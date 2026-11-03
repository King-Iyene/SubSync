import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { accountRows, dealHygiene, getSettings, metricsTrend, pipelineCells, scoreHistory, staleDeals } from "@/lib/analytics/queries";
import { communicationGaps } from "@/lib/analytics/comms-queries";
import { excludedOpenDeals, loadDeals, pipelineTrend } from "@/lib/analytics/pipeline-queries";
import { contactOverview } from "@/lib/analytics/contact-queries";
import { teamStats } from "@/lib/analytics/people-queries";
import { saveStageRule, stageInventory } from "@/lib/analytics/stage-rules-sql";
import { currentVersion } from "@/lib/analytics/definitions";
import { isValidEmail, isValidPhone } from "@/lib/analytics/contact-intel";
import { snapshotMetrics } from "@/lib/analytics/service";

// Stage F1 on a golden dataset in the real database, with a fixture company removed afterwards (it has no refresh token, so the production
// scheduler ignores it). Every deal below is built to be in exactly one place, so a total that takes in the wrong deal, or leaves out the right
// one, fails by name. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-f1-co";
const LOC = "xtestF1Loc";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

let inst = "";
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const SETTINGS = { staleDays: 30, dormantDays: 30, slaHours: 4, speedTargetMinutes: 15 };

async function deal(id: string, o: { pipe: string; stage: string; value: number; owner: string | null; status?: string; contact?: string; acted?: Date }) {
  await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, assigned_to, last_stage_change_at, last_action_at, updated_remote_at, last_status_change_at, created_remote_at)
    values (${inst}, ${LOC}, ${id}, ${o.pipe}, ${o.stage}, ${o.contact ?? null}, ${o.contact ?? null}, ${"Deal " + id}, ${o.value}, ${o.status ?? "open"}, ${o.owner}, ${o.acted ?? ago(60)}, ${o.acted ?? ago(60)}, ${o.acted ?? ago(60)}, ${o.acted ?? ago(60)}, ${ago(90)})`;
}
async function contact(id: string, o: { email?: string | null; phone?: string | null; tags?: string[]; added?: Date } = {}) {
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, date_added)
    values (${inst}, ${LOC}, ${id}, 'Golden', ${id}, ${o.email === undefined ? id + "@example.test" : o.email}, ${o.phone === undefined ? "+15550100" : o.phone}, ${o.tags ?? []}, ${o.added ?? ago(200)})`;
}
const row = async () => (await accountRows(inst, SETTINGS)).find((r) => r.locationId === LOC)!;

