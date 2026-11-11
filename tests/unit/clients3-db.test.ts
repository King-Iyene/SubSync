import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Clients round 3 against the real database: two fixture companies (removed afterwards). Skipped when no database is configured or the migration 20261129090000_clients3_rollup.sql is not applied yet.
//   1. A company sees only its own accounts in every part; naming another company's account (location, ids) gives nothing and is never echoed.
//   2. A reason's count equals the rows it opens. 3. A client's staff get nothing.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
const CO_A = "xtest-cl3-a", CO_B = "xtest-cl3-b", A1 = "xtestCl3A1", B1 = "xtestCl3B1";
let instA = "", instB = "", applied = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, path: string) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }), p.split("/"));
  const t = await res.text();
  return { status: res.status, body: (t && (res.headers.get("content-type") ?? "").includes("json") ? JSON.parse(t) : { csv: t }) as Json };
}

describe.skipIf(!HAS_DB)("clients round 3", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from client_daily limit 1`; applied = true; } catch { applied = false; }
    if (!applied) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzCl3 A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzCl3 B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access, last_synced_at) values (${instA}, ${A1}, 'zzCl3 Client A', 'UTC', true, 'ok', now()), (${instB}, ${B1}, 'zzCl3 Client B', 'UTC', true, 'ok', now())`;
    const conv = (i: string, l: string, id: string, hoursAgo: number) => ({ installation_id: i, location_id: l, conversation_id: id, contact_id: `c-${id}`, contact_name: `Person ${id}`, last_message_direction: "inbound", last_message_at: new Date(Date.now() - hoursAgo * 3_600_000) });
    await sql()`insert into cached_conversations ${sql()([conv(instA, A1, "a1", 30), conv(instA, A1, "a2", 2), conv(instB, B1, "b1", 50)] as never)}`;
  });
  afterAll(async () => {
    if (applied) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("isolates companies in every part and parameter", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null);
    for (const part of ["overview", "needs-attention", "trends", "receipt", "people", "setup", "options", "billing"]) {
      const r = await call(t, `clients3?part=${part}`);
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).not.toContain(B1);
      expect(JSON.stringify(r.body)).not.toContain("zzCl3 Client B");
      const x = await call(t, `clients3?part=${part}&location=${B1}`);
      expect(JSON.stringify(x.body)).not.toContain(B1);
      expect(JSON.stringify(x.body)).not.toContain("zzCl3 Client B");
    }
    const cmp = await call(t, `clients3?part=compare&ids=${A1},${B1}`);
    expect(cmp.body.sides.map((s: Json) => s.locationId)).toEqual([A1]);
    const csv = await call(t, "clients3?part=export");
    expect(csv.body.csv).not.toContain("zzCl3 Client B");
  });

  it("a reason's count equals the rows it opens", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null);
    const ov = await call(t, "clients3?part=needs-attention");
    const acct = (ov.body.rows as Json[]).find((r) => r.locationId === A1)!;
    const old = acct.reasons.find((r: Json) => r.reason === "waiting_old");
    expect(old.count).toBe(1);
    const rows = await call(t, `clients3?part=list&reason=waiting_old&location=${A1}`);
    expect(rows.body.total).toBe(old.count);
    expect((await call(t, `clients3?part=list&reason=waiting_old&location=${B1}`)).body.rows).toEqual([]);
  });

  it("gives a client's staff nothing", async () => {
    if (!applied) return;
    const c = session(CO_A, "client", A1);
    const r = await call(c, "clients3?part=needs-attention");
    expect([200, 403]).toContain(r.status);
    if (r.status === 200) expect(r.body.rows).toEqual([]);
  });
});
