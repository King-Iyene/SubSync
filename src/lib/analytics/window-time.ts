import { dayEndMs, dayStartMs, isRealDay, isTime, localToMs, zoneOf } from "../design/zone.ts";

// How a server turns the date bar's `from` / `to` (days in the app zone) and the optional `fromTime` / `toTime` (HH:MM, same zone) into instants for a TIMESTAMP
// column. ONE place (docs/DATE_RULES.md section 3): readers never turn a day into milliseconds themselves. A reader that only has day totals (a daily rollup)
// uses rollupFromDay / rollupUntilDay from zone.ts on the instants this returns, and says "day precision".

export type At = { fromTime?: string | null; toTime?: string | null };
/** The optional times of a request (`fromTime=09:00&toTime=17:30`); anything that is not HH:MM is ignored. */
export const atOf = (sp: { get(k: string): string | null }): At => { const a = sp.get("fromTime"), b = sp.get("toTime"); return { fromTime: isTime(a) ? a : null, toTime: isTime(b) ? b : null }; };
const D10 = /^\d{4}-\d{2}-\d{2}/;
const dayOf = (v: unknown): string | null => (typeof v === "string" && D10.test(v) && isRealDay(v.slice(0, 10)) ? v.slice(0, 10) : null);
/** The instant a window starting on `from` begins (local midnight, or `fromTime`). null when `from` is not a real day. */
export const startBound = (from: unknown, at?: At, tz?: string): number | null => { const d = dayOf(from); return d === null ? null : at?.fromTime ? localToMs(d, at.fromTime, tz) : dayStartMs(d, tz); };
/** The open end of a window whose last day is `to`: the start of the next local day, or the end of the minute `toTime`. */
export const endBound = (to: unknown, at?: At, tz?: string): number | null => { const d = dayOf(to); if (d === null) return null; if (at?.toTime) { const e = localToMs(d, at.toTime, tz); return e === null ? null : e + 60_000; } return dayEndMs(d, tz); };
/** True when the request has hours (the window is shorter than whole days at one end or both). */
export const hasHours = (at?: At): boolean => Boolean(at?.fromTime || at?.toTime);
export { zoneOf };
