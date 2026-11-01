import { inWindow, shareChange, type Change, type Window } from "./range.ts";

// Turns the weekly speed-to-lead trend into what the clickable chart needs (KF-4 and KF-6): the weeks inside a card's window, one bar per week with the
// count of leads behind it, and the comparison with another window. Pure, so the count on a bar and the rows of the list behind it are tested together.
export type TrendMember = { locationId: string; locationName: string; contactId: string; name: string; status: "within" | "late" | "waiting"; minutes: number; url: string };
export type TrendWeekData = { weekStart: number; leads: number; withinTarget: number; hitRate: number | null; members: TrendMember[] };
export type WeekBar = { label: string; value: number | null; count: number; detail: string; tone: "good" | "warn" | "bad" | "series" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const weekLabel = (ms: number) => { const d = new Date(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

export function weeksIn(trend: readonly TrendWeekData[], w: Pick<Window, "from" | "to">): TrendWeekData[] {
  return trend.filter((t) => inWindow(t.weekStart, 7, w));
}

export function weekBars(weeks: readonly TrendWeekData[]): WeekBar[] {
  return weeks.map((w) => ({
    label: weekLabel(w.weekStart), value: w.hitRate === null ? null : Math.round(w.hitRate * 100), count: w.leads,
    detail: `${w.leads} lead${w.leads === 1 ? "" : "s"} that week`,
    tone: w.hitRate === null ? "series" : w.hitRate >= 0.8 ? "good" : w.hitRate >= 0.5 ? "warn" : "bad",
  }));
}

export const totalsOf = (weeks: readonly TrendWeekData[]) => ({ n: weeks.reduce((s, w) => s + w.withinTarget, 0), total: weeks.reduce((s, w) => s + w.leads, 0) });

/** The comparison sentence for the card: this window's share answered in time against the other window's, in points, and only on enough leads. */
export function compareWeeks(trend: readonly TrendWeekData[], current: Pick<Window, "from" | "to">, other: Pick<Window, "from" | "to"> | null): { change: Change | null; covered: boolean } {
  if (!other) return { change: null, covered: true };
  const prev = weeksIn(trend, other);
  // The history only goes back 8 weeks, so an earlier window may be missing or only partly there. Say so instead of comparing with a partial period.
  const first = trend[0]?.weekStart ?? Infinity;
  const covered = prev.length > 0 && Date.parse(`${other.from}T00:00:00Z`) >= first - 3.5 * 86_400_000;
  return { change: covered ? shareChange(totalsOf(weeksIn(trend, current)), totalsOf(prev)) : null, covered };
}
