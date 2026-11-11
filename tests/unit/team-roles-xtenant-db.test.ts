import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant regression for the Team roles routes: company A's people ask for, label, clear and undo company B's people and accounts by every parameter. Nothing of B may come back (data, name, id)
// and B's rows must not change. Also: only a manager changes roles, an account administrator changes only their own account, and every change leaves an append-only history row.
// Skips until the roles migration is applied. Fixtures (xtest-) removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-roles-a", CO_B = "xtest-roles-b", A1 = "xtestRolesA1", A2 = "xtestRolesA2", B1 = "xtestRolesB1";
const UA1 = "xtest-ra-u1", UA2 = "xtest-ra-u2", UB1 = "xtest-rb-u1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business", loc: string | null, personRole: string) =>
  signSession({ companyId: company, userId: `u-${personRole}`, role: personRole.endsWith("user") || personRole === "agency_staff" ? "user" : "admin", userName: "T", demo: false, kind, locationId: loc, personRole } as never);
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* not json */ }
  return { status: res.status, text: t, body: parsed };
}

describe.skipIf(!HAS_DB)("team roles cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from team_member_roles limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzRoles A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzRoles B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${instA}, ${A1}, 'zzRoles Client A1', 'UTC'), (${instA}, ${A2}, 'zzRoles Client A2', 'UTC'), (${instB}, ${B1}, 'zzRoles Client B', 'UTC')`;
    await sql()`insert into team_members (installation_id, user_id, name, role, all_accounts) values (${instA}, ${UA1}, 'zzRoles Alice', 'agency_staff', true), (${instA}, ${UA2}, 'zzRoles Alan', 'agency_staff', true), (${instB}, ${UB1}, 'zzRoles Bruno', 'agency_staff', true)`;
    await sql()`insert into team_member_access (installation_id, user_id, location_id) values (${instA}, ${UA1}, ${A1})`; // an account administrator sees only people who work in their account
    await sql()`insert into team_member_roles (installation_id, user_id, location_id, role) values (${instB}, ${UB1}, '', 'closer')`;
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("reads: B's people, labels and names never appear for A, whatever is asked", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "agency_owner");
    for (const path of ["people3/roles/map", "people3/roles/list", "people3/roles/list?role=closers", "people3/roles/list?q=zzRoles Bruno", "people3/roles/log"]) {
      const r = await call(t, "GET", path);
      expect(r.status, path).toBe(200);
      expect(r.text, path).not.toContain("zzRoles Bruno");
      expect(r.text, path).not.toContain(UB1);
      expect(r.text, path).not.toContain(B1);
      expect(r.text, path).not.toContain("zzRoles Client B");
    }
    expect((await call(t, "GET", `people3/roles/list?location=${B1}`)).status).toBe(404);
    const own = await call(t, "GET", "people3/roles/list");
    expect(own.body.rows.map((x: Json) => x.userId).sort()).toEqual([UA1, UA2]);
    expect(own.body.counts.none).toBe(2);
  });

  it("writes: a label for B's person or account changes nothing; own people work, are logged, and undo", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null, "agency_owner");
    for (const body of [{ userIds: [UB1], role: "setter" }, { userIds: [UA1, UB1], role: "setter" }, { userIds: [UA1], role: "setter", locationId: B1 }]) {
      for (const step of ["preview", "do"]) expect((await call(t, "POST", "people3/roles/set", { ...body, step })).status, JSON.stringify(body)).toBe(404);
    }
    expect((await call(t, "POST", "people3/roles/undo", { batchId: "00000000-0000-0000-0000-000000000000", step: "do" })).status).toBe(404);
    const [{ n }] = await sql()`select count(*)::int n from team_member_roles where installation_id = ${instB}`;
    expect(n).toBe(1);
    const [{ r }] = await sql()`select role r from team_member_roles where installation_id = ${instB} and user_id = ${UB1}`;
    expect(r).toBe("closer");
    expect((await sql()`select 1 from team_member_roles where installation_id = ${instA}`).length).toBe(0);

    const pre = await call(t, "POST", "people3/roles/set", { userIds: [UA1, UA2], role: "setter", step: "preview" });
    expect(pre.status).toBe(200);
    expect(pre.body.preview.changes).toHaveLength(2);
    expect((await sql()`select 1 from team_member_roles where installation_id = ${instA}`).length, "a preview changes nothing").toBe(0);
    const done = await call(t, "POST", "people3/roles/set", { userIds: [UA1, UA2], role: "setter", step: "do" });
    expect(done.status).toBe(200);
    expect(done.body.changed).toBe(2);
    const map = await call(t, "GET", "people3/roles/map");
    expect(map.body.roles[UA1].role).toBe("setter");
    expect(map.body.any).toBe(true);
    // clearing needs the typed words
    expect((await call(t, "POST", "people3/roles/set", { userIds: [UA2], role: null, step: "do" })).status).toBe(400);
    expect((await call(t, "POST", "people3/roles/set", { userIds: [UA2], role: null, step: "do", typed: "zzroles alan" })).status).toBe(200);
    expect((await sql()`select count(*)::int n from team_member_role_history where installation_id = ${instA}`)[0].n).toBe(3);
    // undo the first batch: Alice goes back to no role; Alan (changed again since) is left alone
    const undo = await call(t, "POST", "people3/roles/undo", { batchId: done.body.batchId, step: "do" });
    expect(undo.status).toBe(200);
    expect((await sql()`select 1 from team_member_roles where installation_id = ${instA} and user_id = ${UA1}`).length).toBe(0);
    expect((await sql()`select count(*)::int n from team_member_role_history where installation_id = ${instA}`)[0].n, "history only grows").toBe(4);
  });

  it("who may change roles: staff and account users read but never change; an account administrator changes only their own account", async () => {
    if (!ok) return;
    const staff = session(CO_A, "agency", null, "agency_staff");
    expect((await call(staff, "POST", "people3/roles/set", { userIds: [UA1], role: "closer", step: "do" })).status).toBe(403);
    expect((await call(staff, "GET", "people3/roles/list")).status).toBe(403);
    expect((await call(staff, "GET", "people3/roles/map")).status).toBe(200);
    const acctUser = session(CO_A, "business", A1, "account_user");
    expect((await call(acctUser, "POST", "people3/roles/set", { userIds: [UA1], role: "closer", step: "do" })).status).toBe(403);
    const acctAdmin = session(CO_A, "business", A1, "account_admin");
    expect((await call(acctAdmin, "POST", "people3/roles/set", { userIds: [UA1], role: "closer", locationId: A2, step: "do" })).status, "not their account").toBe(404);
    expect((await call(acctAdmin, "POST", "people3/roles/set", { userIds: [UA1], role: "closer", step: "do" })).status).toBe(200);
    const row = await sql()`select location_id, role from team_member_roles where installation_id = ${instA} and user_id = ${UA1}`;
    expect(row).toHaveLength(1);
    expect(row[0].location_id, "an account administrator's label is for their account only, never the default").toBe(A1);
  });
});
