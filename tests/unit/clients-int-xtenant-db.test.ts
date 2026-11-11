import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Integration cross-tenant test for the ONE Clients screen (stage CL-INT): the read parts (clients3) and the action routes (clients/act) are used together, so this checks the seams.
//   1. Company A's quiet mark takes the matching reason out of A's ranking at once (the saved answer is dropped) and keeps the real count; B never sees it and cannot set or undo it.
//   2. Every hostile value in every parameter (another company's account id, path tricks, quotes) gives nothing and is never echoed, on the read parts and on the action routes.
// Fixtures are tiny (prefix xtest-) and removed afterwards. Skips until the Clients migrations are applied (the mute and rollup tables).
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-clint-a", CO_B = "xtest-clint-b", A1 = "xtestClIntA1", B1 = "xtestClIntB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* csv */ }
  return { status: res.status, text, body: parsed };
}

describe.skipIf(!HAS_DB)("clients screen cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from client_alert_mutes limit 1`; await sql()`select 1 from client_daily limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzInt A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzInt B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access, last_synced_at) values (${instA}, ${A1}, 'zzInt Client A', 'UTC', true, 'ok', now()), (${instB}, ${B1}, 'zzInt Client B', 'UTC', true, 'ok', now())`;
    const conv = (i: string, l: string, id: string, hoursAgo: number) => ({ installation_id: i, location_id: l, conversation_id: id, contact_id: `c-${id}`, contact_name: `Person ${id}`, last_message_direction: "inbound", last_message_at: new Date(Date.now() - hoursAgo * 3_600_000) });
    await sql()`insert into cached_conversations ${sql()([conv(instA, A1, "ia1", 30), conv(instB, B1, "ib1", 40)] as never)}`;
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("a quiet mark moves A's ranking at once, keeps the real count, and never touches B", async () => {
    if (!ready) return;
    const a = session(CO_A, "agency", null), b = session(CO_B, "agency", null);
    const rowOf = async (t: string) => ((await call(t, "GET", "clients3?part=needs-attention")).body.rows as Json[]).find((r) => r.locationId === A1);
    const before = await rowOf(a);
    expect(before?.reasons.map((r: Json) => r.reason)).toContain("waiting_old");
    // B cannot mark or release A's account.
    expect((await call(b, "POST", "clients/act/mute", { location: A1, kind: "replies", days: 7 })).status).toBe(404);
    const m = await call(a, "POST", "clients/act/mute", { location: A1, kind: "replies", days: 7 });
    expect(m.status, m.text).toBe(200);
    expect((await call(b, "POST", "clients/act/unmute", { id: m.body.id })).status).toBe(404);
    const after = await rowOf(a);
    expect(after?.reasons.map((r: Json) => r.reason)).not.toContain("waiting_old");
    expect(after?.quieted).toContain("replies");
    expect(after?.waitingOld).toBe(1); // the real count stays
    // B's own screen has nothing of A's account or mark.
    const bAll = await call(b, "GET", "clients3?part=needs-attention");
    expect(bAll.text).not.toContain(A1);
    expect(bAll.text).not.toContain("zzInt Client A");
    // Undo puts it back.
    expect((await call(a, "POST", "clients/act/unmute", { id: m.body.id })).status).toBe(200);
    expect((await rowOf(a))?.reasons.map((r: Json) => r.reason)).toContain("waiting_old");
  });

  it("hostile values in every parameter give nothing and are never echoed", async () => {
    if (!ready) return;
    const a = session(CO_A, "agency", null);
    const bad = [B1, "../x", "a'; select 1;--", "%00", "x".repeat(200)];
    for (const v of bad) {
      const e = encodeURIComponent(v);
      const reads = [
        `clients3?part=overview&location=${e}&industry=${e}&q=${e}`, `clients3?part=needs-attention&location=${e}&sort=${e}&level=${e}`, `clients3?part=trends&location=${e}&grain=${e}`,
        `clients3?part=compare&ids=${e},${e}`, `clients3?part=receipt&location=${e}&week=${e}`, `clients3?part=people&location=${e}`, `clients3?part=setup&location=${e}`, `clients3?part=billing&location=${e}`,
        `clients3?part=list&reason=waiting&location=${e}`, `clients3?part=list&reason=${e}`, `clients3?part=options&location=${e}`,
        `clients/act/receipt?location=${e}`, `clients/act/csv?location=${e}`, `clients/act/setup?location=${e}`, `clients/act/workflows?location=${e}`, `clients/act/mutes?location=${e}`, `clients/act/owners?location=${e}`,
      ];
      for (const path of reads) {
        const r = await call(a, "GET", path);
        expect(r.status, path).toBeLessThan(500);
        expect(r.text, path).not.toContain(B1);
        expect(r.text, path).not.toContain("zzInt Client B");
        if (v.length < 100 && v !== B1) expect(r.text, path).not.toContain(v);
      }
      for (const [part, body] of [["mute", { location: v, kind: "all", days: 7 }], ["owner", { location: v, owner: "Sam" }], ["target", { location: v, minutes: 5 }], ["target-undo", { location: v }], ["unmute", { id: v }]] as Array<[string, Json]>) {
        const r = await call(a, "POST", `clients/act/${part}`, body);
        expect(r.status, `${part} ${v}`).toBeLessThan(500);
        expect(r.status, `${part} ${v}`).toBeGreaterThanOrEqual(400);
        expect(r.text, `${part} ${v}`).not.toContain(B1);
      }
    }
    const [{ n }] = await sql()`select count(*)::int n from client_alert_mutes where installation_id = ${instB}`;
    expect(n).toBe(0);
  });

  it("a client's own staff reach neither the read parts nor the action routes for the screen", async () => {
    if (!ready) return;
    const c = session(CO_A, "client", A1);
    const r = await call(c, "GET", "clients3?part=needs-attention");
    if (r.status === 200) expect(r.body.rows).toEqual([]);
    for (const p of ["receipt", "csv", "setup", "mutes", "owners", "health", "risk", "workflows", "new-clients"]) expect((await call(c, "GET", `clients/act/${p}`)).status, p).toBeGreaterThanOrEqual(403);
  });
});
