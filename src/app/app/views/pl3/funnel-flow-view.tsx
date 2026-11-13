"use client";

import { useMemo, useRef, useState } from "react";
import type React from "react";
import { breakdown, closedDeals, dealsText, lostTotal, pathSteps, pctText, winTimeText, type FlowPaths, type PathSeg } from "@/lib/design/flow-paths";
import { funnelFlowLayout, measuresOf, type Measure } from "@/lib/design/funnel-flow-layout";
import { ribbonPath, centerPath, type Pt } from "@/lib/design/river-layout";
import { money, moneyShort } from "./format";

// FUNNEL FLOW. A Sankey-style funnel: each step's band is as thick as the deals (or money) that GOT to it, the funnel narrows step by step, deals that fall out leave upward (lost) or wait
// in their step (downward, hatched ochre when stuck), and at the end it splits like a Y into Won and Lost. Under it: where deals drop out, and who actually won (by person and by source).
// Drawn from per-step totals only (never rows), so it is as fast at 100k deals as at 10. Every band, drop-off and breakdown segment is a button that opens exactly its deals; the number
// on it and the rows behind it are counted by the same rule (see flow-paths.ts and flowReachCond).

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
/** Colours for the stacked "who won" bars: ten steps of the theme's own chart colours, so it works in light and dark. */
const SEG = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function FunnelFlow(p: FunnelFlowProps) {
  const { paths, measure, width, reduced } = p;
  const dealsMode = measure === "deals", wrap = useRef<HTMLDivElement>(null), [tip, setTip] = useState<Tip | null>(null);
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
  const hover = (title: string, lines: string[]) => ({ onPointerMove: (e: React.PointerEvent) => show(e, title, lines), onPointerEnter: (e: React.PointerEvent) => show(e, title, lines), onPointerLeave: () => setTip(null), onFocus: (e: React.FocusEvent) => show(e, title, lines), onBlur: () => setTip(null) });
  const press = (fn: () => void) => ({ onClick: (e: React.MouseEvent) => { e.stopPropagation(); fn(); }, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); fn(); } }, tabIndex: 0, role: "button" as const });
  const go = (can: boolean, fn: () => void) => (can && !p.sample ? press(fn) : {});
  const pctOf = (a: number, b: number) => (enough ? pctText(a, b) : null);
  const leak = L.leakIndex;
  const animate = p.settle && !reduced;

  return (
    <div className="ff-wrap" ref={wrap} data-testid="pl-funnelflow" data-dir={vertical ? "v" : "h"} data-measure={measure}>
      <svg className="rv-svg ff-svg" width={width} height={geo.h} viewBox={`0 0 ${width} ${geo.h}`} role="group" aria-label={dealsMode ? "Funnel of deals by step, ending in won and lost" : "Funnel of money by step, ending in won and lost"} data-settle={animate ? "1" : "0"}>
        <defs>
          <pattern id="ff-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" className="rv-hatch-bg" /><rect width="1.6" height="5" className="rv-hatch-line" /></pattern>
        </defs>
        {L.links.map((l) => {
          const st = steps[l.from], to = st.toId === "won" ? "Won" : st.toName, label = `${st.fromName} to ${to}: ${st.label}`;
          const can = st.toN > 0, mid = pt((l.al0 + l.al1) / 2, (l.ac0 + l.ac1) / 2 + l.th / 2), pc = pctOf(st.toN, st.fromN);
          const lines = [`${nf(st.toN)} of ${nf(st.fromN)} deals that got to ${st.fromName} are now past it${pc ? ` (${pc})` : ""}`, `${nf(st.stillHere)} still in ${st.fromName}, ${nf(st.lostHere)} lost there`, ...(dealsMode ? [] : [`${money(st.toCents)} of ${money(st.fromCents)}`]), can ? "Click to open exactly those deals" : "Nothing got past this step in these dates"];
          return <g key={`l${l.from}`} className="rv-link ff-band" data-open={can && !p.sample ? "1" : "0"} {...hover(`${st.fromName} to ${to}`, lines)} {...go(can, () => p.onReach(l.to))} aria-label={`${label}${can ? ". Open the deals." : ""}`} data-testid={`ff-band-${l.from}`}>
            <path className="rv-ribbon" d={ribbonPath(l.al0, l.ac0, l.th, l.al1, l.ac1, l.th, pt)} />
            <path className="rv-flow" d={centerPath(l, pt)} style={{ strokeWidth: Math.max(1.5, Math.min(4, l.th / 6)) }} />
            {st.fromN > 0 && <g className="rv-conv" transform={`translate(${mid[0]} ${mid[1]})`} data-testid={`ff-band-label-${l.from}`}><rect x={-40} y={-15} width={80} height={30} rx={12} /><text textAnchor="middle" y={-2}>{st.short[0]}</text><text textAnchor="middle" y={10} className="rv-conv-sub">{pc ? `moved on ${pc}` : "moved on"}</text></g>}
          </g>;
        })}
        {L.tails.map((t) => {
          const s = paths.stages[t.from], d = ribbonPath(t.al0, t.ac0, t.th, t.al1, t.ac1, Math.max(1, t.th * 0.3), pt), can = s.lost > 0;
          const lines = [`${nf(s.lost)} lost from ${s.name}${dealsMode ? "" : `, ${money(s.lostCents)}`}`, pctOf(s.lost, steps[t.from].fromN) ? `${pctOf(s.lost, steps[t.from].fromN)} of the deals that got to ${s.name}` : "Share shown once there are enough closed deals", "Click to open exactly those deals"];
          return <g key={`t${t.from}`} className={`rv-tail${t.leak ? " rv-leak" : ""}`} data-open={can && !p.sample ? "1" : "0"} {...hover(`Lost from ${s.name}`, lines)} {...go(can, () => p.onLost(t.from))} aria-label={`Lost from ${s.name}: ${nf(s.lost)} deals. Open them.`} data-testid={`ff-tail-${t.from}`}>
            <path className="rv-drain" d={d} />
          </g>;
        })}
        {L.nodes.map((nd) => {
          const s = nd.kind === "stage" ? paths.stages[nd.index] : null;
          const reachN = s ? steps[nd.index].fromN : paths.won.n, canReach = reachN > 0;
          const tipLines = s
            ? [`${nf(reachN)} deals got to ${s.name}`, `${nf(steps[nd.index].toN)} moved on, ${nf(s.lost)} lost, ${nf(steps[nd.index].stillHere)} still here${s.stuck > 0 ? ` (${nf(s.stuck)} stuck)` : ""}`, canReach ? "Click to open exactly those deals" : "Nothing here in these dates"]
            : [paths.won.n > 0 ? `${nf(paths.won.n)} won${dealsMode ? "" : `, ${money(paths.won.cents)}`}` : "No wins in these dates"];
          const wonEmpty = !s && paths.won.n === 0;
          return <g key={nd.id} className={`rv-node ff-node rv-${nd.kind}`} data-open={canReach && !p.sample ? "1" : "0"} {...hover(nd.name, tipLines)} {...(wonEmpty ? {} : go(canReach, () => (s ? p.onReach(nd.index) : p.onWon())))} aria-label={`${nd.name}: ${tipLines.join(". ")}`} data-testid={s ? `ff-node-${nd.index}` : "ff-won"}>
            {!wonEmpty && <rect className={s ? "ff-bar" : "ff-bar ff-bar-won"} {...R(nd.al, nd.ac, nd.w, nd.h)} rx={3} />}
            {wonEmpty && (() => { const [vx, vy] = pt(nd.al + nd.w / 2, nd.ac + 14); return <g transform={`translate(${vx} ${vy})`} aria-hidden className="rv-emptyvault"><rect x={-15} y={-14} width={30} height={28} rx={4} className="rv-vault-door" /><circle r={6} className="rv-vault-dial" /><path d="M0 -6v-3M0 6v3M-6 0h-3M6 0h3" className="rv-vault-dial" /></g>; })()}
            {s && nd.waitH > 0 && <rect className="ff-wait" {...R(nd.al, nd.waitAc, nd.w, nd.waitH)} />}
            {s && nd.stuckH > 0 && <rect className="rv-stuckmark" {...R(nd.al, nd.waitAc + nd.waitH - nd.stuckH, nd.w, nd.stuckH)} fill="url(#ff-hatch)" pointerEvents="none" />}
            {s && nd.waitH > 0 && <rect className="ff-waithit" {...R(nd.al, nd.waitAc, nd.w, nd.waitH)} fill="transparent" {...go(steps[nd.index].stillHere > 0, () => p.onWaiting(nd.index, false))} aria-label={`${nf(steps[nd.index].stillHere)} still in ${s.name}. Open them.`} data-testid={`ff-wait-${nd.index}`}><title>{`${nf(steps[nd.index].stillHere)} still in ${s.name}`}</title></rect>}
            {s && nd.stuckH > 0 && <rect className="rv-stuckhit" {...R(nd.al, nd.waitAc + nd.waitH - nd.stuckH, nd.w, nd.stuckH)} fill="transparent" {...go(s.stuck > 0, () => p.onWaiting(nd.index, true))} aria-label={`${nf(s.stuck)} stuck in ${s.name}. Open them.`} data-testid={`ff-stuck-${nd.index}`}><title>{`${nf(s.stuck)} stuck in ${s.name}`}</title></rect>}
          </g>;
        })}
        {L.nodes.map((nd) => {
          const s = nd.kind === "stage" ? paths.stages[nd.index] : null;
          const val = s ? fmtShort(nd.reach) : paths.won.n > 0 ? fmtShort(m.won) : "No wins", sub = s ? `${nf(steps[nd.index].fromN)} ${steps[nd.index].fromN === 1 ? "deal" : "deals"}` : paths.won.n > 0 ? (dealsMode ? "won" : `${nf(paths.won.n)} won`) : "in these dates";
          if (vertical) { const y = pt(nd.al, 0)[1]; return <text key={`x${nd.id}`} className="rv-text" x={6} y={y - 9}><tspan className="rv-name">{trunc(nd.name, 20)}</tspan><tspan className="rv-val" dx={8}>{val}</tspan>{(dealsMode ? !s : true) && <tspan className="rv-sub" dx={8}>{sub}</tspan>}<title>{`${nd.name}: ${val}`}</title></text>; }
          const x = pt(nd.al + nd.w / 2, 0)[0];
          return <text key={`x${nd.id}`} className="rv-text" x={x} y={16} textAnchor="middle"><tspan className="rv-name" x={x}>{trunc(nd.name, Math.max(6, Math.floor((width - 24) / ((k + 1) * 7.2))))}</tspan><tspan className="rv-val" x={x} dy={17}>{val}</tspan><tspan className="rv-sub" x={x} dy={14}>{sub}</tspan><title>{`${nd.name}: ${val}`}</title></text>;
        })}
        {leak !== null && enough && (() => {
          const t = L.tails.find((x) => x.leak); if (!t) return null;
          const [x, y] = pt(t.al1, t.ac1 - 4), s = paths.stages[t.from];
          return <g className="rv-leaktag" transform={`translate(${vertical ? Math.max(2, Math.min(x - 70, width - 140)) : Math.max(2, Math.min(x - 40, width - 140))} ${y - 26})`} {...go(true, () => p.onLost(t.from))} aria-label={`Biggest leak: ${fmt(t.amount)} lost from ${s.name}. Open them.`} data-testid="ff-leaktag"><rect width={132} height={22} rx={11} /><text x={66} y={15} textAnchor="middle">Biggest leak: {fmtShort(t.amount)}</text></g>;
        })()}
      </svg>
      <p className="rv-legend" data-testid="ff-legend">Each band is as thick as the {dealsMode ? "deals" : "money"} that got to that step. Lost deals leave upward{dealsMode ? "" : ", in money"}; deals still waiting sit at the bottom of their step (hatched ochre when stuck longer than normal). At the end the last band splits: won carries on, lost leaves. Click any band, drop-off or share to open exactly those deals.</p>
      {tip && <div className="rv-tip" role="tooltip" style={{ left: tip.x, top: tip.y }} data-testid="ff-tip"><b>{tip.title}</b>{tip.lines.map((t, i) => <span key={i}>{t}</span>)}</div>}

      <section className="ff-section" aria-label="Where deals drop out" data-testid="ff-drops">
        <h4 className="ff-h">Where deals drop out</h4>
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
                    <td data-num>{cell(st.stillHere, () => p.onWaiting(i, false), `ff-row-wait-${i}`)}{s.stuck > 0 && <span className="ap-sub"> ({nf(s.stuck)} stuck)</span>}</td>
                    {!dealsMode && <td data-num>{money(s.lostCents)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ap-fine">{dealsText(lostAll)} lost in these dates{" "}{lostAll > 0 && !p.sample && <button type="button" className="ap-link" onClick={p.onLostAll} data-testid="ff-lost-all">Open them</button>}. Moved on = got to the next step. A share is of the deals that got to that step.</p>
      </section>

      <WhoWon paths={paths} dealsMode={dealsMode} sample={!!p.sample} onWon={p.onWon} onWonBy={p.onWonBy} fmt={fmt} fmtShort={fmtShort} />
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

function WhoWon({ paths, dealsMode, sample, onWon, onWonBy, fmt, fmtShort }: { paths: FlowPaths; dealsMode: boolean; sample: boolean; onWon: () => void; onWonBy: (k: "owner" | "source", s: PathSeg) => void; fmt: (v: number) => string; fmtShort: (v: number) => string }) {
  const w = paths.won, total = { n: w.n, cents: w.cents }, time = winTimeText(w.medianDays);
  if (w.n === 0) return <section className="ff-section" data-testid="ff-who"><h4 className="ff-h">Who actually won</h4><p className="ap-fine">No wins in these dates, so there is nobody to credit yet.</p></section>;
  return (
    <section className="ff-section" aria-label="Who actually won" data-testid="ff-who">
      <h4 className="ff-h">Who actually won</h4>
      <p className="ap-fine">{sample ? <b>{dealsText(w.n)} won{dealsMode ? "" : `, ${fmtShort(w.cents)}`}</b> : <button type="button" className="ap-link" onClick={onWon} data-testid="ff-won-all"><b>{dealsText(w.n)} won{dealsMode ? "" : `, ${fmtShort(w.cents)}`}</b></button>} in these dates.{time ? ` A deal took ${time} from created to won (the middle one).` : " Time to win: not enough history yet."}</p>
      <div className="ff-stacks">
        <Stack title="By person" kind="owner" segs={w.byOwner} total={total} dealsMode={dealsMode} sample={sample} onPick={(s) => onWonBy("owner", s)} fmt={fmt} />
        <Stack title="By where the lead came from" kind="source" segs={w.bySource} total={total} dealsMode={dealsMode} sample={sample} onPick={(s) => onWonBy("source", s)} fmt={fmt} />
      </div>
    </section>
  );
}
