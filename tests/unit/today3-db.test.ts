import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { recordToday, forgetToday } from "@/lib/analytics/today3-queries";
import { runTodayEmail } from "@/lib/analytics/today3-email";

// Cross-tenant and counts-equal-rows test for Today. Two fake companies (prefix xtest-), tiny fixtures, removed afterwards. Checks:
//   1. Every part and every list kind, asked for the other company's account by every parameter, gives nothing and never echoes the id or the other company's names.
//   2. The count on the ranked list equals the total of the rows it opens (waiting over a day, no outcome).
//   3. A put-aside mark by one company is invisible and unusable by the other; a team member cannot set one.
//   4. The sweep writes the ledger once: a second run with the same counts changes nothing; a drop is recorded as cleared.
// Skips until the Today migrations are applied (the td_ tables).
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])), locked: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-td-a", CO_B = "xtest-td-b", A1 = "xtestTdA1", B1 = "xtestTdB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null, userId = "u-1") =>
  signSession({ companyId: company, userId, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* csv */ }
  return { status: res.status, text, body: parsed };
}

describe.skipIf(!HAS_DB)("today cross-tenant and counts", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from td_daily_items limit 1`; await sql()`select 1 from td_snoozes limit 1`; await sql()`select 1 from client_daily limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzTd A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzTd B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access, last_synced_at) values (${instA}, ${A1}, 'zzTd Client A', 'UTC', true, 'ok', now()), (${instB}, ${B1}, 'zzTd Client B', 'UTC', true, 'ok', now())`;
    const conv = (i: string, l: string, id: string, hoursAgo: number) => ({ installation_id: i, location_id: l, conversation_id: id, contact_id: `c-${id}`, contact_name: `Person ${id}`, last_message_direction: "inbound", last_message_at: new Date(Date.now() - hoursAgo * 3_600_000) });
    await sql()`insert into cached_conversations ${sql()([conv(instA, A1, "ta1", 30), conv(instA, A1, "ta2", 50), conv(instB, B1, "tb1", 40)] as never)}`;
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("the count on the ranked list equals the rows it opens", async () => {
    if (!ready) return;
    const a = session(CO_A, "agency", null);
    const t = await call(a, "GET", "today3?part=today");
    expect(t.status, t.text).toBe(200);
    const item = (t.body.items as Json[]).find((i) => i.kind === "waiting_old");
    expect(item?.count).toBe(2);
    const l = await call(a, "GET", "today3?part=list&kind=waiting_old");
    expect(l.body.total).toBe(2);
    expect(l.body.rows).toHaveLength(2);
    expect(l.text).not.toContain("zzTd Client B");
    expect(t.text).not.toContain("zzTd Client B");
  });

  it("every part and list kind, asked for the other company's account, gives nothing and is never echoed", async () => {
    if (!ready) return;
    const a = session(CO_A, "agency", null);
    const bad = [B1, "../x", "a'; select 1;--", "%00", "x".repeat(200)];
    const kinds = ["waiting_old", "waiting", "unmarked", "noshows", "stale_deals", "needs_permission", "sync_old", "leads_down", "staff_quiet", "no_owner", "no_phone", "open_deals", "all_waiting", "all_noshows", "all_stale", "mine_waiting"];
    for (const v of bad) {
      const e = encodeURIComponent(v);
      const reads = [...["today", "proof", "numbers", "settings", "export", "options"].map((p) => `today3?part=${p}&location=${e}&week=${e}&days=${e}`), ...kinds.map((k) => `today3?part=list&kind=${k}&location=${e}`), `today3?part=list&kind=${e}`];
      for (const path of reads) {
        const r = await call(a, "GET", path);
        expect(r.status, path).toBeLessThan(500);
        expect(r.text, path).not.toContain(B1);
        expect(r.text, path).not.toContain("zzTd Client B");
        if (v.length < 100 && v !== B1) expect(r.text, path).not.toContain(v);
      }
      for (const [name, body] of [["snooze", { kind: "waiting", location: v }], ["opened", { kind: "waiting", location: v }], ["unsnooze", { id: v }]] as Array<[string, Json]>) {
        const r = await call(a, "POST", `today3/act/${name}`, body);
        expect(r.status, `${name} ${v}`).toBeLessThan(500);
        expect(r.text, `${name} ${v}`).not.toContain(B1);
      }
    }
    const [{ n }] = await sql()`select count(*)::int n from td_snoozes where installation_id = ${instB}`;
    expect(n).toBe(0);
  });

  it("a put-aside mark by A moves A's list, never B's, and a team member cannot set one", async () => {
    if (!ready) return;
    const a = session(CO_A, "agency", null), b = session(CO_B, "agency", null), staff = session(CO_A, "client", A1, "u-staff");
    const s = await call(a, "POST", "today3/act/snooze", { kind: "waiting_old", days: 1 });
    expect(s.status, s.text).toBe(200);
    forgetToday(instA);
    const after = await call(a, "GET", "today3?part=today");
    expect((after.body.items as Json[]).map((i) => i.kind)).not.toContain("waiting_old");
    expect((after.body.snoozed as Json[]).map((i) => i.kind)).toContain("waiting_old");
    expect((await call(b, "POST", "today3/act/unsnooze", { id: s.body.id })).status).toBe(404);
    expect((await call(staff, "POST", "today3/act/snooze", { kind: "waiting", days: 1 })).status).toBeGreaterThanOrEqual(403);
    expect((await call(a, "POST", "today3/act/unsnooze", { id: s.body.id })).status).toBe(200);
    forgetToday(instA);
    expect(((await call(a, "GET", "today3?part=today")).body.items as Json[]).map((i) => i.kind)).toContain("waiting_old");
  });

  // Regression guard (a bare `day` alias once made every Clients part answer 500 on a real database): every part and list kind must actually run and answer 200.
  it("answers 200 for every part and kind, own account and foreign account, and for a team member", { timeout: 300_000 }, async () => {
    if (!ready) return;
    const a = session(CO_A, "agency", null), staff = session(CO_A, "client", A1, "u-staff");
    const kinds = ["waiting_old", "waiting", "unmarked", "noshows", "stale_deals", "needs_permission", "sync_old", "leads_down", "staff_quiet", "no_owner", "no_phone", "open_deals", "all_waiting", "all_noshows", "all_stale", "mine_waiting", "mine_unmarked", "mine_stale"];
    const paths = [
      ...["today", "proof", "numbers", "settings", "export", "options"].flatMap((p) => [`today3?part=${p}`, `today3?part=${p}&location=${A1}`, `today3?part=${p}&location=${B1}`]),
      ...kinds.flatMap((k) => [`today3?part=list&kind=${k}`, `today3?part=list&kind=${k}&location=${A1}`, `today3?part=list&kind=${k}&location=${B1}`]),
      "today3?part=numbers&days=7", "today3?part=numbers&days=90", "today3?part=proof&week=2026-11-02&page=1&size=50",
    ];
    for (const who of [a, staff]) {
      for (let i = 0; i < paths.length; i += 6) {
        const batch = paths.slice(i, i + 6);
        const out = await Promise.all(batch.map((p) => call(who, "GET", p)));
        out.forEach((r, k) => {
          expect(r.status, batch[k]).toBe(200);
          if (batch[k].includes(`location=${B1}`)) expect(r.text, batch[k]).not.toContain(B1);
        });
      }
    }
    // A team member sees only their own account, never the owner-only controls.
    expect((await call(staff, "POST", "today3/act/settings", { emailOn: false })).status).toBeGreaterThanOrEqual(403);
    // The owner saves the daily email choice; a bad address is refused; the choice reads back.
    expect((await call(a, "POST", "today3/act/settings", { emailOn: true, emailHour: 7, quietDays: [0, 6], recipients: ["not an email"] })).status).toBe(400);
    expect((await call(a, "POST", "today3/act/settings", { emailOn: true, emailHour: 8, quietDays: [0, 6], recipients: ["owner@example.com"] })).status).toBe(200);
    const back = await call(a, "GET", "today3?part=settings");
    expect(back.body).toMatchObject({ emailOn: true, emailHour: 8, quietDays: [0, 6], recipients: ["owner@example.com"], canEdit: true });
    expect((await call(session(CO_B, "agency", null), "GET", "today3?part=settings")).text).not.toContain("owner@example.com");
  });

  it("the sweep records once, a second run changes nothing, and a drop is cleared", async () => {
    if (!ready) return;
    const now = Date.now();
    await recordToday(instA, now);
    const rows = async () => (await sql()`select kind, last_count, found, cleared, baseline from td_daily_items where installation_id = ${instA} and location_id = ${A1} and kind = 'waiting_old'`) as unknown as Json[];
    const first = await rows();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ last_count: 2, found: 0, cleared: 0, baseline: true });
    forgetToday(instA);
    await recordToday(instA, now + 60_000);
    expect((await rows())[0]).toMatchObject({ last_count: 2, found: 0, cleared: 0 });
    // One person is answered: the count drops by one and it is recorded as cleared.
    await sql()`update cached_conversations set last_message_direction = 'outbound' where installation_id = ${instA} and conversation_id = 'ta1'`;
    const { clientsCache } = await import("@/lib/analytics/clients3-queries");
    clientsCache.clear("");
    await recordToday(instA, now + 120_000);
    expect((await rows())[0]).toMatchObject({ last_count: 1, cleared: 1 });
    // The weekly receipt is kept too (the whole business and the account), once per week, and a second sweep does not add rows.
    const rc = async () => ((await sql()`select count(*)::int n from td_receipts where installation_id = ${instA}`) as unknown as Array<{ n: number }>)[0].n;
    const n1 = await rc();
    expect(n1).toBeGreaterThanOrEqual(2);
    await recordToday(instA, now + 180_000);
    expect(await rc()).toBe(n1);
    const [r] = (await sql()`select found, cleared from td_receipts where installation_id = ${instA} and location_id = ${A1} order by week_start desc limit 1`) as unknown as Array<{ found: number; cleared: number }>;
    expect(r.cleared).toBeGreaterThanOrEqual(1);
    // The record never shows B's account to A.
    const proof = await call(session(CO_A, "agency", null), "GET", "today3?part=proof");
    expect(proof.text).not.toContain("zzTd Client B");
  });

  it("the daily email goes to the chosen people once a day at their hour, and only through the gated sender", { timeout: 120_000 }, async () => {
    if (!ready) return;
    delete process.env.SEND_EMAIL_LIVE; // the switch stays off: a dry run only
    await sql()`insert into td_prefs (installation_id, email_on, email_hour, quiet_days, recipients) values (${instA}, true, 7, '{}', array['one@example.com', 'two@example.com'])
      on conflict (installation_id) do update set email_on = true, email_hour = 7, quiet_days = '{}', recipients = array['one@example.com', 'two@example.com'], last_sent_key = null`;
    const seven = Date.parse("2026-11-11T07:05:00Z");
    expect(await runTodayEmail(instA, Date.parse("2026-11-11T03:00:00Z"))).toBe(0); // not the hour yet
    expect(await runTodayEmail(instA, seven)).toBe(2); // one message per person
    expect(await runTodayEmail(instA, seven + 600_000)).toBe(0); // the same day again: nothing
    expect(await runTodayEmail(instB, seven)).toBe(0); // B has no choice saved: nothing, and A's addresses are not B's
  });
});
