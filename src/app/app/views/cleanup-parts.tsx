"use client";

import { Sparkline } from "../ds";
import type { Trend } from "@/lib/analytics/quality";

// The pieces shared by every tab of the Clean-up module (stage CLEANUP): one score meter, used for a match score on a duplicate group AND for the data-quality score of a
// client, one way of writing a trend, and the common button styles. Plain words and a thin bar, no pills and no tinted boxes (KF-1).

export const BTN = "ds-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-card px-4 text-sm font-medium hover:border-primary/40 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 sm:min-h-10";
export const PRIMARY = "ds-press inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 sm:min-h-11 sm:text-sm";
export const QUIET = "ds-press inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)] disabled:opacity-50 sm:min-h-10";
export const FIELD = "min-h-11 rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30 sm:min-h-10";

/** The word for a 0 to 100 score. The colour is only a status colour for the bar; the number and the word carry the meaning. */
function toneOf(score: number): string {
  return score >= 75 ? "bg-success" : score >= 55 ? "bg-warning" : "bg-destructive";
}

/**
 * One score, one way. `big` is the headline number of a page; the small one sits in a row or beside a group. The bar is a thin rule under the number, never a pill.
 * Used for "how sure SubSync is that two contacts are the same person" and for "how healthy a client's contact list is".
 */
export function ScoreMeter({ score, word, label, big = false, testId }: { score: number | null; word?: string | null; label: string; big?: boolean; testId?: string }) {
  if (score === null) return <p className="text-sm text-muted-foreground" data-testid={testId}>{label}: not enough contacts to score yet.</p>;
  return (
    <div data-testid={testId} className="min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className={`${big ? "text-5xl" : "text-2xl"} font-semibold tabular-nums tracking-tight`} data-testid={testId ? `${testId}-n` : undefined}>{score}</span>
        <span className="text-sm text-muted-foreground">out of 100{word ? ` · ${word}` : ""}</span>
      </p>
      <div className={`mt-1.5 h-1 overflow-hidden rounded-full bg-muted ${big ? "max-w-xs" : "max-w-[10rem]"}`} role="img" aria-label={`${label}: ${score} out of 100${word ? `, ${word}` : ""}`}>
        <div className={`h-full ${toneOf(score)}`} style={{ width: `${Math.max(2, Math.min(100, score))}%` }} />
      </div>
    </div>
  );
}

/** A score trend from stored snapshots, or the plain reason there is none yet. */
export function TrendLine({ trend, label }: { trend: Trend; label: string }) {
  if (trend.state === "not_enough") return <p className="text-xs text-muted-foreground" data-testid="trend-empty">{trend.reason}</p>;
  const sign = trend.change > 0 ? "up" : trend.change < 0 ? "down" : "the same";
  return (
    <div data-testid="trend">
      <p className="mb-1 text-sm" data-testid="trend-change">
        {trend.change === 0 ? "No change" : `${sign === "up" ? "Up" : "Down"} ${Math.abs(trend.change)} point${Math.abs(trend.change) === 1 ? "" : "s"}`}
        <span className="text-muted-foreground"> since {new Date(trend.from.day).toLocaleDateString("en-US", { day: "numeric", month: "short" })}</span>
      </p>
      <Sparkline values={trend.points.map((p) => p.score)} label={label} min={2} unit="out of 100" />
    </div>
  );
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
