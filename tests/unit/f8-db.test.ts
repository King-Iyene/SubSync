import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import {
  adminSummary, changedSettingKeys, feedbackGivenBy, logAccountFlags, logKeyChange, logSettingsChange, mySuggestions, recordShippedNotices, recordVote,
  saveFeedback, saveProblem, saveSuggestion, settingsHistory, type Who,
} from "@/lib/feedback-queries";
import { DAILY_LIMIT } from "@/lib/feedback";
import { SYNCED_DELETE, UNINSTALL_DELETE } from "@/lib/tenant-tables";

// Stage F8, on the real database (WRITTEN, NOT RUN in the stage: the lead runs it after the merge). Two fixture companies, no tokens (the scheduler ignores an
// install with none), both removed afterwards. Proves: feedback, problem reports and suggestions are stored per company and per person; a person reads back only
// their own suggestions; the alert to King is a WOULD SEND audit line that holds ids only and never the text typed; the daily limit holds; the settings history
// is the audit log read back and holds names, never values; the vote digest and the shipped notices count companies and voters without naming anyone; and
// "Delete my data" and an uninstall treat the new tables as the lists say.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-f8-a";
const CO_B = "xtest-f8-b";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let a = "";
let b = "";
const who = (installationId: string, person: string, kind: Who["kind"] = "agency", limitTo: string | null = null): Who => ({ installationId, kind, limitTo, who: `${kind}:${limitTo ?? "agency"}:${person}`, actor: person });
const SECRET_TEXT = "my secret words about client Dana Whitfield";

