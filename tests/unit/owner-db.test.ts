import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// The Owner picker and the owner-change refusal, against fixture companies only (removed afterwards). Skipped with no database, or until the location_users migration is applied.
// WRITE_GHL_LIVE is never set: nothing reaches a CRM.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const CO = "xtest-own-a", CO2 = "xtest-own-b", L1 = "xtestOwnL1", L2 = "xtestOwnL2", L3 = "xtestOwnL3";
let inst = "", inst2 = "", hasTable = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const token = (co: string) => signSession({ companyId: co, userId: "u-admin", role: "admin", userName: "Test", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" } as never);
async function call(co: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${await token(co)}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), p.split("/"));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

describe.skipIf(!HAS_DB)("Owner picker: only this account's team", () => {
  beforeAll(async () => {
    hasTable = (await sql()`select to_regclass('public.location_users') t`)[0].t !== null;
    for (const co of [CO, CO2]) await sql()`delete from installations where company_id = ${co}`;
    const mk = async (co: string) => (await sql()`insert into installations (company_id, company_name, plan) values (${co}, ${"zzOwn " + co}, 'pro') returning id`)[0].id as string;
    inst = await mk(CO); inst2 = await mk(CO2);
    for (const i of [inst, inst2]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    for (const [i, l] of [[inst, L1], [inst, L2], [inst2, L3]]) await sql()`insert into locations (installation_id, location_id, name, timezone) values (${i}, ${l}, ${"zzOwn " + l}, 'America/New_York')`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, assigned_to) values (${inst}, ${L1}, 'c1-ada', 'Ada', 'Test', 'c1@x.test', '{}', 'u-gone')`;
    if (hasTable) {
      await sql()`insert into location_users (installation_id, location_id, user_id, name) values (${inst}, ${L1}, 'u-bea', 'Bea Zed'), (${inst}, ${L1}, 'u-al', 'Al Able'), (${inst}, ${L2}, 'u-other', 'Other Account'), (${inst2}, ${L3}, 'u-foreign', 'Foreign Co')`;
    }
  });
  afterAll(async () => { for (const co of [CO, CO2]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("lists this account's people by name, sorted, current owner as Unknown user; nobody from another account or company", async () => {
    const r = await call(CO, "GET", `workbench/context?locationId=${L1}&contactId=c1-ada`);
    expect(r.status).toBe(200);
    const names = (r.body.users as Array<{ id: string; name: string }>).map((u) => u.name);
    expect(names.some((n) => /^Team member/.test(n))).toBe(false);
    if (!hasTable) return;
    expect(names).toEqual(["Unknown user", "Al Able", "Bea Zed"]);
    expect(names).not.toContain("Other Account");
    expect(names).not.toContain("Foreign Co");
  });

  it("refuses an owner change to someone who is not on this account's team", async () => {
    for (const userId of ["u-other", "u-foreign", "u-nobody"]) {
      const r = await call(CO, "POST", "workbench/preview", { locationId: L1, contactId: "c1-ada", action: { kind: "owner", userId } });
      expect(r.status).toBe(404);
    }
    if (!hasTable) return;
    const ok = await call(CO, "POST", "workbench/preview", { locationId: L1, contactId: "c1-ada", action: { kind: "owner", userId: "u-bea" } });
    expect(ok.status).toBe(200);
  });
});
