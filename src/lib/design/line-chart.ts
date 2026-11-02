import { niceScale } from "./ui-logic.ts";

// The geometry of a line chart over days (stage C1): where each point sits, the labelled scale on both axes, and which day a pointer or an arrow key is on.
// Pure, so it is tested without a browser; the component (src/app/app/ds/line-chart.tsx) only draws what this says.

export type LinePoint = { day: string; value: number | null };
export type LineSeries = { label: string; points: ReadonlyArray<LinePoint>; /** 1 to 5 picks a chart colour; "muted" is the grey dashed line used for an average. */ tone?: 1 | 2 | 3 | 4 | 5 | "muted"; dashed?: boolean };

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const dayLabel = (iso: string, withYear = false) => { const d = new Date(ms(iso)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ""}`; };

export type Layout = {
  days: string[];
  /** Number of real values (not gaps) over all series. */
  n: number;
  top: number; yTicks: number[];
  xTicks: Array<{ day: string; at: number; label: string }>;
  /** Position 0 to 1 along the x axis. */
  xOf: (day: string) => number;
  /** Position 0 to 1 up the y axis. */
  yOf: (value: number) => number;
  withYear: boolean;
};

/** Lay the series out on one shared pair of axes. The y axis starts at `floor` (default 0) and ends on a round number above the largest value, or at `ceiling` when one is given. */
export function layoutLines(series: ReadonlyArray<LineSeries>, opts: { floor?: number; ceiling?: number; xTickCount?: number } = {}): Layout {
  const days = [...new Set(series.flatMap((s) => s.points.filter((p) => p.value !== null && Number.isFinite(p.value)).map((p) => p.day)))].sort();
  const floor = opts.floor ?? 0;
  const values = series.flatMap((s) => s.points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v)));
  const max = values.length ? Math.max(...values) : 0;
  const scale = niceScale(Math.max(max - floor, 0), 4);
  const top = opts.ceiling ?? floor + scale.top;
  const ticks = opts.ceiling !== undefined ? [0, 1, 2, 3, 4].map((i) => floor + ((opts.ceiling as number) - floor) * (i / 4)) : scale.ticks.map((t) => floor + t);
  const first = days.length ? ms(days[0]) : 0;
  const last = days.length ? ms(days[days.length - 1]) : 0;
  const span = Math.max(last - first, DAY);
  const withYear = days.length > 0 && (last - first > 300 * DAY || days[0].slice(0, 4) !== days[days.length - 1].slice(0, 4));
  const count = Math.max(2, opts.xTickCount ?? 4);
  const xTicks = days.length === 0 ? [] : Array.from({ length: count }, (_, i) => {
    const t = first + (span * i) / (count - 1);
    const day = new Date(Math.round(t / DAY) * DAY).toISOString().slice(0, 10);
    return { day, at: (ms(day) - first) / span, label: dayLabel(day, withYear) };
  });
  return {
    days, n: values.length, top, yTicks: ticks, xTicks, withYear,
    xOf: (day) => (ms(day) - first) / span,
    yOf: (v) => (top === floor ? 0 : (v - floor) / (top - floor)),
  };
}

/** The day, among those that have a value, nearest to a pointer at `fraction` (0 to 1) along the axis. */
export function nearestDay(l: Pick<Layout, "days" | "xOf">, fraction: number): string | null {
  if (l.days.length === 0 || !Number.isFinite(fraction)) return null;
  let best = l.days[0];
  let bestD = Infinity;
  for (const d of l.days) { const dist = Math.abs(l.xOf(d) - fraction); if (dist < bestD) { best = d; bestD = dist; } }
  return best;
}
/** One step along the days that have a value (arrow keys), staying inside the first and last. */
export function stepDay(days: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (days.length === 0) return null;
  if (current === null) return delta === 1 ? days[0] : days[days.length - 1];
  const i = Math.max(0, days.indexOf(current));
  return days[Math.min(days.length - 1, Math.max(0, i + delta))];
}
/** Each series' value on a day, or null when it has none that day. */
export const valuesOn = (series: ReadonlyArray<LineSeries>, day: string): Array<number | null> => series.map((s) => s.points.find((p) => p.day === day)?.value ?? null);

/** The segments of a series to draw: a gap (a null value) breaks the line instead of being joined across, so a missing day is never drawn as a value. */
export function segments(points: ReadonlyArray<LinePoint>): LinePoint[][] {
  const out: LinePoint[][] = [];
  let cur: LinePoint[] = [];
  for (const p of [...points].sort((a, b) => a.day.localeCompare(b.day))) {
    if (p.value === null || !Number.isFinite(p.value)) { if (cur.length) out.push(cur); cur = []; } else cur.push(p);
  }
  if (cur.length) out.push(cur);
  return out;
}