describe.skipIf(!HAS_DB)("feedback, problem reports, suggestions and the settings history", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const [x] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzF8A', 'pro') returning id`;
    const [y] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzF8B', 'pro') returning id`;
    a = x.id as string;
    b = y.id as string;
  });
  afterAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    await closeDb();
  });

  it("feedback and a problem report are stored with who and where, and a reference comes back", async () => {
    const f = await saveFeedback(who(a, "u1"), { message: SECRET_TEXT, page: "speed", severity: "annoying" });
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.reference).toMatch(/^R-[A-Z0-9]{6}$/);
    const p = await saveProblem(who(a, "u1", "client", "locX"), { message: "The list never loaded", page: "inbox", errorId: "E-ABC123" });
    expect(p.ok).toBe(true);
    const rows = await sql()`select kind, who, role, location_id, page, severity, error_id, status from feedback_items where installation_id = ${a} order by created_at`;
    expect(rows.map((r) => [r.kind, r.role, r.location_id, r.page, r.error_id, r.status])).toEqual([["feedback", "agency", null, "speed", null, "new"], ["problem", "client", "locX", "inbox", "E-ABC123", "new"]]);
    expect(await feedbackGivenBy(a, "agency:agency:u1")).toBe(1);
    expect(await feedbackGivenBy(b, "agency:agency:u1"), "another company's count is separate").toBe(0);
  });

  it("the alert to King is a WOULD SEND audit line with ids only: the text typed, the page title and the person's name are never in it", async () => {
    const lines = await sql()`select actor, action, detail from audit_log where installation_id = ${a} and action = 'notify.king.would_send' order by at`;
    expect(lines.length).toBe(2);
    for (const l of lines) {
      const text = JSON.stringify(l.detail);
      expect(text).toContain("WOULD SEND to King");
      expect(text).not.toContain("secret words");
      expect(text).not.toContain("Dana");
      expect(text).not.toContain("never loaded");
    }
    const all = JSON.stringify(await sql()`select detail from audit_log where installation_id = ${a}`);
    expect(all, "no audit line anywhere holds what the person typed").not.toContain("secret words");
  });

  it("suggestions are stored per company and a person reads back only their own, not a colleague's and not another company's", async () => {
    expect((await saveSuggestion(who(a, "u1"), { title: "A weekly team summary", details: "per person", importance: "important", page: "roadmap" })).ok).toBe(true);
    expect((await saveSuggestion(who(a, "u2"), { title: "Colleague's idea", details: null, importance: "nice", page: null })).ok).toBe(true);
    expect((await saveSuggestion(who(b, "u1"), { title: "Other company's idea", details: null, importance: "critical", page: null })).ok).toBe(true);
    expect((await mySuggestions(a, "agency:agency:u1")).map((s) => s.title)).toEqual(["A weekly team summary"]);
    expect((await mySuggestions(a, "agency:agency:u2")).map((s) => s.title)).toEqual(["Colleague's idea"]);
    expect((await mySuggestions(b, "agency:agency:u1")).map((s) => s.title), "the same sign-in id in another company is another person").toEqual(["Other company's idea"]);
    expect((await mySuggestions(a, "agency:agency:u3"))).toEqual([]);
    const lines = JSON.stringify(await sql()`select detail from audit_log where installation_id = ${a} and action in ('roadmap.suggested', 'notify.king.would_send')`);
    expect(lines).not.toContain("weekly team summary");
  });

  it("the daily limit holds, per person", async () => {
    const w = who(a, "spammer");
    for (let i = 0; i < DAILY_LIMIT; i++) expect((await saveFeedback(w, { message: `note ${i}`, page: null, severity: "idea" })).ok).toBe(true);
    const over = await saveFeedback(w, { message: "one too many", page: null, severity: "idea" });
    expect(over).toEqual({ ok: false, tooMany: true });
    expect((await saveFeedback(who(a, "someone-else"), { message: "fine", page: null, severity: "idea" })).ok, "another person is not blocked").toBe(true);
  });

  it("the settings history is the audit log read back: names, never values, newest first, only this company's", async () => {
    await logSettingsChange(a, "Sam", "agency", ["slaHours", "slackWebhookUrl"]);
    await logAccountFlags(a, "Sam", "agency", "locX", ["ignored"]);
    await logKeyChange(a, "Sam", "agency", true);
    await logSettingsChange(b, "Other", "business", ["brandName"]);
    await logSettingsChange(a, "Sam", "agency", []); // nothing changed, nothing written
    const rows = await settingsHistory(a);
    expect(rows.map((r) => r.action)).toEqual(["apikey.created", "accounts.flags_changed", "settings.changed"]);
    expect(rows[2].keys).toEqual(["slaHours", "slackWebhookUrl"]);
    expect(rows[2].actor).toBe("Sam");
    expect(JSON.stringify(rows)).not.toMatch(/hooks\.slack\.com|https?:/);
    expect((await settingsHistory(b)).map((r) => r.keys).flat()).toEqual(["brandName"]);
    expect(await changedSettingKeys(a)).toEqual(new Set(["slaHours", "slackWebhookUrl"]));
    expect(await changedSettingKeys(b)).toEqual(new Set(["brandName"]));
  });

  it("King's summary and the shipped notices count companies and voters, never names", async () => {
    await sql()`insert into roadmap_votes (installation_id, item_key, voter) values (${a}, 'slack-alerts', 'agency:agency:u1'), (${a}, 'slack-alerts', 'client:locX:u9'), (${b}, 'slack-alerts', 'agency:agency:u1')`;
    await recordVote(a, "Sam", "slack-alerts");
    const s = await adminSummary(500);
    const mine = s.votes.find((v) => v.itemKey === "slack-alerts")!;
    expect(mine.votes).toBeGreaterThanOrEqual(3);
    expect(mine.companies).toBeGreaterThanOrEqual(2);
    expect(Object.keys(mine.byKind)).toEqual(expect.arrayContaining(["agency", "client"]));
    for (const row of s.feedback) expect(row.company).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(s.suggestions.concat() as never)).not.toContain("zzF8A");
    const plan = await recordShippedNotices("slack-alerts");
    const ours = plan.filter((p) => p.installationId === a || p.installationId === b);
    expect(ours.map((p) => p.voters).sort()).toEqual([1, 2]);
    const would = await sql()`select detail from audit_log where installation_id = ${a} and detail->>'event' = 'shipped'`;
    expect(would).toHaveLength(1);
    expect(JSON.stringify(would[0].detail)).toContain("WOULD SEND");
    expect(JSON.stringify(would[0].detail)).not.toContain("u1");
  });

  it("the new tables are removed by an uninstall and kept by Delete my data, as the lists say", () => {
    for (const t of ["feedback_items", "roadmap_suggestions"]) {
      expect(UNINSTALL_DELETE).toContain(t);
      expect(SYNCED_DELETE as readonly string[]).not.toContain(t);
    }
  });
});
