// Appointment logic added in stage F3 (the status breakdown, the date window, the filters, the history lines, the targets). Pure: no database or
// network imports, so it can be unit tested. Definitions are in docs/METRICS.md, "Appointments".
import { needsOutcome, rates, type Appt } from "./appointment-intel.ts";

const DAY = 86_400_000;

// ---------- statuses ----------

export type Bucket = "new" | "confirmed" | "showed" | "noshow" | "cancelled" | "invalid" | "other";

/** The order the breakdown is shown in. `new` is what the platform calls a booking nobody has confirmed yet. */
export const BUCKETS: Array<{ key: Bucket; label: string; hint: string }> = [
  { key: "new", label: "Booked", hint: "Booked, not confirmed yet." },
  { key: "confirmed", label: "Confirmed", hint: "Booked and confirmed. Once the time has passed, it still needs an outcome." },
  { key: "showed", label: "Showed", hint: "The person came. This is a recorded outcome." },
  { key: "noshow", label: "No-show", hint: "The person did not come. This is a recorded outcome." },
  { key: "cancelled", label: "Cancelled", hint: "Cancelled before the time. Counted as scheduled, never as an outcome." },
  { key: "invalid", label: "Invalid", hint: "A spam, test or mistaken booking. It is in no number and no rate." },
  { key: "other", label: "Other status", hint: "A status SubSync does not recognise. It is treated as booked with no outcome, never guessed." },
];

export function bucketOf(status: string): Bucket {
  return status === "new" || status === "confirmed" || status === "showed" || status === "noshow" || status === "cancelled" || status === "invalid" ? status : "other";
}
export const bucketLabel = (b: Bucket) => BUCKETS.find((x) => x.key === b)?.label ?? "Other status";

/** The plain word for a platform status, used in lists and the detail panel. */
export const statusWord = (status: string) => bucketLabel(bucketOf(status));

export type StatusCounts = {
  /** Everything that starts inside the window, invalid ones included (they are shown on their own line). */
  total: number;
  /** Everything that starts inside the window except invalid: the "booked" number of the headline tiles (same as `rates().booked`). */
  scheduled: number;
  byBucket: Record<Bucket, number>;
  /** Past by more than 3 hours, active, and still not showed or no-show. */
  noOutcome: number;
};

export function statusCounts(appts: Appt[], from: number, to: number, now: number): StatusCounts {
  const inside = appts.filter((a) => a.startAt >= from && a.startAt < to);
  const byBucket: Record<Bucket, number> = { new: 0, confirmed: 0, showed: 0, noshow: 0, cancelled: 0, invalid: 0, other: 0 };
  for (const a of inside) byBucket[bucketOf(a.status)]++;
  return { total: inside.length, scheduled: inside.length - byBucket.invalid, byBucket, noOutcome: inside.filter((a) => needsOutcome(a, now)).length };
}

// ---------- the window ----------

export type Window = { from: number; to: number };
export type ParsedWindow = {
  current: Window;
  /** The window to compare with, or null when none was asked for. */
  compare: Window | null;
  /** True when no dates were sent: the rolling "last 30 days against the 30 days before" the page always used. */
  defaulted: boolean;
  /** Said in words when a date was refused, so the page can tell the person. */
  problem: string | null;
};

export const MAX_WINDOW_DAYS = 366;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const dayStart = (iso: string): number | null => (ISO.test(iso) && Number.isFinite(Date.parse(`${iso}T00:00:00Z`)) && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? Date.parse(`${iso}T00:00:00Z`) : null);
export const todayIso = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Dates sent by the browser (YYYY-MM-DD, whole UTC days, the end date included). Anything that does not parse, runs backwards, ends in the future or
 * is longer than a year is refused and the default window is used instead; the reason comes back as `problem` and is never silent.
 */
