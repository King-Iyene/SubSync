"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { belowMinimum } from "@/lib/design/ui-logic";
import { dayLabel, layoutLines, nearestDay, segments, stepDay, valuesOn, type LineSeries } from "@/lib/design/line-chart";
import { ChartPlaceholder } from "./charts";

// A trend over days, drawn on two labelled axes (stage C1, N56: "trend charts with axes for each client"). Same approach as every chart (N10): plain HTML
// and one SVG, real text for every label, no chart library. A gap in the data is a gap in the line, never a value. The scale starts at zero (or at `floor`),
// one series colour per line with the name written next to it, and the numbers are reachable without a pointer: the chart takes focus and the left and right
// arrow keys step through the days, with a table for screen readers. Under `min` days of data it is replaced by a placeholder that says when it will appear.
const COLOUR: Record<string, string> = { "1": "var(--chart-1)", "2": "var(--chart-2)", "3": "var(--chart-3)", "4": "var(--chart-4)", "5": "var(--chart-5)", muted: "var(--muted-foreground)" };
const colourOf = (s: LineSeries, i: number) => COLOUR[String(s.tone ?? ((i % 5) + 1))];

export function LineChart({ title, series, format = (n: number) => String(Math.round(n)), unit = "", axisLabel, floor, ceiling, height = 168, min = 3, need = "days of history", note }: {
  title: string; series: ReadonlyArray<LineSeries>;
  format?: (n: number) => string; unit?: string; axisLabel?: string; floor?: number; ceiling?: number; height?: number;
  /** The fewest days with a value before a line is drawn. */
  min?: number; need?: string;
  /** One quiet line under the chart (what the chart does not show, or why part of it is missing). */
  note?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const l = layoutLines(series, { floor, ceiling });
  if (belowMinimum(l.days.length, min)) return <ChartPlaceholder title={title} need={min} have={l.days.length} unit={need}>{note ? ` ${note}` : null}</ChartPlaceholder>;
  const point = (e: PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setActive(nearestDay(l, (e.clientX - r.left) / r.width));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setActive(stepDay(l.days, active, e.key === "ArrowRight" ? 1 : -1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(l.days[0]); }
    else if (e.key === "End") { e.preventDefault(); setActive(l.days[l.days.length - 1]); }
    else if (e.key === "Escape") setActive(null);
  };
  const at = active === null ? null : l.xOf(active);
  const latest = series.map((s) => { const v = [...s.points].reverse().find((p) => p.value !== null); return v ? (v.value as number) : null; });
  return (
    <figure className="min-w-0" data-testid="line-chart">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">{title}</span>{axisLabel && <span>{axisLabel}</span>}</figcaption>
      <div className="flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[11px] text-muted-foreground" style={{ height }} aria-hidden>
          {l.yTicks.map((t) => <span key={t} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ bottom: `${l.yOf(t) * 100}%` }}>{format(t)}</span>)}
        </div>
        <div ref={box} className="relative min-w-0 flex-1 touch-pan-y outline-offset-4" style={{ height }} tabIndex={0} role="group" aria-label={`${title}. Use the left and right arrow keys to read each day.`}
          onPointerMove={point} onPointerDown={point} onPointerLeave={() => setActive(null)} onKeyDown={key} onBlur={() => setActive(null)}>
          {l.yTicks.map((t) => <div key={t} aria-hidden className={`absolute inset-x-0 border-t ${l.yOf(t) === 0 ? "border-foreground/30" : "border-border"}`} style={{ bottom: `${l.yOf(t) * 100}%` }} />)}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {series.map((s, i) => segments(s.points).map((seg, k) => (
              <polyline key={`${s.label}-${k}`} fill="none" stroke={colourOf(s, i)} strokeWidth={s.dashed || s.tone === "muted" ? 1.5 : 2} strokeDasharray={s.dashed || s.tone === "muted" ? "5 4" : undefined} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"
                points={seg.map((p) => `${l.xOf(p.day) * 100},${100 - l.yOf(p.value as number) * 100}`).join(" ")} />
            )))}
          </svg>
          {at !== null && active !== null && (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-foreground/40" style={{ left: `${at * 100}%` }} />
              {series.map((s, i) => { const v = valuesOn(series, active)[i]; return v === null ? null : <span key={s.label} aria-hidden className="pointer-events-none absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-sm border border-background" style={{ left: `${at * 100}%`, bottom: `${l.yOf(v) * 100}%`, background: colourOf(s, i) }} />; })}
              <div role="tooltip" className="pointer-events-none absolute top-0 z-20 w-max max-w-[12rem] rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-[var(--shadow-lift)]" style={{ left: `${Math.min(Math.max(at * 100, 14), 86)}%`, transform: "translateX(-50%)" }}>
                <p className="font-medium">{dayLabel(active, true)}</p>
                {series.map((s, i) => { const v = valuesOn(series, active)[i]; return <p key={s.label} className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-3" style={{ background: colourOf(s, i) }} /><span className="text-muted-foreground">{s.label}</span> {v === null ? "no value" : `${format(v)}${unit ? ` ${unit}` : ""}`}</p>; })}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="relative ml-14 mt-1 h-4 text-[11px] text-muted-foreground" aria-hidden>
        {l.xTicks.map((t, i) => <span key={t.day} className={`absolute whitespace-nowrap ${i === 0 ? "" : i === l.xTicks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${t.at * 100}%` }}>{t.label}</span>)}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5"><span aria-hidden className={`inline-block h-0.5 w-4 ${s.dashed || s.tone === "muted" ? "border-t-2 border-dashed" : ""}`} style={s.dashed || s.tone === "muted" ? { borderColor: colourOf(s, i) } : { background: colourOf(s, i) }} />{s.label}{latest[i] !== null && <span> now <strong className="font-medium text-foreground">{format(latest[i] as number)}{unit ? ` ${unit}` : ""}</strong></span>}</li>
        ))}
      </ul>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      <div className="sr-only"><table><caption>{title}</caption><thead><tr><th>Day</th>{series.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
        <tbody>{l.days.slice(-120).map((d) => <tr key={d}><td>{dayLabel(d, true)}</td>{valuesOn(series, d).map((v, i) => <td key={i}>{v === null ? "none" : format(v)}</td>)}</tr>)}</tbody></table></div>
    </figure>
  );
}
