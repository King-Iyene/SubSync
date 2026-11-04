"use client";

import { Check, ChevronRight } from "lucide-react";
import { useState } from "react";
import { arcsOf, labelAt, LABEL_MIN_SHARE, sectorPath } from "@/lib/design/donut";
import { countWords, kindColour, money, type Kind, type Slice } from "@/lib/analytics/today-queue";
import { CountUp } from "./count-up";
import { ChartHint } from "./showing";

// "What needs attention", part to whole, at most five slices (one per kind of thing). The title states the finding. Every slice is a button: press it (click,
// tap, Enter or Space) and the page narrows to that kind and opens the list behind it, whose row count is the number on the slice. The legend rows are buttons too
// and do the same, so the chart is never the only way in. One colour per kind, the same everywhere on the page; the chosen slice is pushed out and outlined and the
// others are dimmed, and the chosen legend row carries a check mark, so selection is never colour alone. Labels sit outside the ring in text colour; a hidden table
// carries every number for a screen reader. Hover or focus shows the details in words in a line under the chart, where it can never be clipped.
const W = 330, H = 236, CX = 165, CY = 118, R1 = 86, R0 = 56;

export function DonutChart({ title, slices, selected, onSelect, hint = "Click a slice to see exactly what is in it.", used = false, centreLabel = "need attention" }: {
  title: string; slices: Slice[]; selected: Kind | null; onSelect: (k: Kind) => void; hint?: string; used?: boolean; centreLabel?: string;
}) {
  const [hot, setHot] = useState<Kind | null>(null);
  const total = slices.reduce((s, x) => s + x.count, 0);
  const arcs = arcsOf(slices.map((s) => s.count));
  const tip = slices.find((s) => s.kind === hot) ?? null;
  const press = (k: Kind) => onSelect(k);
  return (
    <figure className="min-w-0" data-testid="donut-chart">
      <figcaption className="mb-1 text-sm font-semibold leading-5" data-testid="donut-title">{title}</figcaption>
      <ChartHint used={used}>{hint}</ChartHint>
      <div className="relative mx-auto" style={{ maxWidth: W }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="group" aria-label={`${title}. ${slices.length} kinds. Each slice opens the list behind it.`}>
          {arcs.map((a) => {
            const s = slices[a.index];
            const on = selected === s.kind, focus = hot === s.kind;
            const out = on ? 7 : 0;
            const mid = ((a.mid - 90) * Math.PI) / 180;
            const dim = selected !== null && !on;
            return (
              <g key={s.kind} transform={`translate(${(Math.cos(mid) * out).toFixed(2)} ${(Math.sin(mid) * out).toFixed(2)})`} className="ds-pop" style={{ transformOrigin: `${CX}px ${CY}px` }}>
                <path d={sectorPath(CX, CY, R0, R1, a.from, a.to)} fill={kindColour(s.kind)} fillOpacity={dim ? 0.38 : 1}
                  stroke={on || focus ? "var(--foreground)" : "var(--background)"} strokeWidth={on || focus ? 2.5 : 2} strokeLinejoin="round"
                  role="button" tabIndex={0} aria-pressed={on} aria-label={`${countWords(s.kind, s.count)}, ${s.share}% of what needs attention. Open the list.`}
                  data-testid={`slice-${s.kind}`} data-count={s.count} className="cursor-pointer outline-none transition-[fill-opacity] duration-150"
                  onClick={() => press(s.kind)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); press(s.kind); } }}
                  onMouseEnter={() => setHot(s.kind)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(s.kind)} onBlur={() => setHot(null)} />
              </g>
            );
          })}
          {arcs.filter((a) => slices[a.index].share >= LABEL_MIN_SHARE).map((a) => {
            const s = slices[a.index];
            const p = labelAt(CX, CY, R1 + 12 + (selected === s.kind ? 7 : 0), a.mid);
            return <text key={s.kind} x={p.x} y={p.y} textAnchor={p.anchor} dominantBaseline="middle" className="fill-foreground text-[12px] font-medium" style={{ fontVariantNumeric: "tabular-nums" }} aria-hidden>{s.count.toLocaleString("en-US")} · {s.share}%</text>;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" style={{ paddingBottom: 0 }}>
          <p className="tnum text-[2rem] font-semibold leading-none tracking-tight" data-testid="donut-total"><CountUp value={total.toLocaleString("en-US")} /></p>
          <p className="mt-1 max-w-[6.5rem] text-xs leading-4 text-muted-foreground">{centreLabel}</p>
        </div>
      </div>
      <p className="mt-1 min-h-10 text-sm leading-5" role="status" aria-live="polite" data-testid="donut-tip">
        {tip ? <><span className="font-medium">{tip.label}:</span> {countWords(tip.kind, tip.count)}, {tip.share}% of the total. {tip.dollars ? `${money(tip.dollars)} counted at stake.` : "No counted dollars."}{tip.partial ? " Only the first ones are listed." : ""}</> : ""}
      </p>
      <ul className="mt-1 divide-y border-y" data-testid="donut-legend">
        {slices.map((s) => {
          const on = selected === s.kind;
          return (
            <li key={s.kind}>
              <button type="button" aria-pressed={on} onClick={() => press(s.kind)} onMouseEnter={() => setHot(s.kind)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(s.kind)} onBlur={() => setHot(null)} data-testid={`legend-${s.kind}`}
                className={`ds-press group flex min-h-10 w-full items-center gap-3 px-1 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] ${on ? "font-semibold" : ""}`}>
                <span aria-hidden className="size-3 shrink-0 rounded-[3px]" style={{ background: kindColour(s.kind) }} />
                <span className="min-w-0 flex-1 break-words">{s.label}</span>
                <span className="tnum shrink-0">{s.count.toLocaleString("en-US")}</span>
                <span className="tnum w-10 shrink-0 text-right text-muted-foreground">{s.share}%</span>
                <span className="inline-flex w-4 shrink-0 justify-end">{on ? <Check aria-hidden className="size-4" /> : <ChevronRight aria-hidden className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sr-only"><table><caption>{title}</caption><thead><tr><th>Kind</th><th>Count</th><th>Share</th><th>Counted dollars</th></tr></thead>
        <tbody>{slices.map((s) => <tr key={s.kind}><td>{s.label}</td><td>{s.count}</td><td>{s.share}%</td><td>{s.dollars ? money(s.dollars) : "none"}</td></tr>)}</tbody></table></div>
    </figure>
  );
}
