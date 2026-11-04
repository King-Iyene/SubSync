import { sql } from "../db";
import { headline, needsOutcome, noShowRecovery, overview, rates, type Appt, type Rates } from "./appointment-intel";
import {
  BUCKETS, capItems, clampTarget, DEFAULT_SHOW_RATE_TARGET, filterAppts, filterOptions, flagsOf, groupIn, historyLines, ITEM_CAP, parseWindow, statusCounts,
  type ApptFilters, type ParsedWindow,
} from "./appointment-f3";

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const DAY = 86_400_000;
const LOAD_CAP = 60_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function visible(installationId: string, allowed: string[] | null) {
  const db = sql();
  return db`select location_id, name, appointments_access, users_access, appointments_synced_at from locations
    where installation_id = ${installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
}

export type Loaded = Appt & { bookedBy: string | null; channel: string | null };

// Everything between `from` and `to`, with the platform's own fields. `booked_by_user` and `booking_channel` exist after the F3 migration.
export async function loadAppts(installationId: string, allowed: string[] | null, from: number, to: number): Promise<Loaded[]> {
  const db = sql();
  const rows = await db`
    with loc as (${visible(installationId, allowed)})
    select a.appointment_id, a.location_id, a.calendar_id, a.calendar_name, a.contact_id, a.status, a.start_at, a.created_remote_at, a.assigned_to, a.booked_by_user, a.booking_channel
    from cached_appointments a join loc on loc.location_id = a.location_id
    where a.installation_id = ${installationId} and a.start_at between ${new Date(from)} and ${new Date(to)}
    order by a.start_at desc limit ${LOAD_CAP}`;
  return rows.map((r) => ({
    id: r.appointment_id, locationId: r.location_id, calendarId: r.calendar_id, calendarName: r.calendar_name, contactId: r.contact_id,
    status: r.status ?? "new", startAt: ms(r.start_at) ?? 0, createdAt: ms(r.created_remote_at), assignedTo: r.assigned_to,
    bookedBy: (r.booked_by_user as string | null) ?? null, channel: (r.booking_channel as string | null) ?? null,
  }));
}

type ContactInfo = { name: string; phone: string | null; source: string | null };

async function contactsFor(installationId: string, appts: Appt[]): Promise<Map<string, ContactInfo>> {
  const ids = [...new Set(appts.map((a) => a.contactId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const rows = await sql()`
    select contact_id, location_id, coalesce(nullif(full_name, ''), nullif(email, ''), 'Unnamed contact') name, phone, source
    from cached_contacts where installation_id = ${installationId} and contact_id = any(${ids}::text[])`;
  return new Map(rows.map((r) => [`${r.location_id}:${r.contact_id}`, { name: r.name as string, phone: (r.phone as string | null) ?? null, source: (r.source as string | null) || null }]));
}

/** A person's name from the platform's user list. An id with no name is never shown: it says so in words (N21). */
export const personLabel = (names: Map<string, string>) => (id: string | null | undefined) => (!id || id === "unassigned" ? "Not assigned" : names.get(id) ?? "Team member (name not available)");

export type ApptItem = {
  id: string; locationId: string; locationName: string | null; contactId: string | null; name: string; calendarId: string | null; calendar: string | null;
  at: number; status: string; assignedKey: string; assigned: string; bookedBy: string | null; channel: string | null; source: string | null; phone: string | null;
  /** Past and still without an outcome. */
  noOutcome: boolean;
  /** Booked, not confirmed, starting within two days. */
  unconfirmed: boolean;
};

async function shared(installationId: string, allowed: string[] | null, now: number, spans: Array<{ from: number; to: number }>) {
  // The cache holds what the sync read: 90 days back and 60 days ahead. The default window needs the 60 days before the last 30; a chosen range may reach further.
  const from = Math.min(now - 90 * DAY, ...spans.map((s) => s.from));
  const to = Math.max(now + 60 * DAY, ...spans.map((s) => s.to));
  const [locs, appts, people, cfgRows] = await Promise.all([
    visible(installationId, allowed),
    loadAppts(installationId, allowed, from, to),
    sql()`select user_id, name from team_names where installation_id = ${installationId}`,
    sql()`select appointment_show_rate_target from settings where installation_id = ${installationId}`,
  ]);
  const contacts = await contactsFor(installationId, appts);
  const names = new Map(locs.map((l) => [l.location_id as string, l.name as string | null]));
  const personName = new Map(people.map((p) => [p.user_id as string, p.name as string]));
  const label = personLabel(personName);
  const sourceOf = (loc: string, cid: string) => contacts.get(`${loc}:${cid}`)?.source ?? null;
  const target = clampTarget(cfgRows[0]?.appointment_show_rate_target) ?? DEFAULT_SHOW_RATE_TARGET;
  // The earliest appointment held, so the screen can say how far back its history goes.
  const earliest = appts.length ? appts.reduce((m, a) => Math.min(m, a.startAt), Infinity) : null;
  return { locs, appts, names, label, contacts, sourceOf, target, earliest, several: locs.length > 1 };
}
type Shared = Awaited<ReturnType<typeof shared>>;

function toItem(a: Loaded, c: Shared, now: number): ApptItem {
  const info = a.contactId ? c.contacts.get(`${a.locationId}:${a.contactId}`) : undefined;
  const f = flagsOf(a, now);
  return {
    id: a.id, locationId: a.locationId, locationName: c.names.get(a.locationId) ?? null, contactId: a.contactId, name: info?.name ?? (a.contactId ? "Contact not in the copy yet" : "No contact on this booking"),
    calendarId: a.calendarId, calendar: a.calendarName, at: a.startAt, status: a.status, assignedKey: a.assignedTo ?? "unassigned", assigned: c.label(a.assignedTo),
    bookedBy: a.bookedBy ? c.label(a.bookedBy) : null, channel: a.channel, source: info?.source ?? null, phone: info?.phone ?? null, noOutcome: f.needsOutcome, unconfirmed: f.unconfirmedSoon,
  };
}

const NO_BASE: Rates = { held: 0, noShow: 0, cancelled: 0, booked: 0, unmarked: 0, outcomes: 0, showRate: null, noShowRate: null, cancelRate: null };

// Every count on the Appointments page and the list that opens behind it come from the same rows: the numbers are counted from `mine`, and the lists are cut
// from `mine` too (never a second query), so they cannot disagree. A list is capped at ITEM_CAP rows; the count stays the true count and the page says how
// many rows were left out. With no options the answer is the page's old window (the last 30 days against the 30 before), which the audit and the weekly
// email still use.
export async function appointmentView(installationId: string, allowed: string[] | null, now = Date.now(), opts: { window?: ParsedWindow; filters?: ApptFilters } = {}) {
  const win = opts.window ?? parseWindow({}, now);
  const filters = opts.filters ?? {};
  const spans = [win.current, ...(win.compare ? [win.compare] : [])];
  const c = await shared(installationId, allowed, now, spans);
  const mine = filterAppts(c.appts, filters, c.sourceOf);
  const cur = win.current;
  const o = overview(mine, now);
  const current = rates(mine, cur.from, cur.to, now);
  const compare = win.compare ? rates(mine, win.compare.from, win.compare.to, now) : null;
  const recovery = noShowRecovery(mine, now);
  const inWindow = mine.filter((a) => a.startAt >= cur.from && a.startAt < cur.to).sort((a, b) => b.startAt - a.startAt);
  const unmarked = inWindow.filter((a) => needsOutcome(a, now));
  const upcoming = mine.filter((a) => a.status !== "cancelled" && a.status !== "invalid" && a.startAt >= now && a.startAt < now + 7 * DAY).sort((a, b) => a.startAt - b.startAt);
  const items = (xs: Loaded[]) => capItems(xs).map((a) => toItem(a, c, now));
  const needsPermission = c.locs.filter((l) => l.appointments_access === "needs_permission").map((l) => ({ locationId: l.location_id as string, name: l.name as string | null }));
  const against = win.defaulted ? "the 30 days before" : win.compare && win.compare.to === cur.from ? "the period before" : "the period compared with";
  return {
    access: { ok: c.locs.filter((l) => l.appointments_access === "ok").length, needsPermission, notYet: c.locs.filter((l) => l.appointments_access === null).length, total: c.locs.length, namesNeedPermission: c.locs.filter((l) => l.users_access === "needs_permission").length },
    window: { from: isoDay(cur.from), to: isoDay(cur.to - DAY), defaulted: win.defaulted, problem: win.problem },
    compareWindow: win.compare ? { from: isoDay(win.compare.from), to: isoDay(win.compare.to - DAY) } : null,
    historyFrom: c.earliest === null ? null : isoDay(c.earliest),
    filters,
    options: filterOptions(c.appts, (id) => c.label(id), c.sourceOf, (id) => c.names.get(id) ?? null, c.several),
    target: { showRate: c.target, isDefault: c.target === DEFAULT_SHOW_RATE_TARGET },
    headline: headline(current, compare ?? NO_BASE, against),
    current, compare,
    // The old names, kept for the audit, the weekly email and any saved link: last30 is the chosen window, prior30 the one compared with.
    last30: current, prior30: compare,
    statusCounts: statusCounts(mine, cur.from, cur.to, now),
    statusCompare: win.compare ? statusCounts(mine, win.compare.from, win.compare.to, now) : null,
    statusOrder: BUCKETS,
    upcoming7: o.upcoming7,
    // The lists. `*Total` is the count on the tile; the array is what is sent (at most ITEM_CAP).
    items: items(inWindow), itemsTotal: inWindow.length,
    upcoming: items(upcoming), upcomingTotal: upcoming.length,
    unmarked: items(unmarked), unmarkedTotal: unmarked.length,
    recover: items(recovery), recoverTotal: recovery.length,
    unconfirmedTotal: o.unconfirmed48.length,
    itemCap: ITEM_CAP,
  };
}

// The calendar, person and client-account breakdowns, over their own window (the page gives them their own range control).
export async function appointmentBreakdown(installationId: string, allowed: string[] | null, now = Date.now(), opts: { window?: ParsedWindow; filters?: ApptFilters } = {}) {
  const win = opts.window ?? parseWindow({}, now);
  const c = await shared(installationId, allowed, now, [win.current]);
  const mine = filterAppts(c.appts, opts.filters ?? {}, c.sourceOf);
  const { from, to } = win.current;
  const inWindow = mine.filter((a) => a.startAt >= from && a.startAt < to && a.status !== "invalid").sort((a, b) => b.startAt - a.startAt);
  const calendars = groupIn(mine, from, to, now, "calendar").slice(0, 30).map((g) => ({ ...g, label: c.several && g.locationId ? `${g.label} · ${c.names.get(g.locationId) ?? "account"}` : g.label }));
  const people = groupIn(mine, from, to, now, "person").slice(0, 30).map((g) => ({ ...g, label: c.label(g.key) }));
  const perAccount = c.locs.map((l) => {
    const rows = mine.filter((a) => a.locationId === l.location_id);
    const r = rates(rows, from, to, now);
    return { locationId: l.location_id as string, name: l.name as string | null, booked: r.booked, held: r.held, noShow: r.noShow, outcomes: r.outcomes, showRate: r.showRate, upcoming7: overview(rows, now).upcoming7, unmarked: r.unmarked, access: (l.appointments_access as string | null) ?? "unknown" };
  }).sort((a, b) => b.booked - a.booked);
  return {
    window: { from: isoDay(from), to: isoDay(to - DAY), defaulted: win.defaulted, problem: win.problem },
    byCalendar: calendars, byPerson: people, perAccount,
    // The rows behind every line, for the window: the page picks a line's rows by its calendar, person or account, so the list equals the number.
    items: capItems(inWindow).map((a) => toItem(a, c, now)), itemsTotal: inWindow.length, itemCap: ITEM_CAP,
  };
}

export type DetailResult = null | {
  appointment: { id: string; locationId: string; locationName: string | null; calendar: string | null; title: string | null; at: number; endAt: number | null; status: string; assigned: string; bookedBy: string | null; channel: string | null; createdAt: number | null; noOutcome: boolean };
  contact: { contactId: string; name: string; phone: string | null; source: string | null } | null;
  history: Array<{ at: number; text: string }>;
};

// One appointment, only when it belongs to an account the caller may see (`allowed` null means every account of the company). The location and the id are
// matched together with the installation, so an id from another company or account finds nothing.
export async function appointmentDetail(installationId: string, allowed: string[] | null, locationId: string, appointmentId: string, now = Date.now()): Promise<DetailResult> {
  if (allowed && !allowed.includes(locationId)) return null;
  const db = sql();
  const [row] = await db`
    select a.appointment_id, a.location_id, a.calendar_name, a.contact_id, a.title, a.status, a.start_at, a.end_at, a.assigned_to, a.created_remote_at, a.booked_by_user, a.booking_channel, l.name location_name
    from cached_appointments a join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id and not l.ignored
    where a.installation_id = ${installationId} and a.location_id = ${locationId} and a.appointment_id = ${appointmentId}`;
  if (!row) return null;
  const [people, contactRows, events] = await Promise.all([
    db`select user_id, name from team_names where installation_id = ${installationId}`,
    row.contact_id ? db`select contact_id, coalesce(nullif(full_name, ''), nullif(email, ''), 'Unnamed contact') name, phone, source from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${row.contact_id as string}` : Promise.resolve([]),
    db`select kind, from_value, to_value, occurred_at from appointment_events where installation_id = ${installationId} and location_id = ${locationId} and appointment_id = ${appointmentId} order by occurred_at limit 50`,
  ]);
  const label = personLabel(new Map(people.map((p) => [p.user_id as string, p.name as string])));
  const appt: Appt = { id: appointmentId, locationId, calendarId: null, calendarName: row.calendar_name as string | null, contactId: (row.contact_id as string | null) ?? null, status: (row.status as string | null) ?? "new", startAt: ms(row.start_at) ?? 0, createdAt: ms(row.created_remote_at), assignedTo: (row.assigned_to as string | null) ?? null };
  const k = contactRows[0];
  return {
    appointment: {
      id: appointmentId, locationId, locationName: (row.location_name as string | null) ?? null, calendar: appt.calendarName, title: (row.title as string | null) ?? null, at: appt.startAt, endAt: ms(row.end_at), status: appt.status,
      assigned: label(appt.assignedTo), bookedBy: row.booked_by_user ? label(row.booked_by_user as string) : null, channel: (row.booking_channel as string | null) ?? null, createdAt: appt.createdAt, noOutcome: needsOutcome(appt, now),
    },
    contact: k ? { contactId: k.contact_id as string, name: k.name as string, phone: (k.phone as string | null) ?? null, source: (k.source as string | null) || null } : null,
    history: historyLines(events.map((e) => ({ kind: e.kind as string, from: (e.from_value as string | null) ?? null, to: (e.to_value as string | null) ?? null, at: ms(e.occurred_at) ?? 0 }))),
  };
}

// The account's own show-rate target. Null puts it back to the default.
export async function setShowRateTarget(installationId: string, value: number | null): Promise<void> {
  await sql()`insert into settings (installation_id, appointment_show_rate_target) values (${installationId}, ${value}) on conflict (installation_id) do update set appointment_show_rate_target = excluded.appointment_show_rate_target`;
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
