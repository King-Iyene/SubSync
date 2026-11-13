// THE time zone of the date bar (docs/DATE_RULES.md). Every "day" in the app (today, a preset, the start of a custom range, a server window) is a day in ONE zone,
// so "Today" opens at local midnight and the lunch-hour edge is right. Default Africa/Lagos (no daylight saving, so a day is always 24 hours there); set
// NEXT_PUBLIC_APP_TIMEZONE to change it. Pure: no clock of its own (callers pass `now`). Nothing else in the app may turn a day into milliseconds: use dayStartMs.

export const APP_TZ: string = (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_APP_TIMEZONE) || "Africa/Lagos";
const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); fmtCache.set(tz, f); }
  return f;
};
/** How far the zone is ahead of UTC at this instant, in ms (Lagos: +3 600 000). */
export function offsetMs(ms: number, tz: string = APP_TZ): number {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(ms / 1000) * 1000;
}
const isoOf = (utcMs: number) => new Date(utcMs).toISOString().slice(0, 10);
export const isRealDay = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && isoOf(Date.parse(`${s}T00:00:00Z`)) === s;

/** The calendar day (YYYY-MM-DD) it is in the zone at this instant. */
export const localDay = (ms: number, tz: string = APP_TZ): string => isoOf(ms + offsetMs(ms, tz));
/** The instant (UTC ms) the given zone-local day begins. null when it is not a real day. */
export function dayStartMs(day: string, tz: string = APP_TZ): number | null {
  if (!isRealDay(day)) return null;
  const guess = Date.parse(`${day}T00:00:00Z`);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz); // second pass settles a day that begins across an offset change
  return t;
}
/** The window [from, to) in UTC ms for two zone-local days, `to` included (so `to` becomes the start of the NEXT local day). */
export function windowMs(from: string, to: string, tz: string = APP_TZ): { fromMs: number; toMs: number } | null {
  const a = dayStartMs(from, tz), b = dayStartMs(addDays(to, 1), tz);
  return a === null || b === null ? null : { fromMs: a, toMs: b };
}
/** A day plus (or minus) whole days. Calendar arithmetic, so it ignores the zone. */
export const addDays = (day: string, n: number): string => isoOf(Date.parse(`${day}T00:00:00Z`) + n * DAY);
/** Whole days between two days, `to` included (same day is 1). */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
/** The Monday of the week the day is in (weeks start on Monday). */
export const mondayOfDay = (day: string): string => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
export const monthStartOf = (day: string): string => `${day.slice(0, 7)}-01`;
export const monthEndOf = (day: string): string => { const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`); return isoOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); };
export const prevMonthOf = (day: string): { from: string; to: string } => { const f = isoOf(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 2, 1)); return { from: f, to: monthEndOf(f) }; };
export const zoneWord = (tz: string = APP_TZ): string => (tz.split("/").pop() ?? tz).replace(/_/g, " ");
/** The instant the NEXT local day begins (the open end of "up to and including today"). */
export const nextMidnightMs = (now: number, tz: string = APP_TZ): number => dayStartMs(addDays(localDay(now, tz), 1), tz) as number;
/** The start of the local day for an instant. */
export const todayStartMs = (now: number, tz: string = APP_TZ): number => dayStartMs(localDay(now, tz), tz) as number;
/** Start of the day AFTER the given local day (the open end of a window whose last day is `day`). */
export const dayEndMs = (day: string, tz: string = APP_TZ): number | null => dayStartMs(addDays(day, 1), tz);
/** The UTC midnight that ends the UTC-day window of today's LOCAL date: the open end of "up to and including today" for readers that still count whole UTC days (see docs/DATE_RULES.md, known gaps). */
export const utcDayAfterToday = (now: number, tz: string = APP_TZ): number => Date.parse(`${localDay(now, tz)}T00:00:00Z`) + DAY;

// ---- time of day (optional part of the bar's range) and the day keys of the daily rollups ----
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "09:30": a time of day in the zone, 24 hours. */
export const isTime = (s: unknown): s is string => typeof s === "string" && TIME_RE.test(s);
const pad2 = (n: number) => String(n).padStart(2, "0");
/** "HH:MM" on the zone's clock at this instant. */
export function localHM(ms: number, tz: string = APP_TZ): string { const d = new Date(ms + offsetMs(ms, tz)); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; }
/** The instant the zone's clock reads `day` `time` (HH:MM). null when either is not real. */
export function localToMs(day: string, time: string, tz: string = APP_TZ): number | null {
  if (!isRealDay(day) || !isTime(time)) return null;
  const guess = Date.parse(`${day}T${time}:00Z`);
  let t = guess - offsetMs(guess, tz);
  t = guess - offsetMs(t, tz);
  return t;
}
/**
 * The window [fromMs, toMs) for two local days with an optional time of day on each end. No times: whole days (same as windowMs). `toTime` is inclusive to the
 * minute (17:30 includes 17:30:59). The ONE place a server turns the bar's dates (and times) into instants for a timestamp column.
 */
export function windowAtMs(from: string, to: string, fromTime?: string | null, toTime?: string | null, tz: string = APP_TZ): { fromMs: number; toMs: number } | null {
  const a = fromTime ? localToMs(from, fromTime, tz) : dayStartMs(from, tz);
  const e = toTime ? localToMs(to, toTime, tz) : null;
  const b = toTime ? (e === null ? null : e + 60_000) : dayStartMs(addDays(to, 1), tz);
  return a === null || b === null || b <= a ? null : { fromMs: a, toMs: b };
}
/** The local day a daily rollup row for this instant is keyed by (rows are keyed by the ACCOUNT's local day, default the app zone). */
export const rollupDay = (ms: number, tz: string = APP_TZ): string => localDay(ms, tz);
/** Rollups have day precision: the first day a window [fromMs, toMs) touches... */
export const rollupFromDay = (ms: number, tz: string = APP_TZ): string => localDay(ms, tz);
/** ...and the day AFTER the last day it touches (use with `day < ...`). A window ending exactly at local midnight does not touch the next day. */
export const rollupUntilDay = (ms: number, tz: string = APP_TZ): string => addDays(localDay(ms - 1, tz), 1);
/** True when the zone name is a real IANA zone this runtime knows. */
export function isZone(tz: unknown): tz is string { if (typeof tz !== "string" || !tz) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }
/** The zone of an account: its own when it is a real one, else the app zone. */
export const zoneOf = (tz: unknown): string => (isZone(tz) ? tz : APP_TZ);
