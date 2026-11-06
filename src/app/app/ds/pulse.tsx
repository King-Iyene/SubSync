"use client";

import { CircleCheck, Info, Minus, TriangleAlert } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import type { Usual, Verdict } from "@/lib/analytics/today-queue";
import { CountUp } from "./count-up";
import { fullDate } from "@/lib/analytics/chart-format";

// One figure compared with the account's own usual: the label, the big number, one line that says better, worse, about the same or "not enough history yet"
// (only above the minimum sample, see vsUsual in today-queue.ts), and an optional small line of the last few days. The verdict is in the FORM too: an icon and a
// word beside a thin rule on the left, so it is never colour alone.

const VERDICT: Record<Verdict, { rule: string; text: string; Icon: typeof Info }> = {
  better: { rule: "border-success", text: "text-success", Icon: CircleCheck },
  worse: { rule: "border-warning", text: "text-warning", Icon: TriangleAlert },
  same: { rule: "border-border", text: "text-muted-foreground", Icon: Minus },
  not_enough: { rule: "border-border", text: "text-muted-foreground", Icon: Info },
};

export type SparkPoint = { label: string; value: number; note?: string };

/**
 * One line of the last few days: a 2 px line, the end point marked with a ring in the page colour, a faint baseline, no legend (the tile's label names it) and one
 * axis. Hover or focus shows the exact value and the date; a hidden table carries the same numbers for a screen reader. Points are drawn only where a figure
 * exists, so a missing day is a gap in the data, never a guess.
 */
export function PulseSpark({ points, label, format, height = 96, onPoint, pointInfo }: {
  points: SparkPoint[]; label: string; format: (n: number) => string; height?: number;
  /** Press a point (click, or Enter on the focused point): open the records behind it. */
  onPoint?: (i: number) => void;
  /** What a point opens, in words ("Click to see the 31 leads behind it"), or why it cannot open (SubSync does not hold the records). */
  pointInfo?: (i: number) => { open: boolean; text: string };
}) {
  const [at, setAt] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (points.length < 3) return <p className="mt-2 text-xs text-muted-foreground" data-testid="spark-empty">Not enough days yet to draw a line.</p>;
  const lo = Math.min(...points.map((p) => p.value)), hi = Math.max(...points.map((p) => p.value)), span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * 100;
  const y = (v: number) => 8 + (1 - (v - lo) / span) * 84;
  const last = points.length - 1;
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setAt(Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * last));
  };
  const p = at === null ? null : points[at];
  const avg = points.reduce((t, q) => t + q.value, 0) / points.length;
  const diff = p ? p.value - avg : 0;
  return (
    <figure className="mt-3" data-testid="pulse-spark">
      <div ref={box} className={`relative touch-pan-y px-1.5 outline-offset-4 ${onPoint ? "cursor-pointer" : ""}`} style={{ height }} tabIndex={0} role="group" aria-label={`${label}. Use the left and right arrow keys to read each day.`}
        onPointerMove={(e) => move(e.clientX)} onPointerDown={(e) => move(e.clientX)} onPointerLeave={() => setAt(null)} onBlur={() => setAt(null)}
        onClick={(e) => { move(e.clientX); const r = box.current?.getBoundingClientRect(); if (!onPoint || !r || r.width === 0) return; const i = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * last); if (pointInfo?.(i).open !== false) onPoint(i); }}
        data-testid="spark-surface" data-clickable={onPoint ? "true" : "false"}
        onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); setAt((n) => Math.min(last, (n ?? last - 1) + 1)); } else if (e.key === "ArrowLeft") { e.preventDefault(); setAt((n) => Math.max(0, (n ?? last) - 1)); } else if (e.key === "Escape") setAt(null); else if (e.key === "Enter" && onPoint && at !== null && pointInfo?.(at).open !== false) { e.preventDefault(); onPoint(at); } }}>
        <div aria-hidden className="absolute inset-x-1.5 bottom-0 border-t border-border" />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="absolute inset-x-1.5 inset-y-0 h-full w-[calc(100%-0.75rem)] overflow-visible">
          <polyline fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" points={points.map((q, i) => `${x(i)},${y(q.value)}`).join(" ")} />
        </svg>
        <span aria-hidden className="pointer-events-none absolute size-[10px] -translate-x-1/2 translate-y-1/2 rounded-full bg-primary ring-2 ring-background" style={{ left: `calc(0.375rem + (100% - 0.75rem) * ${x(last) / 100})`, bottom: `${100 - y(points[last].value)}%` }} />
        {at !== null && <span aria-hidden className="pointer-events-none absolute inset-y-0 border-l border-dashed border-[var(--t-ink3)]" style={{ left: `calc(0.375rem + (100% - 0.75rem) * ${x(at) / 100})` }} />}
        {at !== null && at !== last && <span aria-hidden className="pointer-events-none absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-foreground ring-2 ring-background shadow-[0_0_6px_var(--primary)]" style={{ left: `calc(0.375rem + (100% - 0.75rem) * ${x(at) / 100})`, bottom: `${100 - y(points[at].value)}%` }} />}
        {p && (
          <div role="tooltip" className="pointer-events-none absolute bottom-full z-20 mb-1 w-max max-w-[14rem] rounded-[4px] border border-[var(--t-rule2)] bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-[var(--shadow-lift)]" style={{ left: `${Math.min(Math.max(x(at as number), 18), 82)}%`, transform: "translateX(-50%)" }}>
            <p className="text-sm font-bold">{fullDate(p.label)}</p>
            <p className="t-num mt-0.5 font-medium">{format(p.value)}</p>
            <p className="text-muted-foreground">{Math.abs(diff) < 0.05 * Math.max(1, Math.abs(avg)) ? "About the average" : `${diff > 0 ? "Above" : "Below"} the average (${format(avg)})`}</p>
            {p.note && <p className="text-muted-foreground">{p.note}</p>}
            {onPoint && pointInfo && <p className="mt-0.5 text-muted-foreground" data-testid="spark-tip">{pointInfo(at as number).text}</p>}
          </div>
        )}
      </div>
      <div className="sr-only"><table><caption>{label}</caption><thead><tr><th>Day</th><th>Value</th></tr></thead><tbody>{points.map((q) => <tr key={q.label}><td>{q.label}</td><td>{format(q.value)}</td></tr>)}</tbody></table></div>
    </figure>
  );
}

