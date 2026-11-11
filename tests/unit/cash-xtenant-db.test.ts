import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { sweepDeals, sweepRecover } from "@/lib/analytics/cash-queries";

// Cross-tenant test for the cash features: the missed-lead list, the save-this-account list, the deal alerts and every write they have.
//   1. Each company's sweep and lists hold only its own rows; the other company's id, key, cursor and owner are refused or empty and never echoed.
//   2. Snooze, mute, assign and undo on the other company's row answer "not found" and change nothing.
//   3. Recovery is only counted when the record proves it (a person replied), and a stale deal is flagged from its own stage history.
// Fixtures are tiny (prefix xtest-) and removed afterwards. Skips until the cash migration is applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-cf-a", CO_B = "xtest-cf-b", A1 = "xtestCfA1", B1 = "xtestCfB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, loc: string | null = null) =>
  signSession({ companyId: company, userId: `u-${company}`, role: "admin", userName: "T", demo: false, kind: "agency", locationId: loc, personRole: "agency_owner" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* csv */ }
  return { status: res.status, text, body: parsed };
}
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

describe.skipIf(!HAS_DB)("cash features cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from cf_recover_items limit 1`; await sql()`select 1 from cf_deal_flags limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzCf A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzCf B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access, last_synced_at) values (${instA}, ${A1}, 'zzCf Client A', 'UTC', true, 'ok', now()), (${instB}, ${B1}, 'zzCf Client B', 'UTC', true, 'ok', now())`;
    for (const [i, l, k] of [[instA, A1, "a"], [instB, B1, "b"]] as const) {
      await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, phone, tags) values (${i}, ${l}, ${`xtest-c-${k}1`}, ${`Zed${k}`}, 'Waiting', ${`+1555900${k === "a" ? 1 : 2}00`}, '{}'), (${i}, ${l}, ${`xtest-c-${k}2`}, ${`Yan${k}`}, 'Noshow', ${`+1555900${k === "a" ? 1 : 2}01`}, '{}')`;
      await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_direction, last_message_at) values (${i}, ${l}, ${`xtest-v-${k}1`}, ${`xtest-c-${k}1`}, ${`Zed${k} Waiting`}, 'inbound', ${hoursAgo(30)})`;
      await sql()`insert into cached_appointments (installation_id, location_id, appointment_id, contact_id, status, start_at) values (${i}, ${l}, ${`xtest-a-${k}1`}, ${`xtest-c-${k}2`}, 'noshow', ${hoursAgo(48)})`;
      await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, pipeline_name, stage_id, stage_name, contact_id, contact_name, name, monetary_value, status, assigned_to, last_stage_change_at, created_remote_at)
        values (${i}, ${l}, ${`xtest-o-${k}1`}, 'p1', 'Sales', 's1', 'New', ${`xtest-c-${k}1`}, ${`Zed${k} Waiting`}, ${`Deal ${k}`}, 5000, 'open', 'xtest-owner', ${hoursAgo(24 * 120)}, ${hoursAgo(24 * 130)})`;
      await sql()`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${i}, ${l}, 'p1', 'Sales', ${sql().json([{ id: "s1", name: "New" }] as never)})`;
    }
    await sweepRecover(instA, { force: true });
    await sweepRecover(instB, { force: true });
    await sweepDeals(instA, { force: true });
    await sweepDeals(instB, { force: true });
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("each company's missed-lead list holds only its own people, and the count equals the rows", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B);
    const la = await call(a, "GET", "cash?part=recover-list&kind=all");
    expect(la.status, la.text).toBe(200);
    expect(la.body.rows.map((r: Json) => r.contactId).sort()).toEqual(["xtest-c-a1", "xtest-c-a2"]);
    expect(la.body.total).toBe(la.body.rows.length);
    const sa = await call(a, "GET", "cash?part=recover");
    expect(sa.body.total).toBe(la.body.total);
    expect(sa.body.counts.unanswered).toBe(1);
    expect(sa.body.counts.no_show).toBe(1);
    // the open deal gives the waiting person an estimated value
    expect(la.body.rows.find((r: Json) => r.contactId === "xtest-c-a1").estValue).toBe(5000);
    const lb = await call(b, "GET", "cash?part=recover-list&kind=all");
    expect(lb.text).not.toContain("xtest-c-a");
    expect(lb.text).not.toContain(A1);
    expect(la.text).not.toContain("xtest-c-b");
  });

  it("the other company's account, key and cursor give nothing and are never echoed", async () => {
    if (!ready) return;
    const a = session(CO_A);
    for (const path of [`cash?part=recover-list&account=${B1}`, `cash?part=recover&account=${B1}`, `cash?part=deals-list&account=${B1}`, `cash?part=deals&account=${B1}`, `cash?part=team&account=${B1}`, `cash?part=recover-list&cursor=1%7C${B1}~unanswered~xtest-c-b1~x`]) {
      const r = await call(a, "GET", path);
      expect(r.text, path).not.toContain("xtest-c-b");
      expect(r.text, path).not.toContain("zzCf Client B");
      if (r.status === 200 && r.body.rows) expect(r.body.rows).toEqual([]);
    }
  });

  it("snooze, assign, mute and undo on the other company's rows answer not found and change nothing", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B);
    const keyB = `${B1}~unanswered~xtest-c-b1~xtest-v-b1:0`;
    const before = await sql()`select count(*)::int n from cf_recover_items where installation_id = ${instB} and snoozed_until is not null`;
    expect((await call(a, "POST", "cash/act/snooze", { keys: [keyB], for: "d7" })).status).toBe(404);
    expect((await call(a, "POST", "cash/act/assign", { keys: [keyB], ownerId: "foreign-user", step: "do" })).status).toBe(404);
    expect((await call(a, "POST", "cash/act/mute", { location: B1, days: 7 })).status).toBe(404);
    expect((await call(a, "POST", "cash/act/undo", { batchId: "00000000-0000-4000-8000-000000000000", step: "do" })).status).toBe(404);
    const after = await sql()`select count(*)::int n from cf_recover_items where installation_id = ${instB} and snoozed_until is not null`;
    expect(after[0].n).toBe(before[0].n);
    expect((await sql()`select count(*)::int n from cf_mutes where installation_id = ${instB}`)[0].n).toBe(0);
    // B really has the row (so the refusals above were about ownership, not a missing row)
    expect((await call(b, "GET", "cash?part=recover-list")).body.rows.some((r: Json) => r.contactId === "xtest-c-b1")).toBe(true);
  });

  it("a set-aside row leaves the list and comes back; a muted account leaves the save list", async () => {
    if (!ready) return;
    const a = session(CO_A);
    const rows = (await call(a, "GET", "cash?part=recover-list&kind=unanswered")).body.rows as Json[];
    const key = rows[0].key as string;
    expect((await call(a, "POST", "cash/act/snooze", { keys: [key], for: "d3" })).status).toBe(200);
    expect((await call(a, "GET", "cash?part=recover-list&kind=unanswered")).body.total).toBe(0);
    expect((await call(a, "GET", "cash?part=recover-list&kind=all&snoozed=1")).body.total).toBe(1);
    expect((await call(a, "POST", "cash/act/unsnooze", { keys: [key] })).status).toBe(200);
    expect((await call(a, "GET", "cash?part=recover-list&kind=unanswered")).body.total).toBe(1);
    const save = await call(a, "GET", "cash?part=save");
    expect(save.status, save.text).toBe(200);
    expect(save.body.accounts.some((x: Json) => x.locationId === A1)).toBe(true);
    const m = await call(a, "POST", "cash/act/mute", { location: A1, days: 7 });
    expect(m.status).toBe(200);
    expect((await call(a, "GET", "cash?part=save")).body.accounts.some((x: Json) => x.locationId === A1)).toBe(false);
    expect((await call(a, "POST", "cash/act/unmute", { id: m.body.id })).status).toBe(200);
  });

  it("a person is counted as won back only when the record shows a reply", async () => {
    if (!ready) return;
    const a = session(CO_A);
    // Nothing recorded: removing the waiting message ends the row as "dropped", which is not counted.
    await sql()`update cached_conversations set last_message_direction = 'outbound' where installation_id = ${instA} and conversation_id = 'xtest-v-a1'`;
    await sweepRecover(instA, { force: true });
    let s = await call(a, "GET", "cash?part=recover");
    expect(s.body.recovered.count).toBe(0);
    expect((await sql()`select recovered_how from cf_recover_items where installation_id = ${instA} and contact_id = 'xtest-c-a1'`)[0].recovered_how).toBe("dropped");
    // A person's outbound touch after the message: the no-show person is not touched, so only the proven reply counts.
    await sql()`update cached_conversations set last_message_direction = 'inbound', last_message_at = ${hoursAgo(20)} where installation_id = ${instA} and conversation_id = 'xtest-v-a1'`;
    await sweepRecover(instA, { force: true });
    await sql()`insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, user_id, automated) values (${instA}, ${A1}, 'xtest-c-a1', 'xtest-cf-touch-1', 'outbound', 'sms', 'message', now(), 'u1', false)`;
    await sql()`update cached_conversations set last_message_direction = 'outbound' where installation_id = ${instA} and conversation_id = 'xtest-v-a1'`;
    await sweepRecover(instA, { force: true });
    s = await call(a, "GET", "cash?part=recover");
    expect(s.body.recovered.count).toBe(1);
    expect(s.body.recovered.value).toBe(5000);
  });

  it("a deal that sat too long in its stage is flagged for its own account only", async () => {
    if (!ready) return;
    const a = session(CO_A), b = session(CO_B);
    const la = await call(a, "GET", "cash?part=deals-list&kind=slipping");
    expect(la.status, la.text).toBe(200);
    expect(la.body.rows.map((r: Json) => r.opportunityId)).toEqual(["xtest-o-a1"]);
    expect(la.body.total).toBe(1);
    expect((await call(b, "GET", "cash?part=deals-list&kind=slipping")).text).not.toContain("xtest-o-a1");
  });
});
