"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { money, pct } from "@/lib/design/appt-coach";
import { EmptyState, ErrorState, InlineAlert, SkeletonCards, SkeletonRows } from "../../ds";
import { CountUp, Q } from "../speed6-base";
import { useAp, type ApFilters } from "./data";
import type { ApOverview, ApRow } from "./types";

type Open = (r: ApRow) => void;
export type DrillReq = { title: string; count: number; extra: Record<string, string | number | undefined> };
export type SectionProps = { filters: ApFilters; onOpen: Open; activeId: string | null; showAccount: boolean; go: (tab: string) => void; onDrill: (d: DrillReq) => void };
/** A number that opens the appointments behind it. */
export const Hit = ({ n, label, onClick, tone }: { n: number | string; label: string; onClick: () => void; tone?: string }) => (
  <button type="button" className="ap-link tnum" data-tone={tone} onClick={onClick} aria-label={label} title={label} data-testid="ap-hit">{typeof n === "number" ? n.toLocaleString("en-US") : n}</button>
);
const JOURNEY_BUCKET: Record<string, string> = { booked: "booked", showed: "showed", won: "won" };

function Frame<T>({ res, children, cards }: { res: { data: T | null; error: unknown; reload: () => void }; children: (d: T) => React.ReactNode; cards?: boolean }) {
  if (res.error) return <ErrorState error={res.error as Error} onRetry={res.reload} />;
  if (!res.data) return cards ? <SkeletonCards cards={4} label="Loading..." /> : <SkeletonRows rows={5} label="Loading..." />;
  return <>{children(res.data)}</>;
}

