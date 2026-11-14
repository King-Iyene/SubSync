import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { moneyChecks } from "@/lib/api/payments-routes";

// Money checks cross-tenant: company A (an agency, and a client account of A) asks for company B's account on the Money checks part, by the address, with odd ids, and through the reader itself.
// Nothing of B may come back (not its name, not its id), and the platform must never be asked about B's account. Fixtures (xtest-) are removed afterwards. Skips with no database.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD) || Boolean((globalThis as { __subsyncSql?: unknown }).__subsyncSql);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, k === "pm_resend" ? false : true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-mchk-a", CO_B = "xtest-mchk-b", A1 = "xtestMchkA1", A2 = "xtestMchkA2", B1 = "xtestMchkB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", loc: string | null, personRole: string) =>
  signSession({ companyId: company, userId: `u-${personRole}`, role: personRole.endsWith("user") || personRole === "agency_staff" ? "user" : "admin", userName: "T", demo: false, kind, locationId: loc, personRole } as never);
async function call(token: string, path: string) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { headers: { Authorization: `Bearer ${token}` } }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* not json */ }
  return { status: res.status, text: t, body: parsed };
}

describe.skipIf(!HAS_DB)("money checks: cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from locations limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzMchk A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzMchk B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${instA}, ${A1}, 'zzMchk Client A1', 'UTC'), (${instA}, ${A2}, 'zzMchk Client A2', 'UTC'), (${instB}, ${B1}, 'zzMchk Client B', 'UTC')`;
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("an agency asking for another company's account gets nothing, by any spelling of the id", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "agency_owner");
    for (const loc of [B1, B1.toUpperCase(), `${A1},${B1}`, `${B1}%00`, `${A1}&location=${B1}`, "' or 1=1 --"]) {
      const r = await call(t, `payments?part=checks&location=${encodeURIComponent(loc)}`);
      expect(r.text, loc).not.toContain(B1);
      expect(r.text, loc).not.toContain("zzMchk Client B");
      expect(r.body.sections ?? []).toEqual([]);
    }
  });

  it("the reader only ever asks about the account it was given, and an unknown account is not read at all", async () => {
    if (!ok) return;
    const asked: string[] = [];
    const get = () => async (path: string) => { asked.push(path); return { status: 200, body: {} }; };
    const scope = { inst: instA, allowed: null as string[] | null };
    const mine = await moneyChecks({ installationId: instA, demo: false }, { locationToken: async () => "t" }, scope, A1, get);
    expect(mine.account?.id).toBe(A1);
    expect(asked.length).toBeGreaterThan(5);
    expect(asked.every((p) => p.includes(A1) || p.startsWith("/marketplace/billing/charges"))).toBe(true);
    expect(asked.some((p) => p.includes(B1))).toBe(false);
    asked.length = 0;
    const foreign = await moneyChecks({ installationId: instA, demo: false }, { locationToken: async () => "t" }, scope, B1, get);
    expect(foreign.account).toBeNull();
    expect(foreign.sections).toEqual([]);
    expect(asked).toEqual([]);
    // a limited person (allowed = only A2) cannot be pointed at A1 either
    const limited = await moneyChecks({ installationId: instA, demo: false }, { locationToken: async () => "t" }, { inst: instA, allowed: [A2] }, A1, get);
    expect(limited.account).toBeNull();
    expect(asked).toEqual([]);
  });

  it("a client's own team member sees nothing, and a client administrator cannot reach a sibling or another company", async () => {
    if (!ok) return;
    const setter = session(CO_A, "client", A1, "account_user");
    const r = await call(setter, "payments?part=checks");
    expect(r.status).toBe(200);
    expect(r.body.canSee).toBe(false);
    expect(r.body.sections ?? []).toEqual([]);
    const admin = session(CO_A, "business", A1, "account_admin");
    for (const loc of [A2, B1]) {
      const x = await call(admin, `payments?part=checks&location=${loc}`);
      expect(x.text, loc).not.toContain(loc);
      expect(x.text, loc).not.toContain("zzMchk Client");
    }
  });
});
