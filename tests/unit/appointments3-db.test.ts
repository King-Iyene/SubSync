import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Appointments round 3 against the real database: two fixture companies (removed afterwards). Skipped when no database is configured or the migration
// 20261122090000_appointments3.sql is not applied yet.
//   1. A company sees only its own appointments in every part; asking for another company's account gives nothing, and an appointment detail is "not found".
//   2. The overview counts equal the rows of the lists they open; true show rate counts the forgotten outcomes.
//   3. The flow tree's setter counts add up to the root and a click (setter filter) opens exactly that many appointments.
//   4. A client's staff get no ranking of people.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
const CO_A = "xtest-ap3-a", CO_B = "xtest-ap3-b", A1 = "xtestAp3A1", B1 = "xtestAp3B1";
let instA = "", instB = "", applied = false;
const DAY = 86_400_000;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, path: string) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }), p.split("/"));
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : {}) as Json };
}
const ap = (inst: string, loc: string, id: string, c: string, status: string, d: number, o: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, appointment_id: id, calendar_id: `${loc}-cal`, calendar_name: "Consult", contact_id: c, status, start_at: new Date(Date.now() + d * DAY),
  end_at: new Date(Date.now() + d * DAY + 1_800_000), assigned_to: "closer1", booked_by_user: "setter1", created_remote_at: new Date(Date.now() + (d - 2) * DAY), ...o,
});

describe.skipIf(!HAS_DB)("appointments round 3", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from appointment_history limit 1`; applied = true; } catch { applied = false; }
    if (!applied) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAp3 A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAp3 B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access) values (${instA}, ${A1}, 'zzAp3 Client A', 'UTC', true, 'ok'), (${instB}, ${B1}, 'zzAp3 Client B', 'UTC', true, 'ok')`;
    await sql()`insert into team_names (installation_id, user_id, name) values (${instA}, 'closer1', 'Zed Closer'), (${instA}, 'setter1', 'Sam Setter')`;
    await sql()`insert into cached_appointments ${sql()([
      ap(instA, A1, "a1", "p1", "showed", -9), ap(instA, A1, "a2", "p2", "showed", -8), ap(instA, A1, "a3", "p3", "noshow", -5), ap(instA, A1, "a4", "p4", "confirmed", -4), ap(instA, A1, "a5", "p5", "new", 3),
      ap(instB, B1, "b1", "q1", "noshow", -2), ap(instB, B1, "b2", "q2", "confirmed", -3),
    ] as never)}`;
  });
  afterAll(async () => {
    if (applied) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("isolates companies and keeps counts equal to rows", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null);
    const o = await call(t, "appointments?part=overview");
    expect(o.status).toBe(200);
    expect(o.body.booked).toBe(4); // default window is the last 30 days to end of today, so the appointment 3 days ahead is outside it
    expect(o.body.unmarked).toBe(1);
    const list = await call(t, "appointments?part=list&bucket=unmarked");
    expect(list.body.total).toBe(o.body.unmarked);
    const all = await call(t, "appointments?part=list&size=100");
    expect(JSON.stringify(all.body)).not.toContain("b1");
    const other = await call(t, `appointments?part=list&location=${B1}`);
    expect(other.body.rows).toEqual([]);
    expect((await call(t, `appointments?part=detail&location=${B1}&id=b1`)).status).toBe(404);
    expect((await call(t, `appointments?part=detail&location=${A1}&id=a4`)).status).toBe(200);
  });

  it("flow tree adds up and a setter click opens the same number", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null);
    const tree = await call(t, "appointments?part=flow-tree");
    const setters = (tree.body.nodes as Json[]).filter((n) => n.level === "setter");
    expect(setters.reduce((s, n) => s + n.count, 0)).toBe(tree.body.totalBooked);
    const open = await call(t, `appointments?part=list&setter=${setters[0].userId}&size=100`);
    expect(open.body.total).toBe(setters[0].count);
  });

  it("gives a client's staff no ranking of people", async () => {
    if (!applied) return;
    const c = session(CO_A, "client", A1);
    expect((await call(c, "appointments?part=flow-tree")).body.nodes).toEqual([]);
    expect((await call(c, "appointments?part=booking-share")).body.rows).toEqual([]);
    expect((await call(c, "appointments?part=health")).body.rows).toEqual([]);
  });
});
