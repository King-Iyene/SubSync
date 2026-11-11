// The Appointments filters and how they travel in the address (pure, unit tested).
// Shared by every section: days (or a custom date range), account, calendar, person, source, search.
// For the two worklists (Needs outcome, No-show recovery) only: booker, owner, status, age (days since the appointment time) and sort.
export type ApFilters = {
  days: 7 | 30 | 90; locationId: string; calendarId: string; source: string; q: string; userId: string;
  /** A calendar group id, and only active or only inactive calendars. */
  groupId: string; active: "" | "active" | "inactive";
  /** The manager filters. */
  outcome: "" | "showed" | "noshow" | "noshow_open" | "cancelled" | "unmarked"; deal: "" | "has" | "none"; stage: string; leadAge: "" | "7" | "30" | "old"; contact: "" | "new" | "returning"; attention: boolean;
  /** Show the previous period of the same length next to the numbers. */
  compare: boolean;
  /** "Booked on": only appointments booked in this range (ISO days). Both set, or neither. Works together with the appointment dates. */
  bookedFrom: string; bookedTo: string;
  /** A custom date range (ISO days). When both are set they replace `days`. */
  from: string; to: string;
  /** Worklists only. A person id, or "none" for "not recorded". */
  booker: string; owner: string;
  /** Needs outcome only: the status the booking still has. */
  status: "" | "new" | "confirmed" | "booked";
  /** Worklists: only appointments that passed at least this many days ago (0 = any). */
  age: 0 | 1 | 3 | 7 | 14 | 30;
  /** Worklists: "" = the section's own order. */
  sort: "" | "value" | "oldest" | "newest" | "name";
};
export const DEFAULT_FILTERS: ApFilters = { days: 30, locationId: "", calendarId: "", source: "", q: "", userId: "", groupId: "", active: "", outcome: "", deal: "", stage: "", leadAge: "", contact: "", attention: false, compare: false, bookedFrom: "", bookedTo: "", from: "", to: "", booker: "", owner: "", status: "", age: 0, sort: "" };

export const AGE_OPTIONS = [1, 3, 7, 14, 30] as const;
export const STATUS_OPTIONS = ["new", "confirmed", "booked"] as const;
export const SORT_OPTIONS = ["value", "oldest", "newest", "name"] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const goodDay = (v: string | null) => (v && DAY.test(v) && Number.isFinite(Date.parse(v)) ? v : "");

/** The filters live in the address (?ap_days=30&ap_loc=...) so a view can be shared and survives a reload. Pure, so it is unit tested. */
export function filtersToParams(f: ApFilters): Record<string, string> {
  const o: Record<string, string> = {};
  if (f.days !== 30) o.ap_days = String(f.days);
  if (f.locationId) o.ap_loc = f.locationId;
  if (f.calendarId) o.ap_cal = f.calendarId;
  if (f.userId) o.ap_user = f.userId;
  if (f.groupId) o.ap_grp = f.groupId;
  if (f.outcome) o.ap_out = f.outcome;
  if (f.deal) o.ap_deal = f.deal;
  if (f.stage) o.ap_stage = f.stage;
  if (f.leadAge) o.ap_lead = f.leadAge;
  if (f.contact) o.ap_ct = f.contact;
  if (f.attention) o.ap_att = "1";
  if (f.compare) o.ap_cmp = "1";
  if (f.active) o.ap_act = f.active;
  if (f.bookedFrom && f.bookedTo) { o.ap_bf = f.bookedFrom; o.ap_bt = f.bookedTo; }
  if (f.source) o.ap_src = f.source;
  if (f.q) o.ap_q = f.q;
  if (f.from && f.to) { o.ap_from = f.from; o.ap_to = f.to; }
  if (f.booker) o.ap_bk = f.booker;
  if (f.owner) o.ap_ow = f.owner;
  if (f.status) o.ap_st = f.status;
  if (f.age) o.ap_age = String(f.age);
  if (f.sort) o.ap_sort = f.sort;
  return o;
}
/** Every key filtersToParams can write: the address is cleaned of these before the new ones are set. */
export const FILTER_KEYS = ["ap_days", "ap_loc", "ap_cal", "ap_user", "ap_grp", "ap_act", "ap_out", "ap_deal", "ap_stage", "ap_lead", "ap_ct", "ap_att", "ap_cmp", "ap_bf", "ap_bt", "ap_src", "ap_q", "ap_from", "ap_to", "ap_bk", "ap_ow", "ap_st", "ap_age", "ap_sort"];

