import { MAX_RANGE_DAYS } from "../design/range-limits.ts";
import { addDays, localDay } from "../design/zone.ts"; // days are days in the account time zone; the SQL below compares them with UTC-dated rollups (listed in docs/DATE_RULES.md)

const DAYMS = 86_400_000;
export const realDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
/** The dates the date bar asked (checked here, never trusted), or the last `fallbackDays` days. `to` is the last day, included; `next` is the day after it. */
export function windowOf(f: { wfrom?: string | null; wto?: string | null }, fallbackDays: number, now = Date.now()): { from: string; to: string; next: string; days: number; asked: boolean } {
  const today = localDay(now);
  if (realDay(f.wfrom) && realDay(f.wto) && f.wfrom <= f.wto && f.wto <= today) {
    const days = Math.round((Date.parse(`${f.wto}T00:00:00Z`) - Date.parse(`${f.wfrom}T00:00:00Z`)) / DAYMS) + 1;
    if (days <= MAX_RANGE_DAYS) return { from: f.wfrom, to: f.wto, next: addDays(f.wto, 1), days, asked: true };
  }
  return { from: addDays(today, -(fallbackDays - 1)), to: today, next: addDays(today, 1), days: fallbackDays, asked: false };
}
