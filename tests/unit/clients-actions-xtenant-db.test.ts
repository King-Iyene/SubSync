import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant regression for every Clients action and report route (slice CB), CSV export included: company A's agency asks for company B's account on every part and write.
// Nothing of B may come back (data, name, or its id echoed), and B's rows must not change. Skips until the slice CB migration is applied. Fixtures removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-clact-a", CO_B = "xtest-clact-b", A1 = "xtestClActA1", B1 = "xtestClActB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* csv */ }
  return { status: res.status, text: t, body: parsed };
}

describe.skipIf(!HAS_DB)("clients actions cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from client_alert_mutes limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAct A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAct B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${instA}, ${A1}, 'zzAct Client A1', 'UTC'), (${instB}, ${B1}, 'zzAct Client B', 'UTC')`;
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("reads: another company's account is not found, never echoed, and the CSV is guarded the same", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    for (const part of ["receipt", "csv", "setup"]) {
      const r = await call(t, "GET", `clients/act/${part}?location=${B1}`);
      expect(r.status, part).toBe(404);
      expect(r.text, part).not.toContain(B1);
      expect(r.text, part).not.toContain("zzAct Client B");
      const all = await call(t, "GET", `clients/act/${part}`);
      expect(all.status, part).toBe(200);
      expect(all.text, part).not.toContain("zzAct Client B");
      expect(all.text, part).not.toContain(B1);
      const own = await call(t, "GET", `clients/act/${part}?location=${A1}`);
      expect(own.status, part).toBe(200);
    }
    for (const bad of ["../x", "a'; select 1;--", "x", ""]) expect((await call(t, "GET", `clients/act/csv?location=${encodeURIComponent(bad)}`)).status, bad).toBeGreaterThanOrEqual(404);
  });

  it("writes: mute and target on B's account change nothing; on one's own they work and undo", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    expect((await call(t, "POST", "clients/act/mute", { location: B1, kind: "all", days: 7 })).status).toBe(404);
    expect((await call(t, "POST", "clients/act/target", { location: B1, minutes: 5 })).status).toBe(404);
    expect((await call(t, "POST", "clients/act/target-undo", { location: B1 })).status).toBe(404);
    const [{ n }] = await sql()`select count(*)::int n from client_alert_mutes where installation_id = ${instB}`;
    expect(n).toBe(0);
    const [b] = await sql()`select speed_target_minutes from locations where installation_id = ${instB} and location_id = ${B1}`;
    expect(b.speed_target_minutes).toBeNull();
    // A mute created by A cannot be released through B's id space, and B cannot release A's.
    const m = await call(t, "POST", "clients/act/mute", { location: A1, kind: "replies", days: 14 });
    expect(m.status, m.text).toBe(200);
    const tb = session(CO_B, "agency", null);
    expect((await call(tb, "POST", "clients/act/unmute", { id: m.body.id })).status).toBe(404);
    expect((await call(t, "GET", "clients/act/mutes")).body.mutes.length).toBe(1);
    expect((await call(t, "POST", "clients/act/unmute", { id: m.body.id })).status).toBe(200);
    expect((await call(t, "GET", "clients/act/mutes")).body.mutes.length).toBe(0);
    expect((await call(t, "POST", "clients/act/target", { location: A1, minutes: 20 })).status).toBe(200);
    expect((await call(t, "POST", "clients/act/target-undo", { location: A1 })).status).toBe(200);
    const [a] = await sql()`select speed_target_minutes from locations where installation_id = ${instA} and location_id = ${A1}`;
    expect(a.speed_target_minutes).toBeNull();
  });

  it("a client's own staff never reach these routes", async () => {
    if (!ok) return;
    const t = session(CO_A, "client", A1);
    for (const p of ["receipt", "csv", "setup", "mutes"]) expect((await call(t, "GET", `clients/act/${p}?location=${A1}`)).status, p).toBeGreaterThanOrEqual(403);
    expect((await call(t, "POST", "clients/act/mute", { location: A1, kind: "all", days: 7 })).status).toBeGreaterThanOrEqual(403);
  });
});

describe.skipIf(!HAS_DB)("clients bulk and owner cross-tenant", () => {
  it("a foreign id in a bulk list is skipped, never changed, never named", async () => {
    let ok = false;
    try { await sql()`select 1 from client_owners limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    const [{ id: ia }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAct A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    const [{ id: ib }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAct B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    try {
      for (const i of [ia, ib]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
      await sql()`insert into locations (installation_id, location_id, name, timezone) values (${ia}, ${A1}, 'zzAct Client A1', 'UTC'), (${ib}, ${B1}, 'zzAct Client B', 'UTC')`;
      const t = session(CO_A, "agency", null);
      expect((await call(t, "POST", "clients/act/bulk", { what: "owner", name: "Sam", locations: [B1] })).status).toBe(404);
      const prev = await call(t, "POST", "clients/act/bulk", { what: "owner", name: "Sam", locations: [A1, B1] });
      expect(prev.body.count).toBe(1); expect(prev.body.skipped).toBe(1); expect(prev.text).not.toContain(B1);
      expect((await call(t, "POST", "clients/act/bulk", { step: "do", what: "owner", name: "Sam", locations: [A1, B1] })).body.done).toBe(1);
      const [n] = await sql()`select count(*)::int n from client_owners where installation_id = ${ib}`;
      expect(n.n).toBe(0);
      expect((await call(t, "POST", "clients/act/owner", { location: B1, owner: "Sam" })).status).toBe(404);
      expect((await call(t, "GET", "clients/act/owners")).text).not.toContain(B1);
    } finally { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; }
  });
});

describe.skipIf(!HAS_DB)("clients risk, health, workflows and new-clients cross-tenant", () => {
  it("never returns, records or echoes another company's account", async () => {
    let ok = false;
    try { await sql()`select 1 from client_risk_history limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    const [{ id: ia }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAct A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    const [{ id: ib }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAct B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    try {
      for (const i of [ia, ib]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
      await sql()`insert into locations (installation_id, location_id, name, timezone) values (${ia}, ${A1}, 'zzAct Client A1', 'UTC'), (${ib}, ${B1}, 'zzAct Client B', 'UTC')`;
      const t = session(CO_A, "agency", null);
      for (const p of ["risk", "health", "workflows", "new-clients"]) {
        const r = await call(t, "GET", `clients/act/${p}`);
        expect(r.status, p).toBe(200);
        expect(r.text, p).not.toContain(B1); expect(r.text, p).not.toContain("zzAct Client B");
      }
      expect((await call(t, "GET", `clients/act/workflows?location=${B1}`)).status).toBe(404);
      const [h] = await sql()`select count(*)::int n from client_risk_history where installation_id = ${ib}`;
      expect(h.n).toBe(0);
      const c = session(CO_A, "client", A1);
      for (const p of ["risk", "health", "workflows", "new-clients"]) expect((await call(c, "GET", `clients/act/${p}`)).status, p).toBeGreaterThanOrEqual(403);
    } finally { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; }
  });
});
