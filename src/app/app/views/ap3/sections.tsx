"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { money, pct } from "@/lib/design/appt-coach";
import { EmptyState, ErrorState, InlineAlert, SkeletonCards, SkeletonRows } from "../../ds";
import { WhatIs } from "../../ds/what-is";
import { CountUp, Q } from "../speed6-base";
import { useAp, type ApFilters } from "./data";
import { LinkBtn } from "./link-btn";
import type { ApOverview, ApRow } from "./types";

type Open = (r: ApRow) => void;
/** What a number opens: a title, the filters that make the list (shown as removable chips), a plain name for each filter, and the number it promises. */
export type DrillReq = { title: string; count: number; extra: Record<string, string | number | undefined>; labels?: Record<string, string> };
export type SectionProps = {
  filters: ApFilters; onOpen: Open; activeId: string | null; showAccount: boolean;
  /** Open a section. `focus` picks one problem inside it (Calendars: conflicts or idle_person). Arriving from a number always starts the list without its own filters, so the count and the rows agree. */
  go: (tab: string, focus?: string) => void; onDrill: (d: DrillReq) => void;
  /** Open another screen of the app (for example the integrations page). */ openView: (id: string) => void; /** Clear every filter. */ clear: () => void; /** Look back 90 days. */ widen: () => void; /** Any filter is on. */ filtered: boolean; focus?: string;
};
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

/** One card: one big number and one plain label. The how-it-is-worked-out text lives in the (i). Pressing it opens exactly the rows the number counts. */
function Kpi({ tone, n, label, tip, onClick, testId, disabled }: { tone: string; n: React.ReactNode; label: string; tip: string; onClick: () => void; testId: string; disabled?: boolean }) {
  return (
    <div className="ap-kpi-card">
      <button type="button" className="ap-kpi" data-tone={tone} onClick={onClick} disabled={disabled} data-testid={testId} aria-label={`${typeof n === "string" ? n + " " : ""}${label}${disabled ? "" : ". Open them."}`}><span className="ap-kpi-n">{n}</span><span className="ap-kpi-l">{label}</span></button>
      <span className="ap-kpi-i"><WhatIs text={tip} /></span>
    </div>
  );
}
/** The big number inside a card: it opens exactly the rows it counts. */
const Big = ({ tone, n, label, onClick, testId }: { tone: string; n: number; label: string; onClick: () => void; testId?: string }) => (
  <button type="button" className="s6-big ap-bignum" data-tone={tone} onClick={onClick} aria-label={`${n} ${label}. Open them.`} title="Open them" data-testid={testId}><CountUp value={n} /></button>
);