export function parseWindow(q: { from?: string | null; to?: string | null; cmpFrom?: string | null; cmpTo?: string | null }, now: number): ParsedWindow {
  const fallback = (problem: string | null): ParsedWindow => ({ current: { from: now - 30 * DAY, to: now }, compare: { from: now - 60 * DAY, to: now - 30 * DAY }, defaulted: true, problem });
  if (!q.from && !q.to) return fallback(null);
  const f = q.from ? dayStart(q.from) : null;
  const t = q.to ? dayStart(q.to) : null;
  if (f === null || t === null) return fallback("The dates were not understood, so the last 30 days are shown.");
  if (f > t) return fallback("The end date was before the start date, so the last 30 days are shown.");
  if (t > dayStart(todayIso(now))!) return fallback("The end date was in the future, so the last 30 days are shown.");
  if ((t - f) / DAY + 1 > MAX_WINDOW_DAYS) return fallback(`A range can be at most ${MAX_WINDOW_DAYS} days, so the last 30 days are shown.`);
  const current = { from: f, to: t + DAY };
  let compare: Window | null = null;
  let problem: string | null = null;
  if (q.cmpFrom || q.cmpTo) {
    const cf = q.cmpFrom ? dayStart(q.cmpFrom) : null;
    const ct = q.cmpTo ? dayStart(q.cmpTo) : null;
    if (cf === null || ct === null || cf > ct || (ct - cf) / DAY + 1 > MAX_WINDOW_DAYS) problem = "The dates to compare with were not understood, so there is no comparison.";
    else compare = { from: cf, to: ct + DAY };
  }
  return { current, compare, defaulted: false, problem };
}

// ---------- filters ----------

export type ApptFilters = { calendar?: string | null; user?: string | null; source?: string | null };
const clean = (v: string | null | undefined) => (v && v.length <= 80 ? v : null);

/** Reads the three filters from the address. Anything over 80 characters is ignored. */
export function parseFilters(q: { calendar?: string | null; user?: string | null; source?: string | null }): ApptFilters {
  return { calendar: clean(q.calendar), user: clean(q.user), source: clean(q.source) };
}

/** Narrows to a calendar (by id), a person (by id, or "unassigned") and a lead source (the contact's source, or "unknown"). */
export function filterAppts<T extends Appt>(appts: T[], f: ApptFilters, sourceOf: (locationId: string, contactId: string) => string | null): T[] {
  const src = f.source ? f.source.toLowerCase() : null;
  return appts.filter((a) => {
    if (f.calendar && a.calendarId !== f.calendar) return false;
    if (f.user && (f.user === "unassigned" ? a.assignedTo !== null : a.assignedTo !== f.user)) return false;
    if (src) {
      const s = a.contactId ? sourceOf(a.locationId, a.contactId) : null;
      const label = s ? s.toLowerCase() : "unknown";
      if (label !== src) return false;
    }
    return true;
  });
}

export type Choice = { key: string; label: string; count: number };

/** What the filter menus offer: every calendar, person and source in the appointments before narrowing, most used first. */
export function filterOptions(appts: Appt[], personLabel: (id: string) => string, sourceOf: (locationId: string, contactId: string) => string | null, locationName: (id: string) => string | null, several: boolean) {
  const cal = new Map<string, Choice>();
  const who = new Map<string, Choice>();
  const src = new Map<string, Choice>();
  for (const a of appts) {
    if (a.calendarId) {
      const label = `${a.calendarName ?? "Calendar"}${several && locationName(a.locationId) ? ` (${locationName(a.locationId)})` : ""}`;
      const c = cal.get(a.calendarId) ?? { key: a.calendarId, label, count: 0 };
      c.count++; cal.set(a.calendarId, c);
    }
    const uid = a.assignedTo ?? "unassigned";
    const w = who.get(uid) ?? { key: uid, label: personLabel(uid), count: 0 };
    w.count++; who.set(uid, w);
    const s = a.contactId ? sourceOf(a.locationId, a.contactId) : null;
    const sl = s ?? "Unknown";
    const sc = src.get(sl.toLowerCase()) ?? { key: sl, label: sl, count: 0 };
    sc.count++; src.set(sl.toLowerCase(), sc);
  }
  const top = (m: Map<string, Choice>, n: number) => [...m.values()].sort((x, y) => y.count - x.count || x.label.localeCompare(y.label)).slice(0, n);
  return { calendars: top(cal, 40), users: top(who, 40), sources: top(src, 40) };
}

