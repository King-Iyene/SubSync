"use client";

import type { ReactNode } from "react";
import { deltaTone, deltaWords, scaleWords, TONE_GLYPH, toneOf, wordOf, type Scale, type Tone } from "@/lib/design/status-tone";

// Status colour for every rate, bar and change in Appointments. Muted Ledger colours (green good, ochre watch, red bad, grey no data), always with a glyph and a word, never colour alone.
export const TONE_TEXT: Record<Tone, string> = { good: "text-success", caution: "text-warning", bad: "text-destructive", neutral: "text-muted-foreground" };
export const TONE_BG: Record<Tone, string> = { good: "bg-success", caution: "bg-warning", bad: "bg-destructive", neutral: "bg-muted-foreground/40" };
export const TONE_SOFT: Record<Tone, string> = { good: "bg-success/10 border-success/30", caution: "bg-warning/10 border-warning/30", bad: "bg-destructive/10 border-destructive/30", neutral: "bg-muted/40 border-border" };

/** The same colours as CSS values, for a bar drawn with an inline style. */
export const toneVar = (t: Tone): string => (t === "good" ? "var(--success)" : t === "caution" ? "var(--warning)" : t === "bad" ? "var(--destructive)" : "var(--muted-foreground)");

/** A rate with its colour, a glyph and (for screen readers and the title) its word. Null is "n/a" in grey. `n` is the sample size when known. */
export function RateTag({ v, scale, n, strong = false, testId }: { v: number | null; scale: Scale; n?: number; strong?: boolean; testId?: string }) {
  const t = toneOf(v, scale);
  if (v === null) return <span className="text-muted-foreground" title="Not enough marked appointments yet" data-tone="neutral" data-testid={testId}>n/a</span>;
  const word = wordOf(t, scale);
  return (
    <span className={`inline-flex items-baseline gap-1 tabular-nums ${TONE_TEXT[t]} ${strong ? "font-semibold" : ""}`} data-tone={t} data-testid={testId} title={`${scale.name} ${Math.round(v * 100)}%: ${word.toLowerCase()}${n !== undefined ? ` (${n} appointments)` : ""}`}>
      <span aria-hidden className="text-[0.65em]">{TONE_GLYPH[t]}</span>{Math.round(v * 100)}%<span className="sr-only"> {word}</span>
    </span>
  );
}

/** A thin bar sized by `share` (0..1) in the colour of `tone`. */
export function ToneBar({ share, tone, label }: { share: number; tone: Tone; label?: string }) {
  return <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}><span className={`block h-full rounded-full ${TONE_BG[tone]}`} style={{ width: `${Math.min(100, Math.max(share > 0 ? 2 : 0, share * 100))}%` }} /></span>;
}

/** A change since the earlier period: arrow, points and a word, coloured by whether up is good for this rate. */
export function DeltaTag({ delta, higherIsBetter = true }: { delta: number | null; higherIsBetter?: boolean }) {
  const t = deltaTone(delta, higherIsBetter);
  return <span className={`text-xs tabular-nums ${TONE_TEXT[t]}`} data-tone={t}>{delta === null ? "" : delta > 0.004 ? "↑ " : delta < -0.004 ? "↓ " : "→ "}{deltaWords(delta)}{t === "good" ? " (better)" : t === "bad" ? " (worse)" : ""}</span>;
}

/** The small legend under a coloured screen: three swatches with their words and ranges, and a "how we colour this" popover that quotes the thresholds. */
export function StatusLegend({ scale, note }: { scale: Scale; note?: ReactNode }) {
  const rows = scaleWords(scale);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="status-legend" aria-label={`Colour key for ${scale.name}`}>
      {rows.map((r) => <span key={r.tone} className="inline-flex items-center gap-1.5"><span aria-hidden className={`size-2.5 rounded-sm ${TONE_BG[r.tone]}`} /><span className={TONE_TEXT[r.tone]} aria-hidden>{TONE_GLYPH[r.tone]}</span>{wordOf(r.tone, scale)}: {r.text}</span>)}
      <span className="inline-flex items-center gap-1.5"><span aria-hidden className={`size-2.5 rounded-sm ${TONE_BG.neutral}`} />Grey: not enough data</span>
      <details className="relative">
        <summary className="cursor-pointer select-none text-primary underline" data-testid="status-legend-info">How we colour this</summary>
        <p className="absolute left-0 z-10 mt-1 w-72 max-w-[80vw] rounded-lg border bg-card p-3 text-xs leading-5 text-foreground shadow-md">These ranges are rules of thumb for appointment businesses, not your target. {scale.name} {scale.higherIsBetter ? "is better when it is higher" : "is better when it is lower"}. A rate built on fewer than 5 marked appointments is grey and shows n/a. Colour is always paired with a word and a symbol.{note ? <> {note}</> : null}</p>
      </details>
    </div>
  );
}