export function PulseTile({ label, value, usual, sub, spark, testId, onOpen, openLabel, info }: { label: ReactNode; /** One sentence that explains the figure, shown on hover, focus or tap, not on the page. */ info?: string; value: ReactNode; usual: Usual | null; sub?: ReactNode; spark?: ReactNode; testId?: string; /** Press the number to open the records behind it. */ onOpen?: () => void; openLabel?: string }) {
  const v = usual ? VERDICT[usual.verdict] : null;
  return (
    <div className="min-w-0 py-0.5" data-testid={testId} data-verdict={usual?.verdict ?? "none"}>
      <p className="t-label flex items-center gap-1.5">{label}{info && <span tabIndex={0} role="img" aria-label={info} title={info} data-testid={testId ? `${testId}-info` : undefined} className="inline-flex cursor-help rounded-full text-[var(--t-ink3)] hover:text-[var(--t-ink)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"><Info aria-hidden className="size-3.5" /></span>}</p>
      <p className="t-figure mt-2 break-words">
        {onOpen ? <button type="button" onClick={onOpen} data-testid={testId ? `${testId}-open` : undefined} aria-label={openLabel ?? "Show the records behind this number"} title={openLabel ?? "Show the records behind this number"}
          className="ds-press -mx-1 cursor-pointer rounded-md px-1 text-left text-primary underline decoration-primary/40 decoration-[0.07em] underline-offset-[0.18em] hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"><CountUp value={value} /></button> : <CountUp value={value} />}
      </p>
      {sub && <div className="t-small t-quiet mt-2">{sub}</div>}
      {usual && v && <p className={`mt-1.5 flex items-start gap-1.5 text-xs leading-5 ${v.text}`} data-testid={testId ? `${testId}-usual` : undefined}><v.Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" /><span>{usual.text}</span></p>}
      {spark}
    </div>
  );
}
