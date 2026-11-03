// Reads a list of times (when each refresh cycle was queued, in milliseconds) and says how regular they are. Pure. Used by the diagnostics
// address and by `scripts/sync-timeline.ts`, so the number King reads in the morning is worked out the same way the alarm works it out.

export type Gap = { minutes: number; fromAt: number; toAt: number };

export type CycleSummary = {
  cycles: number;
  firstAt: number | null;
  lastAt: number | null;
  /** Minutes between neighbouring cycles. */
  medianGapMinutes: number | null;
  longestGap: Gap | null;
  /** Gaps longer than `slowMinutes`, oldest first. */
  slowGaps: Gap[];
  /** Minutes since the last cycle was queued, at `now`. */
  sinceLastMinutes: number | null;
};

export function summariseCycles(times: number[], now: number, slowMinutes = 30): CycleSummary {
  const t = [...times].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const gaps: Gap[] = [];
  for (let i = 1; i < t.length; i++) gaps.push({ minutes: Math.round((t[i] - t[i - 1]) / 60_000), fromAt: t[i - 1], toAt: t[i] });
  const sorted = gaps.map((g) => g.minutes).sort((a, b) => a - b);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  return {
    cycles: t.length,
    firstAt: t[0] ?? null,
    lastAt: t[t.length - 1] ?? null,
    medianGapMinutes: median,
    longestGap: gaps.length === 0 ? null : gaps.reduce((a, b) => (b.minutes > a.minutes ? b : a)),
    slowGaps: gaps.filter((g) => g.minutes > slowMinutes),
    sinceLastMinutes: t.length === 0 ? null : Math.max(0, Math.round((now - t[t.length - 1]) / 60_000)),
  };
}