describe.skipIf(!HAS_DB)("deals in a closed-out stage or an unused pipeline never count (N38)", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO}`;
    const tok = encryptSecret("not-a-real-token");
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${CO}, 'zzF1', 'pro', ${tok}, now() + interval '1 hour') returning id`;
    inst = i.id as string;
    await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${inst}, ${LOC}, 'F1 fixture', 'UTC')`;
    await sql()`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values
      (${inst}, ${LOC}, 'p1', 'Sales', ${sql().json([{ id: "s1", name: "New" }, { id: "s2", name: "Proposal" }, { id: "s3", name: "Disqualified" }] as never)}),
      (${inst}, ${LOC}, 'p2', '[Not IN USE] Old sales', ${sql().json([{ id: "o1", name: "Lead" }] as never)})`;
    // Open deals. counted: a, b. closed-out stage: c. unused pipeline: d. no value: e. no owner: f.
    await contact("ca"); await contact("cb"); await contact("cc"); await contact("cd");
    await deal("a", { pipe: "p1", stage: "s1", value: 1000, owner: "u1", contact: "ca" });
    await deal("b", { pipe: "p1", stage: "s2", value: 2000, owner: "u1", contact: "cb" });
    await deal("c", { pipe: "p1", stage: "s3", value: 5000, owner: "u1", contact: "cc" });
    await deal("d", { pipe: "p2", stage: "o1", value: 7000, owner: "u1", contact: "cd" });
    await deal("e", { pipe: "p1", stage: "s1", value: 0, owner: "u1" });
    await deal("f", { pipe: "p1", stage: "s1", value: 900, owner: null });
    // Closed deals are not affected by the stage they sit in.
    await deal("w", { pipe: "p1", stage: "s3", value: 400, owner: "u1", status: "won" });
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("open pipeline counts only the two deals in play: value, owner, and a stage that is worked", async () => {
    const r = await row();
    expect(r.openOpps).toBe(2);
    expect(r.openValue).toBe(3000);
    expect(r.excludedOpen).toBe(4);
    expect(r.outOfScopeOpen).toBe(2);
    expect(r.wonCount).toBe(1);
  });

  it("the Pipeline's own list and its left-out sentence agree with the account totals", async () => {
    const deals = await loadDeals(inst, null);
    const open = deals.filter((d) => d.status === "open");
    expect(open.map((d) => d.opportunityId).sort()).toEqual(["a", "b"]);
    expect(open.reduce((s, d) => s + d.value, 0)).toBe(3000);
    expect(deals.some((d) => d.status === "won")).toBe(true);
    const ex = await excludedOpenDeals(inst, null);
    expect(ex).toEqual({ count: 4, closedOut: 2, noValue: 1, noOwner: 1 });
    expect(ex.closedOut + ex.noValue + ex.noOwner, "the three reasons never overlap").toBe(ex.count);
  });

  it("stale deals, deal hygiene, the stage cells and the quiet-deals list leave the closed-out deals out too", async () => {
    // All deals were last moved 60 days ago, so every open deal in play is stale.
    expect((await staleDeals(inst, 30, 100)).map((d) => d.opportunityId).sort()).toEqual(["a", "b", "e", "f"]);
    const hyg = (await dealHygiene(inst)).find((h) => h.locationId === LOC)!;
    expect(hyg.open).toBe(4);
    const cells = await pipelineCells(inst);
    const openCells = cells.filter((c) => c.status === "open");
    expect(openCells.reduce((s, c) => s + c.count, 0)).toBe(2);
    expect(openCells.reduce((s, c) => s + c.value, 0)).toBe(3000);
    const gaps = await communicationGaps(inst, null, 7);
    expect(gaps.total).toBe(2);
    expect(gaps.value).toBe(3000);
    expect(gaps.stages.reduce((s, x) => s + x.count, 0)).toBe(gaps.total);
  });

  it("a person's open deals are the same counted deals as the Pipeline", async () => {
    const team = await teamStats(inst, null, 30);
    const u1 = team.find((t) => t.userId === "u1")!;
    expect(u1.openCount).toBe(2);
    expect(u1.openValue).toBe(3000);
    expect(u1.wonCount).toBe(1);
  });

  it("Leads: a contact whose only deal is closed out is not 'in an open deal', and the counted ones are said apart (UX-02)", async () => {
    const o = await contactOverview(inst, null, null);
    expect(o.lifecycle.opportunities).toBe(2);
    expect(o.lifecycle.opportunitiesCounted).toBe(2);
    // Every contact is in exactly one group, including the two whose only deal is closed out or in an unused pipeline.
    expect(o.lifecycle.lost).toBe(2);
    expect(o.lifecycle.leads + o.lifecycle.opportunities + o.lifecycle.customers + o.lifecycle.lost).toBe(o.lifecycle.total);
  });

  it("the stage list names every pipeline and stage with its open deals, for the owner's controls", async () => {
    const inv = await stageInventory(inst, null);
    expect(inv).toContainEqual({ pipeline: "Sales", stage: "Disqualified", deals: 1, countedDeals: 1 });
    expect(inv).toContainEqual({ pipeline: "[Not IN USE] Old sales", stage: "Lead", deals: 1, countedDeals: 1 });
  });

  it("the owner's rule beats the name: marking Disqualified active brings its deal back, and every figure follows at once", async () => {
    const before = (await getSettings(inst)).dealRulesRevision;
    await saveStageRule(inst, "test", { pipelineKey: "sales", stageKey: "disqualified", cls: "active" });
    expect((await getSettings(inst)).dealRulesRevision, "a rule change is a new definition version").toBe(before + 1);
    let r = await row();
    expect(r.openOpps).toBe(3);
    expect(r.openValue).toBe(8000);
    expect(r.outOfScopeOpen).toBe(1);
    expect((await loadDeals(inst, null)).filter((d) => d.status === "open")).toHaveLength(3);
    // A win probability is only an assumption: it changes no count and no version.
    await saveStageRule(inst, "test", { pipelineKey: "sales", stageKey: "new", winProbability: 25 });
    expect((await getSettings(inst)).dealRulesRevision).toBe(before + 1);
    await saveStageRule(inst, "test", { pipelineKey: "[not in use] old sales", stageKey: "", cls: "in_use" });
    r = await row();
    expect(r.openOpps).toBe(4);
    expect(r.openValue).toBe(15_000);
    expect(r.outOfScopeOpen).toBe(0);
    // Taking the rules off puts the names back in charge.
    await saveStageRule(inst, "test", { pipelineKey: "sales", stageKey: "disqualified", cls: null });
    await saveStageRule(inst, "test", { pipelineKey: "[not in use] old sales", stageKey: "", cls: null });
    r = await row();
    expect(r.openOpps).toBe(2);
    expect(r.outOfScopeOpen).toBe(2);
    const left = await sql()`select count(*)::int n from stage_rules where installation_id = ${inst}`;
    expect(left[0].n, "only the win probability rule is left").toBe(1);
  });
});

describe.skipIf(!HAS_DB)("history is never drawn across a change of definition (N39)", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO + "-h"}`;
    const tok = encryptSecret("not-a-real-token");
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${CO + "-h"}, 'zzF1h', 'pro', ${tok}, now() + interval '1 hour') returning id`;
    inst = i.id as string;
    await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name) values (${inst}, ${LOC}, 'F1 history')`;
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO + "-h"}`; await closeDb(); });

  const snap = (daysAgo: number, value: number, version: number | null) => sql()`insert into account_metrics_daily (installation_id, location_id, day, contacts, new_contacts_30d, open_opportunities, open_value, stale_opportunities, unread_conversations, completeness_pct, engagement_score, definition_version)
    values (${inst}, ${LOC}, current_date - ${daysAgo}::int, 100, 10, 5, ${value}, 1, 0, 80, 70, ${version})`;

  it("the pipeline chart draws only the days counted the way today is counted, and says why the others are not drawn", async () => {
    await snap(5, 2_400_000, null);   // before 31 Oct 2026 this was every open deal; later null rows are version 2: neither is today's version
    await snap(4, 2_400_000, 1000);
    await snap(3, 1_000_000, currentVersion(0) - 1000);
    await snap(2, 900_000, currentVersion(0));
    await snap(1, 950_000, currentVersion(0));
    const t = await pipelineTrend(inst, null, 30);
    expect(t.points.map((p) => p.openValue)).toEqual([900_000, 950_000]);
    expect(t.leftOut).toBe(3);
    expect(t.note).toContain("3 earlier days are not drawn");
    expect(t.since).toBeTruthy();
  });

  it("the account trend flags each day, and the churn baseline uses only like-for-like scores while new contacts keep their whole history", async () => {
    const trend = await metricsTrend(inst, LOC, 30);
    expect(trend.map((p) => p.dealsOk)).toEqual([false, false, false, true, true]);
    const h = (await scoreHistory(inst, 30)).get(LOC)!;
    expect(h.scores).toHaveLength(2);
    expect(h.newContacts).toHaveLength(5);
  });

  it("a snapshot written now carries today's version, and a changed stage rule moves the version on", async () => {
    await snapshotMetrics(inst, [{ locationId: LOC, contacts: 1, new30d: 1, openOpps: 1, openValue: 10, staleOpps: 0, unread: 0, completenessPct: 50, score: 50, daysInactive: 1 } as never], 0);
    const [r] = await sql()`select definition_version from account_metrics_daily where installation_id = ${inst} and day = current_date`;
    expect(r.definition_version).toBe(currentVersion(0));
    await saveStageRule(inst, "test", { pipelineKey: "x", stageKey: "y", cls: "closed_out" });
    expect((await getSettings(inst)).dealRulesRevision).toBe(1);
    await snapshotMetrics(inst, [{ locationId: LOC, contacts: 1, new30d: 1, openOpps: 1, openValue: 10, staleOpps: 0, unread: 0, completenessPct: 50, score: 50, daysInactive: 1 } as never], 1);
    const [r2] = await sql()`select definition_version from account_metrics_daily where installation_id = ${inst} and day = current_date`;
    expect(r2.definition_version).toBe(currentVersion(1));
    expect(currentVersion(1)).not.toBe(currentVersion(0));
  });
});

describe.skipIf(!HAS_DB)("leads: cold lists, what a contact has done, and checks that say when they did not run (N45, N46)", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO + "-l"}`;
    const tok = encryptSecret("not-a-real-token");
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${CO + "-l"}, 'zzF1l', 'pro', ${tok}, now() + interval '1 hour') returning id`;
    inst = i.id as string;
    await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, contacts_synced_at) values (${inst}, ${LOC}, 'F1 leads', now())`;
    await sql()`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${inst}, ${LOC}, 'p1', 'Sales', ${sql().json([{ id: "s1", name: "New" }] as never)})`;
    // 6 cold contacts (tagged), 1 of them replied; 4 working contacts: wrote recently, wrote 100 days ago, has a deal, nothing seen.
    for (const n of [1, 2, 3, 4, 5, 6]) await contact("cold" + n, { tags: ["cold email outreach"] });
    await contact("w-recent"); await contact("w-old"); await contact("w-deal"); await contact("w-none");
    const conv = (id: string, contactId: string, dir: string, days: number) => sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count)
      values (${inst}, ${LOC}, ${id}, ${contactId}, ${contactId}, 'TYPE_SMS', ${dir}, ${ago(days)}, 0)`;
    await conv("v1", "cold1", "inbound", 20);       // a cold contact that did reply
    await conv("v2", "cold2", "outbound", 3);       // we wrote, no reply known: not engagement
    await conv("v3", "w-recent", "inbound", 10);
    await conv("v4", "w-old", "inbound", 100);
    await deal("dd", { pipe: "p1", stage: "s1", value: 500, owner: "u1", contact: "w-deal", acted: ago(5) });
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO + "-l"}`; await closeDb(); });

  it("with the tag names deciding, the cold list is kept apart and each kind of working lead is counted by what was seen", async () => {
    const o = await contactOverview(inst, null, null);
    expect(o.engagement.cold).toBe(6);
    expect(o.engagement.working).toBe(4);
    expect(o.engagement.recent).toBe(2);        // w-recent (wrote 10 days ago) and w-deal (a deal 5 days ago)
    expect(o.engagement.quietAfter).toBe(1);    // w-old wrote 100 days ago and nothing since
    expect(o.engagement.noneSeen).toBe(1);      // w-none
    expect(o.engagement.coldLists).toEqual([{ tag: "cold email outreach", contacts: 6, engaged: 1, source: "name" }]);
    expect(o.engagement.coldChosen).toBe(false);
  });

  it("the owner's choice replaces the guess, an empty choice means nothing is cold, and a tag nobody has is ignored", async () => {
    const chosenNone = await contactOverview(inst, null, []);
    expect(chosenNone.engagement.cold).toBe(0);
    expect(chosenNone.engagement.working).toBe(10);
    expect(chosenNone.engagement.coldChosen).toBe(true);
    const chosenSome = await contactOverview(inst, null, ["cold email outreach", "no such tag"]);
    expect(chosenSome.engagement.cold).toBe(6);
    expect(chosenSome.engagement.coldLists[0].source).toBe("owner");
  });

  it("the data checks ran: every contact has an email and a phone here, so the zeros are real zeros out of the number checked", async () => {
    const o = await contactOverview(inst, null, null);
    expect(o.quality.invalidEmails).toEqual({ state: "checked", value: 0, of: 10 });
    expect(o.quality.invalidPhones).toEqual({ state: "checked", value: 0, of: 10 });
    expect(o.quality.missingEmails).toEqual({ state: "checked", value: 0, of: 10 });
  });

  it("invalid, disposable and missing values are counted apart", async () => {
    await contact("bad1", { email: "not-an-email", phone: "123" });
    await contact("bad2", { email: "x@mailinator.com", phone: null });
    await contact("bad3", { email: null, phone: "+15550199" });
    const o = await contactOverview(inst, null, null);
    expect(o.quality.invalidEmails).toEqual({ state: "checked", value: 1, of: 12 });     // not-an-email (13 contacts, 12 have an email)
    expect(o.quality.disposableEmails).toEqual({ state: "checked", value: 1, of: 12 });
    expect(o.quality.invalidPhones).toEqual({ state: "checked", value: 1, of: 12 });     // 123 (12 of 13 have a phone)
    expect(o.quality.missingEmails).toEqual({ state: "checked", value: 1, of: 13 });
    expect(o.quality.missingPhones).toEqual({ state: "checked", value: 1, of: 13 });
  });

  it("the database's email check and the JavaScript one say the same about the same addresses", async () => {
    const samples = ["a@b.co", "first.last@example.com", "no-at-sign", "two@@signs.com", "space in@x.com", "a@b", "a@b.c", ".dot@x.com", "dou..ble@x.com", "ok+tag@sub.example.org", "UPPER@EXAMPLE.COM", "  padded@x.com  ", "x".repeat(250) + "@x.com"];
    for (const [i, email] of samples.entries()) await contact("em" + i, { email, phone: "+15550100" });
    const rows = await sql()`select contact_id, email from cached_contacts where installation_id = ${inst} and contact_id like 'em%'`;
    const fromDb = await contactOverview(inst, null, null);
    // Count the invalid ones in JavaScript over the same rows and compare with the database count (the earlier fixtures add one more invalid address).
    const invalidJs = rows.filter((r) => (r.email as string).trim() !== "" && !isValidEmail(r.email as string)).length;
    expect(invalidJs, "the samples really do include invalid and valid addresses").toBeGreaterThan(5);
    expect((fromDb.quality.invalidEmails as { value: number }).value).toBe(invalidJs + 1);
  });

  it("the database's phone check and the JavaScript one say the same about the same numbers", async () => {
    const phones = ["+15550100", "123", "0000000", "1111111111", "+1 (555) 010-0199", "12345678901234567890", "5550100"];
    for (const [i, phone] of phones.entries()) await contact("ph" + i, { email: `ph${i}@example.test`, phone });
    const rows = await sql()`select phone from cached_contacts where installation_id = ${inst} and contact_id like 'ph%'`;
    const before = await contactOverview(inst, null, null);
    const invalidJs = rows.filter((r) => !isValidPhone(r.phone as string)).length;
    expect(invalidJs).toBeGreaterThan(3);
    // The earlier fixture phone "123" adds one more invalid number.
    expect((before.quality.invalidPhones as { value: number }).value).toBe(invalidJs + 1);
  });
});
