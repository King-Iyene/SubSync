import { MAX_RANGE_DAYS } from "./range-limits.ts";

// The window and comparison of ONE card (KF-4): "Last 30 days, 3 Oct to 1 Nov, compared with 3 Sep to 2 Oct". Pure: no clock of its own (the caller passes
// today), no React. A card's range overrides the page range for that card only, is carried in the page address as `r.<card>=30d.prev`, and the comparison
// obeys the same minimum-sample rule as the rest of the app: no percentage change on a tiny base.

export type RangePreset = "7d" | "30d" | "90d" | "custom";
export type Compare = "none" | "previous" | "month" | "year";
export type RangeSpec = { preset: RangePreset; from?: string; to?: string; compare: Compare };

export const PRESETS: Array<{ key: Exclude<RangePreset, "custom">; label: string; days: number }> = [{ key: "7d", label: "Last 7 days", days: 7 }, { key: "30d", label: "Last 30 days", days: 30 }, { key: "90d", label: "Last 90 days", days: 90 }];
export const COMPARES: Array<{ key: Compare; label: string }> = [{ key: "none", label: "No comparison" }, { key: "previous", label: "Previous period" }, { key: "month", label: "Same dates last month" }, { key: "year", label: "Same dates last year" }];
export const DEFAULT_RANGE: RangeSpec = { preset: "30d", compare: "none" };
export const MAX_CUSTOM_DAYS = MAX_RANGE_DAYS;

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const validDate = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && Number.isFinite(toMs(s)) && toIso(toMs(s)) === s;
/** "3 Oct" (and the year when it is not this year, or the window spans years). */
const short = (iso: string, withYear: boolean) => { const d = new Date(toMs(iso)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`; };

// The same calendar dates, `months` earlier, with the day clamped to the end of a shorter month (31 Mar minus one month is 28 or 29 Feb).
function shiftMonths(iso: string, months: number): string {
  const d = new Date(toMs(iso));
  const y = d.getUTCFullYear(), m = d.getUTCMonth() - months, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return toIso(Date.UTC(y, m, Math.min(day, last)));
}

export type Window = { from: string; to: string; days: number; label: string };
export type Resolved = { spec: RangeSpec; current: Window; compare: Window | null; sentence: string; problem: string | null };

const win = (from: string, to: string, withYear: boolean, name?: string): Window => ({ from, to, days: Math.round((toMs(to) - toMs(from)) / DAY) + 1, label: name ?? `${short(from, withYear)} to ${short(to, withYear)}` });

// A bad custom range (end before start, in the future, longer than a year) falls back to the default window and says why, never silently.
export function resolveRange(specIn: RangeSpec, today: string): Resolved {
  let spec = specIn;
  let problem: string | null = null;
  let from: string, to: string;
  const preset = PRESETS.find((p) => p.key === spec.preset);
  if (preset) { to = today; from = toIso(toMs(today) - (preset.days - 1) * DAY); }
  else if (validDate(spec.from) && validDate(spec.to)) {
    if (spec.from > spec.to) problem = "The end date is before the start date.";
    else if (spec.to > today) problem = "The end date is in the future.";
    else if ((toMs(spec.to) - toMs(spec.from)) / DAY + 1 > MAX_CUSTOM_DAYS) problem = `A custom range can be at most ${MAX_CUSTOM_DAYS} days (about 3 years).`;
    if (problem) { spec = { ...DEFAULT_RANGE, compare: spec.compare }; to = today; from = toIso(toMs(today) - 29 * DAY); }
    else { from = spec.from; to = spec.to; }
  } else { problem = "Pick a start and an end date."; spec = { ...DEFAULT_RANGE, compare: spec.compare }; to = today; from = toIso(toMs(today) - 29 * DAY); }
  const withYear = from.slice(0, 4) !== to.slice(0, 4) || to.slice(0, 4) !== today.slice(0, 4);
  const name = preset ? `${preset.label}, ${short(from, withYear)} to ${short(to, withYear)}` : undefined;
  const current = win(from, to, withYear, name);
  let compare: Window | null = null;
  if (spec.compare === "previous") { const end = toIso(toMs(from) - DAY); compare = win(toIso(toMs(end) - (current.days - 1) * DAY), end, withYear); }
  else if (spec.compare === "month") compare = win(shiftMonths(from, 1), shiftMonths(to, 1), withYear);
  else if (spec.compare === "year") compare = win(shiftMonths(from, 12), shiftMonths(to, 12), true);
  const sentence = `${current.label}${compare ? `, compared with ${compare.label}` : ""}`;
  return { spec, current, compare, sentence, problem };
}

// ---- the address ----
// `30d`, `7d.prev`, `custom:2026-10-01~2026-10-30.year`. Anything that does not parse is ignored, so a hand-edited link cannot break a card.
const CMP_CODE: Record<Compare, string> = { none: "", previous: ".prev", month: ".month", year: ".year" };
export function encodeRange(spec: RangeSpec): string {
  const head = spec.preset === "custom" && validDate(spec.from) && validDate(spec.to) ? `custom:${spec.from}~${spec.to}` : PRESETS.some((p) => p.key === spec.preset) ? spec.preset : "30d";
  return `${head}${CMP_CODE[spec.compare] ?? ""}`;
}
export function decodeRange(text: string | null | undefined): RangeSpec | null {
  if (!text) return null;
  const m = /^(7d|30d|90d|custom:(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2}))(?:\.(prev|month|year))?$/.exec(text);
  if (!m) return null;
  const compare: Compare = m[4] === "prev" ? "previous" : m[4] === "month" ? "month" : m[4] === "year" ? "year" : "none";
  if (m[1].startsWith("custom:")) return validDate(m[2]) && validDate(m[3]) ? { preset: "custom", from: m[2], to: m[3], compare } : null;
  return { preset: m[1] as RangePreset, compare };
}
export const RANGE_KEY = /^[a-z0-9-]{1,40}$/;
const param = (key: string) => `r.${key}`;

/** The range for a card in an address like `#speed?owner=Sam&r.speed-trend=30d.prev`, or null. */
export function rangeFromHash(hash: string, key: string): RangeSpec | null {
  if (!RANGE_KEY.test(key)) return null;
  const q = hash.indexOf("?");
  return q === -1 ? null : decodeRange(new URLSearchParams(hash.slice(q + 1)).get(param(key)));
}
/** The address with this card's range set (or removed when it is the default), everything else kept as it was. */
export function rangeIntoHash(hash: string, key: string, spec: RangeSpec | null): string {
  if (!RANGE_KEY.test(key)) return hash;
  const q = hash.indexOf("?");
  const head = q === -1 ? hash : hash.slice(0, q);
  const p = new URLSearchParams(q === -1 ? "" : hash.slice(q + 1));
  if (spec) p.set(param(key), encodeRange(spec)); else p.delete(param(key));
  const rest = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%7E/g, "~");
  return rest ? `${head}?${rest}` : head;
}
/** Only the card ranges of an address (`r.*` pairs), so the page can keep them when it rewrites the filter part. */
export function rangesOf(hash: string): string {
  const q = hash.indexOf("?");
  if (q === -1) return "";
  return [...new URLSearchParams(hash.slice(q + 1)).entries()].filter(([k, v]) => k.startsWith("r.") && RANGE_KEY.test(k.slice(2)) && decodeRange(v)).map(([k, v]) => `${k}=${v}`).join("&");
}

// ---- the comparison, with the minimum-sample rule ----
export const MIN_BASE = 10;
export type Change = { kind: "none" | "percent" | "difference" | "same"; text: string; percent: number | null };
/** "up 13%" only when the earlier figure is a base of at least `minBase`; below that, the plain difference ("up 3 from 4"); nothing when there is no earlier figure. */
export function changeBetween(current: number | null, previous: number | null, unit = "", minBase = MIN_BASE): Change {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return { kind: "none", text: "No earlier period to compare with", percent: null };
  const u = unit ? ` ${unit}` : "";
  if (current === previous) return { kind: "same", text: `Same as before (${current}${u})`, percent: 0 };
  const d = current - previous;
  if (previous >= minBase) { const pct = Math.round((d / previous) * 100); return { kind: "percent", text: `${d > 0 ? "Up" : "Down"} ${Math.abs(pct)}% from ${previous}${u}`, percent: pct }; }
  return { kind: "difference", text: `${d > 0 ? "Up" : "Down"} ${Math.abs(d)} from ${previous}${u} (too few for a percentage)`, percent: null };
}
/** A share (0 to 1) compared with an earlier share: the difference in points, and only when both rest on at least `minBase` items. */
export function shareChange(cur: { n: number; total: number }, prev: { n: number; total: number }, minBase = MIN_BASE): Change {
  if (prev.total === 0 || cur.total === 0) return { kind: "none", text: "No earlier period to compare with", percent: null };
  const a = Math.round((cur.n / cur.total) * 100), b = Math.round((prev.n / prev.total) * 100);
  if (prev.total < minBase || cur.total < minBase) return { kind: "difference", text: `${a}% of ${cur.total} against ${b}% of ${prev.total}: too few leads to call it a change`, percent: null };
  const d = a - b;
  return { kind: d === 0 ? "same" : "difference", text: d === 0 ? `Same as before (${b}%)` : `${d > 0 ? "Up" : "Down"} ${Math.abs(d)} points from ${b}%`, percent: d };
}

/** Does a bucket that starts at `startMs` and is `spanDays` long belong to this window? By its middle day, so a week is in the window it mostly falls in. */
export function inWindow(startMs: number, spanDays: number, w: Pick<Window, "from" | "to">): boolean {
  const mid = startMs + (spanDays * DAY) / 2;
  return mid >= toMs(w.from) && mid < toMs(w.to) + DAY;
}
export const todayOf = (ms: number) => toIso(ms);
