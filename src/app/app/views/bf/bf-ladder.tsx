"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { StepKey, StepRow } from "@/lib/analytics/bf-core";
import { along, depthOf, layoutLadder, pathFor } from "@/lib/design/booking-ladder";
import { useReducedMotion } from "../speed6-base";

// THE LADDER: the booking funnel as a staircase. Each step is a ledge as wide as the number of leads that reached it. Leads step down the chutes; the ones that do not fit the next ledge fall off
// its end into a labelled catch-basin. Click a ledge to open the leads that reached it, a basin to open the leads that fell. Hover or focus gives the details; Replay runs it again. Real numbers only.
// With reduced motion (or when the picture is too small to animate) the same picture is still, with the little leads resting where they stopped.

export type LadderPick = { step: StepKey; mode: "reached" | "dropped"; title: string; count: number };
const BASIN: Record<string, string> = { answered: "Never got a reply", booked: "Replied, never booked", showed: "Booked, never showed", deal: "Showed, no deal opened", won: "Deal not won yet" };
const SHORT: Record<string, string> = { answered: "No reply", booked: "Not booked", showed: "Did not show", deal: "No deal", won: "Not won" };
const fmt = (n: number) => n.toLocaleString("en-US");
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function BookingLadder({ steps, biggest = null, onPick, compact = false, testId = "bf-ladder" }: { steps: StepRow[]; biggest?: StepKey | null; onPick?: (p: LadderPick) => void; compact?: boolean; testId?: string }) {
  const wrap = useRef<HTMLDivElement>(null), dots = useRef<Array<SVGCircleElement | null>>([]), clock = useRef(0);
  const [width, setWidth] = useState(compact ? 460 : 860), [hot, setHot] = useState<string | null>(null), [run, setRun] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(280, Math.floor(el.clientWidth)))); ro.observe(el); setWidth(Math.max(280, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  const counts = useMemo(() => steps.map((s) => s.count), [steps]);
  const L = useMemo(() => layoutLadder(steps.map((s) => ({ key: s.key, label: s.label, count: s.count })), { width, compact }), [steps, width, compact]);
  const N = L.narrow || compact ? 28 : 46;
  const paths = useMemo(() => (counts[0] > 0 ? Array.from({ length: N }, (_, j) => { const d = depthOf(j, counts); return { d, pts: pathFor(L, j, d) }; }) : []), [L, counts, N]);
  const animate = !reduced && paths.length > 0;

  useEffect(() => {
    if (!animate) return;
    let raf = 0; const t0 = performance.now(); clock.current = t0;
    const CYCLE = 9000, LIFE = 6500;
    const tick = (now: number) => {
      paths.forEach((p, j) => {
        const el = dots.current[j]; if (!el) return;
        const local = ((now - t0 + (j / paths.length) * CYCLE) % CYCLE), prog = Math.min(1, local / LIFE);
        const pt = along(p.pts, prog);
        const fading = local > LIFE ? Math.max(0, 1 - (local - LIFE) / 1400) : 1;
        el.setAttribute("cx", pt.x.toFixed(1)); el.setAttribute("cy", pt.y.toFixed(1)); el.setAttribute("opacity", (local < 250 ? local / 250 : fading).toFixed(2));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, paths, run]);

  const live = Boolean(onPick);
  const press = (fn: () => void) => !live ? { role: "img" as const, tabIndex: 0, "data-static": "1" } : ({ onClick: fn, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } }, tabIndex: 0, role: "button" as const });
  const total = counts[0] ?? 0;
  if (total <= 0) return <p className="bf-empty" data-testid={`${testId}-empty`}>No new leads in these dates. When leads come in you will see where they stop on the way to a booking.</p>;
  const maxLost = Math.max(1, ...L.leaks.map((k) => k.lost));
  const caption = hot ?? `${fmt(total)} leads came in. ${fmt(counts[counts.length - 1] ?? 0)} were won. ${live ? "Click a step or ribbon to open those leads, or a basin to open the ones that fell." : "Hover a step or basin for its count."}`;

  return (
    <div ref={wrap} className="bf-ladder" data-testid={testId} data-animated={animate ? "1" : "0"}>
      <svg width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} role="group" aria-label="Booking funnel as a staircase. Each step is as wide as the leads that reached it; leads that stop fall into a basin beside the next step.">
        {L.chutes.map((c, i) => {
          const next = steps[i + 1]; if (!next) return <rect key={`c${i}`} x={c.x} y={c.y} width={c.w} height={c.h} className="bf-chute" />;
          const say = `${fmt(next.count)} of ${fmt(steps[i].count)} leads went on from "${steps[i].label}" to "${next.label}".${live ? " Open the list." : ""}`;
          return (
            <g key={`c${i}`} className="bf-ribbon" data-testid={`${testId}-ribbon-${next.key}`} aria-label={say} {...press(() => onPick?.({ step: next.key as StepKey, mode: "reached", title: `Reached: ${next.label}`, count: next.count }))} onMouseEnter={() => setHot(say)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(say)} onBlur={() => setHot(null)}>
              <title>{say}</title>
              <rect x={c.x} y={c.y} width={c.w} height={c.h} className="bf-chute" />
            </g>
          );
        })}
        {L.leaks.map((k, i) => {
          const cur = k.toKey === biggest, label = BASIN[k.toKey] ?? "Stopped here";
          const level = k.lost > 0 ? Math.max(0.12, k.lost / maxLost) : 0, pick = () => onPick?.({ step: k.toKey as StepKey, mode: "dropped", title: label, count: k.lost });
          const say = `${label}: ${fmt(k.lost)} leads${steps[i].count > 0 ? ` (${Math.round((k.lost / steps[i].count) * 100)}% of those that reached the step before)` : ""}.${live ? " Open the list." : ""}`;
          return (
            <g key={`k${i}`} className="bf-basin" data-hot={cur ? "1" : undefined} data-testid={`${testId}-basin-${k.toKey}`} aria-label={say} {...press(pick)} onMouseEnter={() => setHot(say)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(say)} onBlur={() => setHot(null)}>
              <title>{say}</title>
              <path d={`M${k.x0} ${k.y0} Q${k.cx} ${k.cy} ${k.x1} ${k.y1}`} className="bf-stream" strokeWidth={k.stream} fill="none" />
              <rect x={k.basin.x} y={k.basin.y} width={k.basin.w} height={k.basin.h} rx={8} className="bf-basin-box" />
              <rect x={k.basin.x + 1} y={k.basin.y + k.basin.h - 1 - (k.basin.h - 2) * level} width={k.basin.w - 2} height={Math.max(0, (k.basin.h - 2) * level)} rx={7} className="bf-basin-fill" />
              <text x={k.basin.x + 10} y={k.basin.y + (compact || L.narrow ? 14 : 18)} className="bf-basin-n">{fmt(k.lost)}</text>
              <text x={k.basin.x + 10} y={k.basin.y + k.basin.h - (compact || L.narrow ? 5 : 8)} className="bf-basin-t">{L.narrow ? SHORT[k.toKey] ?? cut(label, 14) : cut(label, 26)}</text>
              {cur && <text x={k.basin.x + k.basin.w - 8} y={k.basin.y + (compact || L.narrow ? 14 : 18)} textAnchor="end" className="bf-tag">{L.narrow ? "top" : "biggest leak"}</text>}
            </g>
          );
        })}
        {L.steps.map((s, i) => {
          const row = steps[i], inside = s.w >= 190, pick = () => onPick?.({ step: s.key as StepKey, mode: "reached", title: `Reached: ${row.label}`, count: row.count });
          const say = `${row.label}: ${fmt(row.count)} leads${row.passPct !== null ? `, ${row.passPct}% of the step before` : ""}.${live ? " Open the list." : ""}`;
          const tx = inside ? s.x + 12 : L.narrow ? s.x + 8 : s.x + s.w + 10, halo = !inside && L.narrow;
          return (
            <g key={s.key} className="bf-step" data-testid={`${testId}-step-${s.key}`} aria-label={say} {...press(pick)} onMouseEnter={() => setHot(say)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(say)} onBlur={() => setHot(null)}>
              <title>{say}</title>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={7} className="bf-ledge" data-last={i === L.steps.length - 1 ? "1" : undefined} />
              <text x={tx} y={s.y + s.h / 2 - 2} className={inside ? "bf-step-l bf-on" : halo ? "bf-step-l bf-halo" : "bf-step-l"}>{row.label}</text>
              <text x={tx} y={s.y + s.h / 2 + (compact || L.narrow ? 12 : 15)} className={inside ? "bf-step-n bf-on" : halo ? "bf-step-n bf-halo" : "bf-step-n"}>{fmt(row.count)}{row.passPct !== null ? <tspan className="bf-step-p">{`  ${row.passPct}% pass`}</tspan> : null}</text>
            </g>
          );
        })}
        {animate ? paths.map((p, j) => <circle key={j} ref={(el) => { dots.current[j] = el; }} r={L.narrow ? 2.4 : 3} className="bf-dot" data-fate={p.d >= steps.length - 1 ? "won" : "fell"} cx={p.pts[0].x} cy={p.pts[0].y} opacity={0} />) : paths.map((p, j) => { const e = p.pts[p.pts.length - 1]; return <circle key={j} r={L.narrow ? 2.4 : 3} className="bf-dot" data-fate={p.d >= steps.length - 1 ? "won" : "fell"} cx={e.x + ((j % 7) - 3) * 3} cy={Math.min(e.y, e.y - (j % 3) * 2)} opacity={0.9} />; })}
      </svg>
      <div className="bf-ladder-foot">
        <p className="bf-caption" role="status" aria-live="polite">{caption}</p>
        {!reduced && <button type="button" className="s6-btn bf-replay" onClick={() => setRun((n) => n + 1)} data-testid={`${testId}-replay`}><RotateCcw aria-hidden className="size-4" />Replay</button>}
      </div>
    </div>
  );
}
