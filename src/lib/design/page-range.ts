import { decodeRange, encodeRange, resolveRange, validDate, DEFAULT_RANGE, type Compare, type RangeSpec, type Resolved } from "./range.ts";
import { MAX_RANGE_DAYS } from "./range-limits.ts";
import { isTime } from "./zone.ts";
import { pageRangeFromHash, withPageRange } from "./global-filter.ts";

// The ONE date range of the whole app (the shell bar). This file is the single place that decides what the applied range is, how a typed range is checked,
// how it travels (address first, then this browser's memory) and what the numbers under it must ask the server for. Pure: the clock and the storage are
// passed in, so every rule is unit tested. Screens never work out a window of their own: they read it from here (see usePageRange in ds/page-range.tsx).

export const PAGE_RANGE_DEFAULT: RangeSpec = DEFAULT_RANGE;
const COMPARE_PARAM = "pc";
const CMP_CODE: Record<Exclude<Compare, "none">, string> = { previous: "prev", month: "month", year: "year" };

/** The page comparison (`pc=prev`) of an address: "No comparison" when it has none. */
export function pageCompareFromHash(hash: string): Compare {
  const q = hash.indexOf("?");
  const v = q === -1 ? null : new URLSearchParams(hash.slice(q + 1)).get(COMPARE_PARAM);
  return v === "prev" ? "previous" : v === "month" ? "month" : v === "year" ? "year" : "none";
}
/** The address with the page comparison set (or removed when it is "none"); everything else is kept as it was. */
export function withPageCompare(hash: string, compare: Compare): string {
  const q = hash.indexOf("?");
  const head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  if (compare === "none") p.delete(COMPARE_PARAM); else p.set(COMPARE_PARAM, CMP_CODE[compare]);
  const rest = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%7E/g, "~");
  return rest ? `${head}?${rest}` : head;
}
/** The page range and comparison pairs of an address, to carry to another page (`r.page=...&pc=...`). */
export function pageParamsOf(hash: string): string {
  const r = pageRangeFromHash(hash);
  const c = pageCompareFromHash(hash);
  return [r ? `r.page=${encodeRange({ ...r, compare: "none" })}` : "", c !== "none" ? `${COMPARE_PARAM}=${CMP_CODE[c]}` : ""].filter(Boolean).join("&");
}

export type Saved = { session: string | null; local: string | null };
/**
 * The range in force: the address wins (a pasted link shows what its sender saw), then what this person chose in this browser tab (a custom range lives only
 * for the tab), then a preset remembered for next time, then the default. A custom range is never remembered past the tab, so next week's visit does not open
 * on an old window.
 */
export function pageSpecOf(hash: string, saved: Saved): { spec: RangeSpec; from: "link" | "session" | "saved" | "default" } {
  const link = pageRangeFromHash(hash);
  const compare = pageCompareFromHash(hash);
  if (link) return { spec: { ...link, compare }, from: "link" };
  const s = decodeRange(saved.session);
  if (s) return { spec: { ...s, compare: compare !== "none" ? compare : s.compare }, from: "session" };
  const l = decodeRange(saved.local);
  if (l && l.preset !== "custom") return { spec: { ...l, compare: compare !== "none" ? compare : l.compare }, from: "saved" };
  return { spec: { ...PAGE_RANGE_DEFAULT, compare }, from: "default" };
}

/** True when the range is the app's default (last 30 days, no comparison): the bar offers "Reset" only when it is not. */
export const isDefaultRange = (s: RangeSpec) => s.preset === PAGE_RANGE_DEFAULT.preset && s.compare === "none";

/** Checks two typed dates before they are applied. Returns the plain reason, or null when the range can be applied. Dates are YYYY-MM-DD (the browser's date input gives that whatever the locale shows). */
export function checkCustom(from: string, to: string, today: string, fromTime?: string, toTime?: string): string | null {
  if (!from || !to) return "Pick a start date and an end date.";
  if (!validDate(from) || !validDate(to)) return "One of the dates is not a real date.";
  if (from > to) return "The end date is before the start date.";
  if (to > today) return "The end date is in the future. Pick today or earlier.";
  if ((fromTime && !isTime(fromTime)) || (toTime && !isTime(toTime))) return "A time must look like 09:30.";
  if ((fromTime || toTime) && from === to && (fromTime || "00:00") > (toTime || "23:59")) return "The end time is before the start time.";
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_RANGE_DAYS) return `A custom range can be at most ${MAX_RANGE_DAYS} days (about 3 years). This one is ${days} days.`;
  return null;
}

/** The window as the query every screen sends: `from=2026-10-14&to=2026-11-12` (whole days in the app zone, the end day included), plus `&fromTime=09:00&toTime=17:30` (Lagos time) when the bar has hours. */
export const windowQuery = (r: Resolved) => `from=${r.current.from}&to=${r.current.to}${r.at ? `&fromTime=${r.at.fromTime}&toTime=${r.at.toTime}` : ""}`;
/** The comparison window as a query, or "" when there is none (`cmpFrom=..&cmpTo=..`). */
export const compareQuery = (r: Resolved) => (r.compare ? `cmpFrom=${r.compare.from}&cmpTo=${r.compare.to}` : "");
/** A short stable text for the range, for a request key or a React key: changes whenever the window or comparison changes. */
export const rangeKeyOf = (r: Resolved) => `${r.current.from}~${r.current.to}${r.at ? `@${r.at.fromTime}-${r.at.toTime}` : ""}${r.compare ? `~${r.compare.from}~${r.compare.to}` : ""}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
/**
 * The one line a screen shows when its own record starts after the range begins (the sync window, our own record of changes): never a silently shorter
 * range. `startsOn` is the first day the screen's data really holds (YYYY-MM-DD) or null when unknown. Returns null when the range is fully covered.
 */
export function historyLimitNote(startsOn: string | null | undefined, r: Resolved): string | null {
  if (!startsOn || !validDate(startsOn.slice(0, 10))) return null;
  const s = startsOn.slice(0, 10);
  if (s <= r.current.from) return null;
  if (s > r.current.to) return `Our record for this starts ${fmt(s)}, so nothing is shown for ${r.current.label}.`;
  return `Our record for this starts ${fmt(s)}, so only ${fmt(s)} to ${fmt(r.current.to)} is counted, not the whole range.`;
}

/** The address for a new page range (or none): the range and comparison are both written. */
export function addressWithRange(hash: string, spec: RangeSpec | null): string {
  return withPageCompare(withPageRange(hash, spec), spec ? spec.compare : "none");
}

export { resolveRange };
