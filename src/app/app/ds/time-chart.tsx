"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtAxis, fmtFull, monotonePath, niceTicks, thinLabels } from "@/lib/analytics/chart-format";

// ONE chart for everything over time on Today (Growth daily leads, Clients coming and going, What SubSync caught, Coverage by hour), drawn as bars or as a line and switched
// with a small Bars | Line control. Same click-to-open on both, same axis, same tooltip line, colours from Today's own tokens (--t-c1, --t-c2, --t-accent; checked with the dataviz
// validator on the /design page). The line never overshoots the data (monotone curve), has a light tint under it and a dot where you point. Axis labels are thinned to fit, and
// numbers on the axis are 12k, never 12000.

export type ChartMode = "bars" | "line";
export type ChartSeries = { key: string; name: string; colour: string; values: number[] };
export type ChartPoint = { id: string; /** Full text for the tooltip, "Mon, 3 Nov". */ label: string; /** Short text under the axis. */ short: string; /** Today, still going: drawn lighter. */ partial?: boolean };

/** Remembers the person's Bars or Line choice for one tab in this browser only (a convenience; the chart works without it). */
export function useChartMode(tab: string, fallback: ChartMode = "bars"): [ChartMode, (m: ChartMode) => void] {
  const [mode, setMode] = useState<ChartMode>(fallback);
  useEffect(() => { try { const v = window.localStorage.getItem(`subsync-chart-${tab}`); if (v === "bars" || v === "line") setMode(v); } catch { /* the default stays */ } }, [tab]);
  const set = useCallback((m: ChartMode) => { setMode(m); try { window.localStorage.setItem(`subsync-chart-${tab}`, m); } catch { /* not remembered */ } }, [tab]);
  return [mode, set];
}

export function ModeToggle({ mode, onChange, label }: { mode: ChartMode; onChange: (m: ChartMode) => void; label: string }) {
  return (
    <div role="group" aria-label={`${label}: how to draw it`} className="inline-flex shrink-0 overflow-hidden rounded-[4px] border border-[var(--t-rule2)]" data-testid="chart-mode">
      {(["bars", "line"] as const).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)} data-testid={`chart-mode-${m}`}
          className={`ds-press h-7 cursor-pointer px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] ${mode === m ? "bg-[var(--t-wash)] text-[var(--t-ink)]" : "text-[var(--t-ink2)] hover:bg-[var(--t-wash)]"}`}>{m === "bars" ? "Bars" : "Line"}</button>
      ))}
    </div>
  );
}

const W = 640, H = 200, T = 14, B = 26, R = 50;

