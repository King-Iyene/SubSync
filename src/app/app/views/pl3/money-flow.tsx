"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { riverLayout } from "@/lib/design/river-layout";
import type { PlDrain, PlMoneyFlow, PlStage } from "@/lib/analytics/pipeline3-types-interim";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { useReducedMotion } from "../speed6-base";
import { usePl, type PlFilters } from "./data";
import { money, moneyShort, pct } from "./format";
import { FLOW_FIXTURE } from "./fixtures";
import { River } from "./river-view";

/** Fake numbers for looking at the shape of the river. Shown only when the user asks, always marked Example, never mixed with real data. */
export const FLOW_EXAMPLE: PlMoneyFlow = { ...FLOW_FIXTURE, pipelineName: "Example pipeline", periodLabel: "Example numbers, not yours", people: [], replay: null, excluded: { zeroValue: 0, noOwner: 0, test: 0 }, outlier: null };
/** True when real deals exist but none has a value, so the river counts deals instead of dollars. */
export const hasNoValuedDeals = (f: PlMoneyFlow | null): boolean => !!f && f.stages.length > 0 && f.won.valueCents === 0 && f.stages.every((s) => s.valueCents === 0);

// MONEY FLOW = the RIVER (river-view.tsx): ribbons between stages (conversion % on each), piles of cash where deals sit, stuck piles hatched ochre, lost money drains into a muted channel, won lands in the vault.
// When no deal has a dollar value the same picture counts DEALS (cards instead of bills) so the screen is never blank. The old coin stacks are kept in the unused coin file, hidden at King's request.

export type FlowPick = { title: string; count: number; params: { stageId?: string; bucket?: "no_value"; stale?: boolean; status?: "won" | "lost"; lostReason?: string; ownerId?: string } };

function applyView(f: PlMoneyFlow, person: string, day: number | null): { stages: PlStage[]; drains: PlDrain[]; wonCents: number; wonCount: number } {
  let stages = f.stages, drains = f.drains, wonCents = f.won.valueCents, wonCount = f.won.count;
  const p = person ? f.people.find((x) => x.id === person) : null;
  if (p) {
    stages = f.stages.map((s, i) => ({ ...s, ...(p.stages[i] ?? { count: 0, valueCents: 0, staleCount: 0, lostCount: 0, lostValueCents: 0 }), noValueCount: 0, staleValueCents: s.count ? Math.round(s.staleValueCents * ((p.stages[i]?.staleCount ?? 0) / Math.max(1, s.staleCount))) : 0 }));
    const total = f.stages.reduce((a, s) => a + s.lostValueCents, 0), mine = p.stages.reduce((a, s) => a + s.lostValueCents, 0), k = total ? mine / total : 0;
    drains = f.drains.map((d) => ({ ...d, count: Math.round(d.count * k), valueCents: Math.round(d.valueCents * k) })).filter((d) => d.valueCents > 0);
    wonCents = p.wonCents; wonCount = p.wonCount;
  }
  const r = day !== null && f.replay ? f.replay[Math.min(day, f.replay.length - 1)] : null;
  if (r) { stages = stages.map((s, i) => ({ ...s, valueCents: r.stageValueCents[i] ?? s.valueCents, count: r.stageCounts[i] ?? s.count })); wonCents = r.wonCents; }
  return { stages, drains, wonCents, wonCount };
}