export function filtersFromParams(p: URLSearchParams): ApFilters {
  const id = (v: string | null) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : "");
  const d = Number(p.get("ap_days"));
  const from = goodDay(p.get("ap_from")), to = goodDay(p.get("ap_to")), range = !!from && !!to && from <= to;
  const bf = goodDay(p.get("ap_bf")), bt = goodDay(p.get("ap_bt"));
  const age = Number(p.get("ap_age")), st = p.get("ap_st") ?? "", sort = p.get("ap_sort") ?? "";
  return {
    days: d === 7 || d === 90 ? d : 30, locationId: id(p.get("ap_loc")), calendarId: id(p.get("ap_cal")), userId: id(p.get("ap_user")), groupId: id(p.get("ap_grp")), outcome: ((v) => (["showed", "noshow", "noshow_open", "cancelled", "unmarked"].includes(v) ? v : "") as ApFilters["outcome"])(p.get("ap_out") ?? ""), deal: p.get("ap_deal") === "has" || p.get("ap_deal") === "none" ? (p.get("ap_deal") as "has" | "none") : "", stage: (p.get("ap_stage") ?? "").slice(0, 120), leadAge: ["7", "30", "old"].includes(p.get("ap_lead") ?? "") ? (p.get("ap_lead") as "7" | "30" | "old") : "", contact: p.get("ap_ct") === "new" || p.get("ap_ct") === "returning" ? (p.get("ap_ct") as "new" | "returning") : "", attention: p.get("ap_att") === "1", compare: p.get("ap_cmp") === "1", active: p.get("ap_act") === "active" || p.get("ap_act") === "inactive" ? (p.get("ap_act") as "active" | "inactive") : "", bookedFrom: bf && bt && bf <= bt ? bf : "", bookedTo: bf && bt && bf <= bt ? bt : "", source: (p.get("ap_src") ?? "").slice(0, 120), q: (p.get("ap_q") ?? "").slice(0, 60),
    from: range ? from : "", to: range ? to : "", booker: id(p.get("ap_bk")), owner: id(p.get("ap_ow")),
    status: (STATUS_OPTIONS as readonly string[]).includes(st) ? (st as ApFilters["status"]) : "", age: (AGE_OPTIONS as readonly number[]).includes(age) ? (age as ApFilters["age"]) : 0,
    sort: (SORT_OPTIONS as readonly string[]).includes(sort) ? (sort as ApFilters["sort"]) : "",
  };
}

// ---- date presets (both date axes: "Appointment date" and "Booked on") ----
export const DATE_PRESETS = [["today", "Today"], ["yesterday", "Yesterday"], ["this_week", "This week"], ["last_week", "Last week"], ["this_month", "This month"], ["last_month", "Last month"], ["next7", "Next 7 days"], ["last7", "Last 7 days"], ["last30", "Last 30 days"], ["last90", "Last 90 days"]] as const;
export type DatePreset = (typeof DATE_PRESETS)[number][0];
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAYMS = 86_400_000;
/** The first and last day (ISO, inclusive) of a preset. Weeks start on Monday. Pure, so it is unit tested. */
export function presetRange(key: DatePreset, now: number): { from: string; to: string } {
  const t = Math.floor(now / DAYMS) * DAYMS, dow = (new Date(t).getUTCDay() + 6) % 7, mon = t - dow * DAYMS, d = new Date(t);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  switch (key) {
    case "today": return { from: iso(t), to: iso(t) };
    case "yesterday": return { from: iso(t - DAYMS), to: iso(t - DAYMS) };
    case "this_week": return { from: iso(mon), to: iso(mon + 6 * DAYMS) };
    case "last_week": return { from: iso(mon - 7 * DAYMS), to: iso(mon - DAYMS) };
    case "this_month": return { from: iso(monthStart), to: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)) };
    case "last_month": return { from: iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), to: iso(monthStart - DAYMS) };
    case "next7": return { from: iso(t), to: iso(t + 6 * DAYMS) };
    case "last7": return { from: iso(t - 6 * DAYMS), to: iso(t) };
    case "last30": return { from: iso(t - 29 * DAYMS), to: iso(t) };
    default: return { from: iso(t - 89 * DAYMS), to: iso(t) };
  }
}
/** Which preset a range is, or "custom". */
export function rangeKey(from: string, to: string, now: number): DatePreset | "custom" {
  for (const [k] of DATE_PRESETS) { const r = presetRange(k, now); if (r.from === from && r.to === to) return k; }
  return "custom";
}
/** The same-length stretch just before a range (ISO days, inclusive): what "compare to previous period" shows. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const a = Date.parse(from), b = Date.parse(to), len = Math.round((b - a) / DAYMS) + 1;
  return { from: iso(a - len * DAYMS), to: iso(a - DAYMS) };
}
