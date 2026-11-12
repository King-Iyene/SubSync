"use client";

import { useMemo, useState } from "react";
import type { AccessKind } from "@/lib/access";
import {
  accountBars, accountsNeedingYou, ageWords, barsTitle, countsOf, headlineOf, KIND_LABEL, KINDS, proofLine, replyWords, shareText, staleUsual, waitingOldestFirst,
  type HeadlineAction, type Usual,
} from "@/lib/analytics/today-queue";
import { forecastLine, nextAction } from "@/lib/analytics/today-smart";
import { leadsSpec } from "@/lib/analytics/today-records";
import { judge } from "@/lib/analytics/speed-intel";
import { type PaletteCommand, type TodayView } from "@/lib/analytics/today-palette";
import {
  pointEnd, specAccount, specAlerts, specClients, specComing, specDollars, specInsight, specKind, specNext, specReplies, specSince, specThings,
} from "@/lib/analytics/today-specs";
import type { TodayData } from "@/lib/analytics/today-types";
import type { GrowthData } from "@/lib/analytics/growth";
import { specPeriod } from "@/lib/analytics/growth-records";
import type { GoFn } from "../nav";
import {
  AccountBars, AccountList, CommandPalette, ComingBlock, InlineAlert, InsightStrip, KindList, PrintReport, ProofStrip, PulseSpark, PulseTile,
  RaisedClearedStrip, ReplyNowList, SinceStrip, ViewsMenu, type KindRow, type MenuItem,
} from "../ds";
import { Btn, fmtInt, fmtMoney } from "../ui";
import type { TodayMode } from "./today";
import { TodayDashboard } from "./today-dash";
import { Block, MoreDetail, PrimaryButton, TodayHeader, TodayHeadline, type Primary } from "./today-chrome";
import { AppointmentsSection, CallsSection, DoneForToday } from "./today-mine";
import { useTodayModel, TodayLayers } from "./today-model";
import { BriefPreview, CoverageTab, HeldLink, JunkControl, PeopleTab, SourcesTab } from "./today-parts";
import { GrowthTab } from "./today-growth";
import { ForecastTab } from "./today-forecast";
import { ProofTab } from "./today-proof";
import { ClientsFlowTab, LeadFlowTab, TabIntro } from "./today-flow";
import { SECTION_META } from "@/lib/analytics/today-tabs";

// Today, one page for every role. One question: "what needs a person today, and what do I do first?". Top to bottom: a small title row, ONE plain sentence with the number that matters
// most and ONE primary button, "Do this first" (the working queue: a setter's people to reply to, or one row per client for an agency), what changed since the person was last here
// and what is worth a look, then the evidence (reply time over the week, the figures beside it, and for an agency the bars of where the work sits), and last "Break it down" under
// tabs (Forecast, Proof, People, Sources, Coverage), closed until asked for. Every number comes from countsOf (src/lib/analytics/today-queue.ts), so the headline, the list, the bars,
// the figures and every list behind a number cannot disagree. Every mark opens exactly its own records. Nothing here writes to the CRM. Words: docs/features/TODAY.md (glossary).

const SHARED_HISTORY_NOTE = "Comparisons start after 7 days of history.";

function reasonText(blocked: boolean, kindsOff: string): string | null {
  return blocked ? `Needs permission: ${kindsOff}. Ask whoever manages SubSync to approve it.` : null;
}

