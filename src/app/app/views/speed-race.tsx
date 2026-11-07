"use client";

import { MoreHorizontal, PhoneCall } from "lucide-react";
import { LeadMark, LeadTag, openOnRowClick, ROW_CLICK } from "./speed-lead-row";
import { useEffect, useState, useMemo } from "react";
import { raceState, type Score } from "@/lib/analytics/speed-v4";
import { fmtDuration } from "@/lib/analytics/speed-intel";
import { ReviewSheet, useRunner, wbButtons } from "../ds/wb/runner";
import { CountUp } from "../ds/count-up";
import { PopMenu } from "../ds";
import { WhatIs } from "../ds/what-is";
import { EmptyState, ErrorState, SkeletonRows } from "../ds";
import { useData } from "../session";
import { DupChips, MoneyMeter, type Risk } from "./speed5-ui";
import { PrimaryButton } from "./today-chrome";
import { useSpeedFilter } from "./speed-filter";
import { rowKey, useLeadActions, whyLine, type LeadRow } from "./speed-rows";
import { TzNote, useListPopup } from "./speed6-base";
import { delayReasons, type ReasonKey } from "@/lib/analytics/speed6";
import { DelayChip } from "./delay-chip";
import "./speed4.css";

// The first screen of Speed to lead: THE RACE ON NEW LEADS. A headline in money, a live clock on every new lead, one button for the lead closest to losing, and a speed ring per account.
// Money is shown as counted deals; an estimate only where the account has enough closed deals, and it says so. Nothing here sends a message: replying and assigning go through the
// workbench gateway (preview, confirm, and a dry run while changes from SubSync are switched off).

export type FeedRow = LeadRow & { arrivedAt: number; touchedAt: number | null; targetMinutes: number; quality: number; dollars: number };
type Race = {
  now: number; targetMinutes: number; accounts: number; overall: Score; scores: Array<{ locationId: string; name: string } & Score>;
  leak: { leads: number; noTouch: number; slow: number; countedDollars: number; countedPeople: number; countedDeals: number; estimate: { amount: number; line: string; accounts: number; leftOut: number } | null };
  losing: { count: number; dollars: number }; feed: FeedRow[]; risk: Risk | null;
};
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** One clock for the whole page: ticks every second, and never while the tab is hidden. */
function useNow(serverNow: number) {
  const [ticked, setTicked] = useState<{ base: number; now: number } | null>(null);
  useEffect(() => {
    if (!serverNow) return;
    const skew = serverNow - Date.now();
    const t = setInterval(() => { if (!document.hidden) setTicked({ base: serverNow, now: Date.now() + skew }); }, 1000);
    return () => clearInterval(t);
  }, [serverNow]);
  return ticked && ticked.base === serverNow ? ticked.now : serverNow;
}

