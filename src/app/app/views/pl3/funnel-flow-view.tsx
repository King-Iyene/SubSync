"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type React from "react";
import { breakdown, closedDeals, dealsText, lostTotal, pathSteps, pctText, winTimeText, type FlowPaths, type PathSeg } from "@/lib/design/flow-paths";
import { funnelFlowLayout, measuresOf, type Measure } from "@/lib/design/funnel-flow-layout";
import { bandText, dotOffset, HOW_TO_READ, initials, LEAK_LINE, LEAK_NEEDS, particlePlan } from "@/lib/design/funnel-fx";
import { ribbonPath, centerPath, type Pt } from "@/lib/design/river-layout";
import { money, moneyShort } from "./format";

// FUNNEL FLOW. A Sankey-style funnel: each step's band is as thick as the deals (or money) that GOT to it, the funnel narrows step by step, deals that fall out leave upward (lost) or wait
// in their step (downward, striped orange when stuck), and at the end it splits like a Y into Won and Lost. Under it: how to read it, where deals are lost, and who actually won.
// Drawn from per-step totals only (never rows), so it is as fast at 100k deals as at 10. Every band, lost branch and breakdown segment is a button that opens exactly its deals; the number
// on it and the rows behind it are counted by the same rule (see flow-paths.ts and flowReachCond).
// EFFECTS (funnel-fx.ts has the rules): reveal wipe, flow dots (capped at 60, paused when hidden or off screen), counters, hover lift, stuck shimmer, leak ring, won shine, winner chips.
// Pure SVG and CSS. With reduced motion everything is still, with the same numbers.

export type FunnelFlowProps = {
  paths: FlowPaths; measure: Measure; width: number; reduced: boolean; settle: boolean;
  /** True for the made-up SAMPLE: nothing opens. */ sample?: boolean;
  /** Deals that got to step `index` or further (index = number of steps means Won). */ onReach: (index: number) => void;
  onWaiting: (index: number, stuck: boolean) => void; onLost: (index: number) => void; onLostAll: () => void;
  onWon: () => void; onWonBy: (kind: "owner" | "source", seg: PathSeg) => void;
};
type Tip = { x: number; y: number; title: string; lines: string[] };
const NODE_W = 34, PAD = 48;
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);
const nf = (v: number) => v.toLocaleString("en-US");
/** Colours for the stacked "who won" bars and chips: the theme's own chart colours, so it works in light and dark. */
const SEG = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** A figure that ticks up the first time it is drawn (about a second). With `on` false it just shows the number. */
function Count({ to, fmt, on }: { to: number; fmt: (v: number) => string; on: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!on) return;
    let raf = 0, t0 = 0;
    const step = (t: number) => { if (!t0) t0 = t; const p = Math.min(1, (t - t0) / 1000); setV(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, on]);
  return <>{fmt(on ? v : to)}</>;
}

