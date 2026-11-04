// The Appointments work lists (stage APPT rebuild, docs/APPOINTMENTS_REVIEW.md). Pure: no database or network imports, so it is unit tested.
//
// Three lists, built from the SAME rules Today uses (docs/METRICS.md, "Today, third pass" and "Appointments"), so a number on Today and the list behind it here are one
// number:
//   record   "Needs an outcome":  an active appointment that started more than 3 hours ago, in the last 30 days, still not showed or no-show (appointment-intel: needsOutcome).
//   recover  "No-shows to recover": no-shows of the last 14 days whose person has no later active appointment (appointment-intel: noShowRecovery).
//   upcoming "Coming up that may not show": active appointments in the next 7 days that are not confirmed yet, or whose person missed an earlier appointment.
import { isActive, MIN_OUTCOMES_FOR_RATE, needsOutcome, noShowRecovery, type Appt } from "./appointment-intel.ts";

export const DAY = 86_400_000;
export const RECORD_DAYS = 30;
export const RECOVER_DAYS = 14;
export const UPCOMING_DAYS = 7;
export const MAX_PAGE = 50;
/** Never send more than this many rows from the server in one list read; the count stays the true count. */
export const INLINE_ROWS = 5;

export type WorkKind = "record" | "recover" | "upcoming";
export const WORK_KINDS: WorkKind[] = ["recover", "record", "upcoming"];
export type UpcomingWhy = "unconfirmed" | "missed_before";

/** The three lists as plain appointment rows. `noShowRecovery` and `needsOutcome` are the functions Today's numbers come from. */
export function workLists<T extends Appt>(appts: T[], now: number): { record: T[]; recover: T[]; upcoming: Array<{ a: T; why: UpcomingWhy[]; lastMissed: number | null }> } {
  const record = appts.filter((a) => a.startAt >= now - RECORD_DAYS * DAY && a.startAt < now && needsOutcome(a, now));
  const recover = noShowRecovery(appts, now, RECOVER_DAYS);
  // The last time each person missed an appointment (so an upcoming appointment can say "missed their last one").
  const missed = new Map<string, number[]>();
  for (const a of appts) if (a.status === "noshow" && a.contactId && a.startAt < now) (missed.get(`${a.locationId}:${a.contactId}`) ?? missed.set(`${a.locationId}:${a.contactId}`, []).get(`${a.locationId}:${a.contactId}`)!).push(a.startAt);
  const upcoming: Array<{ a: T; why: UpcomingWhy[]; lastMissed: number | null }> = [];
  for (const a of appts) {
    if (!isActive(a) || a.startAt < now || a.startAt >= now + UPCOMING_DAYS * DAY) continue;
    const why: UpcomingWhy[] = [];
    if (a.status === "new") why.push("unconfirmed");
    const before = a.contactId ? (missed.get(`${a.locationId}:${a.contactId}`) ?? []).filter((t) => t < a.startAt) : [];
    const lastMissed = before.length ? Math.max(...before) : null;
    if (lastMissed !== null) why.push("missed_before");
    if (why.length > 0) upcoming.push({ a, why, lastMissed });
  }
  return { record, recover, upcoming };
}

// ---------- what a row says about itself ----------

export type WorkItem = {
  /** Unique: `<account>:<appointment>`. */
  key: string; kind: WorkKind | "window"; id: string; locationId: string; locationName: string | null; contactId: string | null; name: string;
  phone: string | null; email: string | null; dnd: boolean; timeZone: string | null; calendarId: string | null; calendar: string | null; at: number; status: string;
  assignedKey: string; assigned: string; source: string | null;
  /** Counted open deal dollars of this person (0 when none). Used to rank and to show money at stake. */
  value: number;
  /** One plain line that says why the row is here. */
  reason: string;
  why: UpcomingWhy[];
};

