"use client";

import { useState } from "react";
import type { DayPoint, SourceRow } from "@/lib/analytics/growth";
import { fmtStat } from "@/lib/analytics/chart-format";
import { ChartCard } from "./time-chart";

// Growth's two charts, drawn from Today's own tokens (--t-c1 and friends, checked with the dataviz validator). One series each, thin marks, quiet gridlines, direct labels.
// Every mark is a button: a day opens the leads of that day, a slice or a legend row opens the leads of that source. A hidden table carries every number.

const W = 640, H = 190, L = 34, R = 44, T = 14, B = 26;

/** New email leads per day (thin bars; today, still unfinished, is drawn lighter) with the 7 day average as a line. */
export function GrowthChart({ series, selected, onDay, label }: { series: DayPoint[]; selected: string | null; onDay: (day: string) => void; label: string }) {
  const [hot, setHot] = useState<number | null>(null);
  const max = Math.max(4, ...series.map((p) => Math.max(p.count, p.avg7 ?? 0)));
  const top = Math.ceil(max / 4) * 4;
  const iw = W - L - R, ih = H - T - B;
  const step = iw / series.length, bar = Math.max(3, Math.min(11, step * 0.55));
  const x = (i: number) => L + step * i + step / 2;
  const y = (v: number) => T + ih - (v / top) * ih;
  const avgPts = series.map((p, i) => (p.avg7 === null ? null : [x(i), y(p.avg7)] as const)).filter((p): p is readonly [number, number] => p !== null);
  const last = avgPts[avgPts.length - 1];
  const tip = hot === null ? null : series[hot];
  return (
    <figure className="min-w-0" data-testid="growth-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="group" aria-label={label}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(top * f)} y2={y(top * f)} stroke="var(--t-rule)" strokeWidth={1} strokeDasharray={f === 0 ? undefined : "2 4"} />
            <text x={L - 8} y={y(top * f)} textAnchor="end" dominantBaseline="middle" className="t-num" style={{ fontSize: 10.5, fill: "var(--t-ink3)" }}>{Math.round(top * f)}</text>
          </g>
        ))}
        {series.map((p, i) => {
          const on = selected === p.day, h = Math.max(p.count === 0 ? 0 : 2, (p.count / top) * ih);
          return (
            <g key={p.day}>
              <rect x={x(i) - step / 2} y={T} width={step} height={ih + 4} fill="transparent" role="button" tabIndex={0} aria-pressed={on} aria-label={`${p.label}: ${p.count} new email ${p.count === 1 ? "lead" : "leads"}${p.partial ? " so far" : ""}. See them.`}
                data-testid="growth-day" data-day={p.day} data-count={p.count} className="cursor-pointer outline-none [&:focus-visible]:stroke-[var(--ring)] [&:focus-visible]:stroke-2"
                onClick={() => onDay(p.day)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDay(p.day); } }}
                onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)} />
              <rect x={x(i) - bar / 2} y={y(0) - h} width={bar} height={h} rx={1.5} fill="var(--t-c1)" fillOpacity={on || hot === i ? 1 : p.partial ? 0.35 : 0.62} pointerEvents="none" />
              {on && <rect x={x(i) - bar / 2 - 2} y={y(0) - h - 2} width={bar + 4} height={h + 2} rx={2.5} fill="none" stroke="var(--t-ink)" strokeWidth={1} pointerEvents="none" />}
            </g>
          );
        })}
        {avgPts.length > 1 && <polyline points={avgPts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--t-ink)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />}
        {last && <text x={last[0] + 8} y={last[1]} dominantBaseline="middle" style={{ fontSize: 11, fill: "var(--t-ink)" }} className="t-num" pointerEvents="none">{series.filter((p) => p.avg7 !== null).slice(-1)[0]?.avg7} avg</text>}
        {[0, Math.floor(series.length / 2), series.length - 1].map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === series.length - 1 ? "end" : "middle"} style={{ fontSize: 10.5, fill: "var(--t-ink3)" }}>{series[i].label}</text>)}
      </svg>
      <p className="t-small t-quiet mt-1 min-h-5" role="status" aria-live="polite" data-testid="growth-tip">
        {tip ? <><span className="font-medium text-[var(--t-ink)]">{tip.label}:</span> {tip.count} new email {tip.count === 1 ? "lead" : "leads"}{tip.partial ? " so far today" : ""}{tip.avg7 !== null ? `. 7 day average ${tip.avg7}.` : "."}</> : "Bars are new email leads a day. The line is the 7 day average."}
      </p>
      <div className="sr-only"><table><caption>{label}</caption><thead><tr><th>Day</th><th>New email leads</th><th>7 day average</th></tr></thead>
        <tbody>{series.map((p) => <tr key={p.day}><td>{p.label}</td><td>{p.count}</td><td>{p.avg7 ?? "not enough days"}</td></tr>)}</tbody></table></div>
    </figure>
  );
}

