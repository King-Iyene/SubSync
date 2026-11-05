"use client";

import { ChevronRight, CircleAlert, Clock, TriangleAlert, UserRound } from "lucide-react";
import { useState } from "react";
import { ageWords, money, replyWords } from "@/lib/analytics/today-queue";
import {
  forecastLine, hourWords, type AccountSpeed, type Coming, type Forecast, type HourStat, type Insight, type PersonLoad, type SinceVisit, type SourceStat,
} from "@/lib/analytics/today-smart";
import { useNow } from "./live";

// The smart blocks of Today. Each is a short, plain-words summary of one thing worked out from data SubSync already holds, and each is clickable down to the
// records it was counted from (the page opens the same records panel for all of them). Every block shows how many leads or things it is based on; a comparison is
// labelled "estimate"; none of them says why something happened. No colour is used for meaning on its own: status has an icon and a word.

const card = "ds-press group flex w-full flex-col items-start gap-1 border-b border-[var(--t-rule)] py-3 pr-2 text-left hover:bg-[var(--t-wash)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]";

/** "Spotted today": up to three cards. */
export function InsightStrip({ insights, onOpen }: { insights: Insight[]; onOpen: (i: Insight) => void }) {
  if (insights.length === 0) return null;
  return (
    <section className="mb-12 border-t border-[var(--t-rule)] pt-5" aria-labelledby="spotted-h" data-testid="insight-strip">
      <h2 id="spotted-h" className="t-title mb-1">Worth a look</h2>
      <ul className="max-w-3xl">
        {insights.map((i) => (
          <li key={i.key} className="min-w-0">
            <button type="button" onClick={() => onOpen(i)} className={card} data-testid="insight-card" data-key={i.key} data-sample={i.sample} aria-label={`${i.text} Based on ${i.sampleLabel}. See them.`}>
              <span className="font-medium">{i.text}</span>
              <span className="t-small t-quiet flex w-full items-center justify-between gap-2">
                <span>Based on <span className="t-num text-[var(--t-ink)]">{i.sampleLabel}</span>{i.estimate ? ", an estimate" : ""}</span>
                <span className="inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">See them<ChevronRight aria-hidden className="size-3.5" /></span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What changed since the person last had Today open. Each number opens its records. */
export function SinceStrip({ since, showAlerts, onOpen }: { since: SinceVisit; showAlerts: boolean; onOpen: (k: "new" | "breached" | "answered" | "alerts") => void }) {
  const day = new Date(since.since).toLocaleString("en-GB", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const cells: Array<{ k: "new" | "breached" | "answered" | "alerts"; n: number; one: string; many: string }> = [
    { k: "new", n: since.newLeads.length, one: "new lead came in", many: "new leads came in" },
    { k: "breached", n: since.breached.length, one: "lead went past the reply target", many: "leads went past the reply target" },
    { k: "answered", n: since.answered.length, one: "lead got a first reply", many: "leads got a first reply" },
    ...(showAlerts ? [{ k: "alerts" as const, n: since.clearedAlerts.length, one: "alert cleared", many: "alerts cleared" }] : []),
  ];
  return (
    <section className="mb-12 border-t border-[var(--t-rule)] pt-5" aria-label="Since you were last here" data-testid="since-strip">
      <h2 className="t-title">Since you were last here <span className="t-small t-quiet font-normal">({day})</span></h2>
      <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
        {cells.map((c) => (
          <li key={c.k}>
            {c.n > 0 ? (
              <button type="button" onClick={() => onOpen(c.k)} data-testid={`since-${c.k}`} data-count={c.n} className="ds-press rounded-md py-1 text-left hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
                <span className="t-num text-base">{c.n.toLocaleString("en-US")}</span> {c.n === 1 ? c.one : c.many}
              </button>
            ) : <span className="py-1 text-muted-foreground" data-testid={`since-${c.k}`} data-count={0}><span className="t-num">0</span> {c.many}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A thin ring that empties as the reply target runs out, with the time left in the middle. */
function Ring({ left, total }: { left: number; total: number }) {
  const R = 26, C = 2 * Math.PI * R;
  const share = Math.max(0, Math.min(1, total === 0 ? 0 : left / total));
  const m = Math.floor(left / 60_000), s = Math.floor((left % 60_000) / 1000);
  return (
    <div className="relative size-[4.5rem] shrink-0" role="img" aria-label={`${m} minutes ${s} seconds left`} data-testid="coming-ring" data-left={Math.round(left / 1000)}>
      <svg viewBox="0 0 64 64" className="size-full -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--border)" strokeWidth="3" />
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - share)} style={{ transition: "stroke-dashoffset 1s linear" }} />
      </svg>
      <span className="tnum absolute inset-0 flex items-center justify-center text-sm font-semibold">{m}:{String(s).padStart(2, "0")}</span>
    </div>
  );
}

/** "If nobody acts today": a live ring on the next lead to pass its reply target, and the plain count of what will go wrong. */
export function ComingBlock({ forecast, targetMinutes, onOpen }: { forecast: Forecast; targetMinutes: number; onOpen: (k: "leads" | "deals" | "appointments") => void }) {
  const now = useNow(1000);
  const next = forecast.next;
  const left = next && now > 0 ? Math.max(0, next.at - now) : null;
  const nothing = forecast.leads.length + forecast.deals.length + forecast.appointments.length === 0;
  const stat = (k: "leads" | "deals" | "appointments", n: number, one: string, many: string, extra?: string) => (
    <li key={k}>
      {n > 0 ? (
        <button type="button" onClick={() => onOpen(k)} data-testid={`coming-${k}`} data-count={n} className="ds-press w-full border-l border-[var(--t-rule2)] py-0.5 pl-4 text-left hover:border-primary focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
          <span className="t-figure block">{n.toLocaleString("en-US")}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{n === 1 ? one : many}{extra ? ` (${extra})` : ""}</span>
        </button>
      ) : (
        <div className="border-l border-[var(--t-rule2)] py-0.5 pl-4" data-testid={`coming-${k}`} data-count={0}><span className="t-figure block text-[var(--t-ink3)]">0</span><span className="mt-1 block text-sm text-muted-foreground">{many}</span></div>
      )}
    </li>
  );
  // Nothing is about to go wrong: no empty section (the calm all-clear is the headline's job).
  if (nothing) return null;
  return (
    <section className="mb-12" aria-labelledby="coming-h" data-testid="coming-block">
      <h2 id="coming-h" className="t-title">If nothing changes today</h2>
      <p className="t-small t-quiet mt-1" data-testid="coming-line">{forecastLine(forecast, targetMinutes)}</p>
      {!nothing && (
        <div className="mt-4 grid grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {next && left !== null ? (
            <button type="button" onClick={() => onOpen("leads")} className="ds-press t-surface flex items-center gap-4 p-3 text-left hover:border-primary focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="coming-next">
              <Ring left={left} total={targetMinutes * 60_000} />
              <span className="min-w-0 text-sm leading-5">
                <span className="t-label block">Next to pass the {targetMinutes}-minute reply target</span>
                <span className="block break-words font-semibold">{next.name}</span>
                <span className="block break-words text-muted-foreground">{next.accountName}</span>
              </span>
            </button>
          ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Clock aria-hidden className="size-4" />No lead is close to its reply target right now.</p>}
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {stat("leads", forecast.leads.length, "lead will pass its reply target", "leads will pass their reply target")}
            {stat("deals", forecast.deals.length, "deal will go quiet", "deals will go quiet", forecast.dealDollars > 0 ? money(forecast.dealDollars) : undefined)}
            {stat("appointments", forecast.appointments.length, "appointment will need an outcome marked", "appointments will need an outcome marked")}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Leads by the hour they arrived: how many were answered inside the target and how many were not. A gap hour is marked with an icon and a word. */
export function HourStrip({ stats, title, targetMinutes, onOpen }: { stats: HourStat[]; title: string; targetMinutes: number; onOpen: (hour: number) => void }) {
  const [hot, setHot] = useState<number | null>(null);
  const max = Math.max(1, ...stats.map((s) => s.leads));
  const H = 96;
  const tip = hot === null ? null : stats[hot];
  return (
    <figure className="min-w-0" data-testid="hour-strip">
      <figcaption className="t-title mb-1" data-testid="hour-title">{title}</figcaption>
      <p className="mb-2 text-xs text-muted-foreground">Select an hour to see its leads. Hours use each client&apos;s own time zone.</p>
      <div className="grid grid-cols-[repeat(24,minmax(0,1fr))] gap-[3px]">
        {stats.map((s) => (
          <button key={s.hour} type="button" disabled={s.leads === 0} onClick={() => onOpen(s.hour)} onMouseEnter={() => setHot(s.hour)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(s.hour)} onBlur={() => setHot(null)}
            data-testid="hour-bar" data-hour={s.hour} data-leads={s.leads} data-gap={s.gap} aria-label={`${hourWords(s.hour)}: ${s.leads} leads, ${s.within} answered within ${targetMinutes} minutes, ${s.missed} not.${s.gap ? " A gap hour." : ""}${s.leads ? " See the leads." : ""}`}
            className="ds-press group flex min-w-0 flex-col items-stretch rounded-md pb-0.5 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-default disabled:hover:bg-transparent">
            <span className="flex flex-col justify-end" style={{ height: H }} aria-hidden>
              <span className="block bg-primary" style={{ height: Math.max(s.missed > 0 ? 2 : 0, (s.missed / max) * H), borderRadius: "3px 3px 0 0" }} />
              <span className="block bg-foreground/25" style={{ height: Math.max(s.within > 0 ? 2 : 0, (s.within / max) * H) }} />
            </span>
            <span className="mt-0.5 flex h-4 items-center justify-center text-[10px] text-muted-foreground">{s.gap ? <TriangleAlert aria-hidden className="size-3 text-warning" /> : s.hour % 6 === 0 ? hourWords(s.hour).replace(" ", "") : ""}</span>
          </button>
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground" aria-label="What the bars mean">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-3 bg-primary" />Not answered within {targetMinutes} minutes</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-3 bg-foreground/25" />Answered within {targetMinutes} minutes</li>
        <li className="flex items-center gap-1.5"><TriangleAlert aria-hidden className="size-3 text-warning" />Gap hour: fewer than half answered in time</li>
      </ul>
      <p className="mt-1 min-h-10 text-sm leading-5" role="status" aria-live="polite" data-testid="hour-tip">{tip ? (tip.leads === 0 ? `${hourWords(tip.hour)}: no leads in the last 14 days.` : `${hourWords(tip.hour)}: ${tip.leads} leads, ${tip.within} answered within ${targetMinutes} minutes, ${tip.missed} not.${tip.gap ? " This hour is a gap." : ""}`) : ""}</p>
    </figure>
  );
}

const trackBtn = "ds-press grid w-full items-center gap-x-3 rounded-[4px] px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]";

/** Speed by source: a thin bar per source, longest wait longest. Fixed columns, so every row lines up. */
export function SourceBars({ stats, title, onOpen }: { stats: SourceStat[]; title: string; onOpen: (name: string) => void }) {
  const max = Math.max(1, ...stats.map((s) => s.medianSeconds ?? 0));
  return (
    <figure className="min-w-0" data-testid="source-bars">
      <figcaption className="t-title mb-1" data-testid="source-title">{title}</figcaption>
      <p className="mb-2 text-xs text-muted-foreground">How fast each source gets a first reply, last 14 days. A typical time needs 5 or more replies. Select a source to see its leads.</p>
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_7rem_5.5rem] gap-x-3 px-2 pb-1 t-label" aria-hidden><span>Source</span><span>Typical first reply</span><span className="text-right">Time</span><span className="text-right">Leads</span></div>
      <ul className="divide-y border-y">
        {stats.map((s) => (
          <li key={s.name}>
            <button type="button" onClick={() => onOpen(s.name)} data-testid="source-row" data-leads={s.leads} className={`${trackBtn} grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_7rem_5.5rem]`} aria-label={`${s.name}: ${s.leads} leads${s.medianSeconds === null ? ", not enough replies for a typical time" : `, typical first reply ${replyWords(s.medianSeconds)}`}. See the leads.`}>
              <span className="break-words text-sm font-medium">{s.name}</span>
              <span className="relative block h-2.5 border-l border-foreground/30" aria-hidden>{s.medianSeconds !== null && <span className="ds-grow-x block h-full rounded-r-[4px] bg-primary" style={{ width: `${Math.max(2, (s.medianSeconds / max) * 100)}%` }} />}</span>
              <span className="tnum text-right text-sm">{s.medianSeconds === null ? <span className="text-xs text-muted-foreground">Not enough replies</span> : replyWords(s.medianSeconds)}</span>
              <span className="tnum text-right text-sm text-muted-foreground">{s.leads.toLocaleString("en-US")}</span>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

const FLAG: Record<NonNullable<PersonLoad["flag"]>, { word: string; Icon: typeof CircleAlert; text: string }> = {
  overloaded: { word: "Most waiting", Icon: CircleAlert, text: "text-destructive" },
  quiet: { word: "No replies in 14 days", Icon: TriangleAlert, text: "text-warning" },
};

/** Leads waiting by person, with how many first replies each sent. Fixed columns. */
export function WorkloadList({ people, onOpen }: { people: PersonLoad[]; onOpen: (name: string) => void }) {
  const grid = "grid-cols-[minmax(0,1.4fr)_5.5rem_7rem_8rem_10rem]";
  return (
    <section className="min-w-0" data-testid="workload">
      <h3 className="t-title mb-1">Who has people waiting</h3>
      <p className="t-small t-quiet mb-2">Grouped by the owner set in your CRM. A typical time needs 3 or more replies from that person. Select a name to see their leads.</p>
      <div className={`grid ${grid} gap-x-3 px-2 pb-1 t-label`} aria-hidden><span>Person</span><span className="text-right">Waiting</span><span className="text-right">Oldest</span><span className="text-right">Replies, 14 days</span><span>Note</span></div>
      <ul className="divide-y border-y">
        {people.map((p) => {
          const f = p.flag ? FLAG[p.flag] : null;
          const open = p.waiting > 0;
          const inner = (
            <>
              <span className="flex min-w-0 items-center gap-2 break-words text-sm font-medium"><UserRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />{p.name}</span>
              <span className="tnum text-right text-sm font-semibold">{p.waiting}</span>
              <span className="tnum text-right text-sm text-muted-foreground">{p.oldestMinutes === null ? "-" : ageWords(p.oldestMinutes)}</span>
              <span className="tnum text-right text-sm text-muted-foreground">{p.replies}{p.medianSeconds !== null ? `, typical ${replyWords(p.medianSeconds)}` : ""}</span>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${f?.text ?? ""}`}>{f && <><f.Icon aria-hidden className="size-3.5 shrink-0" />{f.word}</>}</span>
            </>
          );
          return <li key={p.name}>{open
            ? <button type="button" onClick={() => onOpen(p.name)} data-testid="workload-row" data-waiting={p.waiting} className={`${trackBtn} ${grid}`} aria-label={`${p.name}: ${p.waiting} leads waiting. See the leads.`}>{inner}</button>
            : <div className={`grid items-center gap-x-3 px-2 py-1.5 ${grid}`} data-testid="workload-row" data-waiting={0}>{inner}</div>}</li>;
        })}
      </ul>
    </section>
  );
}

/** Accounts compared: the fastest and the slowest typical first reply, three each. Fixed columns. */
export function CompareList({ fastest, slowest, tooFew, onOpen }: { fastest: AccountSpeed[]; slowest: AccountSpeed[]; tooFew: number; onOpen: (locationId: string) => void }) {
  const grid = "grid-cols-[minmax(0,1fr)_6.5rem_5.5rem]";
  const list = (title: string, rows: AccountSpeed[], id: string) => (
    <div className="min-w-0" data-testid={id}>
      <h4 className="t-label mb-1">{title}</h4>
      <div className={`grid ${grid} gap-x-3 px-2 pb-1 t-label`} aria-hidden><span>Client</span><span className="text-right">Typical reply</span><span className="text-right">Replies</span></div>
      <ul className="divide-y border-y">
        {rows.map((a) => (
          <li key={a.locationId}>
            <button type="button" onClick={() => onOpen(a.locationId)} data-testid="compare-row" data-answered={a.answered} className={`${trackBtn} ${grid}`} aria-label={`${a.name}: typical first reply ${replyWords(a.medianSeconds)} from ${a.answered} replies. See the leads.`}>
              <span className="break-words text-sm font-medium">{a.name}</span><span className="tnum text-right text-sm">{replyWords(a.medianSeconds)}</span><span className="tnum text-right text-sm text-muted-foreground">{a.answered}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section className="min-w-0" data-testid="compare">
      <h3 className="t-title mb-1">Clients compared</h3>
      <p className="t-small t-quiet mb-2">Typical first reply, last 14 days. A client needs 5 or more replies to be ranked{tooFew > 0 ? `; ${tooFew} ${tooFew === 1 ? "has" : "have"} too few` : ""}. Select one to see its leads.</p>
      {fastest.length === 0 ? <p className="py-4 text-sm text-muted-foreground" data-testid="compare-empty">Not enough replies yet to compare clients.</p>
        : <div className="grid grid-cols-1 gap-x-10 gap-y-5 lg:grid-cols-2">{list("Fastest", fastest, "compare-fastest")}{list("Slowest", slowest, "compare-slowest")}</div>}
    </section>
  );
}

export type { Coming };
