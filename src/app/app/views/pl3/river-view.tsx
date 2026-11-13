"use client";

import { useMemo, useRef, useState } from "react";
import type React from "react";
import { centerPath, particleCounts, ribbonPath, riverLayout, type Pt } from "@/lib/design/river-layout";
import { dotLegend, dotsFor, dotUnit, pileGrid, wrapLabel } from "@/lib/design/funnel-dots";
import type { ReplayMover } from "@/lib/design/river-replay";
import type { PathStep } from "@/lib/design/flow-paths";
import type { PlStage } from "@/lib/analytics/pipeline3-types-interim";
import { money, moneyShort } from "./format";

// THE RIVER. Cash (or dots, when no deal has a dollar value) flows through the stages as ribbons, piles up where deals sit,
// stops and turns ochre where deals are stuck, drains into a muted channel when lost, and lands in the vault (Won).
// Drawn from per-stage totals only (never rows), so it is fast with 100k deals. Text lives in SVG text with a halo; every pile, ribbon and drain is a button.

export type RiverProps = {
  stages: PlStage[]; wonCount: number; wonCents: number; counts: boolean; enough: boolean; width: number;
  settle: boolean; runKey: number; reduced: boolean;
  /** Replay: the deals that moved on the day being shown (cards slide between piles for `flyMs`). Absent when not replaying. */
  movers?: ReplayMover[]; moverKey?: string; flyMs?: number;
  onStage: (s: PlStage, stale?: boolean) => void; onNoValue: (s: PlStage) => void; onWon: () => void; onLostFrom: (s: PlStage) => void;
  /** What each ribbon says and opens ("53 of 57 moved on (93%)"), one per ribbon, counted by the same rule as the list behind the click. Absent (loading, replaying, no data): the ribbons carry no label and open nothing. */
  steps?: Array<PathStep | undefined>; onPath?: (s: PathStep) => void;
};
type Tip = { x: number; y: number; title: string; lines: string[] };

const NODE_W = 34;

