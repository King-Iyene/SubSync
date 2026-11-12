"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { funnelLayout, bandWidthAt } from "@/lib/design/funnel-layout";
import { layoutStacks, type Rect, type StackCol } from "@/lib/design/stack-layout";
import type { PlDrain, PlMoneyFlow, PlStage } from "@/lib/analytics/pipeline3-types-interim";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { useReducedMotion } from "../speed6-base";
import { usePl, type PlFilters } from "./data";
import { money, moneyShort, pct } from "./format";

// MONEY FLOW. Default view is the stage FUNNEL (tapered bands, width = money in the stage, drops fall down it, % between stages, biggest leak marked). The "Coins" toggle keeps the older view:
// "Coin stacks": one column per stage in the account's own order. Each stack is flat coins, height = the money in that stage (one coin = one value step, never more than 40 coins).
// Won is a tall stack in the one accent colour, lost is a muted grey stack, stuck money is the hatched top of a stack. Coins settle once on load.
// Text lives in its own layer (stack-layout.test.ts proves it never overlaps the coins).

export type FlowPick = { title: string; count: number; params: { stageId?: string; stale?: boolean; status?: "won" | "lost"; lostReason?: string; ownerId?: string } };

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
  const wrap = useRef<HTMLDivElement>(null);
  const [view2, setView2] = useState<"funnel" | "coins">("funnel"), [width, setWidth] = useState(1000), [person, setPerson] = useState(""), [day, setDay] = useState<number | null>(null), [settle, setSettle] = useState(true), [run, setRun] = useState(0);
  const reduced = useReducedMotion();
  const ready = data !== null && data.stages.length > 0;
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth))); ro.observe(el); setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [ready, view2]);
  useEffect(() => { if (!settle) return; const t = setTimeout(() => setSettle(false), 1000); return () => clearTimeout(t); }, [settle, run]);
  const replayLen = data?.replay?.length ?? 0;
  const view = useMemo(() => (data ? applyView(data, person, day) : null), [data, person, day]);
  const layout = useMemo(() => (view && view.stages.length ? layoutStacks(view.stages.map((s) => ({ id: s.id, name: s.name, valueCents: s.valueCents, count: s.count, staleCount: s.staleCount, staleValueCents: s.staleValueCents })), view.wonCents, view.wonCount, view.drains, { width: Math.max(300, width) }) : null), [view, width]);
  const fl = useMemo(() => (view && view.stages.length ? funnelLayout(view.stages.map((s) => ({ id: s.id, name: s.name, valueCents: s.valueCents, count: s.count, staleCount: s.staleCount, staleValueCents: s.staleValueCents, lostValueCents: s.lostValueCents })), view.wonCents) : null), [view]);
  const lostTotal = view ? view.drains.reduce((a, d) => a + d.valueCents, 0) : 0;
  const closed = data ? data.won.count + data.stages.reduce((a, s) => a + s.lostCount, 0) : 0;
  const enough = data ? closed >= data.minDeals : false;

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <SkeletonRows rows={6} label="Loading the money by stage..." />;
  if (!layout || !view || !fl) return <EmptyState title="No open deals in these dates" body="When deals are in your pipeline, the money in each stage shows here. Change the dates or the account above to look further back." />;

  const stageOf = (id: string) => view.stages.find((s) => s.id === id)!;
  const pickStage = (s: PlStage, stale = false) => onPick({ title: stale ? `${s.name}, stuck deals` : `${s.name}, open deals`, count: stale ? s.staleCount : s.count, params: { stageId: s.id, stale, ownerId: person || undefined } });
  const pickWon = () => onPick({ title: "Won deals", count: view.wonCount, params: { status: "won", ownerId: person || undefined } });
  const pickLost = (d?: PlDrain) => onPick(d ? { title: `Lost: ${d.reason}`, count: d.count, params: { status: "lost", lostReason: d.reason } } : { title: "Lost deals", count: view.drains.reduce((a, x) => a + x.count, 0), params: { status: "lost" } });
  const dayLabel = day !== null && data.replay ? data.replay[Math.min(day, data.replay.length - 1)].date : null;
  const px = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
  const box = (r: Rect) => ({ left: r.x, top: r.y, width: r.w, height: r.h });
  const press = (fn: () => void) => ({ onClick: fn, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } }, tabIndex: 0, role: "button" as const });
  const totalStale = view.stages.reduce((a, s) => a + s.staleCount, 0);
  const coinEl = (c: StackCol["coins"][number], i: number, n: number) => <rect key={i} className={`pl-coin pl-coin-${c.kind}`} x={c.x} y={c.y} width={c.w} height={c.h} rx={layout.vertical ? 2 : 2.75} style={{ animationDelay: `${Math.round((i / Math.max(1, n)) * 260)}ms` }} />;
  const colOf = (c: StackCol) => {
    const lab = `${c.name}: ${c.count} ${c.kind === "stage" ? "open " : ""}deals worth ${money(c.valueCents)}`;
    if (c.kind === "stage") {
      const s = stageOf(c.id);
      return <g key={c.id} className="pl-grp">{c.coins.map((k, i) => coinEl(k, i, c.coins.length))}
        {c.openRect && <rect className="pl-hit" {...px(c.openRect)} {...press(() => pickStage(s))} aria-label={`${lab}. Open them.`} data-testid={`pl-seg-${c.id}`}><title>{lab}</title></rect>}
        {c.stuckRect && <rect className="pl-hit" {...px(c.stuckRect)} {...press(() => pickStage(s, true))} aria-label={`${c.stuckCount} stuck deals in ${c.name}. Open them.`} data-testid={`pl-stuck-${c.id}`}><title>{`${c.stuckCount} stuck in ${c.name}`}</title></rect>}</g>;
    }
    if (c.kind === "won") return <g key={c.id} className="pl-grp">{c.coins.map((k, i) => coinEl(k, i, c.coins.length))}<rect className="pl-hit" {...px(c.stack)} {...press(pickWon)} aria-label={`${lab}. Open them.`} data-testid="pl-vault"><title>{lab}</title></rect></g>;
    return <g key={c.id} className="pl-grp">{c.coins.map((k, i) => coinEl(k, i, c.coins.length))}
      {c.segs.map((g) => { const d = view.drains.find((x) => x.reason === g.reason); return <rect key={g.reason} className="pl-hit" {...px(g.rect)} {...press(() => pickLost(d))} aria-label={`Lost, ${g.reason}. Open them.`}><title>{g.reason}</title></rect>; })}</g>;
  };

  return (
    <div className="pl-flow" data-testid="pl-flow" aria-busy={loading}>
      <div className="pl-flow-bar">
        <h3 className="pl-flow-title">{data.pipelineName}<span className="ap-sub"> · {data.periodLabel}</span></h3>
        <label className="sr-only" htmlFor="pl-person">Whose deals</label>
        <select id="pl-person" className="ap-field" value={person} onChange={(e) => { setPerson(e.target.value); setDay(null); }} data-testid="pl-person">
          <option value="">Everyone&apos;s deals</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}&apos;s deals</option>)}
        </select>
        <div className="pl-viewtog" role="group" aria-label="How to show the money">
          <button type="button" className="pl-vt" aria-pressed={view2 === "funnel"} onClick={() => { setView2("funnel"); setSettle(true); setRun((r) => r + 1); }} data-testid="pl-view-funnel">Funnel</button>
          <button type="button" className="pl-vt" aria-pressed={view2 === "coins"} onClick={() => { setView2("coins"); setSettle(true); setRun((r) => r + 1); }} data-testid="pl-view-coins">Coins</button>
        </div>
        <div className="pl-replay" data-testid="pl-replay">
          <button type="button" className="s6-btn" onClick={() => { setDay(null); setRun((r) => r + 1); setSettle(true); }} aria-label={view2 === "funnel" ? "Replay the money flowing down" : "Replay the coins settling"} data-testid="pl-play"><RotateCcw aria-hidden className="size-4" />Replay</button>
          {replayLen > 1 && <>
            <input type="range" min={0} max={replayLen - 1} value={day ?? replayLen - 1} onChange={(e) => setDay(Number(e.target.value))} aria-label="Pick a day to look at" data-testid="pl-scrub" />
            <span className="ap-fine tnum" aria-live="polite">{dayLabel ?? "Today"}</span>
            {day !== null && <button type="button" className="ap-link" onClick={() => setDay(null)}>Back to today</button>}
          </>}
        </div>
      </div>
      {view2 === "coins" ? <p className="ap-fine mb-2">One coin = {money(layout.step)}. Taller stack = more money in that stage. The hatched top is deals stuck longer than that stage&apos;s own normal. Click any stack to open exactly those deals.</p>
        : <p className="ap-fine mb-2">Wider band = more money in that stage. The hatched part is deals stuck longer than that stage&apos;s own normal. The percentage is the share of the money that reached the next step (an estimate). Click a band to open exactly those deals.</p>}

      {view2 === "funnel" ? <>
      <ol className="pl-funnel" aria-label="Funnel of money by stage" data-testid="pl-funnel" data-settle={settle && !reduced ? "1" : "0"} key={`f${run}`}>
        {fl.rows.map((r, i) => {
          const s = stageOf(r.id), leak = enough && !!data.leak && i === fl.leakIndex && s.name === data.leak.fromStage;
          const half = (t: number) => bandWidthAt(r, t) / 2;
          const stuckClip = r.stuckFrac > 0 ? (() => { const t = 1 - r.stuckFrac, top = half(t), bot = half(1), w = Math.max(r.topW, r.bottomW) || 1; const x = (h: number) => ((50 + h - (50 - w / 2)) / w) * 100, xl = (h: number) => ((50 - h - (50 - w / 2)) / w) * 100; return `polygon(${xl(top)}% 0, ${x(top)}% 0, ${x(bot)}% 100%, ${xl(bot)}% 100%)`; })() : undefined;
          const lab = `${s.name}: ${s.count} open deals worth ${money(s.valueCents)}`;
          const nextName = i + 1 < fl.rows.length ? fl.rows[i + 1].name : "Won";
          const wide = Math.max(r.topW, r.bottomW);
          return <li key={r.id} className="fn-item" data-leak={leak ? "1" : "0"}>
            <div className="fn-row">
              <div className="fn-label"><b>{r.name}</b><span className="fn-val tnum">{moneyShort(r.valueCents)}</span><small>{r.count} deals{r.staleCount > 0 && <> · <u>{r.staleCount} stuck</u></>}</small></div>
              <div className="fn-band">
                <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden className="fn-svg">
                  {r.topW > 0 && <polygon className="fn-open" points={`${50 - half(0)},0 ${50 + half(0)},0 ${50 + half(1)},40 ${50 - half(1)},40`} vectorEffect="non-scaling-stroke" />}
                </svg>
                {r.topW > 0 && r.stuckFrac > 0 && <div className="fn-stuckfill" aria-hidden style={{ left: `${50 - wide / 2}%`, width: `${wide}%`, height: `${r.stuckFrac * 100}%`, clipPath: stuckClip }} />}
                <div className="fn-drops" aria-hidden>{Array.from({ length: r.drops }, (_, k) => <i key={k} className="fn-drop" style={{ left: `${50 + (((k * 37) % 61) / 61 - 0.5) * wide * 0.7}%`, animationDelay: `${i * 140 + k * 170}ms` }} />)}</div>
                {r.topW > 0 && <button type="button" className="fn-hit" style={{ left: `${50 - r.topW / 2}%`, width: `${r.topW}%`, top: 0, height: r.stuckFrac > 0 ? `${(1 - r.stuckFrac) * 100}%` : "100%" }} onClick={() => pickStage(s)} aria-label={`${lab}. Open them.`} title={lab} data-testid={`pl-seg-${r.id}`} />}
                {r.topW > 0 && r.stuckFrac > 0 && <button type="button" className="fn-hit" style={{ left: `${50 - bandWidthAt(r, 1 - r.stuckFrac) / 2}%`, width: `${bandWidthAt(r, 1 - r.stuckFrac)}%`, bottom: 0, height: `${r.stuckFrac * 100}%` }} onClick={() => pickStage(s, true)} aria-label={`${r.staleCount} stuck deals in ${r.name}. Open them.`} title={`${r.staleCount} stuck in ${r.name}`} data-testid={`pl-stuck-${r.id}`} />}
              </div>
            </div>
            <div className="fn-conv" data-leak={leak ? "1" : "0"} title="Money that reached the next step, divided by money that reached this step (open, lost and won from here on). An estimate.">
              <span aria-hidden>↓</span>{r.conv === null ? <span>Not enough data</span> : <span className="tnum"><b>{Math.round(r.conv * 100)}%</b> reach {nextName}</span>}
              {leak && <button type="button" className="fn-leaktag" onClick={() => pickStage(s)}>Biggest leak: {moneyShort(data.leak!.lostCents)} left here</button>}
            </div>
          </li>;
        })}
        <li className="fn-item fn-end">
          <div className="fn-row">
            <div className="fn-label fn-won"><b>Won</b><span className="fn-val tnum">{moneyShort(view.wonCents)}</span><small>{view.wonCount} deals</small></div>
            <div className="fn-band"><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden className="fn-svg"><rect className="fn-wonbar" x={50 - fl.wonW / 2} y="4" width={fl.wonW} height="32" /></svg>
              {fl.wonW > 0 && <button type="button" className="fn-hit" style={{ left: `${50 - fl.wonW / 2}%`, width: `${fl.wonW}%`, top: 0, height: "100%" }} onClick={pickWon} aria-label={`Won: ${view.wonCount} deals worth ${money(view.wonCents)}. Open them.`} title={`Won: ${money(view.wonCents)}`} data-testid="pl-vault" />}</div>
          </div>
          <div className="fn-row fn-lostrow">
            <div className="fn-label fn-lost"><b>Lost</b><span className="fn-val tnum">{moneyShort(lostTotal)}</span><small>{view.drains.reduce((a, d) => a + d.count, 0)} deals</small></div>
            <div className="fn-band"><button type="button" className="fn-lostbar" onClick={() => pickLost()} aria-label={`Lost: ${money(lostTotal)}. Open them.`} title={`Lost: ${money(lostTotal)}`} data-testid="pl-lost">Left the funnel. Reasons below.</button></div>
          </div>
        </li>
      </ol>
      </> : <>
      <div className="pl-stackscroll" ref={wrap}><div className="pl-stacks" style={{ height: layout.height, width: layout.width }} data-settle={settle && !reduced ? "1" : "0"} data-vertical={layout.vertical ? "1" : "0"} key={`s${run}`}>
        <svg className="pl-svg" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Stacks of coins, one per stage, showing the money in each">
          <defs><pattern id="pl-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" className="pl-hatch-bg" /><rect width="1.6" height="5" className="pl-hatch-line" /></pattern></defs>
          {!layout.vertical && layout.cols.map((c) => <line key={`b${c.id}`} className="pl-base" x1={c.stack.x} x2={c.stack.x + c.stack.w} y1={c.stack.y + c.stack.h + 2} y2={c.stack.y + c.stack.h + 2} />)}
          {layout.cols.map(colOf)}
        </svg>
        <div className="pl-labels">
          {layout.cols.map((c) => {
            const go = c.kind === "stage" ? () => pickStage(stageOf(c.id)) : c.kind === "won" ? pickWon : () => pickLost();
            return <button key={c.id} type="button" className={`pl-lab pl-lab-${c.kind}`} style={box(c.label)} onClick={go} title={`${c.name}: ${c.count} deals, ${money(c.valueCents)}`} tabIndex={-1}>
              <b>{c.name}</b><span className="pl-val tnum">{moneyShort(c.valueCents)}</span><small>{c.count} deals{c.stuckCount > 0 && <> · <u>{c.stuckCount} stuck</u></>}</small>
            </button>;
          })}
        </div>
      </div></div>

      </>}

      {view.drains.length > 0 && (
        <ul className="pl-reasons" aria-label="Why deals were lost">
          {[...view.drains].sort((a, b) => b.valueCents - a.valueCents).map((d) => <li key={d.reason}><button type="button" className="pl-reason" onClick={() => pickLost(d)} title={`${d.reason}: ${d.count} deals, ${money(d.valueCents)}`}><span>{d.reason}</span><b className="tnum">{d.count}</b><span className="tnum">{moneyShort(d.valueCents)}</span></button></li>)}
        </ul>
      )}
      <ul className="sr-only" aria-label="Money by stage in words">{view.stages.map((s) => <li key={s.id}>{s.name}: {s.count} deals, {money(s.valueCents)}, {s.staleCount} stuck, {s.lostCount} lost.</li>)}<li>Won: {view.wonCount} deals, {money(view.wonCents)}.</li><li>Lost: {money(lostTotal)}.</li></ul>
      <div className="pl-flow-foot">
        {data.leak && enough && <button type="button" className="pl-leak" onClick={() => { const s = data.stages.find((x) => x.name === data.leak!.fromStage); if (s) pickStage(s); }} data-testid="pl-leak">Biggest leak: {money(data.leak.lostCents)} left between <b>{data.leak.fromStage}</b> and <b>{data.leak.toStage}</b>. Open those deals.</button>}
        {!enough && <p className="ap-fine" role="status">Not enough closed deals yet ({closed} of {data.minDeals} needed) to name the biggest leak. The stacks above are still true.</p>}
        {totalStale > 0 && <p className="ap-fine">{totalStale} stuck deals, {money(view.stages.reduce((a, s) => a + s.staleValueCents, 0))} in total.</p>}
        {data.outlier && <p className="ap-fine">{data.outlier.name} is {pct(data.outlier.share)} of the money, so it is left out of the averages.</p>}
        <p className="ap-fine">Left out of the money: {data.excluded.zeroValue} deals with no value, {data.excluded.noOwner} with no owner, {data.excluded.test} test deals.</p>
      </div>
    </div>
  );
}