// ---------- Overview ----------
export function Overview({ filters, go, onDrill }: SectionProps) {
  const res = useAp<ApOverview>("overview", filters);
  const [run, setRun] = useState(0);
  const [more, setMore] = useState(false);
  return (
    <Frame res={res} cards>{(d) => {
      const h = d.headline;
      if (h.booked === 0 && !d.needsPermission) return <EmptyState title="No appointments in these dates" body="When calendars have bookings, the appointments nobody marked, the no-shows to win back and your true show rate appear here." />;
      const gap = h.reportedShowRate !== null && h.trueShowRate !== null ? Math.round((h.reportedShowRate - h.trueShowRate) * 100) : null;
      const clear = h.needsOutcome === 0 && h.noShowsToRecover === 0;
      return (
        <div data-testid="ap-overview">
          {d.needsPermission && <InlineAlert tone="warning" className="mb-4" title="Needs permission: reconnect">Some accounts cannot show appointments yet. Open the app in your marketplace and choose Reinstall, then approve the extra read-only permission.</InlineAlert>}
          <section className="s6-card ap-hero s6-enter" data-glow={clear ? undefined : "warn"} aria-label="What needs you">
            <span className="ap-live"><span className="ap-pulse" />Live</span>
            <p className="ap-fine" data-testid="ap-today">What to do today{d.today && (d.today.doubleBookings > 0 || d.today.idlePeople > 0) ? <>: also <button type="button" className="ap-link" onClick={() => go("calendars")}>{[d.today.doubleBookings > 0 ? `${d.today.doubleBookings} double ${d.today.doubleBookings === 1 ? "booking" : "bookings"}` : null, d.today.idlePeople > 0 ? `${d.today.idlePeople} ${d.today.idlePeople === 1 ? "person" : "people"} with no bookings` : null].filter(Boolean).join(" and ")}</button></> : null}</p>
            <h2 className="ap-sentence" data-testid="ap-headline">
              {clear ? <><CheckCircle2 aria-hidden className="mr-2 inline size-6 text-[var(--s6-green)]" />Every past appointment has an outcome and no no-show is waiting for a call.</>
                : <><span className="ap-strong" data-tone="amber"><CountUp value={h.needsOutcome} /></span> {h.needsOutcome === 1 ? "appointment is" : "appointments are"} past due with no outcome{h.trueShowRate !== null ? <>. Your true show rate is <span className="ap-strong">{pct(h.trueShowRate)}</span>{h.reportedShowRate !== null ? <>, not {pct(h.reportedShowRate)}</> : null}.</> : "."}</>}
            </h2>
            <div className="ap-kpis">
              <button type="button" className="ap-kpi" data-tone="violet" onClick={() => go("needs")} data-testid="ap-kpi-needs"><span className="ap-kpi-n"><CountUp value={h.needsOutcome} /></span><span className="ap-kpi-l">Need an outcome</span></button>
              <button type="button" className="ap-kpi" data-tone="red" onClick={() => go("recover")} data-testid="ap-kpi-recover"><span className="ap-kpi-n"><CountUp value={h.noShowsToRecover} /></span><span className="ap-kpi-l">No-shows to win back</span></button>
              <button type="button" className="ap-kpi" data-tone={gap !== null && gap >= 10 ? "amber" : "green"} onClick={() => go("flow")} data-testid="ap-kpi-rate"><span className="ap-kpi-n">{h.trueShowRate === null ? "n/a" : <CountUp value={Math.round(h.trueShowRate * 100)} suffix="%" />}</span><span className="ap-kpi-l">{h.trueShowRate === null ? `True show rate (${h.marked} of 5 marked needed)` : `True show rate${h.trueRange ? `, ${pct(h.trueRange[0])} to ${pct(h.trueRange[1])} once marked` : ""}`}</span></button>
              <button type="button" className="ap-kpi" data-tone="amber" onClick={() => go("recover")} data-testid="ap-kpi-risk"><span className="ap-kpi-n">{d.revenueAtRisk ? `${money(d.revenueAtRisk.lowCents)} to ${money(d.revenueAtRisk.highCents)}` : "n/a"}</span><span className="ap-kpi-l">{d.revenueAtRisk ? "Revenue at risk (estimate)" : "Revenue at risk: not enough closed deals yet"}</span></button>
            </div>
            <div className="ap-act">
              {h.needsOutcome > 0 ? <button type="button" className="s6-btn" data-kind="primary" onClick={() => go("needs")} data-testid="ap-primary">Mark the {h.needsOutcome} now</button> : h.noShowsToRecover > 0 ? <button type="button" className="s6-btn" data-kind="primary" onClick={() => go("recover")} data-testid="ap-primary">Win back {h.noShowsToRecover} no-shows</button> : <button type="button" className="s6-btn" data-kind="primary" onClick={() => go("flow")} data-testid="ap-primary">See who earns the money</button>}
              {d.revenueAtRisk && <details className="text-sm"><summary className="ap-link cursor-pointer" data-testid="ap-risk-formula">How the estimate is worked out</summary><p className="ap-fine mt-1 max-w-xl">{d.revenueAtRisk.basis}</p></details>}
            </div>
          </section>

          <div className="ap-grid ap-grid3">
            <Q q="Which account loses the most?" tip="The account with the highest no-show rate among those with enough bookings." testId="ap-card-worst">
              {d.cards.worstAccount ? <><p className="s6-big" data-tone="red">{pct(d.cards.worstAccount.noShowRate)}</p><p className="ap-fine">{d.cards.worstAccount.name} misses this share of marked appointments.</p><button type="button" className="ap-link mt-2" onClick={() => go("health")}>Open account health</button></> : <p className="ap-fine">Not enough data yet.</p>}
            </Q>
            <Q q="Who books the best?" tip="The booker with the highest show rate among those with enough bookings." testId="ap-card-top">
              {d.cards.topSetter ? <><p className="s6-big" data-tone="green">{pct(d.cards.topSetter.showRate)}</p><p className="ap-fine">{d.cards.topSetter.name}&apos;s bookings show up.</p><button type="button" className="ap-link mt-2" onClick={() => go("share")}>Open booking share</button></> : <p className="ap-fine">Not enough data yet.</p>}
            </Q>
            <Q q="Where is the biggest leak?" tip="The hand-off with the most no-shows above your own average." testId="ap-card-leak">
              {d.cards.leak ? <><p className="text-[0.95rem] leading-6">{d.cards.leak}</p><button type="button" className="ap-link mt-2" onClick={() => go("flow")}>Show it in the tree</button></> : <p className="ap-fine">No single hand-off stands out.</p>}
            </Q>
          </div>

          <button type="button" className="s6-btn mb-4" onClick={() => setMore((m) => !m)} aria-expanded={more} data-testid="ap-more">{more ? "Less" : "More: where do my appointments go?"}</button>
          {more && d.journey.length > 0 && (
            <Q q="Where do my appointments go?" tip="Booked, showed and won, counted from the same rows as the lists." testId="ap-journey" action={<button type="button" className="s6-btn" onClick={() => setRun((r) => r + 1)}><RotateCcw aria-hidden className="size-4" />Replay</button>}>
              <div className="ap-jr mt-3" key={run}>
                {d.journey.map((s, i) => (
                  <div className="ap-jr-row" key={s.key}><button type="button" className="ap-link" style={{ textAlign: "left" }} onClick={() => onDrill({ title: `${s.label} appointments`, count: s.count, extra: { outcome: JOURNEY_BUCKET[s.key], expect: s.count } })} data-testid={`ap-jr-${s.key}`}>{s.label}</button><div className="ap-jr-bar"><i style={{ width: `${Math.max(2, (s.count / Math.max(1, d.journey[0].count)) * 100)}%`, ["--i" as string]: i }} /></div><span className="ap-jr-pct"><button type="button" className="ap-link tnum" onClick={() => onDrill({ title: `${s.label} appointments`, count: s.count, extra: { outcome: JOURNEY_BUCKET[s.key], expect: s.count } })} aria-label={`Open the ${s.count} ${s.label} appointments`}><b>{s.count}</b></button> {i > 0 ? `${Math.round((s.count / Math.max(1, d.journey[i - 1].count)) * 100)}%` : ""}</span></div>
                ))}
              </div>
            </Q>
          )}
        </div>
      );
    }}</Frame>
  );
}
