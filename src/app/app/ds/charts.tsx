"use client";

import { useState } from "react";
import { belowMinimum, niceScale } from "@/lib/design/ui-logic";

// One approach for every chart (N10): plain HTML and CSS, no chart library. Text is real text, so it stays readable on a phone and scales with the
// person's font size; bars are buttons, so they can be reached with the keyboard and a tap; and every chart has a hidden table for screen readers.
// Rules the code enforces: a labelled scale starting at zero, a tooltip on every mark, one series colour per chart (the first chart colour; status
// colours only when the bar IS a status), and below its minimum sample a chart is replaced by one placeholder that says what will appear and when.
// There is no gauge: nothing in SubSync is a single value out of a fixed range that a bar or a number does not say better.

export type ChartTone = "series" | "good" | "warn" | "bad";
const FILL: Record<ChartTone, string> = { series: "bg-[var(--chart-1)]", good: "bg-success", warn: "bg-warning", bad: "bg-destructive" };

export function ChartPlaceholder({ title, need, have, unit = "", children }: { title?: string; need: number; have: number; unit?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-5" role="img" aria-label={`${title ?? "Chart"}: not enough data yet`} data-testid="chart-placeholder">
      <div aria-hidden className="mb-4 flex h-16 items-end gap-2 opacity-40">
        {[40, 65, 50, 80, 60, 90, 70].map((h, i) => <div key={i} className="ds-skeleton flex-1 rounded-b-none" style={{ height: `${h}%` }} />)}
      </div>
      <p className="text-sm font-medium">{title ? `${title} appears` : "This chart appears"} once there {need === 1 ? "is" : "are"} at least {need} {unit || "data points"}.</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{have === 0 ? "None so far." : `${have} so far.`}{children}</p>
    </div>
  );
}

// `count` is how many things are behind the bar (leads, appointments, deals). When the chart is clickable (onSelect), a bar with something behind it opens
// the list of exactly those things (KF-6); the count shown in the tooltip and the rows of the list come from the same data, never a second calculation.
export type Bar = { label: string; value: number | null; detail?: string; tone?: ChartTone; count?: number };
const clickable = (onSelect: unknown, b: { value: number | null; count?: number }) => Boolean(onSelect) && (b.count ?? b.value ?? 0) > 0;
const opens = (noun: string, b: { count?: number }) => (b.count !== undefined ? `, ${b.count} ${noun}, open the list` : ", open the list");

