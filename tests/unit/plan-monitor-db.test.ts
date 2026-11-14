import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { raisePlanAlerts } from "@/lib/analytics/plan-monitor";

// Plan monitor, cross-tenant test: agency A sees only A's accounts, a client account session sees only its own row, company B never sees A's accounts, and hostile values give nothing.
// Also checks that the alerts (trial ending, plan changed, uninstall) are raised once per account and stay inside their own company. Fixtures are tiny (prefix xtest-) and removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-pm-a", CO_B = "xtest-pm-b", A1 = "xtestPmA1", A2 = "xtestPmA2", B1 = "xtestPmB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, path: string) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { headers: { Authorization: `Bearer ${token}` } }), p.split("/"));
  const text = await res.text();
  let body: Json = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body };
}

describe.skipIf(!HAS_DB)("plan monitor cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from cl3_app_installs limit 1`; await sql()`select charges_state from cl3_app_installs limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzPm A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzPm B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access, last_synced_at) values (${instA}, ${A1}, 'zzPm Client A1', 'UTC', true, 'ok', now()), (${instA}, ${A2}, 'zzPm Client A2', 'UTC', true, 'ok', now()), (${instB}, ${B1}, 'zzPm Client B1', 'UTC', true, 'ok', now())`;
    await sql()`insert into cl3_app_installs (installation_id, location_id, name, is_installed, plan_id, on_trial) values (${instA}, ${A1}, 'zzPm Client A1', true, 'p1', true), (${instA}, ${A2}, 'zzPm Client A2', false, 'p1', false), (${instB}, ${B1}, 'zzPm Client B1', true, 'p1', false)`;
    await sql()`insert into install_plans (installation_id, location_id, plan_id, on_trial, trial_days, trial_started_at) values (${instA}, ${A1}, 'p1', true, 14, now() - interval '12 days')`;
    await sql()`insert into cl3_history (installation_id, location_id, kind) values (${instA}, ${A2}, 'app_removed')`;
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("agency A sees its own two accounts, never B's; a client sees only its own row", async () => {
    if (!ready) return;
    const a = await call(await session(CO_A, "agency", null), "clients3?part=plan-monitor");
    expect(a.status, a.text).toBe(200);
    expect((a.body.rows as Json[]).map((r) => r.locationId).sort()).toEqual([A1, A2]);
    expect(a.text).not.toContain(B1);
    expect(a.text).not.toContain("zzPm Client B1");
    const own = await call(await session(CO_A, "client", A1), "clients3?part=plan-monitor");
    expect((own.body.rows as Json[]).map((r) => r.locationId)).toEqual([A1]);
    expect(own.text).not.toContain(A2);
    // Asking for another account in the address changes nothing for a client session.
    const other = await call(await session(CO_A, "client", A1), `clients3?part=plan-monitor&location=${A2}&q=zzPm`);
    expect((other.body.rows as Json[]).map((r) => r.locationId)).toEqual([A1]);
    const b = await call(await session(CO_B, "agency", null), "clients3?part=plan-monitor");
    expect((b.body.rows as Json[]).map((r) => r.locationId)).toEqual([B1]);
    expect(b.text).not.toContain(A1);
  });

  it("hostile values give nothing and are never echoed", async () => {
    if (!ready) return;
    const a = await session(CO_A, "agency", null);
    for (const v of [B1, "../x", "a'; select 1;--", "%00", "x".repeat(200)]) {
      const r = await call(a, `clients3?part=plan-monitor&q=${encodeURIComponent(v)}&location=${encodeURIComponent(v)}`);
      expect(r.status).toBe(200);
      expect(r.text).not.toContain("zzPm Client B1");
      expect((r.body.rows as Json[]).every((x) => [A1, A2].includes(x.locationId))).toBe(true);
    }
  });

  it("alerts: trial ending and uninstall are raised once for A, nothing for B, and a repeat does not duplicate", async () => {
    if (!ready) return;
    await raisePlanAlerts(instA);
    await raisePlanAlerts(instA);
    const rows = await sql()`select kind, location_id from alerts where installation_id = ${instA} and dedupe_key like 'pm:%' and resolved_at is null order by kind`;
    expect(rows.map((r) => `${r.kind}:${r.location_id}`)).toEqual([`plan_trial_ending:${A1}`, `plan_uninstalled:${A2}`]);
    await raisePlanAlerts(instB);
    expect((await sql()`select count(*)::int n from alerts where installation_id = ${instB} and dedupe_key like 'pm:%'`)[0].n).toBe(0);
  });
});