// ---------- breakdowns over a window ----------

export type Group = { key: string; label: string; locationId: string | null; booked: number; held: number; noShow: number; cancelled: number; outcomes: number; showRate: number | null };

/** Show rate per calendar or per person inside a window. The page opens the rows of a line by its `key` from the same window, so the list equals the number. */
export function groupIn(appts: Appt[], from: number, to: number, now: number, by: "calendar" | "person"): Group[] {
  const groups = new Map<string, Appt[]>();
  for (const a of appts.filter((x) => x.startAt >= from && x.startAt < to && x.status !== "invalid")) {
    const key = by === "calendar" ? a.calendarId ?? "none" : a.assignedTo ?? "unassigned";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  return [...groups.entries()].map(([key, list]) => {
    const r = rates(list, from, to, now);
    return { key, label: by === "calendar" ? list[0].calendarName ?? "Calendar" : key, locationId: list[0].locationId, booked: r.booked, held: r.held, noShow: r.noShow, cancelled: r.cancelled, outcomes: r.outcomes, showRate: r.showRate };
  }).sort((a, b) => b.booked - a.booked);
}

// ---------- the history of one appointment ----------

export type HistoryEvent = { kind: string; from: string | null; to: string | null; at: number };
const fmt = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const iso = (s: string | null) => { const ms = s ? Date.parse(s) : NaN; return Number.isFinite(ms) ? `${fmt(ms)} UTC` : null; };

/** Plain sentences for the changes SubSync recorded. The platform keeps no history, so this only goes back to when SubSync first saw the appointment. */
export function historyLines(events: HistoryEvent[]): Array<{ at: number; text: string }> {
  return [...events].sort((a, b) => a.at - b.at).map((e) => {
    if (e.kind === "created") return { at: e.at, text: `First seen as ${e.to ? statusWord(e.to).toLowerCase() : "booked"}.` };
    if (e.kind === "status") return { at: e.at, text: `Status changed from ${e.from ? statusWord(e.from).toLowerCase() : "unknown"} to ${e.to ? statusWord(e.to).toLowerCase() : "unknown"}.` };
    if (e.kind === "time") return { at: e.at, text: `Moved from ${iso(e.from) ?? "an earlier time"} to ${iso(e.to) ?? "a new time"}.` };
    return { at: e.at, text: "Changed." };
  });
}

// ---------- targets ----------

export const DEFAULT_SHOW_RATE_TARGET = 75;
export const clampTarget = (n: unknown): number | null => (typeof n === "number" && Number.isInteger(n) && n >= 30 && n <= 100 ? n : null);

/** The show rate against the owner's target, in words. Nothing is said while the rate itself is not shown (fewer than 5 recorded outcomes). */
export function targetState(rate: number | null, target: number): { state: "unknown" | "met" | "below"; text: string } {
  if (rate === null) return { state: "unknown", text: `Target ${target}%. Shown once at least 5 outcomes are recorded.` };
  const pct = Math.round(rate * 100);
  return pct >= target ? { state: "met", text: `${pct}% is at or above your ${target}% target.` } : { state: "below", text: `${pct}% is ${target - pct} point${target - pct === 1 ? "" : "s"} below your ${target}% target.` };
}

// ---------- what a list item says about itself (used by the server to build rows and by the tests) ----------

export type ItemFlags = { needsOutcome: boolean; unconfirmedSoon: boolean };
export function flagsOf(a: Appt, now: number): ItemFlags {
  return { needsOutcome: needsOutcome(a, now), unconfirmedSoon: a.status === "new" && a.startAt >= now && a.startAt < now + 2 * DAY };
}

/** The number of rows a list is allowed to send. A count above it is still the true count; the list says how many were left out. */
export const ITEM_CAP = 500;
export const capItems = <T>(rows: T[], cap = ITEM_CAP): T[] => (rows.length > cap ? rows.slice(0, cap) : rows);

/** The one rule that makes a chart count and its list agree: the list of a bucket is the items of that bucket, counted the same way. */
export const itemsInBucket = <T extends { status: string }>(items: T[], key: Bucket) => items.filter((i) => bucketOf(i.status) === key);
