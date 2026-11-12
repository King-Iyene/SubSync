import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant regression for the Workflows second pass: company A (an agency) asks for company B's account on outcomes, the people behind a gap, the library and an install.
// Nothing of B may come back (data or echoed id), A's own numbers must be right. Tiny xtest- fixtures, removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-wfo-a", CO_B = "xtest-wfo-b", A1 = "xtestWfoA1", B1 = "xtestWfoB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string) => signSession({ companyId: company, userId: "u-agency", role: "admin", userName: "T", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${session(CO_A)}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* not json */ }
  return { status: res.status, text: t, body: parsed };
}

describe.skipIf(!HAS_DB)("workflows outcomes cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from lead_touches limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzWfo A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzWfo B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A1}, 'zzWfo Client A1', 'UTC', true), (${instB}, ${B1}, 'zzWfo Client B1', 'UTC', true)`;
    const lead = (inst: string, loc: string, n: number) => ({ installation_id: inst, location_id: loc, contact_id: `c${n}`, conversation_id: `v${n}`, lead_at: new Date(Date.now() - 5 * 3_600_000) });
    await sql()`insert into lead_touches ${sql()([...[1, 2, 3, 4].map((n) => lead(instA, A1, n)), ...[1, 2, 3].map((n) => lead(instB, B1, n))] as never)}`;
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("counts only the caller's own accounts and is right about them", async () => {
    if (!ok) return;
    const r = await call("GET", "workflows/outcomes");
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(B1);
    expect(r.text).not.toContain("zzWfo Client B1");
    const row = (r.body.rows as Array<Json>).find((x) => x.locationId === A1);
    expect(row?.counts.noTouch).toBe(4);
  });

  it("another company's account is refused or ignored on every part", async () => {
    if (!ok) return;
    for (const [m, p, b] of [
      ["GET", `workflows/outcomes?wa=${B1}`], ["GET", `workflows/gap-people?locationId=${B1}&gap=no_touch`], ["GET", `workflows/gap-people?locationId=${B1}&gap=no_touch&cursor=abc`],
      ["POST", "workflows/install-preview", { template: "noshow_task", locationIds: [B1] }], ["POST", "workflows/install", { template: "noshow_task", locationIds: [B1], token: "1.x" }],
    ] as Array<[("GET" | "POST"), string, unknown?]>) {
      const r = await call(m, p, b);
      expect(r.text, p).not.toContain(B1);
      expect(r.text, p).not.toContain("zzWfo Client B1");
      if (p.includes("gap-people") || p.includes("install")) expect(r.status, p).toBe(404);
    }
    const mine = await call("GET", `workflows/gap-people?locationId=${A1}&gap=no_touch`);
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(4);
    const [{ n }] = await sql()`select count(*)::int n from workflow_changes where installation_id = ${instB}`;
    expect(n).toBe(0);
  });
});
