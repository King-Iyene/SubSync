import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant test for the automatic meeting notes and Slack choices: a person's notices and "Added today" rows are private to them; another person or company cannot undo
// them or see them; a client account of another company cannot be muted. Tiny fixtures (prefix xtest-), removed afterwards. Skips until the migration is applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: { ...e.features, am_auto_notes: true, am_slack_auto: true } }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-am-a", CO_B = "xtest-am-b", A1 = "xtestAmA1", B1 = "xtestAmB1", U_A = "xtest-am-ua", U_A2 = "xtest-am-ua2", U_B = "xtest-am-ub";
let instA = "", instB = "", addA = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, user: string) => signSession({ companyId: company, userId: user, role: "admin", userName: "Xtest", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const res = await handle(new Request(`http://localhost/api/app/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), path.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body: parsed };
}

describe.skipIf(!HAS_DB)("Automatic notes cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from am_notices limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'Am Agency A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'Am Agency B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A1}, 'zzAm A1', 'UTC', true), (${instB}, ${B1}, 'zzAm B1', 'UTC', true)`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags) values (${instA}, ${A1}, 'xtest-am-ca', 'Zed', 'AmA', 'zed@am-xtest.test', '{}')`;
    const [m] = await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, title, status) values (${instA}, ${U_A}, 'fathom', 'xt-am-1', 'xtest AM secret title', 'dry_run') returning id`;
    [{ id: addA }] = (await sql()`insert into am_auto_adds (installation_id, owner_ghl_user_id, meeting_id, location_id, contact_id, status) values (${instA}, ${U_A}, ${m.id}, ${A1}, 'xtest-am-ca', 'dry_run') returning id`) as unknown as Array<{ id: string }>;
    await sql()`insert into am_notices (installation_id, owner_ghl_user_id, meeting_id, kind, text) values (${instA}, ${U_A}, ${m.id}, 'added', 'xtest AM secret notice')`;
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("only the owner sees the notice and the added note; others see nothing", async () => {
    if (!ready) return;
    const own = await call(await session(CO_A, U_A), "GET", "am/notes");
    expect(own.body.added.length).toBe(1);
    for (const [co, u] of [[CO_A, U_A2], [CO_B, U_B]] as const) {
      const r = await call(await session(co, u), "GET", "am/notes");
      expect(r.text).not.toContain("xtest AM secret");
      expect(r.body.added ?? []).toHaveLength(0);
    }
  });

  it("another person or company cannot undo a note that is not theirs", async () => {
    if (!ready) return;
    for (const [co, u] of [[CO_A, U_A2], [CO_B, U_B]] as const) {
      const r = await call(await session(co, u), "POST", "am/undo", { id: addA });
      expect(r.status).toBe(404);
    }
    const [row] = await sql()`select status from am_auto_adds where id = ${addA}`;
    expect(row.status).toBe("dry_run");
  });

  it("a client account of another company cannot be muted", async () => {
    if (!ready) return;
    const r = await call(await session(CO_A, U_A), "POST", "am/slack", { muted: [A1, B1] });
    expect(r.body.muted).toEqual([A1]);
  });
});
