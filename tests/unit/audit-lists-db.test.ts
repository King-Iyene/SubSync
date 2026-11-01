import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { accountRows } from "@/lib/analytics/queries";
import { appointmentList, staleDealList, waitingList } from "@/lib/analytics/audit-queries";

// Stage F6, KF-6: the list behind an audit number has exactly the rows that number counted. Built on a golden dataset in the real database (two fixture
// companies, removed afterwards; neither has a refresh token, so the production scheduler ignores them). WRITTEN, NOT RUN in the parallel stage: the
// lead runs it after the merge. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-f6-a", CO_B = "xtest-f6-b";
const LOC = "xtestF6LocA", LOC2 = "xtestF6LocA2", LOC_IGN = "xtestF6LocIgn", LOC_B = "xtestF6LocB";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const SETTINGS = { staleDays: 30, dormantDays: 30, slaHours: 4, speedTargetMinutes: 15 };
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

let instA = "", instB = "";

async function mkInstall(company: string) {
  await sql()`delete from installations where company_id = ${company}`;
  const tok = encryptSecret("not-a-real-token");
  const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${company}, ${"zz" + company}, 'pro', ${tok}, now() + interval '1 hour') returning id`;
  await sql()`insert into settings (installation_id) values (${i.id}) on conflict do nothing`;
  return i.id as string;
}
async function deal(inst: string, loc: string, id: string, o: { value: number; owner: string | null; contact?: string | null; acted: Date; stage?: string }) {
  await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, assigned_to, last_stage_change_at, last_action_at, updated_remote_at, last_status_change_at, created_remote_at)
    values (${inst}, ${loc}, ${id}, 'p1', ${o.stage ?? "s1"}, ${o.contact === undefined ? "c-" + id : o.contact}, ${"Contact " + id}, ${"Deal " + id}, ${o.value}, 'open', ${o.owner}, ${o.acted}, ${o.acted}, ${o.acted}, ${o.acted}, ${ago(90)})`;
}
async function conv(inst: string, loc: string, id: string, o: { dir: string; at: Date }) {
  await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at, unread_count)
    values (${inst}, ${loc}, ${id}, ${"c-" + id}, ${"Person " + id}, 'TYPE_SMS', ${o.dir}, ${o.at}, 0)`;
}

describe.skipIf(!HAS_DB)("the lists behind the audit have the same rows as its numbers", () => {
  beforeAll(async () => {
    instA = await mkInstall(CO_A); instB = await mkInstall(CO_B);
    for (const [inst, loc, name, ign] of [[instA, LOC, "F6 Fixture A", false], [instA, LOC2, "F6 Fixture A2", false], [instA, LOC_IGN, "F6 Ignored", true], [instB, LOC_B, "F6 Other Company", false]] as const) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, ignored) values (${inst}, ${loc}, ${name}, 'UTC', ${ign})`;
      await sql()`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${inst}, ${loc}, 'p1', 'Sales', ${sql().json([{ id: "s1", name: "New" }, { id: "s3", name: "Disqualified" }] as never)})`;
    }
    // Account A: stale and counted: a (5,000), b (2,000). Not stale: c. No owner: d. No value: e. Closed-out stage: f. Fresh: g.
    await deal(instA, LOC, "a", { value: 5000, owner: "u1", acted: ago(60) });
    await deal(instA, LOC, "b", { value: 2000, owner: "u1", acted: ago(45) });
    await deal(instA, LOC, "c", { value: 900, owner: "u1", acted: ago(5) });
    await deal(instA, LOC, "d", { value: 700, owner: null, acted: ago(90) });
    await deal(instA, LOC, "e", { value: 0, owner: "u1", acted: ago(90) });
    await deal(instA, LOC, "f", { value: 4000, owner: "u1", acted: ago(90), stage: "s3" });
    await deal(instA, LOC2, "h", { value: 1500, owner: "u2", acted: ago(40) });
    await deal(instA, LOC_IGN, "i", { value: 9000, owner: "u1", acted: ago(70) });
    await deal(instB, LOC_B, "z", { value: 8000, owner: "u9", acted: ago(70) });
    // Waiting: p (inbound 6 h ago), q (inbound 20 days ago), not waiting: r (inbound 1 h ago, inside the target), s (outbound), t (inbound 40 days ago, older than the window).
    await conv(instA, LOC, "p", { dir: "inbound", at: hoursAgo(6) });
    await conv(instA, LOC, "q", { dir: "inbound", at: ago(20) });
    await conv(instA, LOC, "r", { dir: "inbound", at: hoursAgo(1) });
    await conv(instA, LOC, "s", { dir: "outbound", at: hoursAgo(8) });
    await conv(instA, LOC, "t", { dir: "inbound", at: ago(40) });
    await conv(instA, LOC2, "u", { dir: "inbound", at: hoursAgo(30) });
    await conv(instA, LOC_IGN, "v", { dir: "inbound", at: hoursAgo(30) });
    await conv(instB, LOC_B, "w", { dir: "inbound", at: hoursAgo(30) });
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  it("stale deals: the count and the dollars equal the account totals the audit adds up, and only counted deals are listed", async () => {
    const live = (await accountRows(instA, SETTINGS)).filter((r) => !r.ignored);
    const ids = live.map((r) => r.locationId);
    const list = await staleDealList(instA, ids, SETTINGS.staleDays);
    expect(list.total).toBe(live.reduce((s, r) => s + r.staleOpps, 0));
    expect(list.totalValue).toBe(live.reduce((s, r) => s + r.staleValue, 0));
    expect(list.rows.map((r) => r.id).sort()).toEqual(["a", "b", "h"]);
    expect(list.rows.map((r) => r.id)[0], "largest first").toBe("a");
    expect(list.rows[0].contactId).toBe("c-a");
    expect(list.rows[0].detail).toMatch(/\$5,000 in New \(Sales\), no change for 60 days/);
  });

  it("a cap sends fewer rows but never a smaller total", async () => {
    const list = await staleDealList(instA, [LOC, LOC2], 30, 2);
    expect(list.rows.length).toBe(2);
    expect(list.total).toBe(3);
    expect(list.totalValue).toBe(8500);
  });

  it("waiting conversations: the count equals the unanswered figure on the account totals, and the window and the target are respected", async () => {
    const live = (await accountRows(instA, SETTINGS)).filter((r) => !r.ignored);
    const list = await waitingList(instA, live.map((r) => r.locationId), SETTINGS.slaHours);
    expect(list.total).toBe(live.reduce((s, r) => s + r.unanswered, 0));
    expect(list.rows.map((r) => r.id).sort()).toEqual(["p", "q", "u"]);
    expect(list.rows[0].id, "longest wait first").toBe("q");
    expect(list.rows[0].detail).toMatch(/^Text message, waiting \d+ days?$/);
  });

  it("a list never reaches an account the numbers did not cover: another company, an ignored account, or an account left out by the filter", async () => {
    const onlyA2 = await staleDealList(instA, [LOC2], 30);
    expect(onlyA2.rows.map((r) => r.id)).toEqual(["h"]);
    // The ids are the audit's own accounts, but even a forged id from another company returns nothing for this installation.
    const forged = await staleDealList(instA, [LOC_B], 30);
    expect(forged.total).toBe(0);
    expect((await waitingList(instA, [LOC_B], 4)).total).toBe(0);
    // An ignored account is not listed even when named.
    expect((await staleDealList(instA, [LOC_IGN], 30)).total).toBe(0);
    expect((await waitingList(instA, [LOC_IGN], 4)).total).toBe(0);
    // No accounts, no rows.
    expect(await staleDealList(instA, [], 30)).toEqual({ total: 0, totalValue: null, rows: [] });
    // The other company reads only its own.
    expect((await staleDealList(instB, [LOC_B], 30)).rows.map((r) => r.id)).toEqual(["z"]);
  });
});

// Pure: runs without a database.
describe("appointment lists", () => {
  it("appointment rows keep the number the audit shows even when fewer rows were sent", () => {
    const list = appointmentList([{ contactId: "c1", name: "Ann", locationId: "L", locationName: "Acme", at: Date.parse("2026-11-03T10:00:00Z"), calendar: "Consult" }], 14, "Started");
    expect(list.total).toBe(14);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].detail).toMatch(/^Started [A-Za-z]{3},? 3 Nov, Consult$/);
  });
});
