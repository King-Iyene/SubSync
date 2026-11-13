"use client";

import { CalendarCheck, ClipboardCheck, FileText, Handshake, Layers, PhoneCall, Trophy, UserPlus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { closedDeals, dealsText, lostTotal, pathSteps, type FlowPaths, type PathSeg } from "@/lib/design/flow-paths";
import { LEAK_LINE, LEAK_NEEDS } from "@/lib/design/funnel-fx";
import { dotLegend, funnelModel, halfWidthAt, particleBudget, placeDots, type FunnelRow, type IconKey } from "@/lib/design/funnel-dots";
import type { Measure } from "@/lib/design/funnel-flow-layout";
import { money, moneyShort } from "./format";
import { WhoWon } from "./funnel-flow-view";

// THE FUNNEL (default view of the Pipeline flow). A tapered funnel of full-width rows: one row per step with a small icon, the step's name (it wraps, never cut), a rounded glowing band whose width is
// the deals that got that far, the count, its % of the first step, the % that moved on and the drop-off. Inside each band, TINY DOTS: no dot per deal, only a capped number of dots (see
// funnel-dots.ts) and a legend that says what one dot stands for. The real numbers are always text. Every number and every group of dots opens exactly its deals (same rule as before).
// Drawn from per-step totals only, so it costs the same at 10 deals and 50 million. Reduced motion: still dots, no falling particles.
// When SubSync's own step history does not reach back to the first chosen day, the funnel shows where the deals are NOW (grouped by their current step) and says so in one line; it draws no
// "moved on", no %, no drop-off and no leak, because those would be guesses.

export type FunnelProps = {
  paths: FlowPaths; measure: Measure; width: number; reduced: boolean;
  /** Plain label of the dates, for the one-line note ("Last 90 days"). */ windowLabel: string;
  /** True for the made-up SAMPLE, or while a replay day is shown: nothing opens. */ sample?: boolean;
  /** Set while a replay day is shown ("Replaying 12 Nov"): the numbers are that day's, the breakdown of who won is hidden. */ replayLabel?: string | null;
  /** Deals that got to step `index` or further (index = number of steps means Won). */ onReach: (index: number) => void;
  onWaiting: (index: number, stuck: boolean) => void; onLost: (index: number) => void; onLostAll: () => void;
  onWon: () => void; onWonBy: (kind: "owner" | "source", seg: PathSeg) => void;
};

const ICONS: Record<IconKey, typeof Layers> = { new: UserPlus, contact: PhoneCall, book: CalendarCheck, qualify: ClipboardCheck, offer: FileText, deal: Handshake, won: Trophy, step: Layers };
const nf = (v: number) => v.toLocaleString("en-US");
const NARROW = 640, ROW_H = 78, ROW_H_NARROW = 64;
/** Width of the band column: the picture's width minus the label and the numbers beside it (or the whole width on a phone). */
const bandWidth = (width: number, narrow: boolean) => (narrow ? Math.max(240, width - 4) : Math.max(220, width - 214 - 300 - 28));
const sinceText = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

/** A grey placeholder with the same grid as the finished funnel, so nothing jumps when the numbers arrive. */
export function FunnelSkeleton({ width, rows = 5 }: { width: number; rows?: number }) {
  const narrow = width < NARROW;
  return (
    <div className="fv-wrap" data-testid="fv-skeleton" aria-busy="true" aria-label="Loading the funnel...">
      <ol className="fv-list" data-narrow={narrow ? "1" : "0"}>
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="fv-row fv-skel"><div className="fv-label"><i className="fv-ico" /><span className="fv-bone" style={{ width: 90 }} /></div><div className="fv-band" style={{ height: narrow ? ROW_H_NARROW : ROW_H }}><span className="fv-bone fv-bone-band" style={{ width: `${92 - i * 14}%` }} /></div><div className="fv-stats"><span className="fv-bone" style={{ width: 60 }} /><span className="fv-bone" style={{ width: 140 }} /></div></li>
        ))}
      </ol>
    </div>
  );
}

type Cat = "moved" | "waiting" | "stuck" | "lost";