const CHART_VARS = ["var(--t-c1)", "var(--t-c2)", "var(--t-c3)", "var(--t-c4)", "var(--t-ink3)"];
const colourOf = (i: number) => CHART_VARS[Math.min(i, CHART_VARS.length - 1)];
const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;

/** Where the last 30 days of email leads came from. Four sources and "Other"; a slice or a legend row opens its people. */
export function SourceDonut({ rows, total, selected, onPick, label, rangeWord = "last 30 days" }: { rows: SourceRow[]; total: number; selected: string | null; onPick: (source: string) => void; label: string; rangeWord?: string }) {
  const [hot, setHot] = useState<string | null>(null);
  const shown = rows.length <= 5 ? rows : rows.slice(0, 4);
  const rest = rows.length <= 5 ? [] : rows.slice(4);
  const items = [...shown.map((r, i) => ({ ...r, colour: colourOf(i) })), ...(rest.length ? [{ source: "Other", count: rest.reduce((s, r) => s + r.count, 0), previous: rest.reduce((s, r) => s + r.previous, 0), share: rest.reduce((s, r) => s + r.share, 0), change: rest.reduce((s, r) => s + r.change, 0), colour: "var(--t-ink3)" }] : [])];
  const cx = 70, cy = 70, R1 = 60, R0 = 42;
  let a = -Math.PI / 2;
  const arcs = items.map((it) => {
    const span = total ? (it.count / total) * Math.PI * 2 : 0;
    const from = a; a += span;
    return { it, from, to: a };
  });
  const arc = (from: number, to: number) => {
    const full = to - from >= Math.PI * 2 - 1e-6;
    const [x0, y0] = polar(cx, cy, R1, from), [x1, y1] = polar(cx, cy, R1, full ? from + Math.PI : to), [x2, y2] = polar(cx, cy, R0, full ? from + Math.PI : to), [x3, y3] = polar(cx, cy, R0, from);
    const big = to - from > Math.PI ? 1 : 0;
    return full ? `M${x0},${y0} A${R1},${R1} 0 1 1 ${x1},${y1} A${R1},${R1} 0 1 1 ${x0},${y0} M${x3},${y3} A${R0},${R0} 0 1 0 ${x2},${y2} A${R0},${R0} 0 1 0 ${x3},${y3}` : `M${x0},${y0} A${R1},${R1} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${R0},${R0} 0 ${big} 0 ${x3},${y3} Z`;
  };
  return (
    <figure className="relative grid grid-cols-[8.75rem_minmax(0,1fr)] items-center gap-x-6 gap-y-3" data-testid="source-mix">
      <svg viewBox="0 0 140 140" className="block h-auto w-full" role="group" aria-label={label}>
        {arcs.map(({ it, from, to }) => {
          const on = selected === it.source;
          return it.source === "Other" || it.count === 0 ? (
            <path key={it.source} d={arc(from, to)} fillRule="evenodd" fill={it.colour} fillOpacity={0.55} stroke="var(--t-raise)" strokeWidth={1.5} />
          ) : (
            <path key={it.source} d={arc(from, to)} fillRule="evenodd" fill={it.colour} fillOpacity={selected && !on ? 0.4 : hot && hot !== it.source ? 0.6 : 1} stroke={on ? "var(--t-ink)" : "var(--t-raise)"} strokeWidth={on ? 2 : 1.5} strokeLinejoin="round" style={{ filter: hot === it.source ? `drop-shadow(0 0 5px ${it.colour})` : undefined, transition: "fill-opacity .15s ease" }}
              role="button" tabIndex={0} aria-pressed={on} aria-label={`${it.source}: ${it.count} email leads, ${Math.round(it.share * 100)}% of the ${rangeWord}. See them.`} data-testid="source-slice" data-source={it.source} data-count={it.count}
              className="cursor-pointer outline-none [&:focus-visible]:stroke-[var(--ring)] [&:focus-visible]:stroke-[3px]" onClick={() => onPick(it.source)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(it.source); } else if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); const f = e.key === "ArrowRight" || e.key === "ArrowDown"; let nx = (f ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as SVGElement | null; while (nx && !nx.hasAttribute("data-source")) nx = (f ? nx.nextElementSibling : nx.previousElementSibling) as SVGElement | null; nx?.focus(); } }}
              onMouseEnter={() => setHot(it.source)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(it.source)} onBlur={() => setHot(null)} />
          );
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" className="t-num" style={{ fontSize: 20, fill: "var(--t-ink)", fontWeight: 500 }}>{fmtStat(total)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" style={{ fontSize: 9.5, fill: "var(--t-ink2)" }}>{rangeWord.length > 16 ? "in these dates" : rangeWord}</text>
      </svg>
      {(() => {
        const h = items.find((i) => i.source === hot);
        if (!h) return null;
        const trend = h.change === 0 ? "No change" : h.change > 0 ? `Up ${h.change}` : `Down ${Math.abs(h.change)}`;
        return <ChartCard testId="source-card" title={h.source} left={30} top={0} lines={[<><span aria-hidden className="size-2 rounded-full" style={{ background: h.colour }} /><span className="t-num font-medium">{h.count.toLocaleString("en-US")}</span> email leads, {Math.round(h.share * 100)}% of the {rangeWord}</>]}
          compare={`${trend} against the same number of days before (${h.previous.toLocaleString("en-US")} then)`} hint={h.source === "Other" ? undefined : "Click to see the people"} />;
      })()}
      <ul className="min-w-0" data-testid="source-legend">
        {items.map((it) => {
          const on = selected === it.source;
          const trend = it.change === 0 ? "no change" : it.change > 0 ? `up ${it.change}` : `down ${Math.abs(it.change)}`;
          const row = (
            <>
              <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: it.colour }} />
              <span className="min-w-0 flex-1 truncate" title={it.source}>{it.source}</span>
              <span className="t-num shrink-0 text-right" title={it.count.toLocaleString("en-US")}>{fmtStat(it.count)}</span>
              <span className="t-num w-9 shrink-0 text-right text-[var(--t-ink2)]">{Math.round(it.share * 100)}%</span>
              <span className={`w-16 shrink-0 text-right text-xs ${it.change > 0 ? "text-[var(--t-ok)]" : it.change < 0 ? "text-[var(--t-bad)]" : "text-[var(--t-ink3)]"}`} title="Against the same number of days before">{it.change > 0 ? "▲ " : it.change < 0 ? "▼ " : ""}{trend}</span>
            </>
          );
          return (
            <li key={it.source} className="border-b border-[var(--t-rule)] last:border-0">
              {it.source === "Other" ? <div className="flex min-h-9 items-center gap-2.5 px-1 text-sm">{row}</div> : (
                <button type="button" aria-pressed={on} onClick={() => onPick(it.source)} onMouseEnter={() => setHot(it.source)} onMouseLeave={() => setHot(null)} data-testid="source-row" data-source={it.source}
                  className={`ds-press flex min-h-9 w-full items-center gap-2.5 px-1 text-left text-sm hover:bg-[var(--t-wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] ${on ? "font-medium" : ""}`}>{row}</button>
              )}
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
