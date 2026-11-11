import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Every number that can be pressed in the Appointments module opens exactly that many appointments: the number's source and the list it opens agree.
// Small fixture company (removed afterwards). Skipped without a database or before the appointments migration is applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
process.env.FLAGS_ALL_ON = "true";
const CO = "xtest-ap-counts", L1 = "xtestApcL1", L2 = "xtestApcL2";
const DAY = 86_400_000;
let inst = "", applied = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const tok = signSession({ companyId: CO, userId: "u-t", role: "admin", userName: "T", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
async function get(path: string) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}?${q}`, { headers: { Authorization: `Bearer ${tok}` } }), p.split("/"));
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : {}) as Json };
}
const list = async (q: string) => { const r = await get(`appointments?part=list&size=100&${q}`); expect(r.status, q).toBe(200); return r.body.total as number; };
const ap = (loc: string, id: string, c: string, status: string, d: number, o: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, appointment_id: id, calendar_id: `${loc}-cal`, calendar_name: "Consult", contact_id: c, status, start_at: new Date(Date.now() + d * DAY),
  end_at: new Date(Date.now() + d * DAY + 1_800_000), assigned_to: "closer1", booked_by_user: "setter1", created_remote_at: new Date(Date.now() + (d - 2) * DAY), ...o,
});

describe.skipIf(!HAS_DB)("appointments: every number opens exactly its rows", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from appointment_history limit 1`; applied = true; } catch { applied = false; }
    if (!applied) return;
    await sql()`delete from installations where company_id = ${CO}`;
    [{ id: inst }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO}, 'zzApCounts', 'pro') returning id`) as unknown as Array<{ id: string }>;
    await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, appointments_access) values (${inst}, ${L1}, 'zzApc One', 'UTC', true, 'ok'), (${inst}, ${L2}, 'zzApc Two', 'UTC', true, 'ok')`;
    await sql()`insert into team_names (installation_id, user_id, name) values (${inst}, 'closer1', 'Zed Closer'), (${inst}, 'setter1', 'Sam Setter'), (${inst}, 'idle1', 'Idle Ian')`;
    await sql()`insert into cached_contacts ${sql()([
      { installation_id: inst, location_id: L1, contact_id: "c1", first_name: "A", last_name: "One", full_name: "A One", source: "Facebook" },
      { installation_id: inst, location_id: L1, contact_id: "c2", first_name: "B", last_name: "Two", full_name: "B Two", source: "Google" },
    ] as never)}`.catch(() => undefined);
    await sql()`insert into cached_appointments ${sql()([
      ap(L1, "x1", "c1", "showed", -9), ap(L1, "x2", "c2", "showed", -8), ap(L1, "x3", "c1", "noshow", -3), ap(L1, "x4", "c2", "confirmed", -2), ap(L1, "x5", "c1", "noshow", -4), ap(L1, "x5b", "c1", "new", 2),
      ap(L1, "x6", "c2", "cancelled", -5), ap(L1, "x7", "c2", "invalid", -6), ap(L2, "y1", "c9", "new", -1, { calendar_id: "L2-cal2", calendar_name: "Second" }), ap(L2, "y2", "c9", "showed", -7, { assigned_to: null, booked_by_user: null }),
    ] as never)}`;
  });
  afterAll(async () => { if (applied) await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("overview, needs-outcome, recovery and the journey agree with the lists they open", async () => {
    if (!applied) return;
    const o = (await get("appointments?part=overview")).body;
    expect(await list("bucket=booked")).toBe(o.booked);
    expect(await list("bucket=unmarked")).toBe(o.unmarked);
    expect((await get("appointments?part=needs-outcome&size=100")).body.total).toBe(o.unmarked);
    expect((await get("appointments?part=noshow-recovery&size=100")).body.total).toBe(o.noshowToRecover);
    for (const j of o.journey as Array<{ count: number; bucket: string }>) expect(await list(`bucket=${j.bucket}`), j.bucket).toBe(j.count);
    expect(await list("bucket=no_deal")).toBe(o.noDealLinked);
  });

  it("account health, booking share and sources agree with their lists", async () => {
    if (!applied) return;
    const h = (await get("appointments?part=health")).body;
    for (const r of h.rows as Json[]) {
      expect(await list(`location=${r.locationId}&bucket=booked`), r.locationId).toBe(r.booked);
      expect(await list(`location=${r.locationId}&bucket=unmarked`), r.locationId).toBe(r.unmarked);
    }
    const share = (await get("appointments?part=booking-share")).body;
    for (const p of share.rows as Json[]) {
      const who = p.userId === null ? "none" : p.userId, key = p.role === "closer" ? "closer" : "setter", n = p.role === "closer" ? p.owned : p.booked;
      expect(await list(`${key}=${who}&bucket=booked`), `${key} ${who}`).toBe(n);
      if (p.role === "setter") expect(await list(`${key}=${who}&bucket=burned`), `burned ${who}`).toBe(p.burned);
    }
    const src = (await get("appointments?part=sources")).body;
    for (const s of src.bySource as Json[]) expect(await list(`source=${encodeURIComponent(s.source)}&bucket=booked`), s.source).toBe(s.booked);
  });

  it("the weekly receipt tiles agree with the lists they open", async () => {
    if (!applied) return;
    const r = (await get("appointments?part=receipt&week=" + new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10))).body;
    const w = `from=${r.weekStart}&to=${r.weekEnd}${r.locationId ? `&location=${r.locationId}` : ""}`;
    expect(await list(`${w}&bucket=booked`)).toBe(r.booked);
    expect(await list(`${w}&bucket=showed`)).toBe(r.showed);
    expect(await list(`${w}&bucket=unmarked`)).toBe(r.stillUnmarked);
    expect(await list(`${w}&bucket=recovered`)).toBe(r.recovered);
  });

  it("calendars: lists every calendar and person (zero too), problems carry counts, and rows open their appointments", async () => {
    if (!applied) return;
    const r = await get("appointments?part=calendars");
    expect(r.status).toBe(200);
    const cals = r.body.calendarsAll as Json[], people = r.body.peopleAll as Json[], problems = r.body.problems as Json[];
    expect(cals.length).toBeGreaterThanOrEqual(2);
    expect(people.map((p) => p.userId)).toContain("idle1"); // a person with no bookings is listed, with zero
    expect(people.find((p) => p.userId === "idle1")?.bookings).toBe(0);
    expect(problems.map((p) => p.key)).toEqual(expect.arrayContaining(["double_booking", "forced_overlap", "disconnected", "idle_calendar", "idle_person", "reminder_gap"]));
    for (const c of cals) expect(await list(`location=${c.locationId}&calendar=${c.calendarId}&bucket=booked`), c.calendarId).toBe(c.bookings);
    for (const p of people.filter((x) => x.bookings > 0)) expect(await list(`closer=${p.userId}&bucket=booked`), p.userId).toBe(p.bookings);
  });

  it("every part answers 200 here and never 500 on an empty account", async () => {
    if (!applied) return;
    for (const p of ["overview", "needs-outcome", "noshow-recovery", "booking-share", "flow-tree", "health", "sources", "calendars", "reminders", "receipt", "list"]) expect((await get(`appointments?part=${p}`)).status, p).toBe(200);
    for (const b of ["unmarked", "booked", "showed", "noshow", "cancelled", "invalid", "completed", "won", "lost", "open", "no_deal", "upcoming", "confirmed", "recovered", "burned"]) expect((await get(`appointments?part=list&bucket=${b}`)).status, b).toBe(200);
  });
});
