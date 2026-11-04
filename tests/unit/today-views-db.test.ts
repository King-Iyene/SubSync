import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// A person's saved views of Today against the real database: they belong to the person, keep only this company's own accounts, are capped, and a client's staff keep none.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const CO_A = "xtest-tview-a", CO_B = "xtest-tview-b";
const A1 = "xtestTviewA1", B1 = "xtestTviewB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null, userId: string) =>
  signSession({ companyId: company, userId, role: kind === "client" ? "user" : "admin", userName: userId, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin" });
async function call(token: string, method: string, path: string[], body?: Json): Promise<{ status: number; body: Json }> {
  const res = await handle(new Request(`http://localhost/api/app/${path.join("/")}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), path);
  return { status: res.status, body: (await res.json()) as Json };
}

describe.skipIf(!HAS_DB)("saved views of Today", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzView A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzView B', 'pro') returning id` as unknown as Array<{ id: string }>;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A1}, 'zzView A1', 'UTC', true)`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instB}, ${B1}, 'zzView B1', 'UTC', true)`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("saves, lists and removes a view, keeping only this company's accounts", async () => {
    const me = session(CO_A, "agency", null, "u-me");
    const saved = await call(me, "POST", ["today", "views"], { name: "Clinics", accounts: [A1, B1, "../x"], excludeJunk: true });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.views).toHaveLength(1);
    expect(saved.body.views[0].view).toEqual({ accounts: [A1], excludeJunk: true });
    // The same name again replaces it.
    const again = await call(me, "POST", ["today", "views"], { name: "Clinics", accounts: [], excludeJunk: false });
    expect(again.body.views).toHaveLength(1);
    expect(again.body.views[0].view).toEqual({ accounts: [], excludeJunk: false });
    const gone = await call(me, "DELETE", ["today", "views", again.body.views[0].id]);
    expect(gone.status).toBe(200);
    expect(gone.body.views).toEqual([]);
  });

  it("a view belongs to its person: another person lists none and cannot remove it", async () => {
    const me = session(CO_A, "agency", null, "u-me");
    const other = session(CO_A, "agency", null, "u-other");
    const saved = await call(me, "POST", ["today", "views"], { name: "Mine", accounts: [A1] });
    const id = saved.body.views[0].id as string;
    expect((await call(other, "GET", ["today", "views"])).body.views).toEqual([]);
    expect((await call(other, "DELETE", ["today", "views", id])).status).toBe(404);
    // Another company's agency cannot reach it either.
    expect((await call(session(CO_B, "agency", null, "u-me"), "DELETE", ["today", "views", id])).status).toBe(404);
    expect((await call(me, "GET", ["today", "views"])).body.views).toHaveLength(1);
    expect((await call(me, "DELETE", ["today", "views", id])).status).toBe(200);
  });

  it("refuses a bad name, caps the number of views and gives a client's staff none", async () => {
    const me = session(CO_A, "agency", null, "u-cap");
    expect((await call(me, "POST", ["today", "views"], { name: "" })).status).toBe(400);
    expect((await call(me, "POST", ["today", "views"], { name: "x".repeat(41) })).status).toBe(400);
    for (let i = 0; i < 10; i++) expect((await call(me, "POST", ["today", "views"], { name: `View ${i}` })).status).toBe(200);
    expect((await call(me, "POST", ["today", "views"], { name: "One too many" })).status).toBe(409);
    expect((await call(me, "POST", ["today", "views"], { name: "View 3", excludeJunk: true })).status).toBe(200);
    const client = session(CO_A, "client", A1, "u-setter");
    expect((await call(client, "POST", ["today", "views"], { name: "Nope" })).status).toBe(403);
    expect((await call(client, "GET", ["today", "views"])).body.views).toEqual([]);
    expect((await call(client, "DELETE", ["today", "views", "00000000-0000-0000-0000-000000000000"])).status).toBe(403);
  });
});