export function River(p: RiverProps) {
  const { stages, counts, enough, width, settle, reduced } = p;
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const n = stages.length;
  const vertical = width < 640 || (n + 1) * 84 > width;
  const unit = (v: number) => (counts ? `${v.toLocaleString("en-US")} ${v === 1 ? "deal" : "deals"}` : money(v));
  const unitShort = (v: number) => (counts ? `${v.toLocaleString("en-US")} ${v === 1 ? "deal" : "deals"}` : moneyShort(v));
  const noVal = (s: PlStage) => (s.noValueCount ?? 0);

  const geo = useMemo(() => {
    const ins = stages.map((s) => ({ id: s.id, name: s.name, open: counts ? s.count + noVal(s) : s.valueCents, stuck: counts ? s.staleCount : s.staleValueCents, lost: counts ? s.lostCount : s.lostValueCents }));
    const won = counts ? p.wonCount : p.wonCents;
    if (vertical) {
      const pitch = 104, T = Math.max(200, width - 12), L = n * pitch + NODE_W;
      return { L: riverLayout(ins, won, { length: L, thick: T, nodeW: NODE_W, enough }), vertical: true, w: width, h: 34 + L + 56, T, off: 34 };
    }
    const T = Math.max(220, Math.min(320, Math.round(width * 0.3))), off = 70;
    return { L: riverLayout(ins, won, { length: width - 24, thick: T, nodeW: NODE_W, enough }), vertical: false, w: width, h: off + T + 64, T, off };
  }, [stages, counts, enough, width, vertical, p.wonCount, p.wonCents, n]);

  const L = geo.L;
  if (L.empty) return null;
  const pt: Pt = vertical ? (al, ac) => [ac + 6, al + geo.off] : (al, ac) => [al + 12, ac + geo.off];
  // A rectangle given in (along, across) terms, as x/y/width/height.
  const R = (al: number, ac: number, dl: number, da: number) => { const [x, y] = pt(al, ac); return vertical ? { x, y, width: da, height: dl } : { x, y, width: dl, height: da }; };

  const show = (e: React.PointerEvent | React.FocusEvent, title: string, lines: string[]) => {
    const w = wrap.current; if (!w) return;
    const b = w.getBoundingClientRect();
    let x: number, y: number;
    if ("clientX" in e && e.clientX) { x = e.clientX - b.left; y = e.clientY - b.top; }
    else { const r = (e.currentTarget as Element).getBoundingClientRect(); x = r.left - b.left + r.width / 2; y = r.top - b.top + r.height / 2; }
    setTip({ x: Math.max(8, Math.min(b.width - 8, x)), y, title, lines });
  };
  const hover = (title: string, lines: string[]) => ({ onPointerMove: (e: React.PointerEvent) => show(e, title, lines), onPointerEnter: (e: React.PointerEvent) => show(e, title, lines), onPointerLeave: () => setTip(null), onFocus: (e: React.FocusEvent) => show(e, title, lines), onBlur: () => setTip(null) });
  const press = (fn: () => void) => ({ onClick: fn, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } }, tabIndex: 0, role: "button" as const });

  const stageTip = (s: PlStage): string[] => {
    const a = [counts ? `${(s.count + noVal(s)).toLocaleString("en-US")} open deals` : `${s.count.toLocaleString("en-US")} open deals worth ${money(s.valueCents)}`];
    if (!counts && noVal(s) > 0) a.push(`${noVal(s)} more without a value`);
    if (counts && noVal(s) > 0) a.push("No dollar value on these yet");
    a.push(s.medianDwellDays !== null ? `Average ${Math.round(s.medianDwellDays * 10) / 10} days in this stage` : "Average days: not enough history yet");
    if (s.staleCount > 0) a.push(`${s.staleCount} stuck longer than this stage's normal`);
    if (s.lostCount > 0) a.push(`${s.lostCount} left from here`);
    return a;
  };
  // ONE scale for every pile: tiny dots, never one shape per deal. One dot is one deal (or $1) until the whole picture would pass the dot cap, then the scale steps up and the legend says so.
  const scaleOf = (nd: { open: number }) => (counts ? nd.open : nd.open / 100);
  const cardUnit = dotUnit(L.nodes.map(scaleOf));
  const legend = dotLegend(cardUnit, !counts);
  const dls = particleCounts(L.links.map((l) => l.th), 60);
  const animate = settle && !reduced;
  const leakTail = L.tails.find((t) => t.leak);

  return (
    <div className="rv-wrap" ref={wrap} data-testid="pl-river" data-dir={vertical ? "v" : "h"} data-measure={counts ? "count" : "money"}>
      <svg className="rv-svg" width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} role="group" aria-label={counts ? "River of deals by stage" : "River of money by stage"} data-settle={animate ? "1" : "0"} key={`r${p.runKey}`}>
        <defs>
          <pattern id="rv-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" className="rv-hatch-bg" /><rect width="1.6" height="5" className="rv-hatch-line" /></pattern>
        </defs>
        {L.links.map((l, i) => {
          const s = stages[l.from], to = L.nodes[l.to].kind === "won" ? null : stages[l.to];
          const mid = pt((l.al0 + l.al1) / 2, (l.ac0 + l.ac1) / 2 + l.th / 2);
          // The label and the click come from ONE count (the server's, by the rule of the list that opens): "X of Y moved on", and the click opens exactly those X deals.
          const ps = p.steps?.[l.from] && p.onPath ? p.steps[l.from] : null, canOpen = !!ps && ps.toN > 0;
          const nm = `${s.name} to ${to ? to.name : "Won"}`;
          const lines = ps
            ? [`${ps.toN.toLocaleString("en-US")} of ${ps.fromN.toLocaleString("en-US")} deals that got to ${s.name} are now past it${ps.pct ? ` (${ps.pct})` : ""}`,
              `${ps.stillHere.toLocaleString("en-US")} still in ${s.name}, ${ps.lostHere.toLocaleString("en-US")} lost there`,
              ...(counts ? [] : [`${money(ps.toCents)} of ${money(ps.fromCents)} in money`]),
              canOpen ? "Click to open exactly those deals" : "Nothing got past this step in these dates"]
            : [`${unit(l.amount)} got as far as ${to ? to.name : "Won"}`];
          const label = ps ? `${nm}: ${ps.label}. ${canOpen ? "Open the deals." : "Nothing to open."}` : nm;
          return <g key={`l${i}`} className="rv-link" data-open={canOpen ? "1" : "0"} {...hover(nm, lines)} {...(canOpen ? press(() => p.onPath?.(ps as PathStep)) : {})} aria-label={label} data-testid={`pl-link-${i}`}>
            <path className="rv-ribbon" d={ribbonPath(l.al0, l.ac0, l.th, l.al1, l.ac1, l.th, pt)} style={{ animationDelay: `${i * 160}ms` }} />
            <path className="rv-flow" d={centerPath(l, pt)} style={{ strokeWidth: Math.max(1.5, Math.min(4, l.th / 6)) }} />
            {ps && ps.fromN > 0 && <g className="rv-conv" transform={`translate(${mid[0]} ${mid[1]})`} data-testid={`pl-link-label-${i}`}><rect x={-40} y={-15} width={80} height={30} rx={12} /><text textAnchor="middle" y={-2}>{ps.short[0]}</text><text textAnchor="middle" y={10} className="rv-conv-sub">{ps.short[1]}</text></g>}
          </g>;
        })}
        {L.tails.map((t) => {
          const s = stages[t.from], d = ribbonPath(t.al0, t.ac0, t.th, t.al1, t.ac1, Math.max(1, t.th * 0.3), pt);
          const lines = [`${unit(t.amount)} lost from ${s.name}`, "Click to open exactly those deals"];
          return <g key={`t${t.from}`} className={`rv-tail${t.leak ? " rv-leak" : ""}`} {...hover(`Lost from ${s.name}`, lines)} {...press(() => p.onLostFrom(s))} aria-label={`Lost from ${s.name}: ${lines[0]}. Open them.`} data-testid={`pl-tail-${t.from}`}>
            <path className="rv-drain" d={d} />
          </g>;
        })}
        {L.nodes.map((nd) => {
          const s = nd.kind === "stage" ? stages[nd.index] : null;
          const top = nd.ac + nd.flowH, dots = dotsFor(scaleOf(nd), cardUnit), grid = pileGrid(dots, nd.w, nd.openH), rows = grid.rows, step = grid.step;
          const stuckDots = nd.kind === "stage" && nd.open > 0 && nd.stuck > 0 && dots > 0 ? Math.min(dots, Math.max(1, Math.round((dots * nd.stuck) / nd.open))) : 0;
          const stuckRows = stuckDots ? rows - Math.floor((dots - stuckDots) / grid.cols) : 0;
          // A pile with nothing in it opens nothing, so it is not a button. An empty Won column is an empty vault, with no card drawn in it.
          const nothing = nd.open <= 0, emptyVault = nd.kind === "won" && nothing;
          const tipLines = s ? stageTip(s) : emptyVault ? ["No wins in these dates"] : [`${unit(nd.open)} won`, "Landed in the vault"];
          const label = s ? `${s.name}: ${tipLines.join(". ")}.${nothing ? "" : " Open them."}` : emptyVault ? "Won: No wins in these dates." : `Won: ${tipLines[0]}. Open them.`;
          const go = s ? () => (counts && s.count === 0 && noVal(s) > 0 ? p.onNoValue(s) : p.onStage(s)) : p.onWon;
          const base = nd.kind === "won" ? nd.ac : top;
          if (emptyVault) {
            const [vx, vy] = pt(nd.al + nd.w / 2, base + 14);
            return <g key={nd.id} className="rv-node rv-won rv-emptyvault" {...hover("Won", tipLines)} tabIndex={0} role="img" aria-label={label} data-testid="pl-vault" data-empty="1">
              <g transform={`translate(${vx} ${vy})`} aria-hidden><rect x={-15} y={-14} width={30} height={28} rx={4} className="rv-vault-door" /><circle r={6} className="rv-vault-dial" /><path d="M0 -6v-3M0 6v3M-6 0h-3M6 0h3" className="rv-vault-dial" /></g>
            </g>;
          }
          return <g key={nd.id} className={`rv-node rv-${nd.kind}`} data-open={nothing ? "0" : "1"} {...hover(s ? s.name : "Won", tipLines)} {...(nothing ? {} : press(go))} aria-label={label} data-testid={nd.kind === "won" ? "pl-vault" : `pl-seg-${nd.id}`}>
            {rows > 0 && <rect className="rv-slot" {...R(nd.al, base, nd.w, rows * step + 2)} rx={3} />}
            {dots > 0 && <g className={`rv-dots${counts ? " rv-dots-deals" : ""}`} aria-hidden>
              {Array.from({ length: dots }, (_, i) => {
                const c = i % grid.cols, r = Math.floor(i / grid.cols), bad = i >= dots - stuckDots;
                const [cx, cy] = pt(nd.al + (nd.w - grid.cols * step) / 2 + step / 2 + c * step, base + r * step + step / 2);
                return <circle key={i} className={bad ? "rv-dot rv-dot-stuck" : "rv-dot"} cx={cx} cy={cy} r={grid.r} style={{ animationDelay: `${Math.min(900, 100 + r * 22)}ms` }} />;
              })}
            </g>}
            {stuckRows > 0 && <rect className="rv-stuckmark" {...R(nd.al, base + (rows - stuckRows) * step, nd.w, stuckRows * step)} fill="url(#rv-hatch)" rx={2} pointerEvents="none" />}
            {stuckRows > 0 && s && <rect className="rv-stuckhit" {...R(nd.al, base + (rows - stuckRows) * step, nd.w, stuckRows * step)} fill="transparent" onClick={(e) => { e.stopPropagation(); p.onStage(s, true); }} onKeyDown={(e) => e.stopPropagation()} aria-label={`${s.staleCount} stuck deals in ${s.name}. Open them.`} data-testid={`pl-stuck-${nd.id}`}><title>{`${s.staleCount} stuck in ${s.name}`}</title></rect>}
            {stuckRows > 0 && (() => { const [x, y] = pt(nd.al + nd.w / 2, base + (rows - stuckRows) * step); return <g className="rv-stop" transform={`translate(${x} ${y})`} aria-hidden><rect x={-6} y={-8} width={12} height={14} rx={3} /><path d="M-2.5 -5v8M2.5 -5v8" /></g>; })()}
            {nd.kind === "won" && !nothing && <rect className="rv-vault" {...R(nd.al - 2, nd.ac - 2, nd.w + 4, Math.max(rows * step + 2, 14) + 4)} rx={4} fill="none" pointerEvents="none" />}
          </g>;
        })}
        {L.nodes.map((nd) => {
          const s = nd.kind === "stage" ? stages[nd.index] : null, x = pt(nd.al + nd.w / 2, 0)[0];
          const noWins = !s && nd.open === 0;
          const name = s ? s.name : "Won", val = noWins ? (vertical ? "No wins in these dates" : "No wins") : unitShort(nd.open), sub = s ? `${nd.stuck > 0 ? `${s.staleCount} stuck` : ""}` : noWins && !vertical ? "in these dates" : "";
          if (vertical) { const ly = pt(nd.al, 0)[1]; return <text key={`x${nd.id}`} className="rv-text" x={6} y={ly - 9}><tspan className="rv-name">{name}</tspan><tspan className="rv-val" dx={8}>{val}</tspan>{sub && <tspan className="rv-stucktxt" dx={8}>{sub}</tspan>}<title>{`${name}: ${val}`}</title></text>; }
          return <text key={`x${nd.id}`} className="rv-text" x={x} y={16} textAnchor="middle">{wrapLabel(name, Math.max(7, Math.floor((width - 24) / (n * 7.2)))).map((ln, li) => <tspan key={li} className="rv-name" x={x} dy={li === 0 ? 0 : 12}>{ln}</tspan>)}<tspan className="rv-val" x={x} dy={17}>{val}</tspan>{sub && <tspan className="rv-stucktxt" x={x} dy={14}>{sub}</tspan>}<title>{`${name}: ${val}`}</title></text>;
        })}
        {leakTail && enough && (() => {
          const [x, y] = pt(leakTail.al1, leakTail.ac1 + 4), s = stages[leakTail.from];
          return <g className="rv-leaktag" transform={`translate(${vertical ? Math.min(x, geo.w - 118) : Math.min(x - 40, geo.w - 130)} ${y + 6})`} {...press(() => p.onLostFrom(s))} aria-label={`Biggest leak: ${unit(leakTail.amount)} left from ${s.name}. Open them.`} data-testid="pl-leaktag"><rect width={126} height={22} rx={11} /><text x={63} y={15} textAnchor="middle">Biggest leak: {unitShort(leakTail.amount)}</text></g>;
        })()}
        {!reduced && p.movers && p.movers.length > 0 && (() => {
          const dur = Math.max(0.25, ((p.flyMs ?? 900) / 1000) * 0.9);
          const topOf = (i: number) => L.nodes[i].ac + L.nodes[i].flowH + 6;
          const out: React.ReactNode[] = [];
          p.movers.forEach((m, mi) => {
            for (let k = 0; k < m.n; k++) {
              const fromN = m.from !== null ? L.nodes[m.from] : null, toN = m.to === "won" ? L.nodes[n] : m.to === "lost" ? null : L.nodes[m.to];
              if (m.from !== null && !fromN) continue;
              const a = fromN ? pt(fromN.al + fromN.w, topOf(m.from as number)) : pt(toN?.al ?? 0, (toN?.ac ?? 0) - 24);
              const lostTail = m.to === "lost" && m.from !== null ? L.tails.find((t) => t.from === m.from) : null;
              const b = toN ? pt(toN.al, m.to === "won" ? toN.ac + 6 : topOf(m.to as number)) : lostTail ? pt(lostTail.al1, lostTail.ac1) : fromN ? pt(fromN.al + fromN.w + 24, fromN.ac + fromN.h + 24) : a;
              const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, d = `M${a[0]} ${a[1]} Q${vertical ? a[0] : mx} ${vertical ? my : a[1]} ${b[0]} ${b[1]}`;
              const begin = ((mi * 0.07 + k * 0.1) % (dur * 0.5)).toFixed(2);
              out.push(<g key={`m${p.moverKey}-${mi}-${k}`} opacity={0} aria-hidden>
                <rect className={`rv-fly${m.to === "lost" ? " rv-fly-lost" : m.to === "won" ? " rv-fly-won" : ""}`} x={-6} y={-4} width={12} height={8} rx={1.6} />
                <animateMotion path={d} dur={`${dur}s`} begin={`${begin}s`} fill="freeze" />
                <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur={`${dur}s`} begin={`${begin}s`} fill="freeze" />
              </g>);
            }
          });
          return out;
        })()}
        {animate && L.links.flatMap((l, i) => Array.from({ length: dls[i] }, (_, k) => {
          const dur = 2.4, begin = (i * 0.35 + k * (dur / Math.max(1, dls[i]))).toFixed(2);
          return <g key={`b${i}-${k}`} opacity={0} aria-hidden>
            <rect className="rv-fly" x={-5} y={-3} width={10} height={6} rx={1.2} />
            <animateMotion path={centerPath(l, pt)} dur={`${dur}s`} begin={`${begin}s`} repeatCount="2" fill="freeze" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.85;1" dur={`${dur}s`} begin={`${begin}s`} repeatCount="2" />
          </g>;
        }))}
      </svg>
      <p className="rv-legend" data-testid="pl-legend" data-unit={cardUnit}>{legend}. Piles show what is there now; the ribbons show how much reached each step.</p>
      {tip && <div className="rv-tip" role="tooltip" style={{ left: tip.x, top: tip.y }} data-testid="pl-tip"><b>{tip.title}</b>{tip.lines.map((t, i) => <span key={i}>{t}</span>)}</div>}
    </div>
  );
}
