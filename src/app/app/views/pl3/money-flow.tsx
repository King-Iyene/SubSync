"use client";

import { Pause, Play, RotateCcw, StepBack, StepForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { riverLayout } from "@/lib/design/river-layout";
import { buildReplayFrames, nextFrame, REPLAY_SPEEDS, replayHasMovement } from "@/lib/design/river-replay";
import { sampleRiver } from "@/lib/design/river-sample";
import type { PlDrain, PlMoneyFlow, PlStage } from "@/lib/analytics/pipeline3-types-interim";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { usePageRange } from "../../ds/page-range";
import { zoneWord } from "@/lib/design/zone";
import { useReducedMotion } from "../speed6-base";
import { usePl, type PlFilters } from "./data";
import { money, moneyShort, pct } from "./format";
import { FLOW_FIXTURE } from "./fixtures";
import { LeftOutLine, LEFT_OUT_TITLE } from "./left-out-line";
import { OwnerlessNote } from "./ownerless-note";
import { River } from "./river-view";

/** Fake numbers kept for older screens. The river's own sample (river-sample.ts) is a day-by-day simulation, shown only when the user asks, always marked SAMPLE, never mixed with real data. */
export const FLOW_EXAMPLE: PlMoneyFlow = { ...FLOW_FIXTURE, pipelineName: "Example pipeline", periodLabel: "Example numbers, not yours", people: [], replay: null, excluded: { zeroValue: 0, noOwner: 0, test: 0 }, outlier: null };
/** True when real deals exist but none has a value, so the river counts deals instead of dollars. */
export const hasNoValuedDeals = (f: PlMoneyFlow | null): boolean => !!f && f.stages.length > 0 && f.won.valueCents === 0 && f.stages.every((s) => s.valueCents === 0);

// MONEY FLOW = the RIVER (river-view.tsx): ribbons between stages (conversion % on each), piles of cards (one card per deal) or cash where deals sit, stuck piles hatched ochre, lost deals drain into a muted channel, won lands in the vault.
// When no deal has a dollar value the same picture counts DEALS (cards instead of bills) so the screen is never blank. REPLAY plays our own recorded day-by-day stage changes (frames from river-replay.ts);
// with no recorded movement it says so and offers a clearly labelled SAMPLE instead of faking anything. The old coin stacks are kept in the unused coin file, hidden at King's request.

export type FlowPick = { title: string; count: number; params: { stageId?: string; bucket?: "no_value" | "no_owner" | "test" | "outlier"; stale?: boolean; status?: "won" | "lost"; lostReason?: string; ownerId?: string } };

function applyPerson(f: PlMoneyFlow, person: string): { stages: PlStage[]; drains: PlDrain[]; wonCents: number; wonCount: number } {
  let stages = f.stages, drains = f.drains, wonCents = f.won.valueCents, wonCount = f.won.count;
  const p = person ? f.people.find((x) => x.id === person) : null;
  if (p) {
    stages = f.stages.map((s, i) => ({ ...s, ...(p.stages[i] ?? { count: 0, valueCents: 0, staleCount: 0, lostCount: 0, lostValueCents: 0 }), noValueCount: 0, staleValueCents: s.count ? Math.round(s.staleValueCents * ((p.stages[i]?.staleCount ?? 0) / Math.max(1, s.staleCount))) : 0 }));
    const total = f.stages.reduce((a, s) => a + s.lostValueCents, 0), mine = p.stages.reduce((a, s) => a + s.lostValueCents, 0), k = total ? mine / total : 0;
    drains = f.drains.map((d) => ({ ...d, count: Math.round(d.count * k), valueCents: Math.round(d.valueCents * k) })).filter((d) => d.valueCents > 0);
    wonCents = p.wonCents; wonCount = p.wonCount;
  }
  return { stages, drains, wonCents, wonCount };
}

export function MoneyFlow({ filters, onPick: realPick }: { filters: PlFilters; onPick: (p: FlowPick) => void }) {
  const real = usePl<PlMoneyFlow>("money-flow", filters), { error, loading, reload } = real;
  const bar = usePageRange();
  const [sample, setSample] = useState(false);
  const sampleData = useMemo(() => (sample ? sampleRiver() : null), [sample]);
  const noValued = hasNoValuedDeals(real.data);
  // The sample is a separate, labelled picture. It never replaces real data and its numbers never reach a click-through.
  const data = sample ? sampleData : real.data;
  const onPick = sample ? () => {} : realPick;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000), [person, setPerson] = useState(""), [settle, setSettle] = useState(true), [run, setRun] = useState(0);
  const [frame, setFrame] = useState<number | null>(null), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState<string>("1"), [noMove, setNoMove] = useState(false);
  const reduced = useReducedMotion();
  const ready = data !== null && data.stages.length > 0;
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth))); ro.observe(el); setWidth(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [ready]);
  useEffect(() => { if (!settle) return; const t = setTimeout(() => setSettle(false), 5600); return () => clearTimeout(t); }, [settle, run]);
  // No deal has a dollar value (and we are not showing the sample): count deals so the screen is never blank.
  const counts = noValued && !sample;
  const frames = useMemo(() => (data && replayHasMovement(data.replay) ? buildReplayFrames(data.replay ?? [], data.stages, counts) : null), [data, counts]);
  const replayOn = !!frames && !person;
  const cur = replayOn && frame !== null ? frames[Math.min(frame, frames.length - 1)] : null;
  const ms = REPLAY_SPEEDS.find((x) => x.id === speed)?.ms ?? 900;
  // Play: one day at a time, slider moving with it. Reduced motion never auto-plays; the person steps through with the buttons.
  useEffect(() => {
    if (!playing || !frames || reduced) return;
    const t = setTimeout(() => { const nx = nextFrame(frame ?? 0, frames.length); setFrame(nx.index); if (nx.done) setPlaying(false); }, ms);
    return () => clearTimeout(t);
  }, [playing, frame, frames, ms, reduced]);

  const view = useMemo(() => {
    if (!data) return null;
    const base = applyPerson(data, person);
    if (!cur) return base;
    return { stages: cur.stages, drains: base.drains, wonCents: cur.wonCents, wonCount: cur.wonCount };
  }, [data, person, cur]);
  const empty = useMemo(() => !view || riverLayout(view.stages.map((s) => ({ id: s.id, name: s.name, open: counts ? s.count + (s.noValueCount ?? 0) : s.valueCents, stuck: 0, lost: counts ? s.lostCount : s.lostValueCents })), counts ? view.wonCount : view.wonCents, { length: 600, thick: 200, nodeW: 30 }).empty, [view, counts]);
  const lostTotal = view ? view.drains.reduce((a, d) => a + d.valueCents, 0) : 0;
  const closed = data ? data.won.count + data.stages.reduce((a, s) => a + s.lostCount, 0) : 0;
  const enough = data ? closed >= data.minDeals : false;

  const startSample = () => { setSample(true); setFrame(null); setPlaying(false); setNoMove(false); setPerson(""); };
  const stopSample = () => { setSample(false); setFrame(null); setPlaying(false); setNoMove(false); };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <SkeletonRows rows={6} label="Loading the deal flow..." />;
  if (!view || !view.stages.length || empty) return (
    <div data-testid="pl-flow-empty">
      <EmptyState title="No open deals in these dates" body="When deals are in your pipeline, you will see them flow stage by stage here. Change the dates or the account above to look further back." />
      <p className="ap-fine mb-2">Want to see how it looks with deals moving? <button type="button" className="ap-link" onClick={startSample} data-testid="pl-sample-on-empty">See an example with money</button> (made-up deals, clearly marked SAMPLE).</p>
    </div>
  );

  const pickStage = (s: PlStage, stale = false) => onPick({ title: stale ? `${s.name}, stuck deals` : `${s.name}, open deals`, count: stale ? s.staleCount : s.count, params: { stageId: s.id, stale, ownerId: person || undefined } });
  const pickNoValue = (s: PlStage) => onPick({ title: `${s.name}, deals without a value`, count: s.noValueCount ?? 0, params: { stageId: s.id, bucket: "no_value" } });
  const noValueSteps = person || cur ? [] : view.stages.filter((s) => (s.noValueCount ?? 0) > 0);
  const pickWon = () => onPick({ title: "Won deals", count: view.wonCount, params: { status: "won", ownerId: person || undefined } });
  const pickLostFrom = (s: PlStage) => onPick({ title: `Lost from ${s.name}`, count: s.lostCount, params: { stageId: s.id, status: "lost", ownerId: person || undefined } });
  const pickLost = (d?: PlDrain) => onPick(d ? { title: `Lost: ${d.reason}`, count: d.count, params: { status: "lost", lostReason: d.reason } } : { title: "Lost deals", count: view.drains.reduce((a, x) => a + x.count, 0), params: { status: "lost" } });
  const totalStale = view.stages.reduce((a, s) => a + s.staleCount, 0);
  const total = frames?.length ?? 0;
  const quiet = !sample && !cur && view.wonCount === 0 && lostTotal === 0 && view.stages.every((s) => s.lostCount === 0) && !frames;
  const openLine = view.stages.filter((s) => s.count + (s.noValueCount ?? 0) > 0).map((s) => `${s.name} ${(s.count + (counts ? s.noValueCount ?? 0 : 0)).toLocaleString("en-US")} ${(s.count + (counts ? s.noValueCount ?? 0 : 0)) === 1 ? "deal" : "deals"}`).join(" · ");
  const why = data.replay ? "No deal changed step in these dates." : "We have not recorded enough step changes yet to replay these dates.";

  const play = () => {
    if (!frames || person) { setNoMove(true); return; }
    setNoMove(false);
    if (playing) { setPlaying(false); return; }
    if (reduced) { setFrame((f) => (f === null ? 0 : Math.min(frames.length - 1, f + 1))); return; }
    setFrame((f) => (f === null || f >= frames.length - 1 ? 0 : f)); setPlaying(true); setSettle(false);
  };
  const step = (dir: 1 | -1) => { if (!frames) return; setPlaying(false); setFrame((f) => Math.max(0, Math.min(frames.length - 1, (f ?? frames.length - 1) + dir))); };
  const backToNow = () => { setFrame(null); setPlaying(false); setRun((r) => r + 1); setSettle(true); };
  const summary = cur ? `${cur.date}: ${cur.activity === 0 ? "a quiet day" : `${cur.activity} ${cur.activity === 1 ? "deal" : "deals"} moved`}, ${cur.wonCount} won and ${cur.lostCount} lost so far` : "";

  return (
    <div className="pl-flow" data-testid="pl-flow" aria-busy={loading}>
      {sample && <p className="ap-fine mb-2 rv-sample" role="status" data-testid="pl-example-banner"><b>SAMPLE.</b> These are made-up deals so you can see how the river moves. They are not your deals, and clicking them opens nothing. <button type="button" className="ap-link" onClick={stopSample} data-testid="pl-example-off">Back to my deals</button></p>}
      {counts && <p className="ap-fine mb-2" role="status" data-testid="pl-counts-note">Showing deal counts: no deal here has a dollar value yet. Add a value to a deal and the money appears. <button type="button" className="ap-link" onClick={startSample} data-testid="pl-example-on">See an example with money</button></p>}
      <div className="pl-flow-bar">
        <h3 className="pl-flow-title">{data.pipelineName}<span className="ap-sub"> · {sample ? data.periodLabel : `${bar.label}, ${zoneWord()} time`}</span></h3>
        <label className="sr-only" htmlFor="pl-person">Whose deals</label>
        <select id="pl-person" className="ap-field" value={person} onChange={(e) => { setPerson(e.target.value); setFrame(null); setPlaying(false); }} data-testid="pl-person">
          <option value="">Everyone&apos;s deals</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}&apos;s deals</option>)}
        </select>
        <div className="pl-replay" data-testid="pl-replay" role="group" aria-label="Replay the flow, day by day">
          <button type="button" className="s6-btn" onClick={play} aria-label={playing ? "Pause the replay" : reduced && cur ? "Next day" : "Replay the flow"} data-testid="pl-play">
            {playing ? <Pause aria-hidden className="size-4" /> : cur ? <Play aria-hidden className="size-4" /> : <RotateCcw aria-hidden className="size-4" />}{playing ? "Pause" : reduced && cur ? "Next day" : cur && frame !== null && frame < total - 1 ? "Play" : "Replay"}
          </button>
          {replayOn && total > 1 && <>
            <button type="button" className="s6-btn" onClick={() => step(-1)} aria-label="Back one day" data-testid="pl-step-back"><StepBack aria-hidden className="size-4" /></button>
            <button type="button" className="s6-btn" onClick={() => step(1)} aria-label="Forward one day" data-testid="pl-step-fwd"><StepForward aria-hidden className="size-4" /></button>
            <input type="range" min={0} max={total - 1} value={frame ?? total - 1} onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} aria-label="Pick a day to look at" data-testid="pl-scrub" />
            <span className="ap-fine tnum" aria-live="polite" data-testid="pl-day">{cur ? cur.date : "Today"}</span>
            {!reduced && <span className="rv-speeds" role="group" aria-label="Replay speed">{REPLAY_SPEEDS.map((x) => <button key={x.id} type="button" className={`rv-speed${x.id === speed ? " is-on" : ""}`} aria-pressed={x.id === speed} onClick={() => setSpeed(x.id)} data-testid={`pl-speed-${x.id}`}>{x.label}</button>)}</span>}
            {cur && <button type="button" className="ap-link" onClick={backToNow}>Back to today</button>}
          </>}
        </div>
      </div>
      {noMove && !frames && (
        <p className="ap-fine mb-2 rv-note" role="status" data-testid="pl-nomove">{person ? "Pick everyone's deals to replay: step history is recorded for the whole pipeline." : `Nothing real to replay: ${why.toLowerCase()}`} {!person && <button type="button" className="ap-link" onClick={startSample} data-testid="pl-sample-on-replay">Play a sample replay</button>}</p>
      )}
      {cur && <p className="ap-fine mb-2 rv-daysum" aria-live="polite" data-testid="pl-daysum">{summary}</p>}
      {quiet && (
        <div className="rv-quiet" data-testid="pl-quiet">
          <p><b>What is true right now:</b> {openLine || "no open deals"}.</p>
          <p className="ap-fine">Nothing was won, lost or moved between steps in these dates, so the ribbons, the vault and the lost channel have nothing to show. {why} The piles above are still true.</p>
          <button type="button" className="s6-btn" onClick={startSample} data-testid="pl-sample-on">See an example with money</button>
        </div>
      )}
      <p className="ap-fine mb-2" data-testid="pl-flow-asof"><b>As of now:</b> the piles (open deals and stuck deals). <b>Between {bar.label || "the dates above"}, {zoneWord()} time:</b> won, lost and what moved on.</p>
      <p className="ap-fine mb-2">{counts ? "Each card is one deal in that stage." : "Each pile of cash is the money sitting in that stage."} The ribbons show what moved on, with the share that did. Hatched ochre piles are stuck longer than that stage&apos;s own normal. The channel that drains away is lost. Won lands in the vault. Click any pile or ribbon to open exactly those deals.</p>

      <div ref={wrap} className="rv-host">
        <River stages={view.stages} wonCount={view.wonCount} wonCents={view.wonCents} counts={counts} enough={enough} width={Math.max(300, width)} settle={settle && !cur} runKey={run} reduced={reduced}
          movers={cur ? cur.movers : undefined} moverKey={cur ? `${run}-${cur.index}` : undefined} flyMs={ms}
          onStage={pickStage} onNoValue={pickNoValue} onWon={pickWon} onLostFrom={pickLostFrom} />
      </div>

      {view.drains.length > 0 && !cur && (
        <ul className="pl-reasons" aria-label="Why deals were lost">
          {[...view.drains].sort((a, b) => (counts ? b.count - a.count : b.valueCents - a.valueCents)).map((d) => <li key={d.reason}><button type="button" className="pl-reason" onClick={() => pickLost(d)} title={`${d.reason}: ${d.count} deals${counts ? "" : `, ${money(d.valueCents)}`}`}><span>{d.reason}</span><b className="tnum">{d.count}</b>{!counts && <span className="tnum">{moneyShort(d.valueCents)}</span>}</button></li>)}
        </ul>
      )}
      {noValueSteps.length > 0 && (
        <p className="ap-fine mb-2" data-testid="pl-novalue">
          {noValueSteps.map((s, i) => <span key={s.id}>{i > 0 && " · "}<button type="button" className="ap-link" onClick={() => pickNoValue(s)} data-testid={`pl-novalue-${s.id}`}>{s.name}: {s.noValueCount} {s.noValueCount === 1 ? "deal" : "deals"} without a value</button></span>)}
          {" "}{counts ? "(counted here as deals; they carry no money.)" : "(left out of the money: they stay at $0 here.)"}
        </p>
      )}
      <ul className="sr-only" aria-label="Deals by stage in words">{view.stages.map((s) => <li key={s.id}>{s.name}: {s.count + (counts ? s.noValueCount ?? 0 : 0)} deals{counts ? "" : `, ${money(s.valueCents)}`}, {s.staleCount} stuck, {s.lostCount} lost.</li>)}<li>Won: {view.wonCount} deals{counts ? "" : `, ${money(view.wonCents)}`}.</li>{!counts && <li>Lost: {money(lostTotal)}.</li>}</ul>
      <div className="pl-flow-foot">
        {data.leak && enough && !counts && !cur && <button type="button" className="pl-leak" onClick={() => { const s = data.stages.find((x) => x.name === data.leak!.fromStage); if (s) pickLostFrom(s); }} data-testid="pl-leak">Biggest leak: {money(data.leak.lostCents)} left between <b>{data.leak.fromStage}</b> and <b>{data.leak.toStage}</b>. Open those deals.</button>}
        {!enough && !sample && <p className="ap-fine" role="status">Not enough closed deals yet ({closed} of {data.minDeals} needed) to name the biggest leak. The picture above is still true.</p>}
        {totalStale > 0 && <p className="ap-fine">{totalStale} stuck deals{counts ? "" : `, ${money(view.stages.reduce((a, s) => a + s.staleValueCents, 0))} in total`}.</p>}
        {data.outlier && <p className="ap-fine">{data.outlier.name} is {pct(data.outlier.share)} of the money, so it is left out of the averages.</p>}
        {!person && !sample && <LeftOutLine x={data.excluded} onPick={(key, count) => onPick({ title: LEFT_OUT_TITLE[key], count, params: { bucket: key } })} />}
        {!person && !sample && <OwnerlessNote count={data.excluded.noOwner} counted={data.excluded.ownerCounted === true} testId="pl-flow-ownerless" />}
      </div>
    </div>
  );
}