export function DotFunnel(p: FunnelProps) {
  const { paths, measure, width, reduced } = p;
  const dealsMode = measure === "deals", narrow = width < NARROW, rowH = narrow ? ROW_H_NARROW : ROW_H, bandW = bandWidth(width, narrow);
  const wrap = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true), uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const steps = useMemo(() => pathSteps(paths, dealsMode), [paths, dealsMode]);
  const closed = closedDeals(paths), enough = closed >= paths.minDeals, lostAll = lostTotal(paths);
  // History that does not reach back to the first day means no claim about flow between steps (the sample has no history field and is complete).
  const flowOk = paths.history ? paths.history.covers : true;
  const model = useMemo(() => funnelModel(paths, measure, { enough: enough && flowOk }), [paths, measure, enough, flowOk]);
  const budget = useMemo(() => (reduced ? model.rows.map(() => 0) : particleBudget(model.rows.map((r) => (r.kind === "stage" ? r.moved : 0)))), [model, reduced]);
  const fmtShort = (v: number) => (dealsMode ? nf(v) : moneyShort(v));

  // Depth: the pointer tilts the bands a few degrees and slides the layers by different amounts (parallax). Only two CSS variables change, no React state; touch and reduced motion get none.
  const tilt = useRef<{ x: number; y: number; raf: number }>({ x: 0, y: 0, raf: 0 });
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType === "touch") return;
    const el = wrap.current; if (!el) return;
    const b = el.getBoundingClientRect(); tilt.current.x = Math.max(-1, Math.min(1, ((e.clientX - b.left) / Math.max(1, b.width)) * 2 - 1)); tilt.current.y = Math.max(-1, Math.min(1, ((e.clientY - b.top) / Math.max(1, b.height)) * 2 - 1));
    el.dataset.hover = "1";
    if (!tilt.current.raf) tilt.current.raf = requestAnimationFrame(() => { tilt.current.raf = 0; el.style.setProperty("--fv-tx", tilt.current.x.toFixed(3)); el.style.setProperty("--fv-ty", tilt.current.y.toFixed(3)); });
  };
  const onLeave = () => { const el = wrap.current; if (!el) return; el.dataset.hover = "0"; el.style.setProperty("--fv-tx", "0"); el.style.setProperty("--fv-ty", "0"); };

  // Pause the falling particles when the tab is hidden or the funnel is scrolled out of view.
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    let seen = true;
    const apply = () => setActive(seen && !document.hidden);
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((es) => { seen = es[es.length - 1]?.isIntersecting ?? true; apply(); });
    io?.observe(el); document.addEventListener("visibilitychange", apply);
    return () => { io?.disconnect(); document.removeEventListener("visibilitychange", apply); };
  }, []);

  if (model.empty) return <p className="ap-fine" data-testid="ff-empty">Nothing reached this pipeline in these dates, so there is no funnel to draw.</p>;
  const leak = model.leakIndex, leakStage = leak !== null ? paths.stages[leak] : null;
  const since = sinceText(paths.history?.since);

  const num = (n: number, fn: () => void, id: string, label: string, cls = "fv-n") => (n > 0 && !p.sample
    ? <button type="button" className={`${cls} tnum`} onClick={fn} aria-label={`${label}. Open the deals.`} data-testid={id}>{nf(n)}</button> : <span className={`${cls} tnum`}>{nf(n)}</span>);

  return (
    <div className="fv-wrap" ref={wrap} onPointerMove={onMove} onPointerLeave={onLeave} data-hover="0" data-replay={p.replayLabel ? "1" : "0"} data-testid="pl-funnel" data-measure={measure} data-paused={active ? "0" : "1"} data-motion={reduced ? "0" : "1"} data-unit={model.unit} data-dots={model.totalDots} data-flow={flowOk ? "1" : "0"}>
      <div className="fv-replayslot">{p.replayLabel && <p className="fv-replaychip" role="status" data-testid="fv-replaying"><i aria-hidden />Replaying <b>{p.replayLabel}</b>: the numbers are the end of that day.</p>}</div>
      <ol className="fv-list" data-narrow={narrow ? "1" : "0"} aria-label={dealsMode ? "Funnel of deals by step" : "Funnel of money by step"}>
        {model.rows.map((r, i) => {
          const won = r.kind === "won", st = won ? null : steps[i], s = won ? null : paths.stages[i], Icon = ICONS[r.icon];
          const nextW = won ? r.width : model.rows[i + 1]?.width ?? r.width;
          const isLeak = leak === i && enough && flowOk;
          return (
            <li key={r.id} className="fv-row" style={{ ["--fv-i" as string]: i }} data-kind={r.kind} data-leak={isLeak ? "1" : "0"} data-testid={won ? "fv-row-won" : `fv-row-${i}`}>
              <div className="fv-label">
                <span className="fv-ico" aria-hidden><Icon size={16} /></span>
                <span className="fv-name">{r.name}{isLeak && <span className="ap-chip ml-2" data-tone="red" data-testid="fv-leakchip">Biggest leak</span>}</span>
              </div>
              <div className="fv-band" style={{ height: rowH }}>
                <BandSvg row={r} i={i} uid={uid} w={bandW} h={rowH} wTop={r.width * bandW} wBot={nextW * bandW} leak={isLeak} particles={budget[i] ?? 0} paused={!active}
                  can={{ moved: r.dots.moved > 0 && !p.sample, waiting: r.dots.waiting > 0 && !p.sample, stuck: r.dots.stuck > 0 && !p.sample, lost: r.dots.lost > 0 && !p.sample, band: !p.sample }}
                  on={{ band: () => (won ? p.onWon() : p.onReach(i)), moved: () => (won ? p.onWon() : p.onReach(i + 1)), waiting: () => p.onWaiting(i, false), stuck: () => p.onWaiting(i, true), lost: () => p.onLost(i) }} flowOk={flowOk} />
              </div>
              <div className="fv-stats">
                {won ? (
                  <>
                    <div className="fv-big">{paths.won.n > 0 && !p.sample ? <button type="button" className="fv-count tnum" onClick={p.onWon} data-testid="fv-won-count" aria-label={`${dealsText(paths.won.n)} won. Open the deals.`}>{fmtShort(r.reach)}</button> : <span className="fv-count tnum">{paths.won.n > 0 ? fmtShort(r.reach) : "No wins"}</span>}<span className="fv-unit">{paths.won.n > 0 ? (dealsMode ? "won" : `${dealsText(paths.won.n)} won`) : "in these dates"}</span></div>
                    {enough && flowOk && r.pctFirst && <span className="fv-pill" data-testid="fv-pct-won">{r.pctFirst} of the first step</span>}
                  </>
                ) : flowOk ? (
                  <>
                    <div className="fv-big">{num(st!.fromN, () => p.onReach(i), `fv-reach-${i}`, `${dealsText(st!.fromN)} got to ${r.name} or further`, "fv-count")}<span className="fv-unit">{dealsMode ? (st!.fromN === 1 ? "deal" : "deals") : `${dealsText(st!.fromN)} · ${fmtShort(r.reach)}`}</span></div>
                    <div className="fv-pills">
                      {enough && r.pctFirst && <span className="fv-pill" data-testid={`fv-pct-${i}`}>{r.pctFirst} of the first step</span>}
                      {enough && r.conv && <span className="fv-pill fv-conv" data-testid={`fv-conv-${i}`}>{r.conv} moved on</span>}
                    </div>
                    <div className="fv-drop" data-testid={`fv-drop-${i}`}>
                      <span className="fv-droplabel">Drop-off {nf(Math.max(0, st!.fromN - st!.toN))}:</span>{" "}
                      {num(s!.lost, () => p.onLost(i), `fv-lost-${i}`, `${dealsText(s!.lost)} lost in ${r.name}`, "fv-n fv-n-lost")} lost · {num(st!.stillHere, () => p.onWaiting(i, false), `fv-wait-${i}`, `${dealsText(st!.stillHere)} still in ${r.name}`)} waiting
                      {s!.stuck > 0 && <> ({num(s!.stuck, () => p.onWaiting(i, true), `fv-stuck-${i}`, `${dealsText(s!.stuck)} stuck too long in ${r.name}`, "fv-n fv-n-stuck")} stuck)</>}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="fv-big">{num(st!.stillHere, () => p.onWaiting(i, false), `fv-wait-${i}`, `${dealsText(st!.stillHere)} in ${r.name} now`, "fv-count")}<span className="fv-unit">{st!.stillHere === 1 ? "deal here now" : "deals here now"}</span></div>
                    <div className="fv-drop" data-testid={`fv-drop-${i}`}>
                      {num(s!.lost, () => p.onLost(i), `fv-lost-${i}`, `${dealsText(s!.lost)} lost in ${r.name}`, "fv-n fv-n-lost")} lost here
                      {s!.stuck > 0 && <> · {num(s!.stuck, () => p.onWaiting(i, true), `fv-stuck-${i}`, `${dealsText(s!.stuck)} stuck too long in ${r.name}`, "fv-n fv-n-stuck")} stuck</>}
                    </div>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="fv-legend" data-testid="fv-dotlegend" data-unit={model.unit}>
        <b>{dotLegend(model.unit, !dealsMode)}.</b> Dots are rounded and capped at a few hundred, so the numbers in text are the real ones.
        <span className="fv-keys" aria-label="What the dot colours mean">
          <span><i className="fv-key fv-c-moved" />{flowOk ? "moved on" : "further along"}</span><span><i className="fv-key fv-c-waiting" />waiting</span><span><i className="fv-key fv-c-stuck" />stuck too long</span><span><i className="fv-key fv-c-lost" />lost</span><span><i className="fv-key fv-c-won" />won</span>
        </span>
      </p>
      <p className="fv-note" data-testid="fv-window-note" role="note">
        {flowOk
          ? <>Counts are deals created or moved to a step in <b>{p.windowLabel || "the dates above"}</b>, grouped by the step they are in now. Won and lost are the deals closed in these dates.</>
          : <>Step history only started {since ?? "recently"}, so this shows where deals from <b>{p.windowLabel || "the dates above"}</b> are now. Moves between steps are not shown until the history covers these dates.</>}
      </p>
      {flowOk && <p className="ff-leakline" data-testid="ff-leakline">{LEAK_LINE}{leakStage ? <> Here it is <b>{leakStage.name}</b>.</> : !enough ? <> {LEAK_NEEDS(closed, paths.minDeals)}</> : null}</p>}
      {flowOk && !enough && <p className="ap-fine" role="status" data-testid="ff-notenough">Not enough closed deals yet ({closed} of {paths.minDeals} needed) to show percentages. The counts are still true.</p>}
      <p className="ap-fine fv-lostline">{dealsText(lostAll)} lost in these dates{lostAll > 0 && !p.sample && <> <button type="button" className="ap-link" onClick={p.onLostAll} data-testid="ff-lost-all">Open them</button></>}.{paths.lostElsewhere > 0 ? ` ${dealsText(paths.lostElsewhere)} of them left a step that is no longer in this pipeline.` : ""}{!dealsMode ? ` Money lost: ${money(paths.stages.reduce((t, x) => t + x.lostCents, 0))}.` : ""}</p>
      {!p.replayLabel && <WhoWon paths={paths} dealsMode={dealsMode} sample={!!p.sample} animate={false} onWon={p.onWon} onWonBy={p.onWonBy} fmt={(v) => (dealsMode ? dealsText(v) : money(v))} fmtShort={fmtShort} />}
    </div>
  );
}

type BandProps = {
  row: FunnelRow; i: number; uid: string; w: number; h: number; wTop: number; wBot: number; leak: boolean; particles: number; paused: boolean; flowOk: boolean;
  can: Record<Cat | "band", boolean>; on: Record<Cat | "band", () => void>;
};
const ORDER: Cat[] = ["moved", "waiting", "stuck", "lost"];
const GROUP_LABEL: Record<Cat, string> = { moved: "moved on", waiting: "waiting", stuck: "stuck too long", lost: "lost" };

/** One band, layered for depth: a soft shadow on the floor, the thickness of the slab under it, the glass top with a lit edge and a sheen, then spherical dots and a few falling lights, each layer sliding a little differently with the pointer. One small SVG per row; the dots are circles, never one per deal. */
function BandSvg({ row, i, uid, w, h, wTop, wBot, leak, particles, can, on, flowOk }: BandProps) {
  const won = row.kind === "won", cx = w / 2, top = 2, depth = 5, bot = h - 2 - depth - 3, bh = bot - top;
  const t = Math.max(8, wTop), b = Math.max(8, wBot);
  const shape = (dy: number) => `M${cx - t / 2} ${top + dy} C${cx - t / 2} ${top + dy + bh / 2} ${cx - b / 2} ${top + dy + bh / 2} ${cx - b / 2} ${bot + dy} L${cx + b / 2} ${bot + dy} C${cx + b / 2} ${top + dy + bh / 2} ${cx + t / 2} ${top + dy + bh / 2} ${cx + t / 2} ${top + dy} Z`;
  const d = shape(0), slab = shape(depth), floor = shape(depth + 7);
  const groups = useMemo(() => {
    const counts: Record<Cat, number> = won ? { moved: row.dots.moved, waiting: 0, stuck: 0, lost: 0 } : row.dots;
    const total = counts.moved + counts.waiting + counts.stuck + counts.lost;
    const pts = placeDots(total, { cx, w0: t, w1: b, h: bh, pad: 5, spacing: h > 60 ? 8 : 7, seed: i + 1 });
    const starts = ORDER.map((_, k) => ORDER.slice(0, k).reduce((sum, c) => sum + counts[c], 0));
    return ORDER.map((c, k) => ({ c, pts: pts.slice(starts[k], starts[k] + counts[c]).map((q) => ({ x: q.x, y: q.y + top })) }));
  }, [row, won, cx, t, b, bh, h, i]);
  const r = h > 60 ? 2.5 : 2.2;
  const hit = (c: Cat, g: { pts: unknown[] }) => (g.pts.length && can[c] ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); on[c](); }, "data-open": "1" } : {});
  const falls = Array.from({ length: particles }, (_, j) => ({ x: cx + (j - (particles - 1) / 2) * Math.max(6, Math.min(14, (halfWidthAt(t, b, 0.5) * 2) / 5)), delay: -(j / Math.max(1, particles)) * 5, dur: 4.2 + (j % 3) * 0.7 }));
  const id = (n: string) => `fv${uid}-${n}${i}`;
  const kinds: Cat[] = won ? ["moved"] : ORDER;
  return (
    <svg className="fv-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden focusable="false" data-testid={`fv-svg-${won ? "won" : i}`}>
      <defs>
        <linearGradient id={id("g")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className={won ? "fv-s-won0" : "fv-s-b0"} /><stop offset="1" className={won ? "fv-s-won1" : "fv-s-b1"} /></linearGradient>
        <linearGradient id={id("cyl")} x1="0" y1="0" x2="1" y2="0"><stop offset="0" className="fv-s-edge" /><stop offset="0.22" className="fv-s-clear" /><stop offset="0.78" className="fv-s-clear" /><stop offset="1" className="fv-s-edge" /></linearGradient>
        <linearGradient id={id("sheen")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="fv-s-sheen0" /><stop offset="1" className="fv-s-sheen1" /></linearGradient>
        <clipPath id={id("top")}><rect x="0" y="0" width={w} height={top + bh * 0.46} /></clipPath>
        {kinds.map((c) => <radialGradient key={c} id={id(`r${c}`)} cx="0.35" cy="0.3" r="0.8"><stop offset="0" className="fv-s-spec" /><stop offset="0.45" className={`fv-s-dot fv-s-${won ? "won" : c}`} /><stop offset="1" className={`fv-s-dotedge fv-s-${won ? "won" : c}`} /></radialGradient>)}
      </defs>
      <g className="fv-layer-floor"><path className="fv-floor" d={floor} /></g>
      <g className="fv-layer-slab"><path className={`fv-slab${won ? " fv-slab-won" : ""}`} d={slab} /></g>
      <g className="fv-layer-top">
        <path className={`fv-glow${won ? " fv-glow-won" : ""}`} d={d} />
        <path className={`fv-bandpath${won ? " fv-bandpath-won" : ""}${leak ? " fv-leakring" : ""}`} d={d} fill={`url(#${id("g")})`} {...(can.band ? { onClick: (e: React.MouseEvent) => { e.stopPropagation(); on.band(); }, "data-open": "1" } : {})} />
        <path className="fv-cyl" d={d} fill={`url(#${id("cyl")})`} pointerEvents="none" />
        <path className="fv-sheen" d={d} fill={`url(#${id("sheen")})`} clipPath={`url(#${id("top")})`} pointerEvents="none" />
      </g>
      <g className="fv-layer-dots">
        {groups.map((g) => g.pts.length > 0 && (
          <g key={g.c} className={`fv-grp fv-c-${won ? "won" : g.c}`} {...hit(g.c, g)} data-testid={`fv-dots-${won ? "won" : i}-${g.c}`} data-n={g.pts.length}>
            <title>{`${g.pts.length} dot${g.pts.length === 1 ? "" : "s"}: ${won ? "won" : flowOk ? GROUP_LABEL[g.c] : g.c === "moved" ? "further along" : GROUP_LABEL[g.c]}`}</title>
            {g.pts.map((q, j) => <circle key={j} cx={q.x} cy={q.y} r={r} fill={`url(#${id(`r${g.c}`)})`} />)}
          </g>
        ))}
        {falls.map((f, j) => <circle key={`p${j}`} className="fv-pt" cx={f.x} cy={top} r={1.8} style={{ ["--fv-h" as string]: `${bh}px`, animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s` }} />)}
      </g>
    </svg>
  );
}
