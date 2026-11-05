import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// The Growth tab must open, with its counters and chart, even when the database update that adds the goal and settings tables has not been applied (Postgres 42P01 missing
// table, 42703 missing column). Only the goal part may say "needs the update". Runs against whatever database is configured: with the tables present it checks the normal read,
// with them absent (a fresh database without the growth migration) it checks the degraded read. Fixture company only, removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const CO = "xtest-growmiss-a", LOC = "xtestGrowMissA1";
let inst = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = () => signSession({ companyId: CO, userId: "u-agency", role: "admin", userName: "T", demo: false, kind: "agency", locationId: null, personRole: "agency_owner", exp: Math.floor(Date.now() / 1000) + 3600 } as never);
const call = async (method: string, path: string, body?: Json) => {
  const res = await handle(new Request(`http://localhost/api/app/${path}`, { method, headers: { Authorization: `Bearer ${session()}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), path.split("/"));
  return { status: res.status, body: (await res.json()) as Json };
};

describe.skipIf(!HAS_DB)("Growth without the database update", () => {
  let tablesThere = true;
  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO}`;
    [{ id: inst }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO}, 'zzGrowMiss', 'pro') returning id` as unknown as Array<{ id: string }>;
    await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${LOC}, 'zzGrowMiss Client', 'UTC', true)`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, source, date_added) values (${inst}, ${LOC}, 'm1', 'Ann', 'Lee', 'ann.lee@gmail.com', 'Ads', now() - interval '3 hours')`;
    const [t] = await sql()`select to_regclass('growth_goals') as g, to_regclass('growth_settings') as s`;
    tablesThere = Boolean(t.g && t.s);
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("opens with counters and records, never a 500", async () => {
    const r = await call("GET", "today/growth");
    expect(r.status).toBe(200);
    expect(r.body.changes.all.count).toBe(1);
    expect(r.body.setup).toEqual({ goalsReady: tablesThere, settingsReady: tablesThere });
  });

  it("saving a goal or a setting says it needs the update (409), never a 500", async () => {
    if (tablesThere) return; // with the tables present these succeed; covered by growth-db.test.ts
    const g = await call("POST", "today/growth/goal", { locationId: LOC, goal: 20 });
    expect(g.status).toBe(409);
    expect(g.body.needsUpdate).toBe(true);
    const s = await call("POST", "today/growth/settings", { excludeRoleAddresses: true, internalDomains: [] });
    expect(s.status).toBe(409);
  });

  it("the alert drafts and the main Today read also survive", async () => {
    const { growthAlertDrafts } = await import("@/lib/api/growth-api");
    await expect(growthAlertDrafts(inst)).resolves.toBeInstanceOf(Array);
    expect((await call("GET", "today")).status).toBe(200);
  });
});
