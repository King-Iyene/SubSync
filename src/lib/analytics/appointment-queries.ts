import { sql } from "../db";
import { breakdown, headline, noShowRecovery, overview, rates, type Appt, type Breakdown } from "./appointment-intel";

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const DAY = 86_400_000;

function visible(installationId: string, allowed: string[] | null) {
  const db = sql();
  return db`select location_id, name, appointments_access, users_access, appointments_synced_at from locations
    where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
}

async function loadAppts(installationId: string, allowed: string[] | null, now: number): Promise<Appt[]> {
  const db = sql();
  const rows = await db`
    with loc as (${visible(installationId, allowed)})
    select a.appointment_id, a.location_id, a.calendar_id, a.calendar_name, a.contact_id, a.status, a.start_at, a.created_remote_at, a.assigned_to
    from cached_appointments a join loc on loc.location_id = a.location_id
    where a.installation_id = ${installationId} and a.start_at between ${new Date(now - 90 * DAY)} and ${new Date(now + 60 * DAY)}
    order by a.start_at desc limit 40000`;
  return rows.map((r) => ({
    id: r.appointment_id, locationId: r.location_id, calendarId: r.calendar_id, calendarName: r.calendar_name, contactId: r.contact_id,
    status: r.status ?? "new", startAt: ms(r.start_at) ?? 0, createdAt: ms(r.created_remote_at), assignedTo: r.assigned_to,
  }));
}

export type ApptPerson = { contactId: string; name: string; phone: string | null; locationId: string; locationName: string | null; at: number; calendar: string | null };

async function withContacts(installationId: string, list: Appt[], names: Map<string, string | null>): Promise<ApptPerson[]> {
  const ids = [...new Set(list.map((a) => a.contactId).filter((x): x is string => !!x))];
  if (ids.length === 0) return [];
  const rows = await sql()`
    select contact_id, location_id, coalesce(nullif(full_name, ''), nullif(email, ''), 'Unnamed contact') name, phone
    from cached_contacts where installation_id = ${installationId} and contact_id = any(${ids}::text[])`;
  const by = new Map(rows.map((r) => [`${r.location_id}:${r.contact_id}`, r]));
  return list.flatMap((a) => {
    const c = a.contactId ? by.get(`${a.locationId}:${a.contactId}`) : undefined;
    return c ? [{ contactId: a.contactId as string, name: c.name as string, phone: c.phone as string | null, locationId: a.locationId, locationName: names.get(a.locationId) ?? null, at: a.startAt, calendar: a.calendarName }] : [];
  });
}

export async function appointmentView(installationId: string, allowed: string[] | null, now = Date.now()) {
  const [locs, appts, people] = await Promise.all([
    visible(installationId, allowed),
    loadAppts(installationId, allowed, now),
    sql()`select user_id, name from team_names where installation_id = ${installationId}`,
  ]);
  const names = new Map(locs.map((l) => [l.location_id as string, l.name as string | null]));
  const personName = new Map(people.map((p) => [p.user_id as string, p.name as string]));
  const o = overview(appts, now);
  const recovery = noShowRecovery(appts, now);
  const [unconfirmed, recover, unmarked] = await Promise.all([
    withContacts(installationId, o.unconfirmed48.sort((a, b) => a.startAt - b.startAt).slice(0, 15), names),
    withContacts(installationId, recovery.slice(0, 15), names),
    withContacts(installationId, o.unmarked.sort((a, b) => b.startAt - a.startAt).slice(0, 15), names),
  ]);
  const label = (rows: Breakdown[]) => rows.map((r) => ({ ...r, label: personName.get(r.key) ?? (r.key === "unassigned" ? "Unassigned" : "Team member " + r.key.slice(-4)) }));
  // With several accounts, a calendar is named with its account so two "Free consultation" rows are not a mystery.
  const several = locs.length > 1;
  const calendars = breakdown(appts, now, "calendar").slice(0, 12).map((r) => (several && r.locationId ? { ...r, label: `${r.label} · ${names.get(r.locationId) ?? "account"}` } : r));
  const perAccount = locs.map((l) => {
    const mine = appts.filter((a) => a.locationId === l.location_id);
    const r = rates(mine, now - 30 * DAY, now, now);
    return { locationId: l.location_id as string, name: l.name as string | null, booked: r.booked, held: r.held, noShow: r.noShow, showRate: r.showRate, upcoming7: overview(mine, now).upcoming7, unmarked: r.unmarked, access: (l.appointments_access as string | null) ?? "unknown" };
  }).sort((a, b) => b.booked - a.booked);
  const needsPermission = locs.filter((l) => l.appointments_access === "needs_permission").map((l) => ({ locationId: l.location_id as string, name: l.name as string | null }));
  return {
    access: { ok: locs.filter((l) => l.appointments_access === "ok").length, needsPermission, notYet: locs.filter((l) => l.appointments_access === null).length, total: locs.length },
    headline: headline(o.last30, o.prior30),
    last30: o.last30, prior30: o.prior30, upcoming7: o.upcoming7,
    unconfirmed, recover, recoverTotal: recovery.length, unmarked, unmarkedTotal: o.unmarked.length, unconfirmedTotal: o.unconfirmed48.length,
    byCalendar: calendars,
    byPerson: label(breakdown(appts, now, "person")).slice(0, 12),
    perAccount,
  };
}

// Counts per account used by the daily brief.
export async function appointmentSignals(installationId: string, locationIds: string[], now = Date.now()): Promise<Map<string, { noShows3d: number; unconfirmed48: number }>> {
  if (locationIds.length === 0) return new Map();
  const rows = await sql()`
    select location_id,
      count(*) filter (where status = 'noshow' and start_at > ${new Date(now - 3 * DAY)} and start_at <= ${new Date(now)})::int no_shows,
      count(*) filter (where status = 'new' and start_at >= ${new Date(now)} and start_at < ${new Date(now + 2 * DAY)})::int unconfirmed
    from cached_appointments where installation_id = ${installationId} and location_id = any(${locationIds}::text[]) group by location_id`;
  return new Map(rows.map((r) => [r.location_id as string, { noShows3d: r.no_shows as number, unconfirmed48: r.unconfirmed as number }]));
}