const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(x).padStart(2, "0")}`; };
const TONE = { winning: "text-[var(--t-accent)]", close: "text-warning", losing: "text-destructive", won: "text-muted-foreground", lost: "text-muted-foreground" } as const;
const BAR = { winning: "bg-[var(--t-accent)]", close: "bg-warning", losing: "bg-destructive", won: "bg-muted-foreground/50", lost: "bg-muted-foreground/50" } as const;

/** The clock of one lead: counts up from arrival, turns amber as the target nears and red and flashing at the breach. Stops at the first person touch. */
export function LiveTimer({ lead, now }: { lead: Pick<FeedRow, "arrivedAt" | "touchedAt" | "targetMinutes">; now: number }) {
  const st = raceState(lead.arrivedAt, lead.touchedAt, lead.targetMinutes, now);
  const elapsed = (lead.touchedAt ?? now) - lead.arrivedAt;
  const just = st.race === "losing" && st.msLeft === 0 && elapsed - lead.targetMinutes * 60_000 < 12_000;
  return (
    <div className="w-24 shrink-0" data-testid="live-timer" data-race={st.race}>
      <p className={`tnum text-xl font-semibold leading-none tracking-tight ${TONE[st.race]} ${just ? "s4-flash" : ""}`} aria-label={`${fmtDuration(Math.round(elapsed / 1000))} since the lead arrived`}>{clock(elapsed)}</p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden><div className={`h-full rounded-full ${BAR[st.race]}`} style={{ width: `${Math.min(100, st.pct * 100)}%`, transition: "width 1s linear" }} /></div>
      <p className="t-small t-quiet mt-0.5">{st.race === "won" ? "answered in time" : st.race === "lost" ? "answered late" : st.race === "losing" ? "past the target" : `${clock(st.msLeft)} left`}</p>
    </div>
  );
}

/** The speed ring: the share of new leads answered inside the target. Counts up on arrival; the number in the text is always the real one. */
export function Ring({ score, size = 112, label }: { score: number | null; size?: number; label: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  const r = size / 2 - 8, c = 2 * Math.PI * r, v = score ?? 0;
  return (
    <figure className="m-0 text-center" data-testid="speed-ring" aria-label={score === null ? label + ": not enough data" : label + ": " + score + " percent"}>
      <div className="relative mx-auto" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={"0 0 " + size + " " + size} aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--t-rule)" strokeWidth="8" />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={v >= 80 ? "var(--t-accent)" : v >= 50 ? "var(--warning, #b7791f)" : "var(--destructive, #c53030)"} strokeWidth="8" strokeLinecap="round" strokeDasharray={c}
            strokeDashoffset={on && score !== null ? c * (1 - v / 100) : c} transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"} style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)" }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-semibold tabular-nums" style={{ fontSize: size / 4.2 }}>{score === null ? "n/a" : <><CountUp value={String(score)} />%</>}</div>
      </div>
      <figcaption className="t-small t-quiet mt-1 truncate">{label}</figcaption>
    </figure>
  );
}

function Story({ lead }: { lead: FeedRow }) {
  const { data, error } = useData<{ events: Array<{ at: number; kind: string; text: string }> }>(`speed?part=story&loc=${encodeURIComponent(lead.locationId)}&contact=${encodeURIComponent(lead.contactId)}`);
  if (error) return <p className="t-small t-quiet">The story could not be loaded.</p>;
  if (!data) return <p className="t-small t-quiet">Loading...</p>;
  if (data.events.length === 0) return <p className="t-small t-quiet" data-testid="story-empty">Nothing recorded yet. History fills in from the next sync.</p>;
  return <ol className="t-small space-y-1 border-l pl-3" data-testid="lead-story">{data.events.map((e, i) => <li key={i}><span className="t-quiet tnum">{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> {e.text}</li>)}</ol>;
}

/** One-tap assign: preview, then confirm, through the write gateway. */
function Assign({ lead, onDone }: { lead: LeadRow; onDone: () => void }) {
  const s = lead.suggestion;
  const rr = lead.roundRobin ?? null;
  const run = useRunner(lead.locationId, lead.contactId, onDone);
  if (!lead.unassigned || (!s?.userId && !rr)) return null;
  return (
    <div className="col-span-full flex flex-wrap gap-2">
      {rr && <button type="button" className={`${wbButtons.BTN} !min-h-9 text-sm`} disabled={run.busy} data-testid="race-assign-rr" data-tip="Next in line: the person holding the fewest leads still waiting. Preview first; nothing changes until you confirm." onClick={() => void run.preview({ kind: "owner", userId: rr.userId }, { verb: "Assign" })}>Next in line: {rr.label}</button>}
      {s?.userId && s.userId !== rr?.userId && <button type="button" className={`${wbButtons.BTN} !min-h-9 text-sm`} disabled={run.busy} data-testid="race-assign" onClick={() => void run.preview({ kind: "owner", userId: s.userId as string }, { verb: "Assign" })}>Give to {s.label}</button>}
      <ReviewSheet r={run} name={lead.name} />
    </div>
  );
}

export function RaceTab({ multi, onCall }: { multi: boolean; onCall?: () => void }) {
  const { query } = useSpeedFilter();
  const { data: d, error, reload } = useData<Race>(`speed?part=race${query}`);
  const rows = d?.feed ?? [];
  const reasons = useMemo(() => delayReasons(rows.map((r) => ({ ...r, leadAt: r.arrivedAt }))), [rows]);
  const actions = useLeadActions(rows);
  const now = useNow(d?.now ?? 0);
  const [story, setStory] = useState<string | null>(null);
  const { open: openList, node: listNode } = useListPopup(multi);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!d) return <SkeletonRows rows={5} label="Lining up the race..." />;
  const waiting = rows.filter((r) => r.touchedAt === null).sort((a, b) => (a.arrivedAt + a.targetMinutes * 60_000 - (a.repeat ? 600_000 : 0)) - (b.arrivedAt + b.targetMinutes * 60_000 - (b.repeat ? 600_000 : 0))); // a repeat enquirer is warm: it counts as ten minutes closer to its deadline
  const closest = waiting.find((r) => raceState(r.arrivedAt, null, r.targetMinutes, now).race !== "losing") ?? waiting[0];
  const losing = waiting.filter((r) => raceState(r.arrivedAt, null, r.targetMinutes, now).race === "losing");
  const losingDollars = losing.reduce((s, r) => s + r.dollars, 0);
  const l = d.leak;
  const headline = losing.length === 0
    ? (waiting.length ? `${waiting.length} new ${waiting.length === 1 ? "lead is" : "leads are"} in the race and none has lost it yet.` : "Every new lead has had a person reach out in time.")
    : `${losing.length} new ${losing.length === 1 ? "lead is" : "leads are"} losing the race${losingDollars > 0 ? `: ${usd(losingDollars)} of open deals` : ""}.`;
  return (
    <div data-testid="race-tab">
      {listNode}
      <TzNote />
      <section className="mb-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-center" aria-label="The race">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <h2 className="t-display min-w-0 flex-1 basis-64" data-testid="race-headline" aria-live="polite">{headline}</h2>
            {onCall && <button type="button" onClick={onCall} data-testid="start-calling" className="spd-cta ds-press inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-5 text-[15px] font-semibold focus-visible:outline-2 focus-visible:outline-[var(--ring)]"><PhoneCall aria-hidden className="size-4" />Start calling</button>}
          </div>
          <p className="t-small t-quiet mt-2" data-testid="race-money">
            This month, <button type="button" className="s6-link font-semibold underline decoration-dotted underline-offset-4" data-tip="Click to see these leads" data-testid="race-leak-link" onClick={() => openList("No person reply, or a slow one", { status: "slow" })}>{l.leads.toLocaleString("en-US")} {l.leads === 1 ? "lead" : "leads"}</button> got no person reply or a slow one
            {l.countedDollars > 0 ? <>: <strong className="text-[var(--t-ink)]">{usd(l.countedDollars)}</strong> in open deals belongs to {l.countedPeople} of them (counted).</> : ". No open deals are attached to them."}
            {l.estimate ? <> An estimate of what slow replies cost: <strong className="text-[var(--t-ink)]">{l.estimate.line}</strong> (estimate{l.estimate.leftOut ? `, ${l.estimate.leftOut} accounts left out for too few closed deals` : ""})</> : <> No estimate yet: an account needs 20 closed deals first.</>}
            <WhatIs text="Counted deals are open deals of the people who got no person reply or a slow one. The estimate multiplies those leads by the account's own average deal and win rate, only with 20 or more closed deals." />
          </p>
          <MoneyMeter risk={d.risk} losing={losing.length} waiting={waiting.length} />
          {closest && <div className="mt-4 max-w-sm" data-testid="race-primary"><PrimaryButton p={{ label: "Reply to the lead closest to breaching", sr: `${closest.name}, closest to breaching`, onClick: () => actions.reply(closest) }} /></div>}
        </div>
        <div className="flex items-end justify-center gap-6">
          <button type="button" className="s6-link" data-testid="race-ring-open" data-tip="Answered in time. Click to see those leads." aria-label="Answered in time, open the leads" onClick={() => openList("Answered in time", { status: "within" })}><Ring score={d.overall.score} label="Answered in time" /></button>
          <button type="button" className="s6-link pb-6 text-sm" data-testid="race-median" data-tip="Typical first reply. Click to see the leads that got one." onClick={() => openList("Leads that got a first reply", { status: "answered" })}><p className="t-label">Typical first reply</p><p className="text-2xl font-semibold tabular-nums">{d.overall.medianSeconds === null ? "n/a" : fmtDuration(d.overall.medianSeconds)}</p><p className="t-small t-quiet">target {d.targetMinutes} min</p></button>
        </div>
      </section>

      {d.scores.length > 1 && (
        <section className="mb-8" aria-label="Speed by account" data-testid="race-accounts">
          <h3 className="t-title mb-2">Speed by account <WhatIs text="Share of each account's new leads answered by a person inside the target. Needs 5 judged leads." /></h3>
          <ul className="flex flex-wrap gap-x-6 gap-y-3">{d.scores.map((a) => <li key={a.locationId} className="w-24 text-center"><button type="button" className="s6-link w-full" data-testid="account-ring" data-tip={`${a.name}: click to see its leads`} aria-label={`${a.name}, open its leads`} onClick={() => openList(a.name, { status: "all", account: a.locationId })}><Ring score={a.score} size={72} label={a.name} /></button></li>)}</ul>
        </section>
      )}

      <section aria-label="New leads" data-testid="race-feed">
        <h3 className="t-title mb-2">New leads, newest first <WhatIs text="Each clock starts when the lead arrives and stops at the first person's message or call. It turns amber near the target and red at the breach." /></h3>
        {rows.length === 0 ? <EmptyState title="No new leads in the last 2 days" body="A new lead appears here the moment it arrives, with its clock running." /> : (
          <ul className="@container divide-y border-y" data-testid="race-rows">
            {rows.map((r, i) => (
              <li key={rowKey(r)} onClick={openOnRowClick(() => actions.show(i))} className={`ds-row grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 ${ROW_CLICK}`} data-testid="race-row">
                <LiveTimer lead={r} now={now} />
                <div className="min-w-0">
                  <button type="button" onClick={() => actions.show(i)} className="block max-w-full cursor-pointer truncate text-left font-semibold hover:underline" data-tip="Click to open this lead" title={undefined}><LeadMark name={r.name} />{r.name}<LeadTag /></button>
                  <p className="t-small t-quiet truncate" title={whyLine(r, multi)}>{whyLine(r, multi)}</p>
                  <DupChips dup={r.duplicateOf ?? null} repeat={r.repeat === true} />
                {r.touchedAt === null && reasons.get(rowKey(r)) && <p className="mt-1"><DelayChip reason={reasons.get(rowKey(r)) as ReasonKey} /></p>}
                  <p className="t-small t-quiet">Lead quality <span className="tnum font-medium text-[var(--t-ink)]" data-testid="lead-quality">{r.quality}</span>/100{r.dollars > 0 ? <> · <span className="tnum">{usd(r.dollars)}</span> open</> : null} <WhatIs text="A starting guess from what the lead gave us: a real phone number, a real email, a known source. Not a promise." /></p>
                </div>
                <div className="flex items-center gap-1">
                  {r.touchedAt === null && <button type="button" onClick={() => actions.reply(r)} className="ds-press min-h-11 rounded-md border bg-card px-3 text-sm font-medium hover:border-primary/40 sm:min-h-9" data-testid="race-reply" aria-label={`Reply to ${r.name}`}>Reply</button>}
                  <PopMenu label={`More for ${r.name}`} items={[...actions.menu(r, i, multi), { key: "story", label: story === rowKey(r) ? "Hide life story" : "Life story", onSelect: () => setStory(story === rowKey(r) ? null : rowKey(r)) }]} testId="race-more" triggerClassName="ds-press inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:size-8"><MoreHorizontal aria-hidden className="size-4" /></PopMenu>
                </div>
                {actions.stripFor(r)}
                <Assign lead={r} onDone={reload} />
                {story === rowKey(r) && <div className="col-span-full pl-1"><Story lead={r} /></div>}
              </li>
            ))}
          </ul>
        )}
        {actions.drawer}
      </section>
    </div>
  );
}
