import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { refreshBfRollup, totals } from "@/lib/analytics/bf-queries";

// Booking funnel, against a real database with tiny xtest- fixtures: (1) the numbers are right and the rollup, the live twin and the lists agree, a second refresh changes nothing;
// (2) company A (agency) and a client of A ask for company B's account, calendar, people, source and form by every parameter: nothing of B comes back and B's rows do not change;
// (3) the recover action refuses a foreign account. Everything it creates is removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-bf-a", CO_B = "xtest-bf-b", A1 = "xtestBfA1", A2 = "xtestBfA2", B1 = "xtestBfB1";
let instA = "", instB = "";
const DAY = 86_400_000;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* not json */ }
  return { status: res.status, text: t, body: parsed };
}
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
const RANGE = `from=${day(-10)}&to=${day(0)}`;
const PARTS = ["summary", "breakdown", "leaks", "cohorts", "forecast", "rows", "options"];

/** Twelve leads in one account, three days ago. Furthest step: 2 won, 1 deal open, 1 showed, 2 booked, 4 replied only, 2 untouched. */
async function seedAccount(inst: string, loc: string, tag: string, n = 12) {
  const added = new Date(Date.now() - 3 * DAY);
  for (let i = 0; i < n; i++) {
    const id = `xtestBf${tag}${i}`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, date_added, source, assigned_to)
      values (${inst}, ${loc}, ${id}, ${`Alex${tag}`}, ${`Person${i}x`}, ${`alex${tag}${i}@corp-${tag}.com`}, ${`6175550${String(100 + i)}`}, ${added}, ${`xtest-src-${tag}`}, ${`xtestOwner${tag}`})`;
    if (i < 10) await sql()`insert into touch_events (installation_id, location_id, contact_id, event_key, direction, channel, kind, at, automated) values (${inst}, ${loc}, ${id}, ${`k-${id}`}, 'outbound', 'sms', 'message', ${new Date(added.getTime() + 600_000)}, false)`;
    if (i < 6) await sql()`insert into cached_appointments (installation_id, location_id, appointment_id, calendar_id, calendar_name, contact_id, status, start_at, end_at, assigned_to, booked_by_user, created_remote_at)
      values (${inst}, ${loc}, ${`xtestBfAp${tag}${i}`}, ${`${loc}-cal`}, 'Consult', ${id}, ${i < 4 ? "showed" : i === 4 ? "noshow" : "confirmed"}, ${new Date(added.getTime() + 2 * DAY)}, ${new Date(added.getTime() + 2 * DAY + 1_800_000)}, ${`xtestCloser${tag}`}, ${`xtestSetter${tag}`}, ${new Date(added.getTime() + DAY)})`;
    if (i < 3) await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, contact_id, contact_name, name, monetary_value, status, last_status_change_at, pipeline_name, stage_name)
      values (${inst}, ${loc}, ${`xtestBfOp${tag}${i}`}, ${id}, 'x', 'Deal', 1000, ${i < 2 ? "won" : "open"}, ${new Date(added.getTime() + 3 * DAY - 3600_000)}, 'Sales', 'Stage')`;
  }
}

