"use client";

import { useEffect, useState } from "react";
import { fmtDuration } from "@/lib/analytics/speed-intel";
import { DAY_NAMES, hourWords } from "@/lib/analytics/speed-v3";
import { STEP_LABEL, STEPS, type JourneyStep, type Step } from "@/lib/analytics/speed-v4-more";
import type { ChannelRow, MissedCall } from "@/lib/analytics/speed-v4";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { WhatIs } from "../ds/what-is";
import { useData } from "../session";
import { useSpeedFilter } from "./speed-filter";
import { SidePopup } from "./speed-popup";
import { LeadRows, useLeadActions, type LeadRow } from "./speed-rows";
import { useListPopup } from "./speed6-base";
import { RulesTab6 } from "./speed6-rules";
import type { GoFn } from "../nav";
import "./speed4.css";

// Coverage (what the phones and the nights lose), the lead journey, and the Rules tab (routing check, the printable "Our response speed" report). Money is counted deals first; an estimate
// only with enough closed deals, labelled. Everything is read from SubSync's own history of messages and calls (metadata only, never the words).
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const CH: Record<string, string> = { sms: "Text", email: "Email", whatsapp: "WhatsApp", call: "Call", chat: "Chat", other: "Other" };
const Card = ({ id, title, tip, children }: { id: string; title: string; tip?: string; children: React.ReactNode }) => (
  <section aria-labelledby={id} className="spd-rise mb-10 border-t border-[var(--t-rule)] pt-5" data-testid={id}><h3 id={id} className="t-title mb-2">{title}{tip && <> <WhatIs text={tip} /></>}</h3>{children}</section>
);

type Cov = {
  now: number; eventsStored: number;
  missed: { total: number; recovered15: number; unrecovered: number; dollars: number; rows: Array<LeadRow & { calledAt: number; dollars: number; callState: MissedCall["status"] }>; audit: { missed: number; textedWithin60: number; share: number | null; enough: boolean } };
  night: { lost: number; countedDollars: number; estimate: { amount: number; line: string } | null; hoursToCover: Array<{ dow: number; hour: number; leads: number }>; afterLeads: number; answeredSameNight: number; share: number | null; cover: Array<{ userId: string; name: string; touches: number }> };
  best: { hours: Array<{ hour: number; sent: number; replied: number; rate: number | null }>; best: Array<{ hour: number; sent: number; replied: number; rate: number | null }>; enough: boolean; tries: number };
  channels: ChannelRow[];
  routing: { enough: boolean; fair: number | null; noLeads: Array<{ userId: string; name: string }>; overloaded: Array<{ userId: string; name: string; leads: number }> };
};