export function MoneyFlow({ filters, onPick: realPick }: { filters: PlFilters; onPick: (p: FlowPick) => void }) {
  const real = usePl<PlMoneyFlow>("money-flow", filters), { error, loading, reload } = real;
  const [example, setExample] = useState(false);
  const noValued = hasNoValuedDeals(real.data);
  // The example is only ever offered when the pipeline has no valued deals. It never replaces real data otherwise.
  const showExample = example && noValued;
  const data = showExample ? FLOW_EXAMPLE : real.data;
  const onPick = showExample ? () => {} : realPick;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000), [person, setPerson] = useState(""), [day, setDay] = useState<number | null>(null), [settle, setSettle] = useState(true), [run, setRun] = useState(0);
  const reduced = useReducedMotion();
  const ready = data !== null && data.stages.length > 0;
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth))); ro.observe(el); setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [ready]);
  useEffect(() => { if (!settle) return; const t = setTimeout(() => setSettle(false), 5600); return () => clearTimeout(t); }, [settle, run]);
  const replayLen = data?.replay?.length ?? 0;
  const view = useMemo(() => (data ? applyView(data, person, day) : null), [data, person, day]);
  // No deal has a dollar value (and we are not showing the example): count deals so the screen is never blank.
  const counts = noValued && !showExample;
  const empty = useMemo(() => !view || riverLayout(view.stages.map((s) => ({ id: s.id, name: s.name, open: counts ? s.count + (s.noValueCount ?? 0) : s.valueCents, stuck: 0, lost: counts ? s.lostCount : s.lostValueCents })), counts ? view.wonCount : view.wonCents, { length: 600, thick: 200, nodeW: 30 }).empty, [view, counts]);
  const lostTotal = view ? view.drains.reduce((a, d) => a + d.valueCents, 0) : 0;
  const closed = data ? data.won.count + data.stages.reduce((a, s) => a + s.lostCount, 0) : 0;
  const enough = data ? closed >= data.minDeals : false;

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <SkeletonRows rows={6} label="Loading the deal flow..." />;
  if (!view || !view.stages.length || empty) return <EmptyState title="No open deals in these dates" body="When deals are in your pipeline, you will see them flow stage by stage here. Change the dates or the account above to look further back." />;

  const pickStage = (s: PlStage, stale = false) => onPick({ title: stale ? `${s.name}, stuck deals` : `${s.name}, open deals`, count: stale ? s.staleCount : s.count, params: { stageId: s.id, stale, ownerId: person || undefined } });
  const pickNoValue = (s: PlStage) => onPick({ title: `${s.name}, deals without a value`, count: s.noValueCount ?? 0, params: { stageId: s.id, bucket: "no_value" } });
  const noValueSteps = person ? [] : view.stages.filter((s) => (s.noValueCount ?? 0) > 0);
  const pickWon = () => onPick({ title: "Won deals", count: view.wonCount, params: { status: "won", ownerId: person || undefined } });
  const pickLostFrom = (s: PlStage) => onPick({ title: `Lost from ${s.name}`, count: s.lostCount, params: { stageId: s.id, status: "lost", ownerId: person || undefined } });
  const pickLost = (d?: PlDrain) => onPick(d ? { title: `Lost: ${d.reason}`, count: d.count, params: { status: "lost", lostReason: d.reason } } : { title: "Lost deals", count: view.drains.reduce((a, x) => a + x.count, 0), params: { status: "lost" } });
  const dayLabel = day !== null && data.replay ? data.replay[Math.min(day, data.replay.length - 1)].date : null;
  const totalStale = view.stages.reduce((a, s) => a + s.staleCount, 0);
  const replay = () => { setDay(null); setRun((r) => r + 1); setSettle(true); };

  return (
    <div className="pl-flow" data-testid="pl-flow" aria-busy={loading}>
      {showExample && <p className="ap-fine mb-2" role="status" data-testid="pl-example-banner"><b>Example.</b> These are made-up numbers so you can see the shape. They are not your deals. <button type="button" className="ap-link" onClick={() => setExample(false)} data-testid="pl-example-off">Back to my deals</button></p>}
      {counts && <p className="ap-fine mb-2" role="status" data-testid="pl-counts-note">Showing deal counts: no deal here has a dollar value yet. Add a value to a deal and the money appears. <button type="button" className="ap-link" onClick={() => setExample(true)} data-testid="pl-example-on">See an example with money</button></p>}
      <div className="pl-flow-bar">
        <h3 className="pl-flow-title">{data.pipelineName}<span className="ap-sub"> · {data.periodLabel}</span></h3>
        <label className="sr-only" htmlFor="pl-person">Whose deals</label>
        <select id="pl-person" className="ap-field" value={person} onChange={(e) => { setPerson(e.target.value); setDay(null); }} data-testid="pl-person">
          <option value="">Everyone&apos;s deals</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}&apos;s deals</option>)}
        </select>
        <div className="pl-replay" data-testid="pl-replay">
          <button type="button" className="s6-btn" onClick={replay} aria-label="Replay the flow" data-testid="pl-play"><RotateCcw aria-hidden className="size-4" />Replay</button>
          {replayLen > 1 && <>
            <input type="range" min={0} max={replayLen - 1} value={day ?? replayLen - 1} onChange={(e) => setDay(Number(e.target.value))} aria-label="Pick a day to look at" data-testid="pl-scrub" />
            <span className="ap-fine tnum" aria-live="polite">{dayLabel ?? "Today"}</span>
            {day !== null && <button type="button" className="ap-link" onClick={() => setDay(null)}>Back to today</button>}
          </>}
        </div>
      </div>
      <p className="ap-fine mb-2">{counts ? "Each pile of cards is the deals sitting in that stage." : "Each pile of cash is the money sitting in that stage."} The ribbons show what moved on, with the share that did. Hatched ochre piles are stuck longer than that stage&apos;s own normal. The channel that drains away is lost. Won lands in the vault. Click any pile or ribbon to open exactly those deals.</p>

      <div ref={wrap} className="rv-host">
        <River stages={view.stages} wonCount={view.wonCount} wonCents={view.wonCents} counts={counts} enough={enough} width={Math.max(300, width)} settle={settle} runKey={run} reduced={reduced}
          onStage={pickStage} onNoValue={pickNoValue} onWon={pickWon} onLostFrom={pickLostFrom} />
      </div>

      {view.drains.length > 0 && (
        <ul className="pl-reasons" aria-label="Why deals were lost">
          {[...view.drains].sort((a, b) => (counts ? b.count - a.count : b.valueCents - a.valueCents)).map((d) => <li key={d.reason}><button type="button" className="pl-reason" onClick={() => pickLost(d)} title={`${d.reason}: ${d.count} deals${counts ? "" : `, ${money(d.valueCents)}`}`}><span>{d.reason}</span><b className="tnum">{d.count}</b>{!counts && <span className="tnum">{moneyShort(d.valueCents)}</span>}</button></li>)}
        </ul>
      )}
      {noValueSteps.length > 0 && (
        <p className="ap-fine mb-2" data-testid="pl-novalue">
          {noValueSteps.map((s, i) => <span key={s.id}>{i > 0 && " · "}<button type="button" className="ap-link" onClick={() => pickNoValue(s)} data-testid={`pl-novalue-${s.id}`}>{s.name}: {s.noValueCount} {s.noValueCount === 1 ? "deal" : "deals"} without a value</button></span>)}
          {" "}{counts ? "(counted here as deals; they carry no money.)" : "(not counted in money; money stays at $0 for them.)"}
        </p>
      )}
      <ul className="sr-only" aria-label="Deals by stage in words">{view.stages.map((s) => <li key={s.id}>{s.name}: {s.count + (counts ? s.noValueCount ?? 0 : 0)} deals{counts ? "" : `, ${money(s.valueCents)}`}, {s.staleCount} stuck, {s.lostCount} lost.</li>)}<li>Won: {view.wonCount} deals{counts ? "" : `, ${money(view.wonCents)}`}.</li>{!counts && <li>Lost: {money(lostTotal)}.</li>}</ul>
      <div className="pl-flow-foot">
        {data.leak && enough && !counts && <button type="button" className="pl-leak" onClick={() => { const s = data.stages.find((x) => x.name === data.leak!.fromStage); if (s) pickLostFrom(s); }} data-testid="pl-leak">Biggest leak: {money(data.leak.lostCents)} left between <b>{data.leak.fromStage}</b> and <b>{data.leak.toStage}</b>. Open those deals.</button>}
        {!enough && <p className="ap-fine" role="status">Not enough closed deals yet ({closed} of {data.minDeals} needed) to name the biggest leak. The picture above is still true.</p>}
        {totalStale > 0 && <p className="ap-fine">{totalStale} stuck deals{counts ? "" : `, ${money(view.stages.reduce((a, s) => a + s.staleValueCents, 0))} in total`}.</p>}
        {data.outlier && <p className="ap-fine">{data.outlier.name} is {pct(data.outlier.share)} of the money, so it is left out of the averages.</p>}
        <p className="ap-fine">Left out of the money: {data.excluded.zeroValue} deals with no value, {data.excluded.noOwner} with no owner, {data.excluded.test} test deals.</p>
      </div>
    </div>
  );
}