export function TodayPage({ mode = "full", go, t, kind, reload, sync, syncing, options, picked, setPicked, error, clearShell, growth }: {
  mode?: TodayMode; go: GoFn; t: TodayData; kind: AccessKind; reload: () => Promise<void>; sync: () => Promise<void>; syncing: boolean;
  options: Array<{ id: string; name: string }>; picked: string[]; setPicked: (ids: string[]) => void; error: string | null; clearShell: () => void;
  growth: { data: GrowthData | null; loading: boolean; error: string | null; reload: () => void };
}) {
  const m = useTodayModel({ t, kind, reload });
  const { view, env } = m;
  const agency = kind === "agency";
  // Many accounts at once only for an agency that has not narrowed to one account; everyone else (and an agency inside one account) gets the one-account layout, with no account chart.
  const multi = agency && t.scope !== "account" && picked.length !== 1 && t.accounts.length > 1;
  const [day, setDay] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState(0);
  const [brief, setBrief] = useState(false);
  const [palette, setPalette] = useState(false);
  const [views, setViews] = useState(false);
  const changeAccounts = (ids: string[]) => { m.close(); setDay(null); setPicked(ids); };

  const rows = view.queue;
  const counts = countsOf(view.totals, rows);
  const headline = headlineOf({ scope: multi ? "all" : "account", rows, totals: view.totals, outlier: view.outlier });
  const accountMap = useMemo(() => new Map(t.accounts.map((a) => [a.id, a])), [t.accounts]);
  const needing = accountsNeedingYou(rows, accountMap, 100_000);
  const urgent = needing.rows.filter((a) => a.urgent).length;
  const bars = accountBars(rows, 100000);
  const waiting = waitingOldestFirst(view.items);
  const mine = t.mine;
  const pickedNames = picked.map((id) => options.find((o) => o.id === id)?.name ?? t.accounts.find((a) => a.id === id)?.name ?? "1 client");
  const only = !multi ? (t.accounts[0]?.name ?? pickedNames[0] ?? null) : null;
  const nameOf = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);

  const blockedLeads = reasonText(t.access.leadsBlocked, "reply times stay off until the conversations permission is approved");
  const blockedAppts = reasonText(t.access.apptsBlocked, "appointments stay unchecked until the calendar permission is approved");

  const onPart = (a: HeadlineAction) => m.open(a === "clients" ? specClients(env) : a === "dollars" ? specDollars(env) : a === "replies" ? specKind("replies", env) : specThings(env));
  const copy = async () => {
    const text = shareText({ who: picked.length > 0 ? pickedNames.join(", ") : multi ? "Your clients" : only ?? "Today", headline, rows });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };

  // ---- the one primary button: the first thing to do ----
  let primary: Primary | null = null;
  if (!headline.allClear) {
    if (multi && needing.rows[0]) primary = { label: `Open ${needing.rows[0].name}`, sr: `${needing.rows[0].name}, the client that needs you most`, href: needing.rows[0].url };
    else if (!multi && waiting[0]) primary = { label: `Reply to ${waiting[0].name}`, sr: `${waiting[0].name}, the longest wait`, href: waiting[0].url, seed: waiting[0].contactId ? { contactId: waiting[0].contactId, locationId: waiting[0].locationId, name: waiting[0].name, locationName: waiting[0].accountName, url: waiting[0].url, pending: waiting[0].detail } : null };
    else if (!multi && counts.appointments > 0) primary = { label: "Mark outcomes", sr: "Appointments", onClick: () => go("appointments") };
    else if (!multi && counts.noshows > 0) primary = { label: "Rebook no-shows", sr: "No-shows", onClick: () => m.open(specKind("noshows", env)) };
    else if (!multi && counts.stale > 0) primary = { label: "Review quiet deals", sr: "Quiet deals", onClick: () => m.open(specKind("stale", env)) };
  }

  // ---- the figures beside the reply-time line. History is explained ONCE, under them. ----
  const oldest = waiting[0]?.at ?? null;
  const oldestAppt = view.items.filter((i) => i.kind === "appointments" && i.at !== null).reduce<number | null>((x, i) => (x === null ? i.at : Math.min(x, i.at as number)), null);
  const never = waiting.filter((i) => i.never).length;
  const reply = t.pulse.reply;
  const staleVerdict: Usual = staleUsual(t.pulse.stale);
  const known = (u: Usual) => (u.verdict === "not_enough" ? null : u);
  const noHistory = reply.verdict.verdict === "not_enough" || staleVerdict.verdict === "not_enough";
  const points = reply.points.map((p) => ({ label: p.day, value: p.value, note: p.window }));
  const windowReplies = (i: number) => env.ledger.filter((l) => l.touchAt !== null && l.leadAt > pointEnd(reply.points[i].day, m.now) - 7 * 86_400_000 && l.leadAt <= pointEnd(reply.points[i].day, m.now)).length;
  const since = t.sinceVisit && (t.sinceVisit.newLeads.length + t.sinceVisit.breached.length + t.sinceVisit.answered.length + (kind === "client" ? 0 : t.sinceVisit.clearedAlerts.length) > 0) ? t.sinceVisit : null;
  const dateText = m.now > 0 ? new Date(m.now).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : undefined;

  // ---- command palette (Ctrl Shift K) and the More menu ----
  const openMore = (tabIndex: number) => { setMore(true); setTab(tabIndex); };
  const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  const applyView = (v: TodayView) => { changeAccounts(v.accounts); m.setExcludeJunk(v.excludeJunk); };
  const hasProof = !!t.proof && kind !== "client";
  const growthAt = kind === "client" ? 1 : hasProof ? 5 : 4;
  const coming = agency && t.accounts.length > 1; // clients added and removed: only for a company that looks after several clients
  const tabAt = (n: number) => n + (hasProof ? 0 : -1); // People, Sources and Coverage sit after Forecast and (when shown) Proof
  const commands: PaletteCommand[] = [
    { id: "search-people", group: "Find", title: "Search people", hint: "Names, emails and phone numbers in every client", keywords: "contact lead", run: () => document.querySelector<HTMLElement>('[data-testid="global-search-open"]')?.click() },
    { id: "go-fix", group: "Go to", title: "Do this first", hint: "The first things to do", keywords: "queue top fix reply", run: () => scrollTo("work-h") },
    ...(multi ? [{ id: "go-charts", group: "Go to", title: "Where the work sits", hint: "One bar per client", keywords: "bars", run: () => scrollTo("where-h") }] : []),
    { id: "tab-growth", group: "Go to", title: "Growth", hint: "New email leads, goal and sources", keywords: "email leads counter goal sources", run: () => openMore(growthAt) },
    { id: "tab-flow", group: "Go to", title: "Lead flow", hint: "Where new leads end up", keywords: "funnel replied booked showed leads flow", run: () => openMore(growthAt + 1) },
    ...(coming ? [{ id: "tab-coming", group: "Go to", title: "Clients coming and going", hint: "Clients added and removed each week", keywords: "clients added removed left new churn", run: () => openMore(growthAt + 2) }] : []),
    { id: "tab-numbers", group: "Go to", title: "Forecast", hint: "What goes wrong if nothing changes", keywords: "tiles figures numbers", run: () => openMore(0) },
    ...(kind !== "client" ? [
      { id: "tab-people", group: "Go to", title: "People", hint: "Workload by person", keywords: "owner workload", run: () => openMore(tabAt(2)) },
      { id: "tab-sources", group: "Go to", title: "Sources", hint: "Reply speed by source", run: () => openMore(tabAt(3)) },
      { id: "tab-coverage", group: "Go to", title: "Coverage", hint: "Which hours of the day miss leads", keywords: "hours", run: () => openMore(tabAt(4)) },
    ] : []),
    ...KINDS.map((k): PaletteCommand => ({ id: `list-${k}`, group: "Open list", title: KIND_LABEL[k], hint: `${fmtInt(view.totals[k].count)} in the list`, run: () => m.open(specKind(k, env)) })),
    ...(multi ? [{ id: "list-clients", group: "Open list", title: "Clients with something to do", run: () => m.open(specClients(env)) }] : []),
    { id: "list-dollars", group: "Open list", title: "Quiet deals and their value", keywords: "money stale quiet dollars", run: () => m.open(specDollars(env)) },
    ...(agency ? options.map((o): PaletteCommand => ({ id: `account-${o.id}`, group: "Client", title: o.name, hint: "Show only this client", keywords: "account only narrow", run: () => changeAccounts([o.id]) })) : []),
    ...(agency ? [{ id: "all-accounts", group: "Client", title: "Show all clients", disabled: picked.length === 0, run: () => changeAccounts([]) }] : []),
    { id: "junk", group: "Do", title: m.excludeJunk ? "Count test and very old deals again" : "Leave out test and very old deals", keywords: "junk exclude", run: () => m.setExcludeJunk(!m.excludeJunk) },
    { id: "share", group: "Do", title: "Share Today", hint: "Copies the headline and the top 3 rows", keywords: "copy", run: () => void copy() },
    ...(agency ? [{ id: "brief", group: "Do", title: "Daily email preview", run: () => setBrief(true) }] : []),
    { id: "sync", group: "Do", title: "Sync now", hint: "Read every client again", run: () => void sync() },
    ...(agency ? [{ id: "print", group: "Do", title: "Print report", hint: "Or save it as a PDF", keywords: "pdf paper", run: () => window.print() }] : []),
  ];
  const moreItems: MenuItem[] = [
    ...(agency ? [{ key: "brief", label: "Daily email preview", onSelect: () => setBrief(true) }, { key: "print", label: "Print report", onSelect: () => window.print() }] : []),
    { key: "share", label: copied ? "Copied to your clipboard" : agency ? "Share Today" : "Share my day", onSelect: () => void copy() },
    { key: "sync", label: syncing ? "Syncing" : "Sync now", onSelect: () => void sync(), disabled: syncing },
    ...(agency ? [{ key: "views", label: "Saved views", onSelect: () => setViews(true) }, { key: "commands", label: "Commands", hint: "Ctrl Shift K", onSelect: () => setPalette(true) }] : []),
  ];
  const report = {
    brandName: null, who: picked.length > 0 ? pickedNames.join(", ") : "All clients", generatedAt: new Date(m.now).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" }),
    headline: headline.text, breakdown: [headline.breakdown, headline.note].filter(Boolean).join(" ") || null, rows, insights: m.insights.map((i) => i.text), forecast: forecastLine(t.forecast, t.targetMinutes),
    proof: t.proof ? proofLine(t.proof) : null, setAside: view.held.length,
  };


  // ---- the lists ----
  const alsoRows: KindRow[] = (["appointments", "noshows", "stale"] as const)
    // Where "My day" content is shown below (calls and appointments), those kinds are not listed twice.
    .filter((k) => view.totals[k].count > 0 && !(mine && k !== "stale"))
    .map((k) => {
      const q = rows.find((r) => r.kind === k);
      const n = view.totals[k].count;
      const text = k === "appointments" ? "Over, with no outcome marked" : k === "noshows" ? "Missed an appointment, not rebooked"
        : `Not moved in ${t.staleDays}+ days${view.totals.stale.dollars ? `, worth ${fmtMoney(view.totals.stale.dollars)}` : ""}`;
      const action = k === "stale" ? { label: "Open", href: q?.url ?? t.accounts[0]?.url, sr: "Deals in your CRM" } : { label: "Mark", onClick: () => go("appointments"), sr: k === "noshows" ? "No-shows in Appointments" : "Appointments to mark" };
      return { kind: k, count: n, text, onOpen: () => m.open(specKind(k, env)), action };
    });

  const inTarget = (days: number) => env.ledger.filter((l) => l.leadAt > m.now - days * 86_400_000 && l.leadAt <= m.now && judge(l, t.targetMinutes, m.now) !== null);
  const specTarget = () => { const r = inTarget(7).map(({ zone: _z, ...x }) => { void _z; return x; }); return leadsSpec(r, m.now, { key: "in-target", title: "Leads this week and the reply target", subtitle: `Leads of the last 7 days that were answered, or are past the ${t.targetMinutes}-minute target without an answer. The share is the ones answered within the target.`, noun: r.length === 1 ? "lead" : "leads", count: r.length, exportName: "leads-this-week" }); };
  const n = mine?.numbers;
  const pct = (x: number | null) => `${Math.round((x as number) * 100)}%`;

  // ---- the evidence: the reply-time line, and the figures beside it ----
  const evidence = (
    <Block id="evidence-h" title="This week" tag="Report" hint={SECTION_META["This week"].subtitle} testId="today-evidence">
      <div className="grid grid-cols-1 gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="today-pulse">
        <PulseTile testId="pulse-reply" label="Typical first reply" info="The middle first-reply time of the leads from the last 7 days. The line shows the same figure for each of the last 7 days. It needs 5 or more replies." usual={known(reply.verdict)} onOpen={reply.current.answered > 0 ? () => m.open(specReplies(env, m.now, 7, "Typical first reply, last 7 days")) : undefined} openLabel="See the replies this is worked out from"
          value={reply.current.seconds !== null ? replyWords(reply.current.seconds) : reply.current.answered === 0 ? "No replies yet" : "Not enough yet"}
          sub={reply.current.seconds === null ? `Needs 5 or more replies. ${reply.current.answered} so far.` : `Last 7 days, ${fmtInt(reply.current.answered)} replies`}
          spark={<PulseSpark points={points} label="Typical first reply, last 7 days" format={replyWords}
            onPoint={(i) => m.open(specReplies(env, pointEnd(reply.points[i].day, m.now), 7, `Typical first reply, 7 days to ${reply.points[i].day}`))}
            pointInfo={(i) => { const c = windowReplies(i); return c > 0 ? { open: true, text: `Select to see the ${c} replies behind it.` } : { open: false, text: "SubSync no longer holds the leads behind this point." }; }} />} />
        <div className="grid grid-cols-1 content-start gap-y-7 lg:border-l lg:border-[var(--t-rule)] lg:pl-10">
          <PulseTile testId="pulse-replies" label="Needs a reply" info="People whose last message nobody has answered. New leads count once the reply target has passed." usual={null} onOpen={blockedLeads ? undefined : () => m.open(specKind("replies", env))} openLabel="See the people who need a reply"
            value={blockedLeads ? "Not available" : fmtInt(counts.replies)}
            sub={blockedLeads ? "Needs permission: reconnect." : counts.replies === 0 ? "Nobody" : <>{oldest !== null && <span data-testid="pulse-oldest">Longest wait: {ageWords(Math.max(0, (m.now - oldest) / 60_000))}</span>}{never > 0 && <>. {fmtInt(never)} never answered</>}</>} />
          <PulseTile testId="pulse-risk" label="Quiet deals" info={`Open deals with a value and an owner that have not moved in ${t.staleDays} days or more. This is money that could be lost, not a forecast.`} usual={known(staleVerdict)} onOpen={() => m.open(specDollars(env))} openLabel="See the deals this adds up"
            value={counts.staleDollars ? fmtMoney(counts.staleDollars) : "$0"}
            sub={counts.stale === 0 ? "None" : `${fmtInt(counts.stale)} ${counts.stale === 1 ? "deal" : "deals"}${view.outlier ? `. One is ${fmtMoney(view.outlier.value)}` : ""}`} />
          {n ? (
            <div data-testid="my-numbers" className="grid grid-cols-1 gap-y-6">
              <PulseTile testId="my-showrate" label="Show rate" info="Of the appointments from the last 30 days that have an outcome, the share that showed up." usual={null} onOpen={() => go("appointments")} openLabel="Open Appointments to see the appointments behind this"
                value={n.showRate.now === null ? "Not enough yet" : pct(n.showRate.now)}
                sub={n.showRate.now === null ? `Needs ${n.showRate.minN} outcomes. ${n.showRate.nNow} so far.` : `Last 30 days, ${n.showRate.nNow} appointments`} />
              <PulseTile testId="my-intarget" label="Answered in time" info={`The share of this week's leads that got a reply within ${t.targetMinutes} minutes.`} usual={null} onOpen={inTarget(7).length > 0 ? () => m.open(specTarget()) : undefined} openLabel="See the leads this share is worked out from"
                value={n.inTarget.now === null ? "Not enough yet" : pct(n.inTarget.now)}
                sub={n.inTarget.now === null ? `Needs 5 leads. ${n.inTarget.nNow} so far.` : `This week, ${n.inTarget.nNow} leads`} />
            </div>
          ) : (
            <PulseTile testId="pulse-appointments" label="Needs an outcome" info="Appointments that are over with no outcome marked. Show rate needs them marked." usual={null} onOpen={blockedAppts ? undefined : () => m.open(specKind("appointments", env))} openLabel="See the appointments with no outcome"
              value={blockedAppts ? "Not available" : fmtInt(counts.appointments)}
              sub={blockedAppts ? "Needs permission: reconnect." : counts.appointments === 0 ? "All marked" : oldestAppt !== null ? `Oldest: ${ageWords(Math.max(0, (m.now - oldestAppt) / 60_000))} ago` : null} />
          )}
        </div>
      </div>
      {noHistory && <p className="t-small t-quiet mt-6" data-testid="history-note">{SHARED_HISTORY_NOTE}</p>}
      <div className="mt-4"><JunkControl m={m} staleCount={t.totals.stale.count} /></div>
    </Block>
  );

  // ---- what sits under "Break it down" ----
  const clientList = agency ? options : undefined;
  const proof = t.proof && kind !== "client" ? <ProofTab m={m} proof={t.proof} agency={agency} clients={clientList} who={picked.length > 0 ? pickedNames.join(", ") : multi ? "Your clients" : only ?? "Your account"} /> : null;
  const forecast = <ForecastTab m={m} t={t} clients={clientList} agency={agency} />;

  const growthTab = <GrowthTab m={m} g={growth.data} loading={growth.loading} error={growth.error} reload={growth.reload} kind={kind} clients={options} />;
  const intro = (name: string, node: React.ReactNode) => <><TabIntro name={name} />{node}</>;
  const tabs = [
    { label: "Forecast", node: forecast },
    ...(proof ? [{ label: "Proof", node: proof }] : []),
    ...(kind !== "client" ? [
      { label: "People", node: intro("People", <PeopleTab m={m} t={t} agency={multi} />) },
      { label: "Sources", node: intro("Sources", <SourcesTab m={m} t={t} clients={clientList} agency={agency} />) },
      { label: "Coverage", node: intro("Coverage", <CoverageTab m={m} t={t} clients={clientList} agency={agency} />) },
    ] : []),
    { label: "Growth", node: growthTab },
    { label: "Lead flow", node: <LeadFlowTab m={m} clients={options} kind={kind} /> },
    ...(coming ? [{ label: "Clients coming and going", node: <ClientsFlowTab m={m} /> }] : []),
  ];
  const allDone = headline.allClear && !t.access.leadsBlocked && !t.access.apptsBlocked && (mine ? mine.calls.noshows.total + mine.calls.confirm.total === 0 : true);

  if (mode === "dashboard") {
    return (
      <div className="t-root" data-testid="today-dashboard-root">
        <TodayDashboard m={m} t={t} kind={kind} agency={agency} multi={multi} go={go} options={options} evidence={evidence} growthTab={growthTab} forecast={forecast} where={agency && bars.bars.length >= 1 ? <AccountBars title={barsTitle(bars)} bars={bars.bars} rows={rows} onSegment={(id, k) => m.open(specKind(k, env, id))} onAccount={(id) => m.open(specAccount(id, env))} /> : null}
          sources={kind !== "client" ? <SourcesTab m={m} t={t} clients={clientList} agency={agency} /> : null} coverage={kind !== "client" ? <CoverageTab m={m} t={t} clients={clientList} agency={agency} /> : null}
          people={kind !== "client" ? <PeopleTab m={m} t={t} agency={multi} /> : null} proof={proof} coming={coming ? <ClientsFlowTab m={m} /> : null} flow={<LeadFlowTab m={m} clients={options} kind={kind} />} />
        <TodayLayers m={m} />
      </div>
    );
  }
  return (
    <div data-testid="page" className="ds-enter t-root">
      <PrintReport r={report} now={m.now} />
      <div className="print:hidden">
        <TodayHeader more={moreItems} dateText={dateText} hideTitle={mode === "below"} />
        {error && <InlineAlert tone="danger" className="mb-4" action={<Btn onClick={() => void reload()}>Try again</Btn>}>{error}</InlineAlert>}

        {mode === "below" ? (
          <div className="mb-4 td-oldhead" data-testid="today-below-alerts"><p className="sr-only">The older one-sentence summary</p>
            <TodayHeadline headline={headline} onPart={onPart} action={primary ? <PrimaryButton p={primary} /> : undefined} />
            {blockedLeads && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedLeads}</InlineAlert>}
            {blockedAppts && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedAppts}</InlineAlert>}
          </div>
        ) : <TodayHeadline headline={headline} onPart={onPart} action={primary ? <PrimaryButton p={primary} /> : undefined}>
          {blockedLeads && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedLeads}</InlineAlert>}
          {blockedAppts && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedAppts}</InlineAlert>}
          {headline.allClear && t.proof && !blockedLeads && !blockedAppts && kind !== "client" && <p className="mt-3 text-[var(--t-ink2)]" data-testid="today-proof-line">{proofLine(t.proof)}</p>}
          {!t.actionsReady && <p className="t-small t-quiet mt-2" data-testid="needs-update">Mark done and Snooze need the latest database update.</p>}
        </TodayHeadline>}

        {multi ? (
          <>
            <AccountList rows={needing.rows} total={needing.total} urgent={urgent} onShow={(a) => m.open(specAccount(a.locationId, env))} onOnly={(a) => changeAccounts([a.locationId])} onSeeAll={() => m.open(specClients(env))}
              onAct={m.act} canAssign={m.canAssign} assigned={m.assigned} whyOf={m.rowWhy} nextOf={(a) => nextAction(rows, view.items, a.locationId)} onNext={(a, na) => m.open(specNext(na.itemIds, na.text, env))}
              empty={rows.length === 0 ? (view.held.length > 0 ? "Everything left is snoozed or done." : "Nothing needs you right now.") : "Nothing here needs you right now."} />
            <HeldLink m={m} />
          </>
        ) : (
          <>
            {allDone && <DoneForToday data={t} streak={mine?.numbers.streakDays ?? 0} />}
            <ReplyNowList items={waiting} total={counts.replies} newLeads={counts.newLeads} onSeeAll={() => m.open(specKind("replies", env))} onAct={m.act} canAssign={m.canAssign} assigned={m.assigned} />
            <KindList rows={alsoRows} />
            {mine && <CallsSection mine={mine} />}
            {mine && <AppointmentsSection mine={mine} go={() => go("appointments")} />}
            <HeldLink m={m} />
          </>
        )}

        {since && <SinceStrip since={since} showAlerts={kind !== "client"} onOpen={(k) => m.open(specSince(k, since, env))} />}
        <InsightStrip insights={kind === "client" ? m.insights.filter((i) => i.key !== "idle_owner") : m.insights} onOpen={(i) => m.open(specInsight(i, env))}
          extra={(growth.data?.signals ?? []).slice(0, 2).map((s) => ({ key: `growth-${s.locationId}-${s.scope}-${s.direction}`, text: s.text, label: `${s.count} vs ${s.normal}`, onOpen: () => { const g = growth.data as GrowthData; m.open(specPeriod(g, s.scope === "day" ? "today" : "week", s.locationId)); } }))} />

        {agency && bars.bars.length >= 1 && (
          <Block id="where-h" title="Where the work sits" tag="Report" hint={SECTION_META["Where the work sits"].subtitle} testId="today-charts">
            <AccountBars title={barsTitle(bars)} bars={bars.bars} rows={rows}
              onSegment={(id, k) => m.open(specKind(k, env, id))} onAccount={(id) => m.open(specAccount(id, env))} />
          </Block>
        )}

        {evidence}

        <MoreDetail open={more} onToggle={() => setMore(!more)} tab={tab} onTab={setTab} tabs={tabs} />
      </div>
      {agency && <CommandPalette commands={commands} hideTrigger open={palette} onOpenChange={setPalette} />}
      {agency && <ViewsMenu current={{ accounts: picked, excludeJunk: m.excludeJunk }} names={nameOf} onApply={applyView} hideTrigger open={views} onOpenChange={setViews} />}
      <TodayLayers m={m} />
      {brief && <BriefPreview onClose={() => setBrief(false)} />}
    </div>
  );
}