export function CoverageTab({ multi }: { multi: boolean }) {
  const { query } = useSpeedFilter();
  const { data: d, error, reload } = useData<Cov>(`speed?part=coverage${query}`);
  const actions = useLeadActions(d?.missed.rows ?? []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return <SkeletonRows rows={5} label="Counting missed calls and nights..." />;
  const m = d.missed, n = d.night;
  const maxRate = Math.max(0.01, ...d.best.hours.map((h) => h.rate ?? 0));
  return (
    <div data-testid="coverage-tab">
      {d.eventsStored === 0 && <p className="t-small t-quiet mb-4" data-testid="coverage-warming">Message and call history starts filling after the next sync (the last 30 days are read back a few conversations at a time). Numbers below appear as it arrives.</p>}

      <Card id="missed-calls" title="Missed calls nobody called back" tip="A missed call counts as recovered when anyone (a person or an automatic text) reached out within 15 minutes. Dollars are the open deals of those callers, counted.">
        <p className="t-display" data-testid="missed-headline">{m.unrecovered === 0 ? (m.total === 0 ? "No missed calls recorded in the last 30 days." : "Every missed call was followed up within 15 minutes.") : `${m.unrecovered} missed ${m.unrecovered === 1 ? "call" : "calls"} had no callback or text within 15 minutes${m.dollars > 0 ? `: ${usd(m.dollars)} of open deals` : ""}.`}</p>
        <p className="t-small t-quiet mt-1" data-testid="textback-audit">{m.audit.enough ? `${m.audit.share}% of missed calls got a text inside 60 seconds (${m.audit.textedWithin60} of ${m.audit.missed}).` : "A text-back check needs at least 5 missed calls."}</p>
        {m.rows.length > 0 && <div className="mt-3"><LeadRows rows={m.rows} showAccount={multi} actions={actions} testId="missed-rows" head={false} />{actions.drawer}</div>}
      </Card>

      <Card id="lost-night" title="Lost at night and at weekends" tip="Leads that arrived outside 8 to 18 on a weekday, or at a weekend, and had no person reply within 12 hours. The estimate uses each account's own average deal and win rate, only with 20 closed deals.">
        <p className="t-display" data-testid="night-headline">{n.lost === 0 ? "No lead went unanswered overnight in the last 30 days." : `${n.lost} after-hours ${n.lost === 1 ? "lead" : "leads"} waited over 12 hours for a person${n.countedDollars > 0 ? `: ${usd(n.countedDollars)} of open deals (counted)` : ""}.`}</p>
        {n.estimate && <p className="t-small t-quiet mt-1" data-testid="night-estimate">Estimated cost of that gap: <strong className="text-[var(--t-ink)]">{n.estimate.line}</strong> (estimate).</p>}
        {n.share !== null && <p className="t-small t-quiet">{n.share}% of {n.afterLeads} after-hours leads were answered within 12 hours.</p>}
        {n.hoursToCover.length > 0 && <p className="t-small mt-2" data-testid="hours-to-cover"><span className="font-medium">Hours to cover:</span> {n.hoursToCover.map((h) => `${DAY_NAMES[h.dow]} ${hourWords(h.hour)} (${h.leads})`).join(", ")}.</p>}
        {n.cover.length > 0 && <p className="t-small t-quiet">Has replied after hours before and could cover: {n.cover.map((c) => `${c.name} (${c.touches})`).join(", ")}.</p>}
      </Card>

      <Card id="best-time" title="Best time to call or reply" tip="Share of a person's messages and calls that got something back within a day, by hour of the day in the account's own time. Needs 10 tries in an hour and 5 answers before it is ranked.">
        {!d.best.enough ? <p className="t-small t-quiet" data-testid="best-empty">Not enough history yet ({d.best.tries} tries so far).</p> : (
          <>
            <p className="t-small mb-2" data-testid="best-line">Leads answer most when you reach out at {d.best.best.map((h) => `${hourWords(h.hour)} (${Math.round((h.rate as number) * 100)}%)`).join(", ")}.</p>
            <ol className="flex h-24 items-end gap-0.5" aria-label="Answer rate by hour" data-testid="best-bars">{d.best.hours.map((h) => <li key={h.hour} className="flex-1" title={`${hourWords(h.hour)}: ${h.rate === null ? "not enough tries" : Math.round(h.rate * 100) + "% answered"} (${h.sent} tries)`}><div className="rounded-t-sm bg-[var(--t-accent)]" style={{ height: `${h.rate === null ? 3 : Math.max(4, (h.rate / maxRate) * 96)}px`, opacity: h.rate === null ? 0.25 : 1 }} /></li>)}</ol>
          </>
        )}
      </Card>

      <Card id="channel-mix" title="Channel mix and delivery health" tip="What your people sent, how many got an answer within a day, and how many failed to deliver. A winner is named only when two channels have 20 or more sends.">
        {d.channels.length === 0 ? <p className="t-small t-quiet">No sends recorded yet.</p> : (
          <table className="w-full text-sm" data-testid="channel-table"><thead><tr className="t-small t-quiet text-left"><th className="py-1">Channel</th><th>Sent</th><th>Answered</th><th>Failed to deliver</th></tr></thead>
            <tbody>{d.channels.map((c) => <tr key={c.channel} className="border-t"><td className="py-1.5 font-medium">{CH[c.channel]}{c.winner ? " (best)" : ""}</td><td className="tnum">{c.sent}</td><td className="tnum">{c.rate === null ? "not enough data" : `${Math.round(c.rate * 100)}%`}</td><td className="tnum">{c.failed}{c.failedRate !== null && c.failed > 0 ? ` (${Math.round(c.failedRate * 100)}%)` : ""}</td></tr>)}</tbody></table>
        )}
      </Card>
    </div>
  );
}

/** The lead journey: how many leads got to each step, where they dropped, how long it took. Each step opens exactly its leads. */
export function JourneyCard({ multi }: { multi: boolean }) {
  const { query, range } = useSpeedFilter();
  const { data, error, reload } = useData<{ steps: JourneyStep[]; repliedRecorded: boolean }>(`speed?part=journey${query}`);
  const [open, setOpen] = useState<{ step: Step; dropped: boolean } | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={2} label="Following the leads..." />;
  const top = Math.max(1, data.steps[0]?.count ?? 1);
  return (
    <Card id="journey" title={`Lead journey, ${range?.sentence ?? "last 30 days"}`} tip="Each step is a subset of the one before. Booked, showed and won come from your appointments and deals. Median time is shown where SubSync has both ends recorded.">
      <ol className="space-y-2" data-testid="journey-steps">
        {data.steps.map((s, i) => (
          <li key={s.step} data-testid="journey-step" data-step={s.step}>
            <button type="button" onClick={() => setOpen({ step: s.step, dropped: false })} data-tip={`${s.label}: ${s.count.toLocaleString("en-US")} ${s.count === 1 ? "lead" : "leads"}. Click to see the people.`} className="ds-press spd-row-link -mx-1 block w-full px-1 text-left" aria-label={`${s.label}: ${s.count} leads. Open them.`}>
              <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{s.label}</span><span className="tnum font-semibold" data-testid="journey-count">{s.count.toLocaleString("en-US")}</span></div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className="h-full rounded-full bg-[var(--t-accent)]" style={{ width: `${Math.max(s.count ? 2 : 0, (s.count / top) * 100)}%`, transition: "width 700ms ease" }} /></div>
            </button>
            {i > 0 && <p className="t-small t-quiet mt-0.5">{s.dropped > 0 ? <button type="button" onClick={() => setOpen({ step: s.step, dropped: true })} data-tip="Click to see who dropped here" className="spd-row-link min-h-6 px-1 font-medium text-[var(--t-accent)] underline decoration-dotted underline-offset-4" data-testid="journey-drop">{s.dropped.toLocaleString("en-US")} dropped here{s.dropShare !== null ? ` (${Math.round(s.dropShare * 100)}%)` : ""}</button> : "none dropped here"}{s.medianFromPrev !== null ? ` · typically ${fmtDuration(s.medianFromPrev)} after the step before` : ""}</p>}
          </li>
        ))}
      </ol>
      {!data.repliedRecorded && <p className="t-small t-quiet mt-2">Replies from the lead are not recorded yet; a booked lead counts as replied until they are.</p>}
      {open && <SidePopup label={`${STEP_LABEL[open.step]}${open.dropped ? ", dropped" : ""}`} onClose={() => setOpen(null)}><JourneyList key={open.step + open.dropped} step={open.step} dropped={open.dropped} multi={multi} /></SidePopup>}
    </Card>
  );
}
export function JourneyList({ step, dropped, multi }: { step: Step; dropped: boolean; multi: boolean }) {
  const { query } = useSpeedFilter();
  const { data, error, reload } = useData<{ count: number; shown: number; rows: LeadRow[] }>(`speed?part=journey-list&step=${step}&dropped=${dropped ? 1 : 0}${query}`);
  const actions = useLeadActions(data?.rows ?? []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={3} label="Opening the leads..." />;
  return (
    <div data-testid="journey-list">
      <p className="t-small t-quiet mb-2" data-testid="journey-list-count">{data.count.toLocaleString("en-US")} {data.count === 1 ? "lead" : "leads"} {dropped ? `dropped before "${STEP_LABEL[step]}"` : `reached "${STEP_LABEL[step]}"`}{data.count > data.shown ? `, the first ${data.shown} shown` : ""}</p>
      {data.rows.length === 0 ? <EmptyState title="No leads here" body="Nothing matches this step right now." /> : <LeadRows rows={data.rows} showAccount={multi} actions={actions} testId="journey-rows" />}
      {actions.drawer}
    </div>
  );
}
export const JOURNEY_STEPS = STEPS;

type Proof = { now: number; targetMinutes: number; accounts: Array<{ locationId: string; name: string; leads: number; now: { judged: number; within: number; score: number | null; medianSeconds: number | null; enough: boolean }; within5?: { replied: number; inside: number } | null; before: { score: number | null; medianSeconds: number | null; enough: boolean } }> };

/** The white-label printable report an agency shows a client: median first reply, share inside the target, against the month before. Carries no vendor name. */
function ProofReport() {
  const { data, error, reload } = useData<Proof>("speed?part=proof");
  const [pick, setPick] = useState<string>("");
  const { open: proofOpen, node: proofNode } = useListPopup(true);
  useEffect(() => { const off = () => document.documentElement.classList.remove("s4-printing"); window.addEventListener("afterprint", off); return () => window.removeEventListener("afterprint", off); }, []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <SkeletonRows rows={2} label="Preparing the report..." />;
  const rows = pick ? data.accounts.filter((a) => a.locationId === pick) : data.accounts;
  const diff = (a: number | null, b: number | null, unit: string) => (a === null || b === null ? "no comparison yet" : a === b ? "same as last month" : `${a > b ? "up" : "down"} ${Math.abs(a - b)}${unit} on last month`);
  const secDiff = (a: number | null, b: number | null) => (a === null || b === null ? "no comparison yet" : a === b ? "same as last month" : `${a < b ? "faster" : "slower"} by ${fmtDuration(Math.abs(a - b))}`);
  return (
    <Card id="proof" title="Our response speed (printable report)" tip="Median first reply and the share of new leads answered by a person inside the target, this month against last month. Needs 5 judged leads a month. Carries no product name.">
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        {data.accounts.length > 1 && <select aria-label="Which account" className="h-9 rounded-md border bg-card px-2 text-sm" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="proof-account"><option value="">All accounts</option>{data.accounts.map((a) => <option key={a.locationId} value={a.locationId}>{a.name}</option>)}</select>}
        <button type="button" className="ds-press min-h-9 rounded-md border bg-card px-3 text-sm font-medium hover:border-primary/40" data-testid="proof-print" onClick={() => { document.documentElement.classList.add("s4-printing"); window.print(); }}>Print or save as PDF</button>
      </div>
      <div className="s6-grid s6-three print:hidden" data-testid="proof-cards">
        {rows.length === 0 ? <p className="s6-label">No new leads in the period.</p> : rows.map((a) => (
          <div key={a.locationId} className="s6-card" data-glow={a.now.score !== null && a.now.score < 50 ? "warn" : undefined} data-testid="proof-card">
            <p className="font-semibold">{a.name}</p>
            <button type="button" className="s6-link s6-label underline decoration-dotted underline-offset-4" onClick={() => proofOpen(`${a.name}: new leads`, { status: "all", account: a.locationId })} aria-label={`${a.name}: ${a.leads} new leads. Open the people.`} data-testid="proof-leads">{a.leads.toLocaleString("en-US")} new {a.leads === 1 ? "lead" : "leads"}</button>
            <p className="s6-big mt-3" data-tone={a.now.score === null ? undefined : a.now.score >= 80 ? "green" : a.now.score >= 50 ? "amber" : "red"} data-tip={`Answered by a person inside ${data.targetMinutes} minutes. ${diff(a.now.score, a.before.score, " points")}.`}>{a.now.score === null ? <span className="text-base font-medium">not enough data</span> : <button type="button" className="s6-link" data-testid="proof-score" aria-label={`${a.name}: ${a.now.score}% answered in time. Open the leads.`} onClick={() => proofOpen(`${a.name}: answered in time`, { status: "within", account: a.locationId })}>{a.now.score}%</button>}</p>
            <p className="s6-label">answered in time</p>
            <p className="mt-3 text-sm" data-tip={secDiff(a.now.medianSeconds, a.before.medianSeconds)}>{a.now.medianSeconds === null ? "no typical time yet" : <button type="button" className="s6-link text-left" data-testid="proof-typical" onClick={() => proofOpen(`${a.name}: leads that got a first reply`, { status: "answered", account: a.locationId })}>{fmtDuration(a.now.medianSeconds)} typical first reply</button>}</p>
          </div>
        ))}
      </div>
      {proofNode}
      <article className="s4-print s6-screen-hide" data-testid="proof-report">
        <header className="mb-4 border-b pb-3">
          <h4 className="text-xl font-semibold tracking-tight">Our response speed</h4>
          <p className="t-small t-quiet">How fast a person replied to every new enquiry. Our promise: a reply within {data.targetMinutes} minutes. Last 30 days, with the 30 days before for comparison. {new Date(data.now).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
        </header>
        {rows.length === 0 ? <p className="t-small">No new leads in the period.</p> : rows.map((a) => (
          <section key={a.locationId} className="proof-account mb-5 border-b pb-4 last:border-b-0" data-testid="proof-row">
            <h5 className="text-base font-semibold">{a.name}</h5>
            <p className="t-small t-quiet">{a.leads.toLocaleString("en-US")} new {a.leads === 1 ? "enquiry" : "enquiries"} this period</p>
            <dl className="mt-2 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
              <div><dt className="t-label">Typical first reply</dt><dd className="text-2xl font-semibold tabular-nums">{a.now.medianSeconds === null ? "not enough data" : fmtDuration(a.now.medianSeconds)}</dd><dd className="t-small t-quiet">{secDiff(a.now.medianSeconds, a.before.medianSeconds)}</dd></div>
              <div><dt className="t-label">Answered in time</dt><dd className="text-2xl font-semibold tabular-nums">{a.now.score === null ? "not enough data" : `${a.now.score}%`}</dd><dd className="t-small t-quiet">{diff(a.now.score, a.before.score, " points")}</dd></div>
              <div><dt className="t-label">Replied within 5 minutes</dt><dd className="text-2xl font-semibold tabular-nums">{a.within5 ? `${a.within5.inside} of ${a.within5.replied}` : "not enough data"}</dd><dd className="t-small t-quiet">of the enquiries that got a reply</dd></div>
            </dl>
          </section>
        ))}
        <footer className="t-small t-quiet mt-2">Measured from the moment each enquiry arrived to the first message or call by a person on our team. Automatic replies do not count. A figure needs at least 5 enquiries; below that it says &quot;not enough data&quot; rather than guess.</footer>
      </article>
    </Card>
  );
}

function RoutingCard() {
  const { query } = useSpeedFilter();
  const { data } = useData<Cov>(`speed?part=coverage${query}`);
  if (!data) return null;
  const r = data.routing;
  return (
    <Card id="routing" title="Routing check" tip="Looks for round robin gaps: people who reply to leads but are given none, and anyone holding more than twice an even share. Needs 10 owned leads.">
      {!r.enough ? <p className="t-small t-quiet" data-testid="routing-empty">Not enough owned leads yet to judge the routing.</p> : (
        <ul className="t-small space-y-1" data-testid="routing-list">
          {r.noLeads.length === 0 && r.overloaded.length === 0 && <li>Leads are spread evenly enough. Nothing to fix.</li>}
          {r.noLeads.map((p) => <li key={p.userId}>{p.name} answers leads but is given none.</li>)}
          {r.overloaded.map((p) => <li key={p.userId}>{p.name} holds {p.leads} leads, more than twice an even share ({Math.round(r.fair ?? 0)}).</li>)}
        </ul>
      )}
    </Card>
  );
}

export function RulesTab(p: { who: string; waiting: number; dollars: number | null; typical: string | null; canChange: boolean; targetMinutes: number; go: GoFn; multi?: boolean; accounts?: Array<{ id: string; name: string }> }) {
  return <RulesTab6 {...p} multi={p.multi ?? false} rest={<><RoutingCard /><ProofReport /></>} />;
}
