"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { layoutGate, type GateLaneIn } from "@/lib/design/sorting-gate";
import { useReducedMotion } from "../speed6-base";

// "Where do my leads go?": THE SORTING GATE. Leads stream in from their sources (the stream's thickness is how many leads it carries), pass one gate, and are sorted: duplicates are pulled up
// into a merge circle where the copies become one record, junk drops into a bin, clean leads flow on. Real numbers only. Click a lane, the merge circle, the bin or the clean box to open exactly those
// contacts (the count on the picture is the number of rows). Calm and flat: one accent, one warm colour for duplicates, grey for junk. With reduced motion (or on a phone) the picture is the same but still.

export type GatePick = { src: string | null; flag: "all" | "ok" | "dup" | "junk"; title: string; count: number };
type Props = { lanes: GateLaneIn[]; groups: number; days: number; onPick?: (p: GatePick) => void; compact?: boolean; testId?: string };

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const fmt = (n: number) => n.toLocaleString("en-US");

export function SortingGate({ lanes, groups, days, onPick, compact = false, testId = "dq-gate" }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(compact ? 520 : 900), [run, setRun] = useState(0), [hot, setHot] = useState<string | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth))); ro.observe(el); setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const L = useMemo(() => layoutGate({ lanes, groups }, { width, compact }), [lanes, groups, width, compact]);
  const t = L.totals;
  const press = (fn: () => void) => ({ onClick: fn, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } }, tabIndex: 0, role: "button" as const });
  const pick = (p: GatePick) => () => onPick?.(p);
  const caption = hot ?? `${fmt(t.leads)} leads in the last ${days} days: ${fmt(t.clean)} clean, ${fmt(t.dups)} duplicates, ${fmt(t.junk)} junk.`;
  const showDots = !reduced && L.dots.length > 0;

  if (t.leads === 0) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground" data-testid={`${testId}-empty`}>No new leads in the last {days} days. When leads arrive you will see where they come from and where they go.</p>;

  const tx = L.vertical ? 10 : 52;
  const out = (r: { x: number; y: number; w: number; h: number }) => r;
  return (
    <div ref={wrap} className="w-full" data-testid={testId}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground" aria-live="polite" data-testid={`${testId}-caption`}>{caption}</p>
        {showDots && <button type="button" onClick={() => setRun((n) => n + 1)} className="ds-press inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-medium hover:bg-accent/50" data-testid={`${testId}-replay`}><RotateCcw aria-hidden className="size-3.5" />Replay</button>}
      </div>
      <svg viewBox={`0 0 ${L.width} ${L.height}`} width="100%" height={L.height} role="group" aria-label={`Where leads go: ${fmt(t.leads)} leads, ${fmt(t.dups)} duplicates, ${fmt(t.junk)} junk, ${fmt(t.clean)} clean`} className="block overflow-visible">
        {!L.vertical && <>
          <text x={L.lanes[0]?.labelBox.x ?? 16} y={14} className="fill-muted-foreground" fontSize="10">LEADS IN, BY SOURCE</text>
          <text x={L.outs.merge.x} y={14} className="fill-muted-foreground" fontSize="10">SORTED</text>
        </>}
        {L.lanes.map((l) => {
          const label = `${l.label}: ${fmt(l.leads)} leads, ${fmt(l.dups)} duplicates, ${fmt(l.junk)} junk. Open them.`;
          const body = (
            <>
              <title>{l.other ? `${l.label}: ${fmt(l.leads)} leads from several small sources` : label}</title>
              <rect x={l.row.x} y={l.row.y} width={l.row.w} height={l.row.h} rx={6} className={`fill-transparent ${hot === l.key ? "stroke-primary/50" : "stroke-transparent"}`} />
              <text x={l.labelBox.x} y={l.labelBox.y + l.labelBox.h / 2 + 4} fontSize="12" className="fill-foreground">{L.vertical ? cut(l.label, 36) : cut(l.label, 17)}</text>
              <text x={L.vertical ? l.labelBox.x + l.labelBox.w : l.labelBox.x + l.labelBox.w - 6} y={l.labelBox.y + l.labelBox.h / 2 + 4} fontSize="12" textAnchor="end" className="fill-muted-foreground" fontWeight="600">{fmt(l.leads)}</text>
              <rect x={l.stream.x} y={l.stream.y} width={l.stream.w} height={l.stream.h} rx={Math.min(7, l.stream.h / 2)} className="fill-primary/15 stroke-primary/40" strokeWidth={1} />
            </>
          );
          return l.other
            ? <g key={l.key} onMouseEnter={() => setHot(`${l.label}: ${fmt(l.leads)} leads`)} onMouseLeave={() => setHot(null)}>{body}</g>
            : <g key={l.key} className="cursor-pointer outline-none" {...press(pick({ src: l.key, flag: "all", title: `Leads from ${l.label}`, count: l.leads }))} aria-label={label} data-testid={`${testId}-lane-${l.key}`}
                onMouseEnter={() => setHot(`${l.label}: ${fmt(l.leads)} leads, ${fmt(l.dups)} duplicates, ${fmt(l.junk)} junk`)} onMouseLeave={() => setHot(null)}>{body}</g>;
        })}

        <rect x={L.gate.x} y={L.gate.y} width={L.gate.w} height={L.gate.h} rx={4} className="fill-muted stroke-border" strokeWidth={1} />
        {!L.vertical && [0.25, 0.5, 0.75].map((f) => <line key={f} x1={L.gate.x + 3} x2={L.gate.x + L.gate.w - 3} y1={L.gate.y + L.gate.h * f} y2={L.gate.y + L.gate.h * f} className="stroke-muted-foreground/40" strokeWidth={1} />)}
        {!L.vertical && <text x={L.gate.x + L.gate.w / 2} y={L.gate.y - 6} textAnchor="middle" fontSize="10" className="fill-muted-foreground">GATE</text>}

        {/* duplicates: pulled aside, the copies become one record */}
        <g className="cursor-pointer outline-none" {...press(pick({ src: null, flag: "dup", title: "Duplicate leads", count: t.dups }))} aria-label={`${fmt(t.dups)} duplicates caught. Open them.`} data-testid={`${testId}-dup`}
          onMouseEnter={() => setHot(`${fmt(t.dups)} duplicates caught: the copies are joined into one record. ${fmt(groups)} groups wait for a merge.`)} onMouseLeave={() => setHot(null)}>
          <title>{`${fmt(t.dups)} duplicates caught`}</title>
          <rect {...out(L.outs.merge)} rx={8} className="fill-warning/10 stroke-warning/40" strokeWidth={1} />
          {!L.vertical && <><circle cx={L.mergeCenter.x - 7} cy={L.mergeCenter.y - 4} r={L.mergeCenter.r * 0.55} className="fill-warning/40" /><circle cx={L.mergeCenter.x + 4} cy={L.mergeCenter.y - 6} r={L.mergeCenter.r * 0.55} className="fill-warning/50" />
          <circle cx={L.mergeCenter.x} cy={L.mergeCenter.y + 3} r={L.mergeCenter.r * 0.55} className="fill-warning/60" />
          <circle cx={L.mergeCenter.x} cy={L.mergeCenter.y} r={L.mergeCenter.r} fill="none" className="stroke-warning" strokeWidth={1.5} /></>}
          <text x={L.outs.merge.x + tx} y={L.outs.merge.y + (L.vertical ? 26 : L.outs.merge.h / 2 - 2)} fontSize={compact ? 15 : 20} fontWeight="700" className="fill-foreground">{fmt(t.dups)}</text>
          <text x={L.outs.merge.x + tx} y={L.outs.merge.y + (L.vertical ? 44 : L.outs.merge.h / 2 + 14)} fontSize="11" className="fill-muted-foreground">{L.vertical ? "duplicates" : "duplicates caught"}</text>
        </g>
        {/* clean leads flow on */}
        <g className="cursor-pointer outline-none" {...press(pick({ src: null, flag: "ok", title: "Clean leads", count: t.clean }))} aria-label={`${fmt(t.clean)} clean leads. Open them.`} data-testid={`${testId}-clean`}
          onMouseEnter={() => setHot(`${fmt(t.clean)} clean leads: not a duplicate and not junk.`)} onMouseLeave={() => setHot(null)}>
          <title>{`${fmt(t.clean)} clean leads`}</title>
          <rect {...out(L.outs.clean)} rx={8} className="fill-primary/10 stroke-primary/40" strokeWidth={1} />
          {!L.vertical && <path d={`M${L.outs.clean.x + 12},${L.outs.clean.y + L.outs.clean.h / 2} l18,0 m-6,-5 l6,5 l-6,5`} fill="none" className="stroke-primary" strokeWidth={1.6} strokeLinecap="round" />}
          <text x={L.outs.clean.x + tx} y={L.outs.clean.y + (L.vertical ? 26 : L.outs.clean.h / 2 - 2)} fontSize={compact ? 15 : 20} fontWeight="700" className="fill-foreground">{fmt(t.clean)}</text>
          <text x={L.outs.clean.x + tx} y={L.outs.clean.y + (L.vertical ? 44 : L.outs.clean.h / 2 + 14)} fontSize="11" className="fill-muted-foreground">clean leads</text>
        </g>
        {/* junk drops into the bin */}
        <g className="cursor-pointer outline-none" {...press(pick({ src: null, flag: "junk", title: "Junk leads", count: t.junk }))} aria-label={`${fmt(t.junk)} junk leads. Open them.`} data-testid={`${testId}-junk`}
          onMouseEnter={() => setHot(`${fmt(t.junk)} junk: names or emails like test, asdf or example.com.`)} onMouseLeave={() => setHot(null)}>
          <title>{`${fmt(t.junk)} junk leads`}</title>
          <rect {...out(L.outs.bin)} rx={8} className="fill-muted stroke-border" strokeWidth={1} />
          {!L.vertical && <path d={`M${L.outs.bin.x + 14},${L.outs.bin.y + L.outs.bin.h / 2 - 8} h24 l-3,18 h-18 z`} fill="none" className="stroke-muted-foreground" strokeWidth={1.4} strokeLinejoin="round" />}
          <text x={L.outs.bin.x + tx} y={L.outs.bin.y + (L.vertical ? 26 : L.outs.bin.h / 2 - 2)} fontSize={compact ? 15 : 20} fontWeight="700" className="fill-foreground">{fmt(t.junk)}</text>
          <text x={L.outs.bin.x + tx} y={L.outs.bin.y + (L.vertical ? 44 : L.outs.bin.h / 2 + 14)} fontSize="11" className="fill-muted-foreground">junk</text>
        </g>

        {showDots && (
          <g key={run} aria-hidden pointerEvents="none">
            {L.dots.map((d, i) => (
              <circle key={i} r={d.r} className={d.kind === "dup" ? "fill-warning" : d.kind === "junk" ? "fill-muted-foreground/70" : "fill-primary"} opacity={0}>
                <animateMotion path={d.d} dur={`${d.dur}s`} begin={`${d.begin}s`} repeatCount="indefinite" rotate="0" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" dur={`${d.dur}s`} begin={`${d.begin}s`} repeatCount="indefinite" />
              </circle>
            ))}
          </g>
        )}
      </svg>
      <p className="sr-only">Each row is a source of leads. The thicker the stream, the more leads. Duplicates go to the merge circle, junk to the bin and clean leads on.</p>
    </div>
  );
}