describe.skipIf(!HAS_DB)("booking funnel", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from bf_funnel_daily limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzBf A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzBf B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A1}, 'zzBf Client A1', 'UTC', true), (${instA}, ${A2}, 'zzBf Client A2', 'UTC', true), (${instB}, ${B1}, 'zzBf Client B', 'UTC', true)`;
    await seedAccount(instA, A1, "a", 12);
    await seedAccount(instB, B1, "b", 12);
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("counts every step by the furthest step a lead reached, and the rollup, the live twin and the lists agree", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    const r = await call(t, "GET", `appointments/funnel?part=summary&${RANGE}&location=${A1}`);
    expect(r.status, r.text).toBe(200);
    expect(r.body.steps.map((s: Json) => s.count)).toEqual([12, 10, 6, 4, 3, 2]);
    expect(r.body.won).toBe(2); expect(r.body.wonValue).toBe(2000);
    // second refresh: the same rows, nothing added twice
    const before = JSON.stringify((await totals({ inst: instA, allowed: null }, { from: new Date(day(-10)), to: new Date(Date.parse(day(0)) + DAY), location: A1 })).tot);
    await refreshBfRollup(instA, { id: A1, name: "x", tz: "UTC" }, 45);
    await refreshBfRollup(instA, { id: A1, name: "x", tz: "UTC" }, 45);
    const after = JSON.stringify((await totals({ inst: instA, allowed: null }, { from: new Date(day(-10)), to: new Date(Date.parse(day(0)) + DAY), location: A1 })).tot);
    expect(after).toBe(before);
    expect((await sql()`select coalesce(sum(leads), 0)::int n from bf_funnel_daily where installation_id = ${instA} and location_id = ${A1}`)[0].n).toBe(12);
    // a number opens exactly its rows
    for (const [step, mode, n] of [["booked", "reached", 6], ["showed", "dropped", 2], ["won", "reached", 2], ["answered", "dropped", 2]] as const) {
      const l = await call(t, "GET", `appointments/funnel?part=rows&${RANGE}&location=${A1}&step=${step}&mode=${mode}`);
      expect(l.status, l.text).toBe(200);
      expect(l.body.total.n, `${step} ${mode}`).toBe(n); expect(l.body.rows.length, `${step} ${mode}`).toBe(n);
    }
    const b = await call(t, "GET", `appointments/funnel?part=breakdown&by=source&${RANGE}&location=${A1}`);
    expect(b.body.rows.length).toBe(1); expect(b.body.rows[0].steps[5].count).toBe(2);
    const p = await call(t, "GET", `appointments/funnel?part=breakdown&by=setter&${RANGE}&location=${A1}`);
    expect(p.body.rows.some((x: Json) => x.steps[0].count === 6)).toBe(true);
  });

  it("an agency cannot read another company's account on any part, by any parameter", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    for (const part of PARTS) {
      for (const extra of [`&location=${B1}`, `&location=${B1}&calendar=${B1}-cal&setter=xtestSetterb&closer=xtestCloserb&owner=xtestOwnerb&source=xtest-src-b&form=x&by=account&step=booked&mode=dropped`, `&by=source&step=booked&mode=reached&after=abc`]) {
        const r = await call(t, "GET", `appointments/funnel?part=${part}&${RANGE}${extra}`);
        for (const s of [B1, "zzBf Client B", "xtestBfb", "xtest-src-b", "xtestSetterb", "xtestCloserb", "Alexb"]) expect(r.text, `${part}${extra} ${s}`).not.toContain(s);
      }
    }
    const own = await call(t, "GET", `appointments/funnel?part=summary&${RANGE}`);
    expect(own.body.steps[0].count).toBe(12); // only A's leads, B's twelve are not added in
  });

  it("a client's staff cannot read a sibling account or another company's, and gets no split by person or account", async () => {
    if (!ok) return;
    const t = session(CO_A, "client", A1);
    for (const part of PARTS) for (const loc of [A2, B1]) {
      const r = await call(t, "GET", `appointments/funnel?part=${part}&${RANGE}&location=${loc}&by=account`);
      expect(r.text, `${part} ${loc}`).not.toContain(loc);
    }
    for (const by of ["setter", "closer", "owner", "account"]) {
      const r = await call(t, "GET", `appointments/funnel?part=breakdown&by=${by}&${RANGE}`);
      expect(r.body.rows, by).toEqual([]);
    }
    const lk = await call(t, "GET", `appointments/funnel?part=leaks&${RANGE}`);
    expect(lk.body.setters).toEqual([]); expect(lk.body.closers).toEqual([]); expect(lk.body.accounts).toEqual([]);
  });

  it("the recover action refuses a foreign account and changes nothing", async () => {
    if (!ok) return;
    const before = JSON.stringify(await sql()`select contact_id, tags from cached_contacts where installation_id = ${instB} order by 1`);
    for (const [t, foreign] of [[session(CO_A, "agency", null), [B1, "nope"]], [session(CO_A, "client", A1), [B1, A2, "nope"]]] as const) {
      for (const account of foreign) for (const stage of ["preview", "do"]) {
        const r = await call(t, "POST", "appointments/funnel-recover", { query: RANGE, account, step: "showed", stage, typed: "recover 2 leads" });
        expect(r.status, `${account} ${stage}`).toBeGreaterThanOrEqual(400);
        expect(r.text).not.toContain("zzBf Client B");
      }
    }
    expect(JSON.stringify(await sql()`select contact_id, tags from cached_contacts where installation_id = ${instB} order by 1`)).toBe(before);
    const own = await call(session(CO_A, "agency", null), "POST", "appointments/funnel-recover", { query: RANGE, account: A1, step: "showed", stage: "preview" });
    expect(own.status, own.text).toBe(200);
    expect(own.body.requested).toBeLessThanOrEqual(2);
    const bad = await call(session(CO_A, "agency", null), "POST", "appointments/funnel-recover", { query: RANGE, account: A1, step: "showed", stage: "do", typed: "wrong words" });
    expect(bad.status).toBe(400);
  });
});
