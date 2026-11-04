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
        <span className="sr-only">{label}: </span>
        <span className={`${big ? "text-5xl" : "text-2xl"} font-semibold tabular-nums tracking-tight`} data-testid={testId ? `${testId}-n` : undefined}>{score}</span>
        <span className="text-sm text-muted-foreground">out of 100{word ? ` · ${word}` : ""}</span>
      </p>
      <div className={`mt-1.5 h-1 overflow-hidden rounded-full bg-muted ${big ? "max-w-xs" : "max-w-[10rem]"}`} aria-hidden="true">
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

// ---------- the friendly pieces (the redesign: one plain question per screen) ----------

const toneText = (score: number) => (score >= 75 ? "text-success" : score >= 55 ? "text-warning" : "text-destructive");

/** A round score: the number in the middle, one word under it. Read by a screen reader as one sentence. */
export function ScoreRing({ score, word, label, size = 150, testId }: { score: number | null; word?: string | null; label: string; size?: number; testId?: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <div className="inline-flex flex-col items-center" data-testid={testId}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
          <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted" />
          {score !== null && <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 60 60)" className={toneText(pct)} />}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="sr-only">{label}: </span>
          <span className="text-4xl font-semibold tabular-nums leading-none" data-testid={testId ? `${testId}-n` : undefined}>{score === null ? "-" : score}</span>
          <span className="mt-1 text-xs text-muted-foreground">{score === null ? "not enough contacts" : word}</span>
        </div>
      </div>
    </div>
  );
}

/** How sure SubSync is, as a bar and one plain sentence. The number lives behind "How we decided". */
export function MatchMeter({ confidence, word, reason }: { confidence: number; word: string; reason: string }) {
  return (
    <div className="max-w-md" data-testid="dup-meter">
      <p className="text-base font-semibold">{word}</p>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className={`h-full ${confidence >= 90 ? "bg-success" : confidence >= 75 ? "bg-primary" : "bg-warning"}`} style={{ width: `${Math.max(8, Math.min(100, confidence))}%` }} /></div>
      <p className="mt-1.5 text-sm text-muted-foreground" data-testid="dup-reason-line">{reason}</p>
    </div>
  );
}

export function Avatar({ name, tone = 0 }: { name: string; tone?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  const hues = ["bg-primary/15 text-primary", "bg-success/15 text-success", "bg-warning/15 text-warning"];
  return <span aria-hidden="true" className={`inline-flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${hues[tone % hues.length]}`}>{initials}</span>;
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total <= 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div data-testid="dup-progress">
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
