import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { appointmentBreakdown, appointmentDetail, appointmentView, setShowRateTarget } from "@/lib/analytics/appointment-queries";
import { appointmentInsights } from "@/lib/analytics/appointment-insight-queries";
import { BUCKETS, parseWindow } from "@/lib/analytics/appointment-f3";

// Stage F3 on the real database with two fixture companies (removed afterwards, no tokens, so the production scheduler ignores them): every count on the
// Appointments page equals the rows of the list behind it, the window and the filters narrow what they should, and one company can never read the
// other's appointment. Written in the parallel stage and NOT RUN there: the lead runs it after the merge. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-f3-a";
const CO_B = "xtest-f3-b";
const LOC_A1 = "xtestF3LocA1";
const LOC_A2 = "xtestF3LocA2";
const LOC_B1 = "xtestF3LocB1";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const DAY = 86_400_000;
const NOW = Date.now();
const at = (daysAgo: number, hour = 10) => new Date(Math.floor(NOW / DAY) * DAY - daysAgo * DAY + hour * 3_600_000);
let instA = "", instB = "";
let n = 0;

async function make(company: string, label: string) {
  await sql()`delete from installations where company_id = ${company}`;
  const [i] = await sql()`insert into installations (company_id, company_name, plan) values (${company}, ${label}, 'pro') returning id`;
  return i.id as string;
}
async function appt(inst: string, loc: string, o: { id?: string; contact: string; status: string; start: Date; calendar?: string; user?: string | null; bookedBy?: string | null }) {
  const id = o.id ?? `f3a${n++}`;
  await sql()`insert into cached_appointments (installation_id, location_id, appointment_id, calendar_id, calendar_name, contact_id, title, status, start_at, end_at, assigned_to, booked_by_user, booking_channel)
    values (${inst}, ${loc}, ${id}, ${o.calendar ?? "cal1"}, ${o.calendar === "cal2" ? "Estimate" : "Consult"}, ${o.contact}, 'Golden', ${o.status}, ${o.start}, ${new Date(o.start.getTime() + 1_800_000)}, ${o.user === undefined ? "u1" : o.user}, ${o.bookedBy ?? null}, ${o.bookedBy ? "calendar_page" : null})`;
  return id;
}
const contact = (inst: string, loc: string, id: string, source: string | null) => sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, source, date_added)
  values (${inst}, ${loc}, ${id}, 'Golden', ${id}, ${id + "@example.test"}, '5550100', ${source}, ${at(60)})`;

describe.skipIf(!HAS_DB)("appointments: counts equal lists, windows and filters narrow, tenants stay apart", () => {
  beforeAll(async () => {
    instA = await make(CO_A, "zzF3A");
    instB = await make(CO_B, "zzF3B");
    await sql()`insert into locations (installation_id, location_id, name, appointments_access, users_access) values (${instA}, ${LOC_A1}, 'F3 fixture one', 'ok', 'ok'), (${instA}, ${LOC_A2}, 'F3 fixture two', 'ok', 'ok'), (${instB}, ${LOC_B1}, 'F3 other company', 'ok', 'ok')`;
    await sql()`insert into team_names (installation_id, user_id, name) values (${instA}, 'u1', 'Dana Brooks'), (${instA}, 'u2', 'Marcus Lee') on conflict do nothing`;
    for (const c of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"]) await contact(instA, LOC_A1, c, c < "f" ? "Facebook" : c < "k" ? "Referral" : null);
    await contact(instB, LOC_B1, "z", "Facebook");
    // Account one, last 30 days: 5 showed, 2 no-show, 1 cancelled, 1 invalid, 3 confirmed in the past (no outcome recorded), 1 booked and 1 confirmed upcoming.
    for (const [c, d] of [["a", 3], ["b", 4], ["c", 5], ["d", 6], ["e", 7]] as const) await appt(instA, LOC_A1, { contact: c, status: "showed", start: at(d) });
    await appt(instA, LOC_A1, { contact: "f", status: "noshow", start: at(2) });
    await appt(instA, LOC_A1, { contact: "g", status: "noshow", start: at(9), calendar: "cal2", user: "u2" });
    await appt(instA, LOC_A1, { contact: "h", status: "cancelled", start: at(10) });
    await appt(instA, LOC_A1, { contact: "i", status: "invalid", start: at(11) });
    for (const [c, d] of [["j", 12], ["k", 13], ["l", 14]] as const) await appt(instA, LOC_A1, { contact: c, status: "confirmed", start: at(d), user: null });
    await appt(instA, LOC_A1, { contact: "m", status: "new", start: at(-1), bookedBy: "u1" });
    await appt(instA, LOC_A1, { contact: "a", status: "confirmed", start: at(-3) });
    // Account two: one in the window, one before it.
    await appt(instA, LOC_A2, { contact: "x1", status: "showed", start: at(1) });
    await appt(instA, LOC_A2, { contact: "x2", status: "showed", start: at(45) });
    // The other company.
    await appt(instB, LOC_B1, { id: "b-secret", contact: "z", status: "showed", start: at(2) });
    // A history for one appointment.
    const hist = await appt(instA, LOC_A1, { id: "f3-hist", contact: "b", status: "noshow", start: at(20) });
    await sql()`insert into appointment_events (installation_id, location_id, appointment_id, kind, from_value, to_value, start_at, occurred_at) values
      (${instA}, ${LOC_A1}, ${hist}, 'created', null, 'new', ${at(20)}, ${at(25)}), (${instA}, ${LOC_A1}, ${hist}, 'status', 'new', 'noshow', ${at(20)}, ${at(19)})`;
  });
  afterAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    await closeDb();
  });

  it("for every status, the count on the bar equals the rows of its list", async () => {
    const v = await appointmentView(instA, null, NOW);
    expect(v.itemsTotal).toBe(v.items.length);
    for (const b of BUCKETS) expect(v.items.filter((i) => (b.key === i.status || (b.key === "other" && !["new", "confirmed", "showed", "noshow", "cancelled", "invalid"].includes(i.status)))).length, b.label).toBe(v.statusCounts.byBucket[b.key]);
    expect(v.statusCounts.scheduled).toBe(v.current.booked);
    expect(v.statusCounts.byBucket.invalid).toBe(1);
  });

  it("every tile opens a list with the same number of rows", async () => {
    const v = await appointmentView(instA, null, NOW);
    expect(v.unmarked.length).toBe(v.unmarkedTotal);
    expect(v.unmarkedTotal).toBe(v.current.unmarked);
    expect(v.unmarked.every((r) => r.noOutcome)).toBe(true);
    expect(v.upcoming.length).toBe(v.upcomingTotal);
    expect(v.upcoming.filter((r) => r.unconfirmed).length).toBe(v.unconfirmedTotal);
    expect(v.recover.length).toBe(v.recoverTotal);
    expect(v.items.filter((i) => i.status === "showed" || i.status === "noshow").length).toBe(v.current.outcomes);
  });

  it("the numbers match a raw count of the rows", async () => {
    const [raw] = await sql()`select count(*) filter (where status = 'showed')::int showed, count(*) filter (where status = 'noshow')::int noshow, count(*) filter (where status <> 'invalid')::int scheduled
      from cached_appointments where installation_id = ${instA} and start_at >= ${new Date(NOW - 30 * DAY)} and start_at < ${new Date(NOW)}`;
    const v = await appointmentView(instA, null, NOW);
    expect(v.current.held).toBe(raw.showed);
    expect(v.current.noShow).toBe(raw.noshow);
    expect(v.current.booked).toBe(raw.scheduled);
  });

  it("a chosen window and its comparison narrow the numbers; a bad window falls back and says why", async () => {
    const from = new Date(NOW - 60 * DAY).toISOString().slice(0, 10), to = new Date(NOW - 31 * DAY).toISOString().slice(0, 10);
    const old = await appointmentView(instA, null, NOW, { window: parseWindow({ from, to }, NOW) });
    expect(old.current.booked).toBe(1);
    expect(old.window.defaulted).toBe(false);
    const bad = await appointmentView(instA, null, NOW, { window: parseWindow({ from: "2099-01-01", to: "2099-02-01" }, NOW) });
    expect(bad.window.defaulted).toBe(true);
    expect(bad.window.problem).toMatch(/future/);
  });

  it("calendar, person and source filters narrow every list and count the same way", async () => {
    const byCal = await appointmentView(instA, null, NOW, { filters: { calendar: "cal2" } });
    expect(byCal.itemsTotal).toBe(1);
    const byUser = await appointmentView(instA, null, NOW, { filters: { user: "u2" } });
    expect(byUser.items.every((i) => i.assignedKey === "u2")).toBe(true);
    const none = await appointmentView(instA, null, NOW, { filters: { user: "unassigned" } });
    expect(none.items.every((i) => i.assignedKey === "unassigned")).toBe(true);
    expect(none.unmarkedTotal).toBe(3);
    const fb = await appointmentView(instA, null, NOW, { filters: { source: "facebook" } });
    expect(fb.items.length).toBeGreaterThan(0);
    expect(fb.items.every((i) => i.source === "Facebook")).toBe(true);
    const v = await appointmentView(instA, null, NOW);
    expect(v.options.calendars.map((c) => c.key).sort()).toEqual(["cal1", "cal2"]);
    expect(v.options.users.some((u) => u.label === "Dana Brooks")).toBe(true);
    expect(v.options.users.some((u) => u.label === "Not assigned")).toBe(true);
  });

  it("a line of the breakdown counts the appointments behind it", async () => {
    const b = await appointmentBreakdown(instA, null, NOW);
    for (const g of b.byCalendar) expect(b.items.filter((i) => (i.calendarId ?? "none") === g.key).length, g.label).toBe(g.booked);
    for (const g of b.byPerson) expect(b.items.filter((i) => i.assignedKey === g.key).length, g.label).toBe(g.booked);
    for (const a of b.perAccount) expect(b.items.filter((i) => i.locationId === a.locationId).length, a.name ?? "").toBe(a.booked);
    expect(b.byPerson.some((g) => /^Team member \(name not available\)$/.test(g.label))).toBe(false);
  });

  it("an appointment opens with its history, who booked it and the contact; another company's appointment does not exist", async () => {
    const d = await appointmentDetail(instA, null, LOC_A1, "f3-hist", NOW);
    expect(d?.appointment.status).toBe("noshow");
    expect(d?.history.map((h) => h.text)).toEqual(["First seen as booked.", "Status changed from booked to no-show."]);
    expect(d?.contact?.source).toBe("Facebook");
    const booked = await sql()`select appointment_id from cached_appointments where installation_id = ${instA} and booked_by_user = 'u1' limit 1`;
    const withWho = await appointmentDetail(instA, null, LOC_A1, booked[0].appointment_id as string, NOW);
    expect(withWho?.appointment.bookedBy).toBe("Dana Brooks");
    expect(withWho?.appointment.channel).toBe("calendar_page");
    // Cross-tenant: the other company's id, asked for by the first company (and the reverse), finds nothing.
    expect(await appointmentDetail(instA, null, LOC_B1, "b-secret", NOW)).toBeNull();
    expect(await appointmentDetail(instB, null, LOC_A1, "f3-hist", NOW)).toBeNull();
    // A client's staff see one account only: another account of the SAME company is also not theirs.
    expect(await appointmentDetail(instA, [LOC_A2], LOC_A1, "f3-hist", NOW)).toBeNull();
    expect(await appointmentDetail(instA, [LOC_A1], LOC_A1, "f3-hist", NOW)).not.toBeNull();
    // And the lists never carry another company's rows.
    const mine = await appointmentView(instA, null, NOW);
    expect([...mine.items, ...mine.upcoming, ...mine.unmarked].some((r) => r.id === "b-secret")).toBe(false);
    const limited = await appointmentView(instA, [LOC_A2], NOW);
    expect(limited.items.every((r) => r.locationId === LOC_A2)).toBe(true);
  });

  it("the show-rate target is stored per company, defaults to 75 and can be put back", async () => {
    expect((await appointmentView(instA, null, NOW)).target).toEqual({ showRate: 75, isDefault: true });
    await setShowRateTarget(instA, 85);
    expect((await appointmentView(instA, null, NOW)).target).toEqual({ showRate: 85, isDefault: false });
    expect((await appointmentView(instB, null, NOW)).target.showRate).toBe(75);
    await setShowRateTarget(instA, null);
    expect((await appointmentView(instA, null, NOW)).target.isDefault).toBe(true);
  });

  it("the Insights tab: a small account has an n/a health score, no heat grid and no 100% claim, and its lists match its numbers", async () => {
    const ins = await appointmentInsights(instA, null, NOW);
    expect(ins.health.score).toBeNull();
    expect(ins.heat.ready).toBe(false);
    expect(ins.funnel.biggestLeak ?? "").not.toMatch(/100%/);
    expect(ins.funnel.steps.every((s) => s.members.length === Math.min(60, s.count))).toBe(true);
    for (const s of ins.bySource) expect(s.booked).toBe((s.ids ?? []).length);
    const filtered = await appointmentInsights(instA, null, NOW, { filters: { calendar: "cal2" } });
    expect(filtered.sampleSize).toBe(1);
  });
});