export function BarChart({
  title, bars, sample, min = 0, need, unit = "", axisLabel, format = (n: number) => String(n), height = 160, onSelect, selected = null, noun = "items",
}: {
  title: string; bars: Bar[];
  /** How many real observations the chart rests on. Below `min` the chart is replaced by a placeholder. */
  sample?: number; min?: number; need?: string;
  unit?: string; axisLabel?: string; format?: (n: number) => string; height?: number;
  /** Makes the chart clickable: called with the bar's position when a bar that has something behind it is pressed (click, tap, Enter or Space). */
  onSelect?: (index: number) => void;
  /** The bar whose list is open, kept marked while the list is closed and reopened. */
  selected?: number | null;
  /** What the bars count, for the spoken label ("leads", "appointments"). */
  noun?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const n = sample ?? bars.reduce((s, b) => s + (b.value ?? 0), 0);
  if (belowMinimum(n, min)) return <ChartPlaceholder title={title} need={min} have={Math.max(0, Math.round(n))} unit={need ?? unit} />;
  const max = Math.max(0, ...bars.map((b) => b.value ?? 0));
  const scale = niceScale(max);
  const direct = bars.length <= 8;
  return (
    <figure className="min-w-0" data-testid="bar-chart">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">{title}</span>{axisLabel && <span>{axisLabel}</span>}</figcaption>
      <div className="mt-4 flex gap-2">
        <div className="relative w-10 shrink-0 text-right text-[11px] text-muted-foreground" style={{ height }} aria-hidden>
          {scale.ticks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ bottom: `${(t / scale.top) * 100}%` }}>{format(t)}</span>)}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {scale.ticks.map((t) => <div key={t} aria-hidden className={`absolute inset-x-0 border-t ${t === 0 ? "border-foreground/30" : "border-border"}`} style={{ bottom: `${(t / scale.top) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2">
            {bars.map((b, i) => {
              const h = b.value === null ? 0 : (b.value / scale.top) * 100;
              return (
                <div key={b.label + i} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
                  {active === i && (
                    <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-max max-w-[9rem] -translate-x-1/2 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-[var(--shadow-lift)]">
                      <p className="font-medium">{b.label}</p>
                      <p>{b.value === null ? "Too few to show" : `${format(b.value)}${unit ? ` ${unit}` : ""}`}</p>
                      {b.detail && <p className="text-muted-foreground">{b.detail}</p>}
                      {clickable(onSelect, b) && <p className="mt-0.5 font-medium text-primary">Click to see the list</p>}
                    </div>
                  )}
                  <button type="button" aria-label={`${b.label}: ${b.value === null ? "too few to show" : `${format(b.value)}${unit ? ` ${unit}` : ""}`}${b.detail ? `. ${b.detail}` : ""}${clickable(onSelect, b) ? opens(noun, b) : ""}`}
                    aria-pressed={onSelect ? selected === i : undefined}
                    onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                    onClick={() => (clickable(onSelect, b) ? onSelect?.(i) : setActive(active === i ? null : i))}
                    className={`relative flex w-full flex-1 flex-col justify-end rounded-sm outline-offset-2 ${clickable(onSelect, b) ? "cursor-pointer" : ""} ${selected === i ? "outline outline-2 outline-foreground" : ""}`}>
                    {direct && b.value !== null && <span className="mb-0.5 text-center text-[11px] font-medium tabular-nums">{format(b.value)}</span>}
                    {b.value === null
                      ? <span aria-hidden className="h-6 w-full rounded-t-[4px] border border-dashed" />
                      : <span aria-hidden className={`ds-grow w-full rounded-t-[4px] ${FILL[b.tone ?? "series"]} ${active === i ? "opacity-100" : "opacity-90"}`} style={{ height: `${h}%`, minHeight: b.value > 0 ? 2 : 0 }} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="ml-12 mt-1 flex gap-1.5 sm:gap-2" aria-hidden>
        {bars.map((b, i) => <span key={b.label + i} className="min-w-0 flex-1 truncate text-center text-[11px] text-muted-foreground">{b.label}</span>)}
      </div>
      <div className="sr-only"><table><caption>{title}</caption><thead><tr><th>Group</th><th>Value</th></tr></thead><tbody>{bars.map((b, i) => <tr key={b.label + i}><td>{b.label}</td><td>{b.value === null ? "too few to show" : format(b.value)}</td></tr>)}</tbody></table></div>
    </figure>
  );
}

// A distribution as ranked rows: a label, a bar on a labelled scale, the number. Better than a bar chart when the labels are long (wait buckets,
// sources, people).
export function Distribution({ title, rows, unit = "", sample, min = 0, need, format = (n: number) => String(n), onSelect, selected = null, noun = "items" }: { title: string; rows: Array<{ label: string; value: number; detail?: string; tone?: ChartTone; count?: number }>; unit?: string; sample?: number; min?: number; need?: string; format?: (n: number) => string; onSelect?: (index: number) => void; selected?: number | null; noun?: string }) {
  const n = sample ?? rows.reduce((s, r) => s + r.value, 0);
  if (belowMinimum(n, min)) return <ChartPlaceholder title={title} need={min} have={Math.max(0, Math.round(n))} unit={need ?? unit} />;
  const scale = niceScale(Math.max(0, ...rows.map((r) => r.value)), 3);
  return (
    <figure className="min-w-0" data-testid="distribution">
      <figcaption className="mb-2 text-xs font-medium">{title}</figcaption>
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.label} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-2 text-sm" title={clickable(onSelect, { value: r.value, count: r.count }) ? `${r.detail ?? r.label}. Click to see the list` : r.detail}>
            {clickable(onSelect, { value: r.value, count: r.count }) ? (
              <button type="button" onClick={() => onSelect?.(i)} aria-pressed={selected === i} aria-label={`${r.label}: ${format(r.value)}${unit ? ` ${unit}` : ""}${opens(noun, r)}`} className={`min-h-9 truncate text-left text-muted-foreground underline-offset-4 hover:text-foreground hover:underline ${selected === i ? "font-medium text-foreground underline" : ""}`}>{r.label}</button>
            ) : <span className="truncate text-muted-foreground">{r.label}</span>}
            <span className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden><span className={`ds-grow-x block h-full rounded-full ${FILL[r.tone ?? "series"]}`} style={{ width: `${(r.value / scale.top) * 100}%` }} /></span>
            <span className="min-w-8 text-right tabular-nums">{format(r.value)}{unit ? ` ${unit}` : ""}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 grid grid-cols-[minmax(5rem,9rem)_1fr_auto] gap-2 text-[11px] text-muted-foreground" aria-hidden>
        <span /><span className="flex justify-between">{scale.ticks.map((t) => <span key={t} className="tabular-nums">{format(t)}</span>)}</span><span className="min-w-8" />
      </div>
    </figure>
  );
}

// A trend small enough for a table cell or a tile: the line, and in words where it started, where it is now and its range, so it is never just a
// squiggle. Needs at least `min` points.
export function Sparkline({ values, label, min = 3, format = (n: number) => String(Math.round(n)), unit = "" }: { values: number[]; label: string; min?: number; format?: (n: number) => string; unit?: string }) {
  if (belowMinimum(values.length, min)) return <p className="text-xs text-muted-foreground" data-testid="sparkline-empty">Needs at least {min} days of history ({values.length} so far).</p>;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const y = (v: number) => 6 + (1 - (v - lo) / span) * 88;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${y(v)}`).join(" ");
  const first = values[0], last = values[values.length - 1];
  return (
    <figure className="min-w-0" data-testid="sparkline">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-12 w-full overflow-hidden border-b border-border" role="img" aria-label={`${label}: from ${format(first)} to ${format(last)}${unit ? ` ${unit}` : ""}, lowest ${format(lo)}, highest ${format(hi)}`}>
        <polyline points={pts} fill="none" stroke="var(--chart-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground tabular-nums"><span>Start {format(first)}</span><span>Now <strong className="text-foreground">{format(last)}</strong></span><span>Range {format(lo)} to {format(hi)}</span></figcaption>
    </figure>
  );
}
