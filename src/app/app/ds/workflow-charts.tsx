"use client";

import { ColumnChart } from "./column-chart";
import { useState } from "react";

// The Workflows charts (docs/features/WORKFLOWS.md). Plain SVG and HTML, no library. Every mark is a real button: a slice, a bar row, a point of the trend
// and a number each open the list behind them. Every mark has text for a screen reader, the colours never carry the meaning alone (each row says its words and
// number), and a series that has fewer than 3 days of history is replaced by a sentence instead of a line.

export type Mark = { key: string; label: string; count: number; colour: string };

const R = 52, C = 2 * Math.PI * R;

export function WfDonut({ title, marks, selected, onSelect, centre = "in total", empty = "Nothing to show yet." }: { title: string; marks: Mark[]; selected: string | null; onSelect: (key: string) => void; centre?: string; empty?: string }) {
  const total = marks.reduce((s, m) => s + m.count, 0);
  const starts = marks.reduce<number[]>((a, m, i) => [...a, i === 0 ? 0 : a[i - 1] + (marks[i - 1].count / (total || 1)) * C], []);
  return (
    <figure className="min-w-0" data-testid="wf-donut">
      <figcaption className="mb-2 text-sm font-semibold">{title}</figcaption>
      {total === 0 ? <p className="py-6 text-sm text-muted-foreground">{empty}</p> : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="group" aria-label={`${title}: ${marks.map((m) => `${m.label} ${m.count}`).join(", ")}`}>
            <g transform="rotate(-90 70 70)">
              {marks.map((m, i) => {
                if (m.count <= 0) return null;
                const len = (m.count / total) * C, offset = starts[i];
                return (
                  <circle key={m.key} cx="70" cy="70" r={R} fill="none" stroke={m.colour} strokeWidth={selected === m.key ? 24 : 18} strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`} strokeDashoffset={-offset}
                    opacity={selected && selected !== m.key ? 0.4 : 1} className="cursor-pointer" role="button" tabIndex={0} aria-label={`${m.label}: ${m.count}. Show the list.`}
                    onClick={() => onSelect(m.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(m.key); } }} data-testid={`wf-slice-${m.key}`} />
                );
              })}
            </g>
            <text x="70" y="68" textAnchor="middle" pointerEvents="none" className="fill-foreground text-[22px] font-semibold" style={{ fontVariantNumeric: "tabular-nums" }}>{total}</text>
            <text x="70" y="85" textAnchor="middle" pointerEvents="none" className="fill-muted-foreground text-[9px]">{centre}</text>
          </svg>
          <ul className="min-w-[10rem] flex-1 space-y-1">
            {marks.map((m) => (
              <li key={m.key}>
                <button type="button" onClick={() => onSelect(m.key)} aria-pressed={selected === m.key} data-testid={`wf-legend-${m.key}`}
                  className={`grid min-h-9 w-full grid-cols-[0.75rem_1fr_auto] items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-accent ${selected === m.key ? "bg-accent" : ""}`}>
                  <span aria-hidden className="size-2.5 rounded-sm" style={{ background: m.colour }} />
                  <span>{m.label}</span>
                  <span className="font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{m.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}

/** Horizontal bars, one thin bar per row, the longest first, the number at the end. Each row is a button. */
export function WfBars({ title, rows, selected, onSelect, colour = "var(--chart-1)", flagColour = "var(--destructive)", empty = "Nothing to show yet.", columns = false }: {
  title: string; rows: Array<{ key: string; label: string; value: number; flag?: number; note?: string }>; selected: string | null; onSelect: (key: string) => void; colour?: string; flagColour?: string; empty?: string;
  /** One vertical column per row (shared ColumnChart): for comparisons across many client accounts. */
  columns?: boolean;
}) {
  if (columns && rows.length > 0) {
    return <ColumnChart testId="wf-bars" title={title} subject="client" unit="" onSelect={(k) => onSelect(k)}
      items={rows.map((r) => ({ key: r.key, label: r.label, segments: [{ key: "v", label: title, value: r.value, colour }] }))} />;
  }
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <figure className="min-w-0" data-testid="wf-bars">
      <figcaption className="mb-2 text-sm font-semibold">{title}</figcaption>
      {rows.length === 0 ? <p className="py-6 text-sm text-muted-foreground">{empty}</p> : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" onClick={() => onSelect(r.key)} aria-pressed={selected === r.key} data-testid={`wf-bar-${r.key}`} aria-label={`${r.label}: ${r.value}${r.flag ? `, ${r.flag} need attention` : ""}. Show the list.`}
                className={`grid min-h-9 w-full grid-cols-[minmax(6rem,10rem)_1fr_3.5rem] items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-accent ${selected === r.key ? "bg-accent" : ""}`}>
                <span className="truncate">{r.label}</span>
                <span className="relative block h-2 rounded-full bg-muted" aria-hidden>
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: colour }} />
                  {r.flag ? <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.flag / max) * 100}%`, background: flagColour }} /> : null}
                </span>
                <span className="text-right font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** One thin line over days. Gaps stay gaps. Each day with a value is a point you can press. Under three days it says when it will appear. */
export function WfTrend({ title, points, onPoint, unit = "", colour = "var(--chart-1)", need = 3 }: { title: string; points: Array<{ day: string; value: number | null }>; onPoint?: (day: string) => void; unit?: string; colour?: string; need?: number }) {
  const [hot, setHot] = useState<number | null>(null);
  const have = points.filter((p) => p.value !== null);
  if (have.length < need) return <figure data-testid="wf-trend"><figcaption className="mb-2 text-sm font-semibold">{title}</figcaption><p className="py-6 text-sm text-muted-foreground">SubSync keeps its own daily record. This chart appears after {need} days of history ({have.length} so far).</p></figure>;
  const W = 320, H = 120, PL = 28, PB = 18;
  const max = Math.max(1, ...have.map((p) => p.value as number));
  const x = (i: number) => PL + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - PL - 6));
  const y = (v: number) => 6 + (1 - v / max) * (H - PB - 6);
  let d = "";
  points.forEach((p, i) => { if (p.value === null) return; d += `${points[i - 1]?.value === null || i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)} `; });
  const tip = hot === null ? null : points[hot];
  return (
    <figure className="min-w-0" data-testid="wf-trend">
      <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label={`${title}. ${have.length} days.`}>
        <line x1={PL} x2={W - 6} y1={y(0)} y2={y(0)} stroke="var(--border)" />
        <text x={PL - 4} y={y(max) + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">{max}</text>
        <text x={PL - 4} y={y(0) + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">0</text>
        <path d={d} fill="none" stroke={colour} strokeWidth="1.5" strokeLinejoin="round" />
        {points.map((p, i) => p.value === null ? null : (
          <circle key={p.day} cx={x(i)} cy={y(p.value)} r={hot === i ? 4 : 2.5} fill={colour} stroke="var(--background)" strokeWidth="1" className="cursor-pointer" role="button" tabIndex={0}
            aria-label={`${p.day}: ${p.value}${unit}. Show the list.`} data-testid="wf-point" onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)}
            onClick={() => onPoint?.(p.day)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPoint?.(p.day); } }} />
        ))}
        <text x={PL} y={H - 4} className="fill-muted-foreground text-[8px]">{points[0].day.slice(5)}</text>
        <text x={W - 6} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[8px]">{points[points.length - 1].day.slice(5)}</text>
      </svg>
      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">{tip && tip.value !== null ? `${tip.day}: ${tip.value}${unit}` : "Press a point to see the list for that day."}</p>
    </figure>
  );
}

/** A big number you can press. */
export function WfNumber({ label, value, hint, tone = "neutral", onClick, testId }: { label: string; value: string | number; hint?: string; tone?: "neutral" | "bad" | "warn" | "good"; onClick?: () => void; testId?: string }) {
  const c = { neutral: "text-foreground", bad: "text-destructive", warn: "text-warning", good: "text-success" }[tone];
  const inner = (<><span className="block text-xs font-medium text-muted-foreground">{label}</span><span className={`block text-[1.6rem] font-semibold leading-8 ${c}`} style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>{hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}</>);
  return onClick ? <button type="button" onClick={onClick} data-testid={testId} className="min-h-16 min-w-0 rounded-xl border px-3 py-2 text-left hover:bg-accent">{inner}</button> : <div data-testid={testId} className="min-w-0 rounded-xl border px-3 py-2">{inner}</div>;
}