// ---------- Overview ----------
export function Overview({ go, onDrill, filters, clear, widen, filtered }: SectionProps) {
  const res = useAp<ApOverview>("overview", filters);
  const [run, setRun] = useState(0);
  const [more, setMore] = useState(false);
  return (
    <Frame res={res} cards>{(d) => {
      const h = d.headline, c = d.cards;
      if (h.booked === 0 && !d.needsPermission) return <EmptyState title="No appointments in these dates" body="When calendars have bookings, the appointments nobody marked, the no-shows to win back and your true show rate appear here." action={<span className="flex flex-wrap justify-center gap-2">{filtered && <button type="button" className="s6-btn" onClick={clear}>Clear filters</button>}<button type="button" className="s6-btn" onClick={widen}>Look back 90 days</button></span>} />;
      const clearAll = h.needsOutcome === 0 && h.noShowsToRecover === 0;
      const dbl = d.today?.doubleBookings ?? 0, idle = d.today?.idlePeople ?? 0;
      const sentence = h.needsOutcome > 0
        ? <><span className="ap-strong" data-tone="amber"><CountUp value={h.needsOutcome} /></span> past {h.needsOutcome === 1 ? "appointment has" : "appointments have"} no outcome yet.</>
        : <><span className="ap-strong" data-tone="red"><CountUp value={h.noShowsToRecover} /></span> {h.noShowsToRecover === 1 ? "no-show is" : "no-shows are"} waiting for a call.</>;
      const meaning = h.needsOutcome > 0
        ? (h.trueShowRate !== null ? `Until they are marked, nobody knows who came. So far ${h.showed.toLocaleString("en-US")} of ${h.passed.toLocaleString("en-US")} past appointments are confirmed shown (${pct(h.trueShowRate)}).` : "Until they are marked, nobody knows who came, so a show rate cannot be worked out yet.")
        : "Missed in the last 7 days and not booked again. A call today is the quickest win.";
      return (
        <div data-testid="ap-overview">
          {d.needsPermission && <InlineAlert tone="warning" className="mb-4" title="Needs permission: reconnect">Some accounts cannot show appointments yet. Open the app in your marketplace and choose Reinstall, then approve the extra read-only permission.</InlineAlert>}
          <section className="s6-card ap-hero s6-enter" data-glow={clearAll ? undefined : "warn"} aria-label="What needs you">
            <span className="ap-live"><span className="ap-pulse" />Live</span>
            <h2 className="ap-sentence" data-testid="ap-headline">
              {clearAll ? <><CheckCircle2 aria-hidden className="mr-2 inline size-6 text-[var(--s6-green)]" />Every past appointment has an outcome and no no-show is waiting for a call.</> : sentence}
            </h2>
            {!clearAll && <p className="ap-meaning" data-testid="ap-meaning">{meaning}</p>}
            {clearAll && h.trueShowRate !== null && <p className="ap-meaning">Your show rate is {pct(h.trueShowRate)}.</p>}
            <div className="ap-kpis">
              <Kpi tone="violet" n={<CountUp value={h.needsOutcome} />} label="Past appointments with no outcome" tip="Their time passed more than 3 hours ago and nobody marked them showed, no-show or cancelled. Press to see exactly these." onClick={() => go("needs")} testId="ap-kpi-needs" />
              <Kpi tone="red" n={<CountUp value={h.noShowsToRecover} />} label="No-shows to win back" tip="Missed in the last 7 days and not booked again (a no-show you snoozed is left out until the snooze ends). Press to see exactly these." onClick={() => go("recover")} testId="ap-kpi-recover" />
              <Kpi tone={h.trueShowRate !== null && h.reportedShowRate !== null && h.reportedShowRate - h.trueShowRate >= 0.1 ? "amber" : "green"} n={h.trueShowRate === null ? "n/a" : <CountUp value={Math.round(h.trueShowRate * 100)} suffix="%" />} label={h.trueShowRate === null ? "Show rate: not enough marked yet" : "Confirmed shown"}
                tip={h.trueShowRate === null ? `A show rate needs at least 5 past appointments with an outcome. ${h.marked} so far.` : `${h.showed.toLocaleString("en-US")} showed, out of ${h.passed.toLocaleString("en-US")} past appointments (showed, no-show and no outcome yet). It rises as the unmarked ones are marked.${h.reportedShowRate !== null ? ` If the ${h.needsOutcome} unmarked were ignored it would read ${pct(h.reportedShowRate)}, which is why it is not used.` : ""} Press to see the ones that showed.`}
                disabled={h.showed === 0} onClick={() => onDrill({ title: "Confirmed shown", count: h.showed, extra: { outcome: "showed", expect: h.showed } })} testId="ap-kpi-rate" />
              <Kpi tone="amber" n={d.revenueAtRisk ? `${money(d.revenueAtRisk.lowCents)} to ${money(d.revenueAtRisk.highCents)}` : "n/a"} label={d.revenueAtRisk ? "Deal money at risk (estimate)" : "Deal money at risk: no open deals yet"}
                tip={d.revenueAtRisk ? `${d.revenueAtRisk.basis} Press to see the ${h.atRisk.toLocaleString("en-US")} appointments it is made of.` : "Counted from open deals linked to no-shows and unmarked appointments. None are linked yet."}
                disabled={!d.revenueAtRisk || h.atRisk === 0} onClick={() => onDrill({ title: "Appointments with deal money at risk", count: h.atRisk, extra: { outcome: "at_risk", sort: "value", expect: h.atRisk } })} testId="ap-kpi-risk" />
            </div>
            <div className="ap-act">
              {h.needsOutcome > 0 ? <button type="button" className="s6-btn" data-kind="primary" onClick={() => go("needs")} data-testid="ap-primary">Mark the {h.needsOutcome} now</button> : h.noShowsToRecover > 0 ? <button type="button" className="s6-btn" data-kind="primary" onClick={() => go("recover")} data-testid="ap-primary">Win back {h.noShowsToRecover} no-shows</button> : <button type="button" className="s6-btn" data-kind="primary" onClick={() => go("flow")} data-testid="ap-primary">See who earns the money</button>}
              {(dbl > 0 || idle > 0) && <span className="ap-fine" data-testid="ap-today">Also today:{" "}
                {dbl > 0 && <LinkBtn onClick={() => go("calendars", "conflicts")} testId="ap-today-double">{dbl} double {dbl === 1 ? "booking" : "bookings"}</LinkBtn>}
                {dbl > 0 && idle > 0 && " and "}
                {idle > 0 && <LinkBtn onClick={() => go("calendars", "idle_person")} testId="ap-today-idle">{idle} {idle === 1 ? "person" : "people"} with no bookings</LinkBtn>}</span>}
            </div>
          </section>

          <div className="ap-grid ap-grid3">
            <Q q="Which account loses the most?" tip="The account with the most no-shows against its past appointments, among accounts with at least 5 marked. The number is its no-shows; the line under it says what share that is. Press the number to see them." testId="ap-card-worst">
              {c.worstAccount ? <>
                <Big tone="red" n={c.worstAccount.noShows} label={`no-shows at ${c.worstAccount.name}`} testId="ap-worst-hit"
                  onClick={() => onDrill({ title: `${c.worstAccount!.name}: no-shows`, count: c.worstAccount!.noShows, extra: { location: c.worstAccount!.id, outcome: "noshow", expect: c.worstAccount!.noShows }, labels: { location: c.worstAccount!.name } })} />
                <p className="ap-fine">no-shows at {c.worstAccount.name}: {pct(c.worstAccount.noShowRate)} of its {c.worstAccount.of.toLocaleString("en-US")} past appointments.</p>
                <p className="mt-2"><LinkBtn onClick={() => go("health")}>See every account</LinkBtn></p>
              </> : <><p className="ap-fine">Not enough marked appointments yet: each account needs 5 or more.</p><p className="mt-2"><LinkBtn onClick={() => go("needs")}>Mark outcomes</LinkBtn></p></>}
            </Q>
            <Q q="Who books the best?" tip="The person whose bookings are most often confirmed shown, among people with at least 5 marked. Bookings with no booker recorded are left out, because there is nobody to learn from. Press the number to see those appointments." testId="ap-card-top">
              {c.topSetter ? <>
                <Big tone="green" n={c.topSetter.showed} label={`bookings by ${c.topSetter.name} confirmed shown`} testId="ap-top-hit"
                  onClick={() => onDrill({ title: `Booked by ${c.topSetter!.name}: showed`, count: c.topSetter!.showed, extra: { booker: c.topSetter!.id, outcome: "showed", expect: c.topSetter!.showed }, labels: { booker: c.topSetter!.name } })} />
                <p className="ap-fine">bookings by {c.topSetter.name} confirmed shown: {pct(c.topSetter.showRate)} of {c.topSetter.of.toLocaleString("en-US")}.</p>
              </> : <p className="ap-fine">Not enough marked appointments yet: each person needs 5 or more.</p>}
              {c.unrecordedBookers > 0 && <p className="ap-fine mt-2">{c.unrecordedBookers.toLocaleString("en-US")} {c.unrecordedBookers === 1 ? "booking has" : "bookings have"} no booker recorded, so {c.unrecordedBookers === 1 ? "it is" : "they are"} left out. <LinkBtn onClick={() => onDrill({ title: "Bookings with no booker recorded", count: c.unrecordedBookers, extra: { booker: "none", outcome: "booked", expect: c.unrecordedBookers }, labels: { booker: "not recorded" } })} testId="ap-unrecorded-hit">Open them</LinkBtn></p>}
              <p className="mt-2"><LinkBtn onClick={() => go("share")}>See every booker</LinkBtn></p>
            </Q>
            <Q q="Where is the biggest leak?" tip="The hand-off (one person books, another takes the meeting) that loses clearly more appointments than your own average. The number is the appointments in that hand-off. Press it to see them." testId="ap-card-leak">
              {c.leak ? <>
                <Big tone="red" n={c.leak.count} label="appointments in this hand-off" testId="ap-leak-hit"
                  onClick={() => onDrill({ title: `${c.leak!.names.booker ?? "Booker"} to ${c.leak!.names.owner ?? "owner"}`, count: c.leak!.count, extra: { ...c.leak!.params, expect: c.leak!.count }, labels: { ...(c.leak!.names.booker ? { booker: c.leak!.names.booker } : {}), ...(c.leak!.names.owner ? { owner: c.leak!.names.owner } : {}) } })} />
                <p className="ap-fine">{c.leak.text}</p>
                <p className="mt-2"><LinkBtn onClick={() => go("flow")}>Show it in the tree</LinkBtn></p>
              </> : <><p className="ap-fine">No single hand-off stands out yet.</p><p className="mt-2"><LinkBtn onClick={() => go("flow")}>Open the tree</LinkBtn></p></>}
            </Q>
          </div>

          <button type="button" className="s6-btn mb-4" onClick={() => setMore((m) => !m)} aria-expanded={more} data-testid="ap-more">{more ? "Less" : "More: where do my appointments go?"}</button>
          {more && d.journey.length > 0 && (
            <Q q="Where do my appointments go?" tip="Booked, showed and won, counted from the same rows as the lists. Press a number to see them." testId="ap-journey" action={<button type="button" className="s6-btn" onClick={() => setRun((r) => r + 1)}><RotateCcw aria-hidden className="size-4" />Replay</button>}>
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
