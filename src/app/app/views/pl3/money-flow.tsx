"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { allocateParticles, layoutPipes, speedFor, type PipeLayout } from "@/lib/design/pipe-layout";
import type { PlDrain, PlMoneyFlow, PlStage } from "@/lib/analytics/pipeline3-types-interim";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { CountUp, useReducedMotion } from "../speed6-base";
import { usePl, type PlFilters } from "./data";
import { money, moneyShort, pct } from "./format";

// MONEY FLOW: a network of pipes with cash running through. Each stage is a pipe segment (fatter = more money, coins slow down and a dark clog forms where deals sit too long,
// the pressure gauge compares the stage with YOUR OWN normal). Lost deals drip into the drain trough, labelled by reason. Won money fills the vault.
// Layers: SVG pipes, a canvas of coins (capped at about 300 however many deals), and a separate HTML label layer whose boxes are proven never to overlap (pipe-layout.test.ts).

export type FlowPick = { title: string; count: number; params: { stageId?: string; stale?: boolean; status?: "won" | "lost"; lostReason?: string; ownerId?: string } };
const DRAIN_VARS = ["--s6-red", "--s6-orange", "--s6-magenta", "--s6-violet", "--s6-amber", "--s6-blue", "--s6-lime", "--muted-foreground"];
const GAUGE = { green: "var(--s6-green)", amber: "var(--s6-amber)", red: "var(--s6-red)", grey: "var(--muted-foreground)" } as const;
type Coin = { s: number; t: number; lane: number; v: number; dark: boolean };
type Hot = { kind: "stage" | "drain" | "vault"; id: string } | null;

function applyView(f: PlMoneyFlow, person: string, day: number | null): { stages: PlStage[]; drains: PlDrain[]; wonCents: number; wonCount: number } {
  let stages = f.stages, drains = f.drains, wonCents = f.won.valueCents, wonCount = f.won.count;
  const p = person ? f.people.find((x) => x.id === person) : null;
  if (p) {
    stages = f.stages.map((s, i) => ({ ...s, ...(p.stages[i] ?? { count: 0, valueCents: 0, staleCount: 0, lostCount: 0, lostValueCents: 0 }), staleValueCents: s.count ? Math.round(s.staleValueCents * ((p.stages[i]?.staleCount ?? 0) / Math.max(1, s.staleCount))) : 0 }));
    const total = f.stages.reduce((a, s) => a + s.lostValueCents, 0), mine = p.stages.reduce((a, s) => a + s.lostValueCents, 0), k = total ? mine / total : 0;
    drains = f.drains.map((d) => ({ ...d, count: Math.round(d.count * k), valueCents: Math.round(d.valueCents * k) })).filter((d) => d.valueCents > 0);
    wonCents = p.wonCents; wonCount = p.wonCount;
  }
  const r = day !== null && f.replay ? f.replay[Math.min(day, f.replay.length - 1)] : null;
  if (r) { stages = stages.map((s, i) => ({ ...s, valueCents: r.stageValueCents[i] ?? s.valueCents, count: r.stageCounts[i] ?? s.count })); wonCents = r.wonCents; }
  return { stages, drains, wonCents, wonCount };
}

