"use client";

import type { ReactNode } from "react";
import type { PlForecast, PlHealthRow, PlOverview, PlPerson, PlProof, PlSource, PlStageHistory, PlWonLost } from "@/lib/analytics/pipeline3-types-interim";
import { EmptyState, ErrorState, SkeletonRows } from "../../ds";
import { usePageRange } from "../../ds/page-range";
import { zoneWord } from "@/lib/design/zone";
import { CountUp } from "../speed6-base";
import { usePl, type PlFilters } from "./data";
import { overviewIsEmpty } from "./adapters";
import { days, money, moneyShort, pct } from "./format";
import { leftOutSentence } from "./pipe-list";
import { Chip, DealList } from "./parts";
import { ForecastWords, FollowUpPlan, WinLossReview } from "./deal-ai";
import { TrustBasis } from "../td3/trust-basis";
import type { PlDeal } from "@/lib/analytics/pipeline3-types-interim";

export type SectionProps = { filters: PlFilters; onOpen: (d: PlDeal) => void; activeId: string | null; showAccount: boolean; go: (tab: string) => void; onDrill: (d: { title: string; count: number; extra: Record<string, string | number | undefined> }) => void };

function Gate<T>({ r, label, children, empty }: { r: { data: T | null; error: unknown; loading: boolean; reload: () => void }; label: string; children: (d: T) => ReactNode; empty?: (d: T) => { title: string; body: string } | null }) {
  if (r.error) return <ErrorState error={r.error as never} onRetry={r.reload} />;
  if (!r.data) return <SkeletonRows rows={4} label={label} />;
  const e = empty?.(r.data); if (e) return <EmptyState title={e.title} body={e.body} />;
  return <>{children(r.data)}</>;
}
/** What the dates above do to these numbers, in words next to them: open money, stuck and open counts are as of now; won, lost and moved are between the bar's dates (Lagos time). */
function Dates() {
  const r = usePageRange();
  return <p className="ap-fine mb-2" data-testid="pl-dates-note"><b>As of now:</b> open money, stuck deals and open counts. <b>Between {r.label || "the dates above"}, {zoneWord()} time:</b> won, lost and moved.</p>;
}
const Formula = ({ text }: { text: string }) => <details className="ap-formula"><summary>How is this worked out?</summary><p className="ap-fine">{text}</p></details>;
const Rows = ({ head, children, testId }: { head: string[]; children: ReactNode; testId: string }) => <div className="ap-tablewrap" data-testid={testId}><div className="ap-scroll"><table className="ap-t"><thead><tr>{head.map((h, i) => <th key={h} data-num={i > 0 || undefined}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div></div>;

export function Overview({ filters, go, onDrill }: SectionProps) {
  const r = usePl<PlOverview>("overview", filters);
  const bar = usePageRange();
  return (
    <Gate r={r} label="Loading the pipeline..." empty={(d) => (overviewIsEmpty(d.headline) ? { title: "No deals to show yet", body: "When deals are in your pipeline, the money, the stuck deals and the biggest leak show up here." } : null)}>
      {(d) => {
        const h = d.headline;
        return (
          <div data-testid="pl-overview">
            <section className="s6-card ap-hero">
              <span className="ap-fine">Your pipeline</span>
              {d.sentence && <p className="ap-sentence" data-testid="pl-sentence">{d.sentence}</p>}
              {(h.staleCount > 0 || d.excluded.noOwner > 0 || (d.bigUntouched?.count ?? 0) > 0) && <p className="ap-fine" data-testid="pl-today">What to do today: {[h.staleCount > 0 ? `move ${h.staleCount} stuck deal${h.staleCount === 1 ? "" : "s"} (${moneyShort(h.staleValueCents)})` : "", d.excluded.noOwner > 0 ? `give ${d.excluded.noOwner} deal${d.excluded.noOwner === 1 ? "" : "s"} an owner` : "", d.bigUntouched && d.bigUntouched.count > 0 ? `check ${d.bigUntouched.count} big open deal${d.bigUntouched.count === 1 ? "" : "s"} (${moneyShort(d.bigUntouched.valueCents)}) nobody has touched in ${d.bigUntouched.days} days` : ""].filter(Boolean).join(", then ")}. {h.staleCount > 0 && <button type="button" className="s6-btn" onClick={() => go("needs")}>Open stuck deals</button>}</p>}
              <div className="ap-kpis">
                <button type="button" className="ap-kpi" data-tone="cyan" onClick={() => go("flow")}><span className="ap-kpi-n">$<CountUp value={Math.round(h.openValueCents / 100)} /></span><span className="ap-kpi-l">Open money, {h.openCount} deals, as of now</span></button>
                <button type="button" className="ap-kpi" data-tone={h.staleCount ? "amber" : "green"} onClick={() => go("needs")}><span className="ap-kpi-n"><CountUp value={h.staleCount} /></span><span className="ap-kpi-l">Stuck deals, {moneyShort(h.staleValueCents)}, as of now</span></button>
                <button type="button" className="ap-kpi" data-tone="green" onClick={() => onDrill({ title: "Won deals", count: 0, extra: { status: "won" } })}><span className="ap-kpi-n">{h.wonCents === 0 ? "None" : moneyShort(h.wonCents)}</span><span className="ap-kpi-l">{h.wonCents === 0 ? (h.lostCents === 0 ? "Nothing won or lost in these dates" : `Nothing won in these dates (lost ${moneyShort(h.lostCents)})`) : `Won between ${bar.label || "these dates"}, ${zoneWord()} time`}</span></button>
                <button type="button" className="ap-kpi" data-tone={h.winRate === null ? "violet" : "cyan"} onClick={() => go("wonlost")}><span className="ap-kpi-n">{h.winRate === null ? "Not enough data" : pct(h.winRate)}</span><span className="ap-kpi-l">{h.winRate === null ? `Needs ${d.minDeals} closed deals, you have ${h.winRateDeals}` : `Win rate, ${h.winRateDeals} closed deals`}</span></button>
              </div>
              {h.openCount === 0 && (h.openAll ?? 0) > 0 && <p className="ap-fine" data-testid="pl-nomoney-note">{(h.openAll ?? 0).toLocaleString("en-US")} open deals are in play, but none counts toward the money yet (no value or no owner). Give them a value and an owner to see the money here. The Money flow tab can count them by step.</p>}
              <Dates />
              {d.trust && <TrustBasis t={d.trust} />}
              <div className="ap-act"><button type="button" className="s6-btn" data-kind="primary" onClick={() => go("flow")}>See the money flow</button><button type="button" className="s6-btn" onClick={() => go("needs")}>Unclog stuck deals</button></div>
            </section>
            {d.outlier && <p className="ap-fine">{d.outlier.name} is {pct(d.outlier.share)} of the money, so it is left out of the averages and shown on its own.</p>}
            <p className="ap-fine">{leftOutSentence(d.excluded) ?? "Nothing is left out of the money here."} A deal is stuck when it has sat in a step longer than that step normally takes in your own account.</p>
          </div>
        );
      }}
    </Gate>
  );
}

export function NeedsAttention(p: SectionProps) {
  return (
    <div data-testid="pl-needs">
      <p className="ap-fine mb-2">Deals that sat in a step longer than that step normally takes in your own account. Worst first. Open one to move it, change the owner, or close it out.</p>
      <FollowUpPlan filters={p.filters} />
      <DealList part="needs-attention" filters={p.filters} onOpen={p.onOpen} activeId={p.activeId} showAccount={p.showAccount} empty="Nothing is stuck right now" testId="pl-needs-list" selectable />
    </div>
  );
}

export function WonLost(p: SectionProps) {
  const r = usePl<PlWonLost>("won-lost", p.filters);
  return (
    <Gate r={r} label="Loading won and lost..." empty={(d) => (d.won + d.lost === 0 ? { title: "Nothing closed in these dates", body: "Won and lost deals show up here, with the lost reason when your CRM has one." } : null)}>
      {(d) => (
        <div data-testid="pl-wonlost">
          <Dates />
          <WinLossReview filters={p.filters} />
          <div className="ap-kpis">
            <button type="button" className="ap-kpi" data-tone="green" onClick={() => p.onDrill({ title: "Won deals", count: d.won, extra: { status: "won", expect: d.won } })}><span className="ap-kpi-n">{d.won}</span><span className="ap-kpi-l">Won, {moneyShort(d.wonCents)}</span></button>
            <button type="button" className="ap-kpi" data-tone="red" onClick={() => p.onDrill({ title: "Lost deals", count: d.lost, extra: { status: "lost", expect: d.lost } })}><span className="ap-kpi-n">{d.lost}</span><span className="ap-kpi-l">Lost, {moneyShort(d.lostCents)}</span></button>
            <div className="ap-kpi" data-tone="cyan"><span className="ap-kpi-n">{d.winRate === null ? "Not enough data" : pct(d.winRate)}</span><span className="ap-kpi-l">Win rate</span></div>
            <div className="ap-kpi" data-tone="violet"><span className="ap-kpi-n">{d.bookedToWon === null ? "Not enough data" : pct(d.bookedToWon)}</span><span className="ap-kpi-l">Booked appointments that became wins</span></div>
          </div>
          <h3 className="mb-2 text-base font-semibold">Why deals were lost</h3>
          <Rows head={["Reason", "Deals", "Money"]} testId="pl-reasons">{d.byReason.map((x) => <tr key={x.reason} onClick={() => p.onDrill({ title: `Lost: ${x.reason}`, count: x.count, extra: { status: "lost", lostReason: x.reason, expect: x.count } })}><td className="ap-name">{x.reason}</td><td data-num>{x.count}</td><td data-num>{money(x.valueCents)}</td></tr>)}</Rows>
        </div>
      )}
    </Gate>
  );
}

export function Forecast({ filters }: SectionProps) {
  const r = usePl<PlForecast>("forecast", filters);
  return (
    <Gate r={r} label="Loading the forecast...">
      {(d) => (
        <div data-testid="pl-forecast">
          <ForecastWords filters={filters} />
          {d.midCents === null || d.lowCents === null || d.highCents === null ? (
            <section className="s6-card ap-hero"><p className="ap-sentence" data-testid="pl-forecast-none">Not enough closed deals to forecast honestly yet.</p><p className="ap-fine">You have {d.closedDeals} closed deals in these dates and a forecast needs {d.minDeals}. Until then, SubSync shows what is in the pipe and does not guess.</p></section>
          ) : (
            <section className="s6-card ap-hero"><span className="ap-live">Estimate, not a promise</span><p className="ap-sentence">About <b className="ap-strong">{money(d.midCents)}</b> likely to close from what is open now, in a range of {money(d.lowCents)} to {money(d.highCents)}.</p><p className="ap-fine">Based on {d.closedDeals} closed deals.</p></section>
          )}
          <Formula text={d.formula} />
          {d.byStage.length > 0 && <Rows head={["Stage", "Chance a deal here is won"]} testId="pl-forecast-stages">{d.byStage.map((s) => <tr key={s.stage}><td className="ap-name">{s.stage}</td><td data-num>{pct(s.winChance)}</td></tr>)}</Rows>}
        </div>
      )}
    </Gate>
  );
}

export function People(p: SectionProps) {
  const r = usePl<{ rows: PlPerson[] }>("people", p.filters);
  return (
    <Gate r={r} label="Loading people..." empty={(d) => (d.rows.length === 0 ? { title: "No deal owners yet", body: "When deals have owners, you will see who closes and who lets deals go cold." } : null)}>
      {(d) => (
        <Rows head={["Person", "Open", "Open money", "Stuck", "Won", "Won money", "Lost money", "Win rate"]} testId="pl-people">
          {d.rows.map((x) => <tr key={x.id} onClick={() => p.onDrill({ title: `${x.name}, open deals`, count: x.open, extra: { owner: x.id, status: "open", expect: x.open } })}><td className="ap-name">{x.name}</td><td data-num>{x.open}</td><td data-num>{moneyShort(x.openCents)}</td><td data-num>{x.stale > 0 ? <Chip tone="amber">{x.stale}</Chip> : 0}</td><td data-num>{x.won}</td><td data-num>{moneyShort(x.wonCents)}</td><td data-num>{moneyShort(x.lostCents)}</td><td data-num>{pct(x.winRate)}</td></tr>)}
        </Rows>
      )}
    </Gate>
  );
}

export function Sources(p: SectionProps) {
  const r = usePl<{ rows: PlSource[] }>("sources", p.filters);
  return (
    <Gate r={r} label="Loading sources..." empty={(d) => (d.rows.length === 0 ? { title: "No sources yet", body: "When deals record where the lead came from, you will see which sources turn into money." } : null)}>
      {(d) => (
        <Rows head={["Source", "Deals", "Won", "Win rate", "Won money", "Days to win"]} testId="pl-sources">
          {d.rows.map((x) => <tr key={x.source} onClick={() => p.onDrill({ title: `${x.source}, deals`, count: x.deals, extra: { source: x.source, expect: x.deals } })}><td className="ap-name">{x.source}</td><td data-num>{x.deals}</td><td data-num>{x.won}</td><td data-num>{pct(x.winRate)}</td><td data-num>{moneyShort(x.wonCents)}</td><td data-num>{days(x.avgCycleDays)}</td></tr>)}
        </Rows>
      )}
    </Gate>
  );
}

export function StageHistory({ filters }: SectionProps) {
  const r = usePl<PlStageHistory>("stage-history", filters);
  return (
    <Gate r={r} label="Loading stage history..." empty={(d) => (d.stages.length === 0 ? { title: "Recording has just started", body: "Your CRM only keeps the last change on each deal. SubSync now writes down every move from here on, so this fills up over the coming weeks." } : null)}>
      {(d) => (
        <div data-testid="pl-history">
          <p className="ap-fine mb-2">Your CRM does not keep a history of stage moves, so SubSync records them itself{d.recorded.since ? ` since ${d.recorded.since} (${d.recorded.changes.toLocaleString("en-US")} changes so far)` : ""}. A step with fewer than a handful of deals shows &quot;not enough data&quot;.</p>
          <Rows head={["Step", "Typical days here", "Slowest 1 in 10", "Counts as stuck after", "Deals seen"]} testId="pl-history-rows">
            {d.stages.map((s) => <tr key={s.name}><td className="ap-name">{s.name}</td><td data-num>{s.sample < 5 ? "Not enough data" : days(s.medianDays)}</td><td data-num>{s.sample < 5 ? "Not enough data" : days(s.p90Days)}</td><td data-num>{s.staleAfterDays === null ? "Not enough data" : `${s.staleAfterDays} d`}</td><td data-num>{s.sample}</td></tr>)}
          </Rows>
        </div>
      )}
    </Gate>
  );
}

export function Health({ filters, onDrill }: SectionProps) {
  const r = usePl<{ rows: PlHealthRow[] }>("health", filters);
  return (
    <Gate r={r} label="Loading account health..." empty={(d) => (d.rows.length === 0 ? { title: "No accounts with deals yet", body: "Every client account will show here, worst first, once it has deals." } : null)}>
      {(d) => (
        <Rows head={["Account", "Open deals", "Stuck share"]} testId="pl-health">
          {[...d.rows].sort((a, b) => (b.staleShare ?? -1) - (a.staleShare ?? -1)).map((x) => <tr key={x.locationId} onClick={() => onDrill({ title: `${x.name}, open deals`, count: x.open, extra: { location: x.locationId, status: "open" } })}><td className="ap-name">{x.name}</td><td data-num>{x.open}</td><td data-num>{x.staleShare === null ? "Not enough data" : pct(x.staleShare)}</td></tr>)}
        </Rows>
      )}
    </Gate>
  );
}

export function Proof({ filters, go, onDrill }: SectionProps) {
  const r = usePl<PlProof>("proof", filters);
  return (
    <Gate r={r} label="Loading the receipt..." empty={(d) => (d.rows.length === 0 ? { title: "No receipt yet", body: "Each week SubSync lists the stuck deals it caught, what moved on and the money won, so you can show it." } : null)}>
      {(d) => (
        <div data-testid="pl-proof">
          <p className="ap-fine mb-2">{d.weekLabel}. {d.headline}</p>
          <Rows head={["What happened", "This week"]} testId="pl-proof-rows">
            {d.rows.map((x) => <tr key={x.label} onClick={x.go === "needs" ? () => go("needs") : x.go ? () => onDrill({ title: x.label, count: 0, extra: { status: x.go as "won" | "lost" } }) : undefined}><td className="ap-name">{x.label}</td><td data-num>{x.value}</td></tr>)}
          </Rows>
          {d.verifyHash && <p className="ap-fine mt-2">Check code {d.verifyHash}: it is built from these numbers, so a client can ask us to confirm them.</p>}
        </div>
      )}
    </Gate>
  );
}
