// Lead intake health (pure rules, no database, no network). Definitions are written once here and in docs/METRICS.md ("Lead intake health").
//
// Low application alert: a form or survey got far fewer submissions in the last 7 days than its OWN usual week. "Usual" is the median of the 4 weeks before. Names and times only, never answers.
// Links: a trigger link or redirect whose target is empty.

export const HEALTH_VERSION = "health-1";
export const DEFAULT_DROP_PCT = 50; // alert when the last 7 days are at least this much lower than the usual week
export const MIN_DROP_PCT = 10;
export const MAX_DROP_PCT = 90;
export const DEFAULT_MIN_BASELINE = 5; // the usual week must be at least this many submissions, or a "drop" is just noise
export const MIN_BASELINE_FLOOR = 1;
export const MIN_BASELINE_CEIL = 100;
export const WEEK_MS = 7 * 86_400_000;
export const BASELINE_WEEKS = 4;
export const NOT_ENOUGH = "Not enough data yet";
export const NO_VIEWS = "Page views are not available from the platform";

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const clampDrop = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(MIN_DROP_PCT, Math.min(MAX_DROP_PCT, n)) : DEFAULT_DROP_PCT; };
export const clampBaseline = (v: unknown): number => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(MIN_BASELINE_FLOOR, Math.min(MIN_BASELINE_CEIL, n)) : DEFAULT_MIN_BASELINE; };

/**
 * The counts of rolling 7-day windows ending now: `recent` is [now-7d, now), previous[i] is [now-7(i+2)d, now-7(i+1)d) for i = 0..3. The database counts them with the same bounds
 * (dq-health-queries.ts), so the number on the screen and the number the rule used are one set.
 */
export type WeekCounts = { recent: number; previous: number[] };
/** Builds the counts from the five bucket numbers [last 7 days, week before, ...]. Anything missing counts as zero. */
export const fromBuckets = (b: ReadonlyArray<number | null | undefined>): WeekCounts => ({ recent: Number(b[0] ?? 0), previous: [1, 2, 3, 4].map((i) => Number(b[i] ?? 0)) });

export type Verdict = "ok" | "drop" | "not_enough_data" | "zero_baseline";
export type Health = {
  verdict: Verdict; recent: number; usual: number | null; dropPct: number | null;
  /** One plain line for the screen. */
  line: string;
};

/**
 * One form or survey. `firstAt` is the time of its first stored submission (null when none): the form needs 35 days of its own history (the last week plus 4 before it) or the answer is
 * "Not enough data yet". A usual week under `minBaseline` is a zero or tiny baseline: no alert, because 3 against 4 is not a drop worth waking anyone for.
 */
export function judgeWeek(w: WeekCounts, firstAt: number | null, now: number, opts: { dropPct?: number; minBaseline?: number } = {}): Health {
  const drop = clampDrop(opts.dropPct ?? DEFAULT_DROP_PCT), minBase = clampBaseline(opts.minBaseline ?? DEFAULT_MIN_BASELINE);
  if (firstAt === null || now - firstAt < (BASELINE_WEEKS + 1) * WEEK_MS) return { verdict: "not_enough_data", recent: w.recent, usual: null, dropPct: null, line: NOT_ENOUGH };
  const usual = median(w.previous);
  if (usual <= 0) return { verdict: "zero_baseline", recent: w.recent, usual: 0, dropPct: null, line: `No submissions in a usual week, so there is nothing to compare with.` };
  if (usual < minBase) return { verdict: "zero_baseline", recent: w.recent, usual, dropPct: null, line: `A usual week is only ${fmt(usual)} (under ${minBase}), too small to call a drop.` };
  const pct = Math.round(((usual - w.recent) / usual) * 100);
  if (pct > drop) return { verdict: "drop", recent: w.recent, usual, dropPct: pct, line: `${w.recent} in the last 7 days, usually ${fmt(usual)} a week: down ${pct}%.` };
  return { verdict: "ok", recent: w.recent, usual, dropPct: Math.max(0, pct), line: `${w.recent} in the last 7 days, usually ${fmt(usual)} a week.` };
}
const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const titleOf = (name: string, kind: "form" | "survey", h: Health): string => `${name} (${kind}) got ${h.recent} ${h.recent === 1 ? "application" : "applications"} in 7 days, usually ${fmt(h.usual ?? 0)}: down ${h.dropPct}%`;

// ---- links
/** A target that is empty, or only spaces, cannot send anybody anywhere. */
/** null means the platform did not say (never flagged); an empty or all-space text means it said "nothing". */
export const emptyTarget = (t: string | null | undefined): boolean => typeof t === "string" && t.trim() === "";