export function FunnelFlow(p: FunnelFlowProps) {
  const { paths, measure, width, reduced } = p;
  const dealsMode = measure === "deals", wrap = useRef<HTMLDivElement>(null), svgRef = useRef<SVGSVGElement>(null);
  const [tip, setTip] = useState<Tip | null>(null), [hot, setHot] = useState<string | null>(null), [active, setActive] = useState(true);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, ""), ref = (n: string) => `url(#ff${uid}-${n})`;
  const k = paths.stages.length, vertical = width < 640;
  const steps = useMemo(() => pathSteps(paths, dealsMode), [paths, dealsMode]);
  const closed = closedDeals(paths), enough = closed >= paths.minDeals, lostAll = lostTotal(paths);
  const fmt = (v: number) => (dealsMode ? dealsText(v) : money(v)), fmtShort = (v: number) => (dealsMode ? nf(v) : moneyShort(v));
  const m = useMemo(() => measuresOf(paths, measure), [paths, measure]);
  const geo = useMemo(() => {
    if (vertical) { const pitch = 96, T = Math.max(180, width - PAD - 12), L = k * pitch + NODE_W; return { L: funnelFlowLayout(paths, measure, { length: L, thick: T, nodeW: NODE_W, enough }), h: 34 + L + 40, off: 34 }; }
    const T = Math.max(200, Math.min(300, Math.round(width * 0.28))), off = 62 + PAD;
    return { L: funnelFlowLayout(paths, measure, { length: width - 24, thick: T, nodeW: NODE_W, enough }), h: off + T + 40, off };
  }, [paths, measure, enough, width, vertical, k]);
  const L = geo.L;
  // Dots: how many per band and how fast (funnel-fx.ts). None with reduced motion.
  const plan = useMemo(() => (reduced ? L.links.map(() => ({ count: 0, dur: 0, size: 0 })) : particlePlan(L.links.map((l) => l.th))), [L, reduced]);

  // Pause every moving thing when the tab is hidden or the funnel is scrolled out of view.
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    let seen = true;
    const apply = () => setActive(seen && !document.hidden);
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((es) => { seen = es[es.length - 1]?.isIntersecting ?? true; apply(); });
    io?.observe(el); document.addEventListener("visibilitychange", apply);
    return () => { io?.disconnect(); document.removeEventListener("visibilitychange", apply); };
  }, []);
  useEffect(() => { const s = svgRef.current; if (!s || typeof s.pauseAnimations !== "function") return; if (active) s.unpauseAnimations(); else s.pauseAnimations(); }, [active, L]);

  if (L.empty) return <p className="ap-fine" data-testid="ff-empty">Nothing reached this pipeline in these dates, so there is no funnel to draw.</p>;
  const pt: Pt = vertical ? (al, ac) => [ac + PAD, al + geo.off] : (al, ac) => [al + 12, ac + geo.off];
  const R = (al: number, ac: number, dl: number, da: number) => { const [x, y] = pt(al, ac); return vertical ? { x, y, width: da, height: dl } : { x, y, width: dl, height: da }; };

  const show = (e: React.PointerEvent | React.FocusEvent, title: string, lines: string[]) => {
    const w = wrap.current; if (!w) return;
    const b = w.getBoundingClientRect();
    let x: number, y: number;
    if ("clientX" in e && e.clientX) { x = e.clientX - b.left; y = e.clientY - b.top; }
    else { const r = (e.currentTarget as Element).getBoundingClientRect(); x = r.left - b.left + r.width / 2; y = r.top - b.top + r.height / 2; }
    setTip({ x: Math.max(8, Math.min(b.width - 8, x)), y, title, lines });
  };
  const hover = (key: string, title: string, lines: string[]) => ({ onPointerMove: (e: React.PointerEvent) => show(e, title, lines), onPointerEnter: (e: React.PointerEvent) => { setHot(key); show(e, title, lines); }, onPointerLeave: () => { setTip(null); setHot(null); }, onFocus: (e: React.FocusEvent) => { setHot(key); show(e, title, lines); }, onBlur: () => { setTip(null); setHot(null); } });
  const press = (fn: () => void) => ({ onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn(); }, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); fn(); } }, tabIndex: 0, role: "button" as const });
  const go = (can: boolean, fn: () => void) => (can && !p.sample ? press(fn) : {});
  const pctOf = (a: number, b: number) => (enough ? pctText(a, b) : null);
  const leak = L.leakIndex;
  const animate = p.settle && !reduced, motion = !reduced;
  const leakStage = leak !== null && enough ? paths.stages[leak] : null;
  // Gradients run along the funnel (left to right, or top to bottom on a phone).
  const gv = vertical ? { x1: 0, y1: 0, x2: 0, y2: 1 } : { x1: 0, y1: 0, x2: 1, y2: 0 };
  const chipW = Math.max(64, Math.min(132, Math.floor((width - 24) / (k + 1)) - 8));

  return (
    <div className="ff-wrap" ref={wrap} data-testid="pl-funnelflow" data-dir={vertical ? "v" : "h"} data-measure={measure} data-paused={active ? "0" : "1"} data-motion={motion ? "1" : "0"}>
      <svg ref={svgRef} className="rv-svg ff-svg" width={width} height={geo.h} viewBox={`0 0 ${width} ${geo.h}`} role="group" aria-label={dealsMode ? "Funnel of deals by step, ending in won and lost" : "Funnel of money by step, ending in won and lost"} data-settle={animate ? "1" : "0"} data-hot={hot ?? undefined}>
        <defs>
          <pattern id={`ff${uid}-hatch`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" className="rv-hatch-bg" /><rect width="1.6" height="5" className="rv-hatch-line" /></pattern>
          <linearGradient id={`ff${uid}-band`} {...gv}><stop offset="0" className="ff-s-band0" /><stop offset="1" className="ff-s-band1" /></linearGradient>
          <linearGradient id={`ff${uid}-bandwon`} {...gv}><stop offset="0" className="ff-s-band1" /><stop offset="1" className="ff-s-gold" /></linearGradient>
          <linearGradient id={`ff${uid}-lost`} {...gv}><stop offset="0" className="ff-s-ember" /><stop offset="1" className="ff-s-ember" style={{ stopOpacity: 0.05 }} /></linearGradient>
          <linearGradient id={`ff${uid}-gate`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="ff-s-gate0" /><stop offset="1" className="ff-s-gate1" /></linearGradient>
          <linearGradient id={`ff${uid}-gold`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="ff-s-gold" /><stop offset="1" className="ff-s-gold2" /></linearGradient>
          <linearGradient id={`ff${uid}-shine`} {...gv}>
            <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.5" stopColor="#fff" stopOpacity="0.85" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
            {motion && <><animate attributeName={vertical ? "y1" : "x1"} from="-0.7" to="1" dur="1.8s" begin="1.6s" repeatCount="2" /><animate attributeName={vertical ? "y2" : "x2"} from="0" to="1.7" dur="1.8s" begin="1.6s" repeatCount="2" /></>}
          </linearGradient>
          <filter id={`ff${uid}-blur`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter>
          <filter id={`ff${uid}-dot`} x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="1.6" /></filter>
          <clipPath id={`ff${uid}-reveal`}><rect className={animate ? "ff-wipe" : undefined} x={-20} y={-20} width={width + 40} height={geo.h + 40} /></clipPath>
        </defs>
        <g clipPath={ref("reveal")} data-vertical={vertical ? "1" : "0"}>
          {L.links.map((l) => {
            const st = steps[l.from], to = st.toId === "won" ? "Won" : st.toName, toWon = st.toId === "won";
            const can = st.toN > 0, mid = pt((l.al0 + l.al1) / 2, (l.ac0 + l.ac1) / 2 + l.th / 2), pc = pctOf(st.toN, st.fromN);
            const first = bandText({ toN: st.toN, fromN: st.fromN, pct: pc, moneyText: dealsMode ? null : `${moneyShort(st.toCents)} of ${moneyShort(st.fromCents)}` });
            const lines = [first, `${nf(st.stillHere)} still in ${st.fromName}, ${nf(st.lostHere)} lost there`, can ? "Click to open exactly those deals" : "Nothing got past this step in these dates"];
            const d = ribbonPath(l.al0, l.ac0, l.th, l.al1, l.ac1, l.th, pt), key = `l${l.from}`;
            return <g key={key} className="rv-link ff-band ff-item" data-open={can && !p.sample ? "1" : "0"} data-on={hot === key ? "1" : undefined} {...hover(key, `${st.fromName} to ${to}`, lines)} {...go(can, () => p.onReach(l.to))} aria-label={`${st.fromName} to ${to}: ${lines.slice(0, 2).join(". ")}${can ? ". Open the deals." : ""}`} data-testid={`ff-band-${l.from}`}>
              <path className="ff-glow" d={d} filter={ref("blur")} />
              <path className="ff-ribbon" d={d} fill={toWon ? ref("bandwon") : ref("band")} />
              <path className="rv-flow ff-spine" d={centerPath(l, pt)} style={{ strokeWidth: Math.max(1.5, Math.min(4, l.th / 6)) }} />
              {st.fromN > 0 && <g className="rv-conv" transform={`translate(${mid[0]} ${mid[1]})`} data-testid={`ff-band-label-${l.from}`}><rect x={-40} y={-15} width={80} height={30} rx={12} /><text textAnchor="middle" y={-2}>{st.short[0]}</text><text textAnchor="middle" y={10} className="rv-conv-sub">{pc ? `moved on ${pc}` : "moved on"}</text></g>}
            </g>;
          })}
          {L.tails.map((t) => {
            const s = paths.stages[t.from], d = ribbonPath(t.al0, t.ac0, t.th, t.al1, t.ac1, Math.max(1, t.th * 0.3), pt), can = s.lost > 0, key = `t${t.from}`;
            const lines = [`${nf(s.lost)} lost in ${s.name}${dealsMode ? "" : `, ${money(s.lostCents)}`}`, pctOf(s.lost, steps[t.from].fromN) ? `${pctOf(s.lost, steps[t.from].fromN)} of the deals that got to ${s.name}` : "The % shows once enough deals are closed", "Click to open exactly those deals"];
            return <g key={key} className={`rv-tail ff-item${t.leak ? " rv-leak" : ""}`} data-open={can && !p.sample ? "1" : "0"} data-on={hot === key ? "1" : undefined} {...hover(key, `Lost in ${s.name}`, lines)} {...go(can, () => p.onLost(t.from))} aria-label={`Lost in ${s.name}: ${lines.slice(0, 2).join(". ")}. Open them.`} data-testid={`ff-tail-${t.from}`}>
              <path className="ff-drain" d={d} fill={ref("lost")} />
            </g>;
          })}
          {L.nodes.map((nd) => {
            const s = nd.kind === "stage" ? paths.stages[nd.index] : null, key = `n${nd.index}`;
            const reachN = s ? steps[nd.index].fromN : paths.won.n, canReach = reachN > 0;
            const tipLines = s
              ? [`${nf(reachN)} deals got to ${s.name}`, `${nf(steps[nd.index].toN)} moved on, ${nf(s.lost)} lost here, ${nf(steps[nd.index].stillHere)} still here${s.stuck > 0 ? ` (${nf(s.stuck)} stuck too long)` : ""}`, canReach ? "Click to open exactly those deals" : "Nothing here in these dates"]
              : [paths.won.n > 0 ? `${nf(paths.won.n)} won${dealsMode ? "" : `, ${money(paths.won.cents)}`}` : "No wins in these dates"];
            const wonEmpty = !s && paths.won.n === 0;
            return <g key={nd.id} className={`rv-node ff-node ff-item rv-${nd.kind}`} data-open={canReach && !p.sample ? "1" : "0"} data-on={hot === key ? "1" : undefined} {...hover(key, nd.name, tipLines)} {...(wonEmpty ? {} : go(canReach, () => (s ? p.onReach(nd.index) : p.onWon())))} aria-label={`${nd.name}: ${tipLines.join(". ")}`} data-testid={s ? `ff-node-${nd.index}` : "ff-won"}>
              {!wonEmpty && <rect className={s ? "ff-bar" : "ff-bar ff-bar-won"} {...R(nd.al, nd.ac, nd.w, nd.h)} rx={6} fill={s ? ref("gate") : ref("gold")} />}
              {!s && !wonEmpty && motion && <rect className="ff-shine" {...R(nd.al, nd.ac, nd.w, nd.h)} rx={6} fill={ref("shine")} pointerEvents="none" />}
              {wonEmpty && (() => { const [vx, vy] = pt(nd.al + nd.w / 2, nd.ac + 14); return <g transform={`translate(${vx} ${vy})`} aria-hidden className="rv-emptyvault"><rect x={-15} y={-14} width={30} height={28} rx={4} className="rv-vault-door" /><circle r={6} className="rv-vault-dial" /><path d="M0 -6v-3M0 6v3M-6 0h-3M6 0h3" className="rv-vault-dial" /></g>; })()}
              {s && nd.waitH > 0 && <rect className="ff-wait" {...R(nd.al, nd.waitAc, nd.w, nd.waitH)} />}
              {s && nd.stuckH > 0 && <rect className="rv-stuckmark ff-stuck" {...R(nd.al, nd.waitAc + nd.waitH - nd.stuckH, nd.w, nd.stuckH)} fill={ref("hatch")} pointerEvents="none" />}
              {s && nd.waitH > 0 && <rect className="ff-waithit" {...R(nd.al, nd.waitAc, nd.w, nd.waitH)} fill="transparent" {...go(steps[nd.index].stillHere > 0, () => p.onWaiting(nd.index, false))} aria-label={`${nf(steps[nd.index].stillHere)} still in ${s.name}. Open them.`} data-testid={`ff-wait-${nd.index}`}><title>{`${nf(steps[nd.index].stillHere)} still in ${s.name}`}</title></rect>}
              {s && nd.stuckH > 0 && <rect className="rv-stuckhit" {...R(nd.al, nd.waitAc + nd.waitH - nd.stuckH, nd.w, nd.stuckH)} fill="transparent" {...go(s.stuck > 0, () => p.onWaiting(nd.index, true))} aria-label={`${nf(s.stuck)} stuck too long in ${s.name}. Open them.`} data-testid={`ff-stuck-${nd.index}`}><title>{`${nf(s.stuck)} stuck too long in ${s.name}`}</title></rect>}
              {s && leak === nd.index && enough && nd.lostH > 0 && <rect className="ff-ring" {...R(nd.al - 3, nd.lostAc - 3, nd.w + 6, nd.lostH + 6)} rx={8} pointerEvents="none" />}
            </g>;
          })}
          {motion && L.links.map((l, i) => {
            const f = plan[i]; if (!f || f.count === 0) return null;
            const d = centerPath(l, pt), key = `l${l.from}`;
            return <g key={`dots${l.from}`} className="ff-dots ff-item" data-on={hot === key ? "1" : undefined} aria-hidden pointerEvents="none">
              {Array.from({ length: f.count }, (_, j) => {
                const begin = `-${(dotOffset(j, f.count) * f.dur).toFixed(2)}s`;
                return <g key={j} className="ff-dot" style={{ opacity: 0 }}>
                  <circle r={f.size * 2} className="ff-dot-glow" filter={ref("dot")} /><circle r={f.size} className="ff-dot-core" />
                  <animateMotion dur={`${f.dur}s`} begin={begin} repeatCount="indefinite" path={d} />
                  <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.12;0.88;1" dur={`${f.dur}s`} begin={begin} repeatCount="indefinite" />
                </g>;
              })}
            </g>;
          })}
        </g>
        {L.nodes.map((nd) => {
          const s = nd.kind === "stage" ? paths.stages[nd.index] : null;
          const reachN = s ? steps[nd.index].fromN : paths.won.n, valN = s ? nd.reach : m.won;
          const val = <Count to={valN} fmt={fmtShort} on={animate} />, sub = s ? `${nf(reachN)} ${reachN === 1 ? "deal" : "deals"}` : paths.won.n > 0 ? (dealsMode ? "won" : `${nf(paths.won.n)} won`) : "in these dates";
          if (vertical) { const y = pt(nd.al, 0)[1]; return <text key={`x${nd.id}`} className="rv-text ff-head" x={6} y={y - 9}><tspan className="rv-name">{trunc(nd.name, 20)}</tspan><tspan className="rv-val" dx={8}>{s || paths.won.n > 0 ? val : "No wins"}</tspan>{(dealsMode ? !s : true) && <tspan className="rv-sub" dx={8}>{sub}</tspan>}<title>{`${nd.name}: ${s || paths.won.n > 0 ? fmtShort(valN) : "No wins"}`}</title></text>; }
          const x = pt(nd.al + nd.w / 2, 0)[0];
          return <g key={`x${nd.id}`} className="ff-headchip"><rect x={x - chipW / 2} y={0} width={chipW} height={46} rx={12} /><text className="rv-text ff-head" x={x} y={16} textAnchor="middle"><tspan className="rv-name" x={x}>{trunc(nd.name, Math.max(6, Math.floor(chipW / 6.8)))}</tspan><tspan className="rv-val" x={x} dy={15}>{s || paths.won.n > 0 ? val : "No wins"}</tspan><tspan className="rv-sub" x={x} dy={13}>{sub}</tspan><title>{`${nd.name}: ${s || paths.won.n > 0 ? fmtShort(valN) : "No wins"}`}</title></text></g>;
        })}
        {leak !== null && enough && (() => {
          const t = L.tails.find((x) => x.leak); if (!t) return null;
          const [x, y] = pt(t.al1, t.ac1 - 4), s = paths.stages[t.from];
          return <g className="rv-leaktag ff-leaktag" transform={`translate(${vertical ? Math.max(2, Math.min(x - 70, width - 160)) : Math.max(2, Math.min(x - 40, width - 160))} ${y - 26})`} {...go(true, () => p.onLost(t.from))} aria-label={`Biggest leak: ${fmt(t.amount)} lost in ${s.name}. Open them.`} data-testid="ff-leaktag"><rect width={150} height={22} rx={11} /><text x={75} y={15} textAnchor="middle">Biggest leak: {fmtShort(t.amount)} lost</text></g>;
        })()}
      </svg>
      <p className="ff-leakline" data-testid="ff-leakline">{LEAK_LINE}{leakStage ? <> Here it is <b>{leakStage.name}</b>.</> : !enough ? <> {LEAK_NEEDS(closed, paths.minDeals)}</> : null}</p>
      {tip && <div className="rv-tip" role="tooltip" style={{ left: tip.x, top: tip.y }} data-testid="ff-tip"><b>{tip.title}</b>{tip.lines.map((t, i) => <span key={i}>{t}</span>)}</div>}

      <section className="ff-howto" aria-label="How to read this" data-testid="ff-howto">
        <h4 className="ff-h">How to read this</h4>
        <p className="ap-fine">Left to right is the order of your steps. Click any band, red branch or name to open exactly those deals.</p>
        <ul className="ff-keys" data-testid="ff-legend">
          {HOW_TO_READ.map((h) => <li key={h.kind}><i className={`ff-sw ff-sw-${h.kind}`} aria-hidden /><span><b>{h.label}.</b> {h.line}</span></li>)}
        </ul>
      </section>

      <section className="ff-section" aria-label="Where deals are lost" data-testid="ff-drops">
        <h4 className="ff-h">Where deals are lost</h4>
        <p className="ap-fine">Step by step: how many got there, how many moved on, how many were lost there and how many are still waiting.</p>
        {!enough && <p className="ap-fine" role="status" data-testid="ff-notenough">Not enough closed deals yet ({closed} of {paths.minDeals} needed) to show percentages. The counts below are still true.</p>}
        <div className="ap-scroll">
          <table className="ap-t ff-table">
            <thead><tr><th>Step</th><th data-num>Got here</th><th data-num>Moved on</th><th data-num>Lost here</th><th data-num>Still here</th>{!dealsMode && <th data-num>Money lost</th>}</tr></thead>
            <tbody>
              {paths.stages.map((s, i) => {
                const st = steps[i], isLeak = enough && leak === i;
                const cell = (n: number, fn: () => void, id: string) => (n > 0 && !p.sample ? <button type="button" className="ap-link tnum" onClick={fn} data-testid={id}>{nf(n)}</button> : <span className="tnum">{nf(n)}</span>);
                return (
                  <tr key={s.id} data-leak={isLeak ? "1" : "0"}>
                    <td><span className="ap-name">{s.name}</span>{isLeak && <span className="ap-chip ml-2" data-tone="red">Biggest leak</span>}</td>
                    <td data-num>{cell(st.fromN, () => p.onReach(i), `ff-row-reach-${i}`)}</td>
                    <td data-num>{cell(st.toN, () => p.onReach(i + 1), `ff-row-past-${i}`)}{pctOf(st.toN, st.fromN) && <span className="ap-sub"> {pctOf(st.toN, st.fromN)}</span>}</td>
                    <td data-num>{cell(s.lost, () => p.onLost(i), `ff-row-lost-${i}`)}{pctOf(s.lost, st.fromN) && <span className="ap-sub"> {pctOf(s.lost, st.fromN)}</span>}</td>
                    <td data-num>{cell(st.stillHere, () => p.onWaiting(i, false), `ff-row-wait-${i}`)}{s.stuck > 0 && <span className="ap-sub"> ({nf(s.stuck)} stuck too long)</span>}</td>
                    {!dealsMode && <td data-num>{money(s.lostCents)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ap-fine">{dealsText(lostAll)} lost in these dates{" "}{lostAll > 0 && !p.sample && <button type="button" className="ap-link" onClick={p.onLostAll} data-testid="ff-lost-all">Open them</button>}. Moved on = got to the next step. Each % is out of the deals that got to that step.</p>
      </section>

      <WhoWon paths={paths} dealsMode={dealsMode} sample={!!p.sample} animate={animate} onWon={p.onWon} onWonBy={p.onWonBy} fmt={fmt} fmtShort={fmtShort} />
    </div>
  );
}

function Stack({ title, kind, segs, total, dealsMode, sample, onPick, fmt }: { title: string; kind: "owner" | "source"; segs: PathSeg[]; total: { n: number; cents: number }; dealsMode: boolean; sample: boolean; onPick: (s: PathSeg) => void; fmt: (v: number) => string }) {
  const b = breakdown(segs, 8, total), share = (n: number) => `${Math.max(0.5, (n / Math.max(1, total.n)) * 100)}%`;
  if (!b.shown.length) return null;
  return (
    <div className="ff-stack" data-testid={`ff-won-by-${kind}`}>
      <h5 className="ff-h5">{title}</h5>
      <div className="ff-bar-row" role="group" aria-label={title}>
        {b.shown.map((s, i) => <button key={s.key} type="button" className="ff-seg" style={{ width: share(s.n), background: SEG[i % SEG.length] }} disabled={sample} onClick={() => onPick(s)} title={`${s.name}: ${dealsText(s.n)}${dealsMode ? "" : `, ${fmt(s.cents)}`}`} aria-label={`${s.name}: ${dealsText(s.n)} won. Open them.`} data-testid={`ff-seg-${kind}-${i}`} />)}
        {b.rest && <span className="ff-seg ff-seg-rest" style={{ width: share(b.rest.n) }} title={`Everyone else: ${dealsText(b.rest.n)}`} />}
      </div>
      <ul className="ff-legend">
        {b.shown.map((s, i) => <li key={s.key}><i style={{ background: SEG[i % SEG.length] }} aria-hidden />{sample ? <span>{s.name}</span> : <button type="button" className="ap-link" onClick={() => onPick(s)}>{s.name}</button>} <b className="tnum">{dealsText(s.n)}</b><span className="ap-sub tnum"> {pctText(s.n, total.n)}{dealsMode ? "" : `, ${fmt(s.cents)}`}</span></li>)}
        {b.rest && <li><i className="ff-rest" aria-hidden /><span>Everyone else</span> <b className="tnum">{dealsText(b.rest.n)}</b></li>}
      </ul>
    </div>
  );
}

function WhoWon({ paths, dealsMode, sample, animate, onWon, onWonBy, fmt, fmtShort }: { paths: FlowPaths; dealsMode: boolean; sample: boolean; animate: boolean; onWon: () => void; onWonBy: (k: "owner" | "source", s: PathSeg) => void; fmt: (v: number) => string; fmtShort: (v: number) => string }) {
  const w = paths.won, total = { n: w.n, cents: w.cents }, time = winTimeText(w.medianDays);
  if (w.n === 0) return <section className="ff-section" data-testid="ff-who"><h4 className="ff-h">Who actually won</h4><p className="ap-fine">No wins in these dates, so there is nobody to credit yet.</p></section>;
  const chips = breakdown(w.byOwner, 8, total).shown;
  return (
    <section className="ff-section" aria-label="Who actually won" data-testid="ff-who">
      <h4 className="ff-h">Who actually won</h4>
      <p className="ap-fine">{sample ? <b>{dealsText(w.n)} won{dealsMode ? "" : `, ${fmtShort(w.cents)}`}</b> : <button type="button" className="ap-link" onClick={onWon} data-testid="ff-won-all"><b>{dealsText(w.n)} won{dealsMode ? "" : `, ${fmtShort(w.cents)}`}</b></button>} in these dates.{time ? ` A deal took ${time} from created to won (the middle one).` : " Time to win: not enough history yet."}</p>
      {chips.length > 0 && (
        <div className="ff-chips-wrap" data-testid="ff-chips">
          <span className="ff-chips-arrow" aria-hidden>Won</span>
          <ul className="ff-chips" data-anim={animate ? "1" : "0"} aria-label="People who won deals, most wins first">
            {chips.map((s, i) => <li key={s.key} style={{ ["--i" as string]: i }}>
              {sample ? <span className="ff-chip" title={`${s.name}: ${dealsText(s.n)} won`}><i style={{ background: SEG[i % SEG.length] }}>{initials(s.name)}</i><b>{dealsText(s.n)}</b></span>
                : <button type="button" className="ff-chip" onClick={() => onWonBy("owner", s)} title={`${s.name}: ${dealsText(s.n)} won`} aria-label={`${s.name}: ${dealsText(s.n)} won. Open them.`}><i style={{ background: SEG[i % SEG.length] }}>{initials(s.name)}</i><b>{dealsText(s.n)}</b></button>}
            </li>)}
          </ul>
        </div>
      )}
      <p className="ap-fine">Each circle is a person; the number is the deals they won. Longer bars below mean more wins.</p>
      <div className="ff-stacks">
        <Stack title="By person" kind="owner" segs={w.byOwner} total={total} dealsMode={dealsMode} sample={sample} onPick={(s) => onWonBy("owner", s)} fmt={fmt} />
        <Stack title="By where the lead came from" kind="source" segs={w.bySource} total={total} dealsMode={dealsMode} sample={sample} onPick={(s) => onWonBy("source", s)} fmt={fmt} />
      </div>
    </section>
  );
}