const dayFmt = (t: number, tz?: string | null) => {
  try { return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz ?? "UTC" }); } catch { return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); }
};
const ago = (days: number) => (days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

/** The one plain line under a person's name. Words only; no percentages, no jargon. */
export function reasonFor(kind: WorkKind, v: { at: number; now: number; calendar: string | null; why?: UpcomingWhy[]; lastMissed?: number | null; timeZone?: string | null }): string {
  const days = Math.max(0, Math.floor((v.now - v.at) / DAY));
  const cal = v.calendar ? ` (${v.calendar})` : "";
  if (kind === "record") return `Was ${dayFmt(v.at, v.timeZone)}${cal}. Nobody marked it showed or no-show.`;
  if (kind === "recover") return `Missed ${ago(days)}${cal}. Not booked again.`;
  const bits: string[] = [];
  if (v.why?.includes("unconfirmed")) bits.push("not confirmed yet");
  if (v.why?.includes("missed_before")) bits.push(v.lastMissed ? `missed their last one on ${dayFmt(v.lastMissed, v.timeZone)}` : "missed an earlier one");
  const text = bits.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${cal}.`;
}

// ---------- filter, sort, page ----------

export type SortKey = "important" | "newest" | "oldest" | "account" | "name";
export const SORT_KEYS: SortKey[] = ["important", "newest", "oldest", "account", "name"];
export const parseSort = (v: string | null | undefined): SortKey => (SORT_KEYS as string[]).includes(v ?? "") ? (v as SortKey) : "important";
export const sortLabel = (k: SortKey, kind: WorkKind | "all" | "bucket") =>
  k === "important" ? (kind === "upcoming" ? "Soonest first" : kind === "all" ? "Most to lose first" : kind === "bucket" ? "Most valuable first" : "Most valuable first")
  : k === "newest" ? "Newest first" : k === "oldest" ? "Oldest first" : k === "account" ? "Client account A to Z" : "Name A to Z";

export type ListQuery = { q: string; sort: SortKey; location: string | null; user: string | null; calendar: string | null };

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9@. ]+/g, " ").replace(/\s+/g, " ").trim();
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");

/** Money first, then how fresh. Recover: the newest miss first (the sooner a person is called the better the odds); record: the oldest first (the longest hidden); upcoming: soonest first. */
function important(kind: WorkKind | "all" | "bucket") {
  return (a: WorkItem, b: WorkItem) => {
    if (kind === "upcoming") return a.at - b.at || b.value - a.value || a.key.localeCompare(b.key);
    if (b.value !== a.value) return b.value - a.value;
    if (kind === "recover") return b.at - a.at || a.key.localeCompare(b.key);
    if (kind === "record") return a.at - b.at || a.key.localeCompare(b.key);
    // all: past things (oldest first within money), then coming up (soonest first)
    return (a.kind === "upcoming" ? 1 : 0) - (b.kind === "upcoming" ? 1 : 0) || (a.kind === "upcoming" ? a.at - b.at : b.at - a.at) || a.key.localeCompare(b.key);
  };
}

export function selectWork(items: readonly WorkItem[], kind: WorkKind | "all" | "bucket", q: ListQuery): WorkItem[] {
  const text = norm(q.q);
  const num = digits(q.q);
  const out = items.filter((i) => {
    if (q.location && i.locationId !== q.location) return false;
    if (q.user && i.assignedKey !== q.user) return false;
    if (q.calendar && i.calendarId !== q.calendar) return false;
    if (!text && !num) return true;
    const hay = norm(`${i.name} ${i.email ?? ""} ${i.calendar ?? ""} ${i.assigned} ${i.locationName ?? ""}`);
    if (text && hay.includes(text)) return true;
    return num.length >= 4 && digits(i.phone).includes(num);
  });
  const cmp: Record<SortKey, (a: WorkItem, b: WorkItem) => number> = {
    important: important(kind),
    newest: (a, b) => b.at - a.at || a.key.localeCompare(b.key),
    oldest: (a, b) => a.at - b.at || a.key.localeCompare(b.key),
    account: (a, b) => (a.locationName ?? "").localeCompare(b.locationName ?? "") || a.at - b.at || a.key.localeCompare(b.key),
    name: (a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key),
  };
  return out.sort(cmp[q.sort]);
}

export function pageOf<T>(list: readonly T[], page: number, size: number): { rows: T[]; page: number; pages: number; total: number; from: number; to: number } {
  const n = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number.isFinite(size) ? size : 25)));
  const pages = Math.max(1, Math.ceil(list.length / n));
  const at = Math.min(Math.max(0, Math.floor(Number.isFinite(page) ? page : 0)), pages - 1);
  const rows = list.slice(at * n, at * n + n);
  return { rows, page: at, pages, total: list.length, from: list.length === 0 ? 0 : at * n + 1, to: at * n + rows.length };
}

/** Dollars of open deals of the PEOPLE in a list, each person once (two appointments of one person do not count their deals twice). */
export function valueOfPeople(items: readonly Pick<WorkItem, "locationId" | "contactId" | "value">[]): number {
  const seen = new Set<string>();
  let sum = 0;
  for (const i of items) {
    if (!i.contactId || i.value <= 0) continue;
    const k = `${i.locationId}:${i.contactId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    sum += i.value;
  }
  return sum;
}

// ---------- the true show rate ----------

export type ShowRate = {
  booked: number; held: number; noShow: number; cancelled: number; outcomes: number; unmarked: number;
  /** held / (held + no-show), or null under 5 recorded outcomes. */
  rate: number | null;
  /** What it would read if every unmarked appointment had shown (high) or none had (low). Only given when it helps: at least 3 unmarked and at least 5 points apart. */
  range: { low: number; high: number } | null;
  need: number;
};

export function showRateOf(appts: readonly Appt[], from: number, to: number, now: number): ShowRate {
  const inWin = appts.filter((a) => a.startAt >= from && a.startAt < to && a.status !== "invalid");
  const held = inWin.filter((a) => a.status === "showed").length;
  const noShow = inWin.filter((a) => a.status === "noshow").length;
  const cancelled = inWin.filter((a) => a.status === "cancelled").length;
  const unmarked = inWin.filter((a) => needsOutcome(a, now)).length;
  const outcomes = held + noShow;
  const rate = outcomes >= MIN_OUTCOMES_FOR_RATE ? held / outcomes : null;
  let range: ShowRate["range"] = null;
  if (rate !== null && unmarked >= 3) {
    const low = held / (outcomes + unmarked);
    const high = (held + unmarked) / (outcomes + unmarked);
    if (Math.round(high * 100) - Math.round(low * 100) >= 5) range = { low, high };
  }
  return { booked: inWin.length, held, noShow, cancelled, outcomes, unmarked, rate, range, need: Math.max(0, MIN_OUTCOMES_FOR_RATE - outcomes) };
}

/** The outcome bars of the show-rate card: what happened to the appointments of a window. Each bar's rows are exactly its count. */
export type OutcomeBucket = "showed" | "noshow" | "unmarked" | "cancelled";
export const OUTCOME_BUCKETS: Array<{ key: OutcomeBucket; label: string; hint: string }> = [
  { key: "showed", label: "Showed", hint: "Marked as showed. A recorded outcome." },
  { key: "noshow", label: "No-show", hint: "Marked as no-show. A recorded outcome." },
  { key: "unmarked", label: "No outcome yet", hint: "Time passed, nobody marked it. SubSync does not guess." },
  { key: "cancelled", label: "Cancelled", hint: "Cancelled before the time. Not an outcome." },
];
export const parseBucket = (v: string | null | undefined): OutcomeBucket | null => (OUTCOME_BUCKETS.some((b) => b.key === v) ? (v as OutcomeBucket) : null);

export function inOutcomeBucket(a: Appt, b: OutcomeBucket, now: number): boolean {
  if (a.status === "invalid") return false;
  if (b === "showed") return a.status === "showed";
  if (b === "noshow") return a.status === "noshow";
  if (b === "cancelled") return a.status === "cancelled";
  return needsOutcome(a, now);
}
export const outcomeCounts = (appts: readonly Appt[], from: number, to: number, now: number): Record<OutcomeBucket, number> => {
  const inWin = appts.filter((a) => a.startAt >= from && a.startAt < to);
  return Object.fromEntries(OUTCOME_BUCKETS.map((b) => [b.key, inWin.filter((a) => inOutcomeBucket(a, b.key, now)).length])) as Record<OutcomeBucket, number>;
};

// ---------- the comparison people can act on ----------

export type Compare = { key: string; label: string; record: number; recover: number; upcoming: number; todo: number; booked: number; outcomes: number; rate: number | null };
export type By = "person" | "account" | "calendar";
export const parseBy = (v: string | null | undefined): By => (v === "account" || v === "calendar" ? v : "person");

/**
 * One line per person, client account or calendar. "To do" is the same three lists as the page (so pressing it opens exactly those rows); the show rate is over the
 * window of the card and needs 5 recorded outcomes. Most to do first, so the line to act on is on top.
 */
export function compareBy(appts: readonly Appt[], by: By, from: number, to: number, labelOf: (key: string) => string, lists: { record: readonly Appt[]; recover: readonly Appt[]; upcoming: readonly Appt[] }): Compare[] {
  const keyOf = (a: Appt) => (by === "person" ? a.assignedTo ?? "unassigned" : by === "account" ? a.locationId : a.calendarId ?? "none");
  const rows = new Map<string, Compare>();
  const row = (key: string): Compare => rows.get(key) ?? rows.set(key, { key, label: labelOf(key), record: 0, recover: 0, upcoming: 0, todo: 0, booked: 0, outcomes: 0, rate: null }).get(key)!;
  const held = new Map<string, number>();
  for (const a of appts) {
    if (a.startAt < from || a.startAt >= to || a.status === "invalid") continue;
    const r = row(keyOf(a));
    r.booked++;
    if (a.status === "showed" || a.status === "noshow") { r.outcomes++; if (a.status === "showed") held.set(r.key, (held.get(r.key) ?? 0) + 1); }
  }
  for (const a of lists.record) { const r = row(keyOf(a)); r.record++; r.todo++; }
  for (const a of lists.recover) { const r = row(keyOf(a)); r.recover++; r.todo++; }
  for (const a of lists.upcoming) { const r = row(keyOf(a)); r.upcoming++; r.todo++; }
  for (const r of rows.values()) r.rate = r.outcomes >= MIN_OUTCOMES_FOR_RATE ? (held.get(r.key) ?? 0) / r.outcomes : null;
  return [...rows.values()].sort((a, b) => b.todo - a.todo || b.booked - a.booked || a.label.localeCompare(b.label));
}

// ---------- the headline ----------

export type Counts = { record: number; recover: number; upcoming: number; recoverValue: number; value: number };

/** The one sentence that opens the page and the one button under it. Counts are of appointments, and the three kinds never overlap, so they add up. */
export function headlineOf(c: Counts): { title: string; line: string | null; action: { kind: WorkKind; label: string } | null; total: number } {
  const total = c.record + c.recover + c.upcoming;
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  if (total === 0) return { title: "Every appointment is accounted for.", line: "Nothing is waiting for an outcome, no no-show is waiting for a call and nothing coming up looks shaky.", action: null, total };
  const parts = [
    c.recover > 0 ? `${plural(c.recover, "no-show", "no-shows")} nobody has followed up` : null,
    c.record > 0 ? `${plural(c.record, "past appointment", "past appointments")} with no outcome marked` : null,
    c.upcoming > 0 ? `${plural(c.upcoming, "appointment", "appointments")} coming up that may not show` : null,
  ].filter(Boolean) as string[];
  const money = c.value > 0 ? ` The people behind them have ${money$(c.value)} of open deals.` : "";
  const action = c.recover > 0 ? { kind: "recover" as const, label: `Follow up the ${plural(c.recover, "no-show", "no-shows")}` }
    : c.record > 0 ? { kind: "record" as const, label: `Mark ${plural(c.record, "past appointment", "past appointments")}` }
    : { kind: "upcoming" as const, label: `Check ${plural(c.upcoming, "appointment", "appointments")} coming up` };
  return { title: `${plural(total, "appointment needs", "appointments need")} a person.`, line: `${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}.${money}`, action, total };
}
export const money$ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The copy-and-print summary: plain lines a person can paste into a message. */
export function summaryText(v: { counts: Counts; rate: ShowRate; windowWords: string; accounts?: Array<{ label: string; record: number; recover: number }> }): string {
  const h = headlineOf(v.counts);
  const r = v.rate;
  const lines = [
    `Appointments: ${h.title.replace(/\.$/, "")}.`,
    h.line ?? "",
    r.rate === null ? `True show rate: not enough marked appointments yet (${r.outcomes} of ${MIN_OUTCOMES_FOR_RATE} needed), ${v.windowWords}.` : `True show rate ${Math.round(r.rate * 100)}% over ${v.windowWords}: ${r.held} showed, ${r.noShow} no-show, ${r.unmarked} still have no outcome.`,
    r.range ? `Once the ${r.unmarked} unmarked are marked it will land between ${Math.round(r.range.low * 100)}% and ${Math.round(r.range.high * 100)}%.` : "",
    ...(v.accounts ?? []).map((a) => `- ${a.label}: ${a.recover} no-shows to follow up, ${a.record} to mark`),
  ];
  return lines.filter(Boolean).join("\n");
}