export function TimeChart({ points, series, avg, mode, onPick, selectedId, label, noun = "", testId = "time-chart", hint }: {
  points: ChartPoint[]; series: ChartSeries[]; /** A dashed average line, drawn on both modes. */ avg?: Array<number | null>; mode: ChartMode; onPick?: (i: number) => void; selectedId?: string | null; label: string; noun?: string; testId?: string; hint?: string;
}) {
  const [hot, setHot] = useState<number | null>(null);
  const n = points.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values), ...(avg ?? []).map((v) => v ?? 0));
  const ticks = niceTicks(max, 4), top = ticks[ticks.length - 1] || 1;
  const L = 12 + Math.max(...ticks.map((t) => fmtAxis(t).length)) * 6.2;
  const iw = W - L - R, ih = H - T - B;
  const step = iw / Math.max(1, n), x = (i: number) => L + step * i + step / 2, y = (v: number) => T + ih - (v / top) * ih;
  const k = series.length, bar = Math.max(1.5, Math.min(12, (step * 0.72) / k)), gap = k > 1 ? 1.5 : 0;
  const labels = thinLabels(n, Math.max(2, Math.floor(iw / 58)));
  const avgPts = (avg ?? []).map((v, i) => (v === null ? null : ([x(i), y(v)] as const))).filter((p): p is readonly [number, number] => p !== null);
  const lastAvg = [...(avg ?? [])].reverse().find((v) => v !== null && v !== undefined) ?? null;
  const tipP = hot === null ? null : points[hot];
  const open = (i: number) => onPick?.(i);
  return (
    <figure className="min-w-0" data-testid={testId} data-mode={mode}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="group" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--t-rule)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={L - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="t-num" style={{ fontSize: 10.5, fill: "var(--t-ink3)" }}>{fmtAxis(t)}</text>
          </g>
        ))}
        {mode === "bars" && points.map((p, i) => series.map((s, j) => {
          const v = s.values[i] ?? 0, h = Math.max(v === 0 ? 0 : 1.5, (v / top) * ih), on = selectedId === p.id;
          const bx = x(i) - (k * bar + (k - 1) * gap) / 2 + j * (bar + gap);
          return <rect key={`${p.id}-${s.key}`} x={bx} y={y(0) - h} width={bar} height={h} rx={Math.min(1.5, bar / 3)} fill={s.colour} fillOpacity={on || hot === i ? 1 : p.partial ? 0.4 : 0.7} pointerEvents="none" />;
        }))}
        {mode === "line" && series.map((s, j) => {
          const pts = points.map((_, i) => [x(i), y(s.values[i] ?? 0)] as const);
          const d = monotonePath(pts);
          return (
            <g key={s.key} pointerEvents="none">
              {j === 0 && n > 1 && <path d={`${d}L${pts[n - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z`} fill={s.colour} fillOpacity={0.12} />}
              <path d={d} fill="none" stroke={s.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {n <= 45 && pts.map(([px, py], i) => (s.values[i] ?? 0) > 0 && hot !== i ? <circle key={i} cx={px} cy={py} r={1.8} fill={s.colour} /> : null)}
            </g>
          );
        })}
        {hot !== null && <line x1={x(hot)} x2={x(hot)} y1={T} y2={y(0)} stroke="var(--t-rule2)" strokeWidth={1} pointerEvents="none" />}
        {hot !== null && mode === "line" && series.map((s) => <circle key={s.key} cx={x(hot)} cy={y(s.values[hot] ?? 0)} r={4} fill={s.colour} stroke="var(--t-raise)" strokeWidth={1.5} pointerEvents="none" />)}
        {avgPts.length > 1 && <polyline points={avgPts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--t-accent)" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" data-testid="chart-avg" />}
        {avgPts.length > 1 && lastAvg !== null && <text x={W - R + 6} y={avgPts[avgPts.length - 1][1]} dominantBaseline="middle" className="t-num" style={{ fontSize: 11, fill: "var(--t-ink)" }} pointerEvents="none">avg {fmtAxis(Math.round(lastAvg * 10) / 10)}</text>}
        {points.map((p, i) => (
          <rect key={`hit-${p.id}`} x={x(i) - step / 2} y={T} width={step} height={ih + 4} fill="transparent" role={onPick ? "button" : undefined} tabIndex={onPick ? 0 : undefined} aria-pressed={onPick ? selectedId === p.id : undefined}
            aria-label={`${p.label}: ${series.map((s) => `${fmtFull(s.values[i] ?? 0)} ${s.name.toLowerCase()}`).join(", ")}${p.partial ? " so far" : ""}.${onPick ? " See them." : ""}`}
            data-testid={`${testId}-mark`} data-id={p.id} data-count={series[0]?.values[i] ?? 0} data-count2={series[1]?.values[i] ?? ""} className={`${onPick ? "cursor-pointer" : ""} outline-none [&:focus-visible]:stroke-[var(--ring)] [&:focus-visible]:stroke-2`}
            onClick={() => open(i)} onKeyDown={(e) => { if (onPick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(i); } }}
            onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)} />
        ))}
        {labels.map((i) => <text key={i} x={x(i)} y={H - 7} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} style={{ fontSize: 10.5, fill: "var(--t-ink3)" }}>{points[i].short}</text>)}
      </svg>
      <p className="t-small t-quiet mt-1 min-h-5" role="status" aria-live="polite" data-testid={`${testId}-tip`}>
        {tipP && hot !== null ? <><span className="font-medium text-[var(--t-ink)]">{tipP.label}:</span> {series.map((s) => `${fmtFull(s.values[hot] ?? 0)} ${s.name.toLowerCase()}`).join(", ")}{tipP.partial ? " so far today" : ""}{avg && avg[hot] != null ? `. 7 day average ${avg[hot]}.` : "."}</> : hint ?? ""}
      </p>
      {k > 1 && <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--t-ink2)]" aria-label="What the colours mean">{series.map((s) => <li key={s.key} className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-3 rounded-[2px]" style={{ background: s.colour }} />{s.name}</li>)}</ul>}
      <div className="sr-only"><table><caption>{label}</caption><thead><tr><th>{noun || "Day"}</th>{series.map((s) => <th key={s.key}>{s.name}</th>)}</tr></thead>
        <tbody>{points.map((p, i) => <tr key={p.id}><td>{p.label}</td>{series.map((s) => <td key={s.key}>{s.values[i] ?? 0}</td>)}</tr>)}</tbody></table></div>
    </figure>
  );
}
