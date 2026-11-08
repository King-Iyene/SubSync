import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { missedStats, missedWaitingPage, missedRecoveredRows } from "@/lib/analytics/missed-calls";
import { speedCoverage } from "@/lib/analytics/speed-v4-queries";
import { sourceRowsPage } from "@/lib/api/dial-routes";

// "Missed calls nobody called back" is one SQL definition (src/lib/analytics/missed-calls.ts, docs/METRICS.md) read by Speed > Coverage and Speed > Call mode.
// Part 1: a golden dataset where every caller is built to be in or out of the list for one named reason, two companies, and the proof that both screens agree.
// Part 2: scale. 100,000 missed calls (and 20,000 leads with deals) on the real database, removed afterwards; every page and count stays inside a time limit, and the other Call mode lists
// (new leads, hot leads, no-show saver, redial) are read one page at a time with their true totals. It is OPT IN (MISSED_SCALE=1) and refuses to run when the shared database is above
// 380 MB: the free database is capped at 500 MB and goes read-only for everyone when full (that happened once when this fixture was first sized at 300,000 leads).
// Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const TAG = "xtest-missed";
vi.setConfig({ testTimeout: 280_000, hookTimeout: 280_000 });
const DAY = 86_400_000, MIN = 60_000;

const make = async (name: string) => {
  const tok = encryptSecret("not-a-real-token");
  const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${`${TAG}-${name}`}, ${"zzMissed " + name}, 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`;
  return i.id as string;
};

describe.skipIf(!HAS_DB)("missed calls nobody called back: golden dataset", () => {
  let A = "", B = "";
  const now = Date.now();
  const at = (ms: number) => new Date(ms);
  const ev = (inst: string, loc: string, contact: string, key: string, o: { dir?: "inbound" | "outbound"; kind?: string; channel?: string; at: number }) =>
    sql()`insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, automated) values (${inst}, ${loc}, ${contact}, ${key}, ${o.dir ?? "inbound"}, ${o.channel ?? "call"}, ${o.kind ?? "missed_call"}, ${at(o.at)}, false)`;
  const person = (inst: string, loc: string, id: string, owner: string | null = null) => sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, phone, assigned_to, date_added) values (${inst}, ${loc}, ${id}, 'Caller', ${id}, '5550100', ${owner}, now())`;

  beforeAll(async () => {
    await sql()`delete from installations where company_id like ${TAG + "-%"}`;
    A = await make("a"); B = await make("b");
    for (const [inst, ids] of [[A, ["L1", "L2"]], [B, ["L1"]]] as const) for (const id of ids) await sql()`insert into locations (installation_id, location_id, name, timezone) values (${inst}, ${id}, ${"Account " + id}, 'UTC')`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, ignored) values (${A}, 'LX', 'Ignored account', 'UTC', true)`;
    const m = (n: number) => now - n * MIN;
    // waiting: a (nothing after), d (only a failed text after), g (a callback BEFORE the latest missed call), t (a missed call in the other account, same id as a)
    await person(A, "L1", "a", "u1"); await ev(A, "L1", "a", "a1", { at: m(30) });
    await person(A, "L1", "d"); await ev(A, "L1", "d", "d1", { at: m(40) }); await ev(A, "L1", "d", "d2", { dir: "outbound", kind: "failed", channel: "sms", at: m(35) });
    await person(A, "L2", "g", "u2"); await ev(A, "L2", "g", "g1", { at: m(500) }); await ev(A, "L2", "g", "g2", { dir: "outbound", kind: "call", at: m(450) }); await ev(A, "L2", "g", "g3", { at: m(20) });
    await person(A, "L2", "a"); await ev(A, "L2", "a", "t1", { at: m(25) });
    // not waiting: b (a text after 5 minutes), c (a call after 20 minutes), e (a call result logged in Call mode), f (older than the range), h (ignored account)
    await person(A, "L1", "b"); await ev(A, "L1", "b", "b1", { at: m(60) }); await ev(A, "L1", "b", "b2", { dir: "outbound", kind: "message", channel: "sms", at: m(55) });
    await person(A, "L1", "c"); await ev(A, "L1", "c", "c1", { at: m(90) }); await ev(A, "L1", "c", "c2", { dir: "outbound", kind: "call", at: m(70) });
    await person(A, "L1", "e"); await ev(A, "L1", "e", "e1", { at: m(120) });
    await sql()`insert into call_outcomes (installation_id, location_id, contact_id, outcome, created_at) values (${A}, 'L1', 'e', 'no_answer', ${at(m(100))})`;
    await person(A, "L1", "f"); await ev(A, "L1", "f", "f1", { at: now - 45 * DAY });
    await person(A, "LX", "h"); await ev(A, "LX", "h", "h1", { at: m(10) });
    // the other company: a caller with the same id as company A's, waiting
    await person(B, "L1", "a"); await ev(B, "L1", "a", "z1", { at: m(15) });
  });
  afterAll(async () => { await sql()`delete from installations where company_id like ${TAG + "-%"}`; await closeDb(); });

  const scope = (inst: string, allowed: string[] | null = null, ownerId?: string) => ({ installationId: inst, allowed, fromMs: now - 30 * DAY, toMs: now + DAY, ownerId });
  const ids = (r: { rows: Array<{ locationId: string; contactId: string }> }) => r.rows.map((x) => `${x.locationId}:${x.contactId}`).sort();

  it("lists exactly the callers nobody reached after their latest missed call", async () => {
    const r = await missedWaitingPage(scope(A), { limit: 50, offset: 0 });
    expect(ids(r)).toEqual(["L1:a", "L1:d", "L2:a", "L2:g"]);
    expect(r.total).toBe(4);
  });
  it("never shows another company, whatever the id (tenant isolation)", async () => {
    expect(ids(await missedWaitingPage(scope(B), { limit: 50, offset: 0 }))).toEqual(["L1:a"]);
    expect((await missedWaitingPage(scope(A, ["L1"]), { limit: 50, offset: 0 })).total).toBe(2);
    expect((await missedWaitingPage({ ...scope(A), installationId: B, allowed: ["L2"] }, { limit: 50, offset: 0 })).total).toBe(0);
  });
  it("account filter, date range and a client's own leads narrow it; a person with no id sees nobody", async () => {
    expect(ids(await missedWaitingPage(scope(A, ["L2"]), { limit: 50, offset: 0 }))).toEqual(["L2:a", "L2:g"]);
    expect((await missedWaitingPage({ ...scope(A), fromMs: now - 25 * MIN, toMs: now + DAY }, { limit: 50, offset: 0 })).total).toBe(2); // only g (20 min ago) and a in L2 (25 min ago is the edge: kept)
    expect(ids(await missedWaitingPage(scope(A, null, "u1"), { limit: 50, offset: 0 }))).toEqual(["L1:a"]);
    expect((await missedWaitingPage(scope(A, null, ""), { limit: 50, offset: 0 })).total).toBe(0);
  });
  it("pages are stable and the total is the same on every page", async () => {
    const p1 = await missedWaitingPage(scope(A), { limit: 3, offset: 0 }), p2 = await missedWaitingPage(scope(A), { limit: 3, offset: 3 });
    expect(p1.rows).toHaveLength(3); expect(p2.rows).toHaveLength(1);
    expect(p1.total).toBe(4); expect(p2.total).toBe(4);
    expect(new Set([...ids(p1), ...ids(p2)]).size).toBe(4);
    expect((await missedWaitingPage(scope(A), { limit: 3, offset: 30 })).total).toBe(4); // past the end still says how many there are
  });
  it("counts calls and recoveries: 15 minutes for a callback or text, 60 seconds for a text", async () => {
    const s = await missedStats(scope(A));
    expect(s.calls).toBe(8); // a, a (L2), b, c, d, e and g twice (two missed calls); f is out of range and h is in an ignored account
    expect(s.recovered15).toBe(1); // only b (text after 5 minutes); c came after 20 minutes; d's text failed
    expect(s.texted60).toBe(0);
    expect((await missedRecoveredRows(scope(A), 10)).map((r) => r.contactId)).toEqual(["b"]);
  });
  it("Coverage and Call mode are the same people, count and dollars", async () => {
    const cov = await speedCoverage({ installationId: A, allowed: null, targetMinutes: 15, now, seePeople: true });
    const call = await sourceRowsPage({ installationId: A }, null, "missed", { offset: 0, limit: 50, fromMs: now - 30 * DAY, toMs: now + DAY });
    expect(cov.missed.unrecovered).toBe(call.total);
    expect(cov.missed.rows.map((r) => `${r.locationId}:${r.contactId}`).sort()).toEqual(call.rows.map((r) => `${r.locationId}:${r.contactId}`).sort());
    expect(cov.missed.dollars).toBe(call.dollars ?? 0);
  });
});

// ---------------------------------------------------------------- scale
const N_MISSED = 100_000, N_LEADS = 20_000, LOCS = 20;
describe.skipIf(!HAS_DB || process.env.MISSED_SCALE !== "1")("missed calls and the Call mode lists at scale (100,000 missed calls)", () => {
  let I = "";
  const now = Date.now();
  const scope = { installationId: "", allowed: null as string[] | null, fromMs: now - 30 * DAY, toMs: now + DAY };
  // The fixture rule, so the counts are known without asking the database: lead g (1..100,000) phoned and missed us (g % 1440) minutes and (g % 25) days ago.
  // Only the first 20,000 callers exist as leads (the rest show as unknown callers). Every third lead was called back (g % 40) minutes later, so it is out of the list; the other two thirds are waiting. Every fifth lead has an open deal of 1,000.
  const waiting = (() => { let n = 0; for (let g = 1; g <= N_MISSED; g++) if (g % 3 !== 0) n++; return n; })();
  const recovered15Calls = (() => { let n = 0; for (let g = 1; g <= N_MISSED; g++) if (g % 3 === 0 && g % 40 <= 14) n++; return n; })();
  const timed = async <T,>(f: () => Promise<T>) => { const t = Date.now(); const v = await f(); return { v, ms: Date.now() - t }; };

  beforeAll(async () => {
    const db = sql();
    const [{ mb }] = await db`select (pg_database_size(current_database()) / 1048576)::int mb`;
    if (mb > 380) throw new Error(`The database is ${mb} MB; the scale fixture needs about 80 MB of room under the 500 MB cap. Free space first.`);
    await db`delete from installations where company_id like ${TAG + "-%"}`;
    I = await make("scale"); scope.installationId = I;
    await db`insert into locations (installation_id, location_id, name, timezone) select ${I}::uuid, 'xm' || g, 'Account ' || lpad(g::text, 3, '0'), 'UTC' from generate_series(1, ${LOCS}::int) g`;
    await db`
      insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, assigned_to, date_added, last_activity_at)
      select ${I}::uuid, 'xm' || (g % ${LOCS} + 1), 'c' || g, 'Lead', 'N' || g, 'l' || g || '@example.test', '555' || g, case when g % 4 = 0 then null else 'u' || (g % 6) end,
        case when g % 50 = 0 then now() - interval '1 hour' else now() - interval '90 days' end, now() - interval '30 days'
      from generate_series(1, ${N_LEADS}::int) g`;
    await db`
      insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, automated)
      select ${I}::uuid, 'xm' || (g % ${LOCS} + 1), 'c' || g, 'm' || g, 'inbound', 'call', 'missed_call', now() - (g % 25) * interval '1 day' - (g % 1440) * interval '1 minute', false from generate_series(1, ${N_MISSED}::int) g`;
    await db`
      insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, automated)
      select ${I}::uuid, 'xm' || (g % ${LOCS} + 1), 'c' || g, 'o' || g, 'outbound', 'sms', 'message', now() - (g % 25) * interval '1 day' - (g % 1440) * interval '1 minute' + (g % 40) * interval '1 minute', false
      from generate_series(1, ${N_MISSED}::int) g where g % 3 = 0`;
    // Redial list: 1,500 leads tried once through Call mode with no answer (leads that were already called back, so the waiting count is unchanged)
    await db`
      insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, automated, source, outcome)
      select ${I}::uuid, 'xm' || ((3 * g) % ${LOCS} + 1), 'c' || (3 * g), 'r' || g, 'outbound', 'call', 'call', now() - interval '1 minute', false, 'subsync_call', 'no_answer' from generate_series(5001, 6500) g`;
    await db`
      insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, assigned_to, last_status_change_at, last_action_at, updated_remote_at, created_remote_at)
      select ${I}::uuid, 'xm' || (g % ${LOCS} + 1), 'o' || g, 'p1', 's0', 'c' || g, 'Lead', 'Deal ' || g, 1000, 'open', 'u1', now() - interval '60 days', now() - interval '60 days', now() - interval '60 days', now() - interval '90 days'
      from generate_series(1, ${N_LEADS}::int) g where g % 5 = 0`;
    await db`
      insert into cached_appointments (installation_id, location_id, appointment_id, contact_id, title, status, start_at, end_at)
      select ${I}::uuid, 'xm' || ((g + 10000) % ${LOCS} + 1), 'a' || g, 'c' || (g + 10000), 'Visit', 'noshow', now() - interval '3 days', now() - interval '3 days' + interval '30 minutes' from generate_series(1, 1000) g`;
    for (const t of ["touch_events", "cached_contacts", "cached_opportunities", "cached_appointments", "call_outcomes"]) await db.unsafe(`analyze ${t}`);
  });
  afterAll(async () => { if (!process.env.MISSED_KEEP) await sql()`delete from installations where company_id like ${TAG + "-%"}`; await closeDb(); });

  it("counts 100,000 missed calls exactly with one aggregate", async () => {
    await missedStats(scope); // warm
    const { v, ms } = await timed(() => missedStats(scope));
    expect(v.calls).toBe(N_MISSED);
    expect(v.recovered15).toBe(recovered15Calls);
    expect(ms).toBeLessThan(8000);
  });
  it("lists the waiting callers one page at a time, with the true total and dollars, fast", async () => {
    await missedWaitingPage(scope, { limit: 20, offset: 0 });
    const first = await timed(() => missedWaitingPage(scope, { limit: 50, offset: 0 }));
    expect(first.v.total).toBe(waiting);
    expect(first.v.rows).toHaveLength(50);
    expect(first.v.dollars).toBeGreaterThan(0);
    expect(first.v.rows[0].dollars).toBeGreaterThanOrEqual(first.v.rows[49].dollars); // dollars first
    expect(first.ms).toBeLessThan(8000);
    const deep = await timed(() => missedWaitingPage(scope, { limit: 100, offset: 60_000 }));
    expect(deep.v.rows).toHaveLength(100);
    expect(deep.v.total).toBe(waiting);
    expect(deep.ms).toBeLessThan(8000);
    const narrowed = await timed(() => missedWaitingPage({ ...scope, allowed: ["xm3"] }, { limit: 20, offset: 0 }));
    expect(narrowed.v.total).toBeGreaterThan(0); expect(narrowed.v.total).toBeLessThan(waiting / 10);
    const mine = await missedWaitingPage({ ...scope, ownerId: "u1" }, { limit: 20, offset: 0 });
    expect(mine.total).toBeGreaterThan(0);
  });
  it("Coverage uses the same count at scale and returns small payloads", async () => {
    const { v, ms } = await timed(() => speedCoverage({ installationId: I, allowed: null, targetMinutes: 15, now, seePeople: true }));
    expect(v.missed.unrecovered).toBe(waiting);
    expect(v.missed.total).toBe(N_MISSED);
    expect(v.missed.rows.length).toBeLessThanOrEqual(50);
    expect(JSON.stringify(v).length).toBeLessThan(400_000);
    expect(ms).toBeLessThan(30_000);
  });
  it("Call mode lists are paged with their true totals (new leads, hot leads, no-show saver, redial)", async () => {
    const o = (offset: number, limit: number) => ({ offset, limit, fromMs: scope.fromMs, toMs: scope.toMs });
    const run = async (list: string) => { await sourceRowsPage({ installationId: I }, null, list, o(0, 20)); return timed(() => sourceRowsPage({ installationId: I }, null, list, o(20, 20))); };
    const fresh = await run("new_unanswered"); expect(fresh.v.total).toBe(400); expect(fresh.v.rows).toHaveLength(20);
    const hot = await run("hot_uncontacted"); expect(hot.v.total).toBe(4000); expect(hot.v.rows).toHaveLength(20);
    const ns = await run("noshow_recovery"); expect(ns.v.total).toBe(1000); expect(ns.v.rows).toHaveLength(20);
    const re = await run("redial"); expect(re.v.total).toBe(1500); expect(re.v.rows).toHaveLength(20);
    for (const r of [fresh, hot, ns, re]) expect(r.ms).toBeLessThan(15_000);
  });
});