export function MoneyFlow({ filters, onPick }: { filters: PlFilters; onPick: (p: FlowPick) => void }) {
  const { data, error, loading, reload } = usePl<PlMoneyFlow>("money-flow", filters);
  const wrap = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(1000), [person, setPerson] = useState(""), [day, setDay] = useState<number | null>(null), [playing, setPlaying] = useState(false), [hot, setHot] = useState<Hot>(null);
  const reduced = useReducedMotion();
  const ready = data !== null && data.stages.length > 0;
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth))); ro.observe(el); setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [ready]);
  const replayLen = data?.replay?.length ?? 0;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setDay((d) => { const n = (d ?? -1) + 1; if (n >= replayLen - 1) { setPlaying(false); return replayLen - 1; } return n; }), reduced ? 500 : 230);
    return () => clearInterval(id);
  }, [playing, replayLen, reduced]);

  const view = useMemo(() => (data ? applyView(data, person, day) : null), [data, person, day]);
  const layout = useMemo<PipeLayout | null>(() => (view && view.stages.length ? layoutPipes(view.stages, view.drains, { width: Math.max(300, width) }) : null), [view, width]);
  const lostTotal = view ? view.drains.reduce((a, d) => a + d.valueCents, 0) : 0;
  const fill = view && view.wonCents + lostTotal > 0 ? view.wonCents / (view.wonCents + lostTotal) : 0;
  const closed = data ? data.won.count + data.stages.reduce((a, s) => a + s.lostCount, 0) : 0;
  const enough = data ? closed >= data.minDeals : false;

  // The coins. One stream per segment, per drip and one for the vault pipe; the total is capped no matter how many deals there are.
  const plan = useMemo(() => (layout && view ? allocateParticles([...layout.segs.map((s, i) => view.stages[i].valueCents), ...layout.drips.map((d) => view.stages.find((s) => s.id === d.id)?.lostValueCents ?? 0), view.wonCents]) : []), [layout, view]);
  const coins = useRef<Coin[]>([]);
  useEffect(() => {
    if (!layout) return;
    const cs: Coin[] = [];
    plan.forEach((n, s) => { for (let k = 0; k < n; k++) cs.push({ s, t: ((k * 0.618) % 1), lane: ((k * 37) % 11) / 5 - 1, v: 0.8 + ((k * 13) % 5) / 10, dark: false }); });
    layout.segs.forEach((seg, si) => { const m = cs.filter((c) => c.s === si); const nd = Math.min(m.length, Math.round(m.length * seg.stalePart)); m.slice(0, nd).forEach((c) => { c.dark = true; c.t = 0.45 + c.t * 0.5; }); });
    coins.current = cs;
  }, [layout, plan]);

  useEffect(() => {
    const cv = canvas.current; if (!cv || !layout) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = layout.width * dpr; cv.height = layout.height * dpr;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const L = layout, nS = L.segs.length;
    let raf = 0, last = performance.now(), frame = 0, gold = "#f5b301", glow = "#fde68a", bronze = "#7c4a03", red = "#fb7185";
    const readColors = () => { const st = getComputedStyle(cv); gold = st.getPropertyValue("--pl-gold").trim() || gold; glow = st.getPropertyValue("--pl-gold-hi").trim() || glow; bronze = st.getPropertyValue("--pl-clog").trim() || bronze; red = st.getPropertyValue("--s6-red").trim() || red; };
    const draw = (dt: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, L.width, L.height);
      for (const c of coins.current) {
        let x = 0, y = 0, a = 1, col = gold, r = 2.7;
        if (c.s < nS) {
          const seg = L.segs[c.s], sp = speedFor(seg.ratio) * (c.dark ? 0.12 : 1);
          c.t += (dt * 34 * sp * c.v) / (L.vertical ? seg.h : seg.w); if (c.dark) { if (c.t > 0.95) c.t = 0.45; } else if (c.t > 1) c.t -= 1;
          const k = Math.max(0, Math.min(1, c.t)), off = c.lane * (seg.thick / 2 - 5);
          if (L.vertical) { x = seg.x + seg.w / 2 + off; y = seg.y + k * seg.h; } else { x = seg.x + k * seg.w; y = seg.y + seg.h / 2 + off; }
          col = c.dark ? bronze : gold; if (c.dark) r = 2.3;
        } else if (c.s < nS + L.drips.length) {
          const d = L.drips[c.s - nS]; c.t += dt * 0.55 * c.v; if (c.t > 1) c.t -= 1;
          x = d.x1 + (d.x2 - d.x1) * c.t + (L.vertical ? 0 : (c.lane * d.width) / 3); y = d.y1 + (d.y2 - d.y1) * c.t + (L.vertical ? (c.lane * d.width) / 3 : 0); col = red; r = 2.2; a = 1 - c.t * 0.3;
        } else {
          const k = L.connector; c.t += dt * 0.45 * c.v; if (c.t > 1) c.t -= 1;
          if (L.vertical) { x = k.x + k.w / 2 + c.lane * 3; y = k.y + c.t * k.h; } else { x = k.x + c.t * k.w; y = k.y + k.h / 2 + c.lane * 3; }
          a = c.t > 0.85 ? (1 - c.t) / 0.15 : 1; r = 2.9;
        }
        if (a <= 0) continue;
        ctx.globalAlpha = a * 0.35; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, r + 2.4, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = a; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    readColors();
    if (reduced) { draw(0.4); return; }
    const tick = (now: number) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; if (++frame % 90 === 0) readColors(); draw(dt); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout, reduced, plan]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <SkeletonRows rows={6} label="Loading the money flow..." />;
  if (!layout || !view) return <EmptyState title="No open deals in these dates" body="When deals are in your pipeline, you will see the money run through it here. Change the dates or the account above to look further back." />;

  const stageOf = (id: string) => view.stages.find((s) => s.id === id)!;
  const pickStage = (s: PlStage, stale = false) => onPick({ title: stale ? `${s.name}, stuck deals` : `${s.name}, open deals`, count: stale ? s.staleCount : s.count, params: { stageId: s.id, stale, ownerId: person || undefined } });
  const hotStage = hot?.kind === "stage" ? stageOf(hot.id.replace("stage:", "")) : null, hotSeg = hotStage ? layout.segs.find((g) => g.id === hotStage.id) : null;
  const dayLabel = day !== null && data.replay ? data.replay[Math.min(day, data.replay.length - 1)].date : null;
  const px = (r: { x: number; y: number; w: number; h: number }) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
  const drainTot = Math.max(1, layout.drainOrder.reduce((t, d) => t + d.valueCents, 0)), drainW = layout.drainOrder.map((d) => Math.max(4, (d.valueCents / drainTot) * (layout.trough.w - 6)));
  const drainX = drainW.map((_, i) => layout.trough.x + 3 + drainW.slice(0, i).reduce((t, w) => t + w, 0));
  const totalStale = view.stages.reduce((a, s) => a + s.staleCount, 0);

  return (
    <div className="pl-flow" data-testid="pl-flow" aria-busy={loading}>
      <div className="pl-flow-bar">
        <h3 className="pl-flow-title">{data.pipelineName}<span className="ap-sub"> · {data.periodLabel}</span></h3>
        <label className="sr-only" htmlFor="pl-person">Whose pipe</label>
        <select id="pl-person" className="ap-field" value={person} onChange={(e) => { setPerson(e.target.value); setDay(null); setPlaying(false); }} data-testid="pl-person">
          <option value="">Everyone&apos;s deals</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}&apos;s deals</option>)}
        </select>
        {data.replay && data.replay.length > 1 && (
          <div className="pl-replay" data-testid="pl-replay">
            <button type="button" className="s6-btn" onClick={() => { if (playing) setPlaying(false); else { if (day === null || day >= replayLen - 1) setDay(0); setPlaying(true); } }} aria-label={playing ? "Pause the replay" : "Replay how the money moved"} data-testid="pl-play">{playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}{playing ? "Pause" : "Replay"}</button>
            <input type="range" min={0} max={replayLen - 1} value={day ?? replayLen - 1} onChange={(e) => { setPlaying(false); setDay(Number(e.target.value)); }} aria-label="Pick a day to look at" data-testid="pl-scrub" />
            <span className="ap-fine tnum" aria-live="polite">{dayLabel ?? "Today"}</span>
            {day !== null && <button type="button" className="ap-link" onClick={() => { setDay(null); setPlaying(false); }}><RotateCcw aria-hidden className="mr-1 inline size-3" />Back to today</button>}
          </div>
        )}
      </div>
      <p className="ap-fine mb-2">Fatter pipe = more money. Coins slow down and a dark clog forms where deals sit longer than your own normal. Red drips are lost deals. Click any part to open exactly those deals.</p>

      <div className="pl-pipe" ref={wrap} style={{ height: layout.height }} data-vertical={layout.vertical ? "1" : "0"}>
        <svg className="pl-svg" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Pipes showing money moving through each stage">
          <defs>
            <pattern id="pl-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--pl-clog)" /><rect width="2.4" height="6" fill="var(--pl-clog-hi)" /></pattern>
            <linearGradient id="pl-vault" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--pl-gold-hi)" /><stop offset="1" stopColor="var(--pl-gold)" /></linearGradient>
          </defs>
          <rect className="pl-pipe-body" x={layout.connector.x} y={layout.connector.y} width={layout.connector.w} height={layout.connector.h} rx={6} />
          {layout.channel && <rect className="pl-channel" x={layout.channel.x} y={layout.channel.y} width={layout.channel.w} height={layout.channel.h} rx={7} />}
          {layout.drips.map((d) => <line key={d.id} className="pl-drip" x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} strokeWidth={d.width} strokeLinecap="round" />)}
          {layout.segs.map((g) => {
            const s = view.stages[g.index], on = hot?.id === `stage:${g.id}`, clogW = g.stalePart > 0 ? Math.max(12, Math.min(g.w * 0.5, g.stalePart * g.w * 1.8)) : 0;
            return (
              <g key={g.id} className="pl-seg" data-tone={g.tone} data-on={on ? "1" : "0"}>
                <rect className="pl-pipe-body" x={g.x} y={g.y} width={g.w} height={g.h} rx={Math.min(10, g.thick / 2)} />
                <rect className="pl-liquid" x={g.x + 3} y={g.y + 3} width={Math.max(2, g.w - 6)} height={Math.max(2, g.h - 6)} rx={Math.min(8, g.thick / 2)} />
                {clogW > 0 && (layout.vertical ? <rect className="pl-clog" x={g.x + 3} y={g.y + g.h - clogW - 3} width={Math.max(2, g.w - 6)} height={clogW} rx={4} fill="url(#pl-hatch)" /> : <rect className="pl-clog" x={g.x + g.w * 0.95 - clogW} y={g.y + 3} width={clogW} height={Math.max(2, g.h - 6)} rx={4} fill="url(#pl-hatch)" />)}
                <rect className="pl-hit" x={g.x} y={g.y - 6} width={g.w} height={g.h + 12} tabIndex={0} role="button" aria-label={`${s.name}: ${s.count} open deals worth ${money(s.valueCents)}. Open them.`} data-testid={`pl-seg-${g.id}`}
                  onMouseEnter={() => setHot({ kind: "stage", id: `stage:${g.id}` })} onMouseLeave={() => setHot(null)} onFocus={() => setHot({ kind: "stage", id: `stage:${g.id}` })} onBlur={() => setHot(null)}
                  onClick={() => pickStage(s)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickStage(s); } }} />
              </g>
            );
          })}
          {layout.valves.map((v, i) => <g key={i} className="pl-valve"><circle cx={v.x} cy={v.y} r={v.r} /><line x1={v.x - v.r + 3} y1={v.y} x2={v.x + v.r - 3} y2={v.y} /><line x1={v.x} y1={v.y - v.r + 3} x2={v.x} y2={v.y + v.r - 3} /></g>)}
          {layout.gauges.map((g) => {
            const a = (g.angle * Math.PI) / 180;
            return <g key={g.id} className="pl-gauge"><path d={`M ${g.cx - g.r} ${g.cy} A ${g.r} ${g.r} 0 0 1 ${g.cx + g.r} ${g.cy}`} fill="none" strokeWidth={4} className="pl-gauge-arc" /><line x1={g.cx} y1={g.cy} x2={g.cx + (g.r - 3) * Math.sin(a)} y2={g.cy - (g.r - 3) * Math.cos(a)} stroke={GAUGE[g.tone]} strokeWidth={2.4} strokeLinecap="round" /><circle cx={g.cx} cy={g.cy} r={2.6} fill={GAUGE[g.tone]} /></g>;
          })}
          <rect className="pl-trough" x={layout.trough.x} y={layout.trough.y} width={layout.trough.w} height={layout.trough.h} rx={9} />
          {layout.drainOrder.map((d, i) => <rect key={d.reason} className="pl-drain-seg" x={drainX[i]} y={layout.trough.y + 3} width={Math.max(2, drainW[i] - 2)} height={layout.trough.h - 6} rx={5} style={{ fill: `var(${DRAIN_VARS[i % DRAIN_VARS.length]})` }} data-on={hot?.id === `drain:${d.reason}` ? "1" : "0"} onMouseEnter={() => setHot({ kind: "drain", id: `drain:${d.reason}` })} onMouseLeave={() => setHot(null)} onClick={() => onPick({ title: `Lost: ${d.reason}`, count: d.count, params: { status: "lost", lostReason: d.reason } })} />)}
          <g className="pl-vault" onMouseEnter={() => setHot({ kind: "vault", id: "vault" })} onMouseLeave={() => setHot(null)} onClick={() => onPick({ title: "Won deals", count: view.wonCount, params: { status: "won", ownerId: person || undefined } })} role="button" tabIndex={0} aria-label={`Vault: ${view.wonCount} won deals worth ${money(view.wonCents)}. Open them.`} data-testid="pl-vault" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick({ title: "Won deals", count: view.wonCount, params: { status: "won", ownerId: person || undefined } }); } }}>
            <rect className="pl-vault-body" x={layout.vault.x} y={layout.vault.y} width={layout.vault.w} height={layout.vault.h} rx={14} />
            <rect className="pl-vault-fill" fill="url(#pl-vault)" rx={11} x={layout.vault.x + 4} width={layout.vault.w - 8} style={layout.vertical ? { y: layout.vault.y + 4, height: layout.vault.h - 8, transform: `scaleX(${Math.max(0.02, fill)})`, transformOrigin: `${layout.vault.x + 4}px 0` } : { y: layout.vault.y + 4 + (layout.vault.h - 8) * (1 - fill), height: Math.max(2, (layout.vault.h - 8) * fill) }} />
          </g>
        </svg>
        <canvas ref={canvas} className="pl-canvas" style={{ width: layout.width, height: layout.height }} aria-hidden />
        <div className="pl-labels">
          {layout.labels.map((l) => {
            if (l.kind === "stage") { const s = stageOf(l.id.slice(6)); return <button key={l.id} type="button" className="pl-lab pl-lab-stage" style={px(l.rect)} onClick={() => pickStage(s)} title={`${s.name}: ${s.count} deals, ${money(s.valueCents)}`} tabIndex={-1}><b>{s.name}</b><span className="pl-val tnum">{moneyShort(s.valueCents)}</span><small>{s.count} deals{s.staleCount > 0 && <> · <u>{s.staleCount} stuck</u></>}</small></button>; }
            if (l.kind === "gauge") { const g = layout.segs.find((x) => `gauge:${x.id}` === l.id)!; return <div key={l.id} className="pl-lab pl-lab-gauge" style={px(l.rect)} data-tone={g.tone}>{g.ratio === null ? "No history yet" : g.ratio <= 1.25 ? "Normal pace" : `${g.ratio.toFixed(1)}x slower`}</div>; }
            if (l.kind === "drain") { const i = layout.drainOrder.findIndex((d) => `drain:${d.reason}` === l.id), d = layout.drainOrder[i]; return <button key={l.id} type="button" className="pl-lab pl-lab-drain" style={px(l.rect)} onClick={() => onPick({ title: `Lost: ${d.reason}`, count: d.count, params: { status: "lost", lostReason: d.reason } })} title={`${d.reason}: ${d.count} deals, ${money(d.valueCents)}`}><i style={{ background: `var(${DRAIN_VARS[i % DRAIN_VARS.length]})` }} aria-hidden /><span>{d.reason}</span><b className="tnum">{d.count}</b></button>; }
            return <button key={l.id} type="button" className="pl-lab pl-lab-vault" style={px(l.rect)} onClick={() => onPick({ title: "Won deals", count: view.wonCount, params: { status: "won", ownerId: person || undefined } })} tabIndex={-1}><small>Won</small><b className="tnum">$<CountUp value={Math.round(view.wonCents / 100)} /></b><small>{view.wonCount} deals{enough && view.wonCents + lostTotal > 0 ? ` · ${pct(fill)} of closed money` : ""}</small></button>;
          })}
        </div>
        {hotStage && hotSeg && (
          <div className="pl-tip" role="status" style={{ left: Math.max(8, Math.min(layout.width - 228, hotSeg.x + hotSeg.w / 2 - 110)), top: layout.vertical ? hotSeg.y + hotSeg.h / 2 : hotSeg.y + hotSeg.h + 8 }}>
            <b>{hotStage.name}</b>
            <span>{hotStage.count} open deals, {money(hotStage.valueCents)}</span>
            <span>Median time here {hotStage.medianDwellDays === null ? "not known yet" : `${hotStage.medianDwellDays} days`}{hotStage.normalDwellDays ? ` (your normal ${hotStage.normalDwellDays})` : ""}</span>
            <span>{hotStage.staleCount > 0 ? `${hotStage.staleCount} stuck, ${money(hotStage.staleValueCents)}` : "Nothing stuck"} · {hotStage.lostCount} lost from here</span>
          </div>
        )}
      </div>

      <ul className="sr-only" aria-label="Money flow in words">{view.stages.map((s) => <li key={s.id}>{s.name}: {s.count} deals, {money(s.valueCents)}, {s.staleCount} stuck, {s.lostCount} lost.</li>)}<li>Won: {view.wonCount} deals, {money(view.wonCents)}.</li></ul>
      <div className="pl-flow-foot">
        {data.leak && enough && <button type="button" className="pl-leak" onClick={() => { const s = data.stages.find((x) => x.name === data.leak!.fromStage); if (s) pickStage(s); }} data-testid="pl-leak">Biggest leak: {money(data.leak.lostCents)} left between <b>{data.leak.fromStage}</b> and <b>{data.leak.toStage}</b>. Open those deals.</button>}
        {!enough && <p className="ap-fine" role="status">Not enough closed deals yet ({closed} of {data.minDeals} needed) to name the biggest leak or show a win share. The pipes above are still true.</p>}
        {totalStale > 0 && <span className="ap-chip" data-tone="amber">{totalStale} stuck deals, {money(view.stages.reduce((a, s) => a + s.staleValueCents, 0))}</span>}
        {data.outlier && <p className="ap-fine">{data.outlier.name} is {pct(data.outlier.share)} of the money, so it is shown on its own in the vault and not blended into the averages.</p>}
        <p className="ap-fine">Left out of the money: {data.excluded.zeroValue} deals with no value, {data.excluded.noOwner} with no owner, {data.excluded.test} test deals. Vault share = won money divided by won plus lost money in these dates.</p>
      </div>
    </div>
  );
}
