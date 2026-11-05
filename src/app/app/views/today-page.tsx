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
import type { GoFn } from "../nav";
import {
  AccountBars, AccountList, CommandPalette, ComingBlock, HeadlineBlock, InlineAlert, InsightStrip, KindList, PrintReport, ProofStrip, PulseSpark, PulseTile,
  RaisedClearedStrip, ReplyNowList, SinceStrip, ViewsMenu, type KindRow, type MenuItem,
} from "../ds";
import { Btn, fmtInt, fmtMoney } from "../ui";
import { MoreDetail, PrimaryButton, TodayHeader, type Primary } from "./today-chrome";
import { AppointmentsSection, CallsSection, DoneForToday } from "./today-mine";
import { useTodayModel, TodayLayers } from "./today-model";
import { BriefPreview, CoverageTab, HeldLink, JunkControl, PeopleTab, SourcesTab } from "./today-parts";

// Today, one page for every role. One question: "what needs a person today, and what do I do first?". Top to bottom: one slim header (title, the client-account filter, "More"),
// ONE sentence in large type and ONE primary button, then the work list (a setter's "Reply now"; an agency's one row per client account), the account bars (agency, all accounts
// only), what changed since the person last looked, and then "More detail", closed until it is asked for. Every number comes from countsOf (src/lib/analytics/today-queue.ts), so
// the headline, the list, the bars, the tiles and every list behind a number cannot disagree. Every mark opens exactly its own records. Nothing here writes to the CRM.

const SHARED_HISTORY_NOTE = "Comparisons with your usual start after 7 days of history.";

function reasonText(blocked: boolean, kindsOff: string): string | null {
  return blocked ? `Needs permission: ${kindsOff}. Ask the person who manages SubSync to approve it, then run a sync.` : null;
}

export function TodayPage({ go, t, kind, reload, sync, syncing, options, picked, setPicked, error, clearShell }: {
  go: GoFn; t: TodayData; kind: AccessKind; reload: () => Promise<void>; sync: () => Promise<void>; syncing: boolean;
  options: Array<{ id: string; name: string }>; picked: string[]; setPicked: (ids: string[]) => void; error: string | null; clearShell: () => void;
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
  const bars = accountBars(rows);
  const waiting = waitingOldestFirst(view.items);
  const mine = t.mine;
  const pickedNames = picked.map((id) => options.find((o) => o.id === id)?.name ?? t.accounts.find((a) => a.id === id)?.name ?? "1 client account");
  const only = !multi ? (t.accounts[0]?.name ?? pickedNames[0] ?? null) : null;
  const nameOf = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);

  const blockedLeads = reasonText(t.access.leadsBlocked, "replies cannot be timed until the conversations permission is approved");
  const blockedAppts = reasonText(t.access.apptsBlocked, "appointments cannot be checked until the calendar permission is approved");

  const onPart = (a: HeadlineAction) => m.open(a === "clients" ? specClients(env) : a === "dollars" ? specDollars(env) : a === "replies" ? specKind("replies", env) : specThings(env));
  const copy = async () => {
    const text = shareText({ who: picked.length > 0 ? pickedNames.join(", ") : multi ? "Your client accounts" : only ?? "Today", headline, rows });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };

  // ---- the one primary button: the first thing to do ----
  let primary: Primary | null = null;
  if (!headline.allClear) {
    if (multi && needing.rows[0]) primary = { label: `Open ${needing.rows[0].name}`, sr: `${needing.rows[0].name}, the client that needs you most`, href: needing.rows[0].url };
    else if (!multi && waiting[0]) primary = { label: "Reply now", sr: `${waiting[0].name}, the longest wait`, href: waiting[0].url };
    else if (!multi && counts.appointments > 0) primary = { label: "Mark appointments", sr: "Appointments", onClick: () => go("appointments") };
    else if (!multi && counts.noshows > 0) primary = { label: "Win back no-shows", sr: "No-shows", onClick: () => m.open(specKind("noshows", env)) };
    else if (!multi && counts.stale > 0) primary = { label: "Look at the quiet deals", sr: "Deals gone quiet", onClick: () => m.open(specKind("stale", env)) };
  }

  // ---- the four tiles, each a plain number and one sentence. History is explained ONCE, under the tiles. ----
  const oldest = waiting[0]?.at ?? null;
  const oldestAppt = view.items.filter((i) => i.kind === "appointments" && i.at !== null).reduce<number | null>((x, i) => (x === null ? i.at : Math.min(x, i.at as number)), null);
  const never = waiting.filter((i) => i.never).length;
  const reply = t.pulse.reply;
  const staleVerdict: Usual = staleUsual(t.pulse.stale);
  const known = (u: Usual) => (u.verdict === "not_enough" ? null : u);
  const noHistory = reply.verdict.verdict === "not_enough" || staleVerdict.verdict === "not_enough";
  const points = reply.points.map((p) => ({ label: p.day, value: p.value, note: p.window }));
  const windowReplies = (i: number) => env.ledger.filter((l) => l.touchAt !== null && l.leadAt > pointEnd(reply.points[i].day, m.now) - 7 * 86_400_000 && l.leadAt <= pointEnd(reply.points[i].day, m.now)).length;
  const since = t.sinceVisit && (t.sinceVisit.newLeads.length + t.sinceVisit.breached.length + t.sinceVisit.answered.length + t.sinceVisit.clearedAlerts.length > 0) ? t.sinceVisit : null;

  // ---- command palette (Ctrl Shift K) and the More menu ----
  const openMore = (tabIndex: number) => { setMore(true); setTab(tabIndex); };
  const scrollTo = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  const applyView = (v: TodayView) => { changeAccounts(v.accounts); m.setExcludeJunk(v.excludeJunk); };
  const commands: PaletteCommand[] = [
    { id: "search-people", group: "Find", title: "Search people", hint: "Names, emails and phone numbers in every client account", keywords: "contact lead", run: () => document.querySelector<HTMLElement>('[data-testid="global-search-open"]')?.click() },
    { id: "go-fix", group: "Go to", title: multi ? "Start here" : "Reply now", hint: "The first things to do", keywords: "queue top fix", run: () => scrollTo("work-h") },
    ...(multi ? [{ id: "go-charts", group: "Go to", title: "Where the work is", hint: "One bar per client account", keywords: "bars", run: () => scrollTo("where-h") }] : []),
    { id: "tab-numbers", group: "Go to", title: "Numbers (more detail)", keywords: "tiles figures", run: () => openMore(0) },
    ...(kind !== "client" ? [
      { id: "tab-people", group: "Go to", title: "People tab", hint: "Workload by person", keywords: "owner workload", run: () => openMore(1) },
      { id: "tab-sources", group: "Go to", title: "Sources tab", hint: "Speed by source", run: () => openMore(2) },
      { id: "tab-coverage", group: "Go to", title: "Coverage tab", hint: "Which hours of the day miss leads", keywords: "hours", run: () => openMore(3) },
    ] : []),
    ...KINDS.map((k): PaletteCommand => ({ id: `list-${k}`, group: "Open list", title: KIND_LABEL[k], hint: `${fmtInt(view.totals[k].count)} behind this number`, run: () => m.open(specKind(k, env)) })),
    ...(multi ? [{ id: "list-clients", group: "Open list", title: "Clients that need you", run: () => m.open(specClients(env)) }] : []),
    { id: "list-dollars", group: "Open list", title: "Deals behind the dollars at risk", keywords: "money stale quiet", run: () => m.open(specDollars(env)) },
    ...(agency ? options.map((o): PaletteCommand => ({ id: `account-${o.id}`, group: "Client account", title: o.name, hint: "Show only this client account", keywords: "account only narrow", run: () => changeAccounts([o.id]) })) : []),
    ...(agency ? [{ id: "all-accounts", group: "Client account", title: "Show all client accounts", disabled: picked.length === 0, run: () => changeAccounts([]) }] : []),
    { id: "junk", group: "Do", title: m.excludeJunk ? "Count test and very old deals again" : "Leave out test and very old deals", keywords: "junk exclude", run: () => m.setExcludeJunk(!m.excludeJunk) },
    { id: "share", group: "Do", title: "Share Today", hint: "Copies the headline and the top 3", keywords: "copy", run: () => void copy() },
    ...(agency ? [{ id: "brief", group: "Do", title: "Preview the daily email", run: () => setBrief(true) }] : []),
    { id: "sync", group: "Do", title: "Sync now", hint: "Read every client account again", run: () => void sync() },
    ...(agency ? [{ id: "print", group: "Do", title: "Print the report", hint: "Or save it as a PDF", keywords: "pdf paper", run: () => window.print() }] : []),
  ];
  const moreItems: MenuItem[] = [
    ...(agency ? [{ key: "brief", label: "Preview the daily email", onSelect: () => setBrief(true) }, { key: "print", label: "Print report", onSelect: () => window.print() }] : []),
    { key: "share", label: copied ? "Copied to your clipboard" : agency ? "Share Today" : "Share my day", onSelect: () => void copy() },
    { key: "sync", label: syncing ? "Syncing..." : "Sync now", onSelect: () => void sync(), disabled: syncing },
    ...(agency ? [{ key: "views", label: "Saved views", onSelect: () => setViews(true) }, { key: "commands", label: "Commands", hint: "Ctrl Shift K", onSelect: () => setPalette(true) }] : []),
  ];
  const report = {
    brandName: null, who: picked.length > 0 ? pickedNames.join(", ") : "All client accounts", generatedAt: new Date(m.now).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" }),
    headline: headline.text, breakdown: headline.breakdown, rows, insights: m.insights.map((i) => i.text), forecast: forecastLine(t.forecast, t.targetMinutes),
    proof: t.proof ? proofLine(t.proof) : null, setAside: view.held.length,
  };

  // The client-account choice lives in the shell's one global filter bar (KF-11); Today only reads it (`picked`).
  const filter = null;

  // ---- the lists ----
  const alsoRows: KindRow[] = (["appointments", "noshows", "stale"] as const)
    // Where "My day" content is shown below (calls and appointments), those kinds are not listed twice.
    .filter((k) => view.totals[k].count > 0 && !(mine && k !== "stale"))
    .map((k) => {
      const q = rows.find((r) => r.kind === k);
      const n = view.totals[k].count;
      const text = k === "appointments" ? `${n === 1 ? "A past appointment has" : `${n} past appointments have`} no outcome marked.` : k === "noshows" ? `${n === 1 ? "Someone missed" : `${n} people missed`} an appointment and have not rebooked.`
        : `${n === 1 ? "An open deal has" : `${n} open deals have`} not moved in ${t.staleDays}+ days${view.totals.stale.dollars ? `, ${fmtMoney(view.totals.stale.dollars)} in all` : ""}.`;
      const action = k === "stale" ? { label: "Open", href: q?.url ?? t.accounts[0]?.url, sr: "Deals in your CRM" } : { label: "Mark", onClick: () => go("appointments"), sr: k === "noshows" ? "No-shows in Appointments" : "Appointments to mark" };
      return { kind: k, count: n, text, onOpen: () => m.open(specKind(k, env)), action };
    });

  const inTarget = (days: number) => env.ledger.filter((l) => l.leadAt > m.now - days * 86_400_000 && l.leadAt <= m.now && judge(l, t.targetMinutes, m.now) !== null);
  const specTarget = () => { const r = inTarget(7).map(({ zone: _z, ...x }) => { void _z; return x; }); return leadsSpec(r, m.now, { key: "in-target", title: "Leads this week, judged against the reply target", subtitle: `Leads of the last 7 days that were answered, or are past the ${t.targetMinutes}-minute target without an answer. The share is the ones answered inside the target.`, noun: r.length === 1 ? "lead" : "leads", count: r.length, exportName: "leads-this-week" }); };
  const n = mine?.numbers;
  const pct = (x: number | null) => `${Math.round((x as number) * 100)}%`;

  const numbers = (
    <div data-testid="tab-numbers">
      <section className="mb-3 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4" aria-label="Four figures" data-testid="today-pulse">
        <PulseTile testId="pulse-replies" label="Waiting for a reply" usual={null} onOpen={blockedLeads ? undefined : () => m.open(specKind("replies", env))} openLabel="Show the people waiting for a reply"
          value={blockedLeads ? "Not available" : fmtInt(counts.replies)}
          sub={blockedLeads ? "Needs permission: reconnect." : counts.replies === 0 ? "Nobody is waiting for a reply." : <>{oldest !== null && <span data-testid="pulse-oldest">The longest wait is {ageWords(Math.max(0, (m.now - oldest) / 60_000))}.</span>}{counts.newLeads > 0 && <> {fmtInt(counts.newLeads)} {counts.newLeads === 1 ? "is a new lead" : "are new leads"}.</>}{never > 0 && <> {fmtInt(never)} {never === 1 ? "was" : "were"} never answered.</>}</>} />
        <PulseTile testId="pulse-reply" label="Typical first reply" usual={known(reply.verdict)} onOpen={reply.current.answered > 0 ? () => m.open(specReplies(env, m.now, 7, "Typical first reply, last 7 days")) : undefined} openLabel="Show the replies this is worked out from"
          value={reply.current.seconds !== null ? replyWords(reply.current.seconds) : reply.current.answered === 0 ? "No replies yet" : "Not enough yet"}
          sub={reply.current.seconds === null ? `A typical time needs at least 5 replies in 7 days.${reply.current.answered > 0 ? ` ${reply.current.answered} so far.` : ""}` : `Last 7 days, from ${fmtInt(reply.current.answered)} replies.`}
          spark={<PulseSpark points={points} label="Typical first reply, last 7 days" format={replyWords}
            onPoint={(i) => m.open(specReplies(env, pointEnd(reply.points[i].day, m.now), 7, `Typical first reply, 7 days to ${reply.points[i].day}`))}
            pointInfo={(i) => { const c = windowReplies(i); return c > 0 ? { open: true, text: `Click to see the ${c} replies behind it.` } : { open: false, text: "SubSync no longer holds the leads behind this point." }; }} />} />
        <PulseTile testId="pulse-appointments" label="Appointments to mark" usual={null} onOpen={blockedAppts ? undefined : () => m.open(specKind("appointments", env))} openLabel="Show the appointments to mark"
          value={blockedAppts ? "Not available" : fmtInt(counts.appointments)}
          sub={blockedAppts ? "Needs permission: reconnect." : counts.appointments === 0 ? "Every past appointment has an outcome." : oldestAppt !== null ? `The oldest started ${ageWords(Math.max(0, (m.now - oldestAppt) / 60_000))} ago.` : null} />
        <PulseTile testId="pulse-risk" label="Deals gone quiet" usual={known(staleVerdict)} onOpen={() => m.open(specDollars(env))} openLabel="Show the deals this adds up"
          value={counts.staleDollars ? fmtMoney(counts.staleDollars) : "$0"}
          sub={counts.stale === 0 ? "No open deal has gone quiet." : `${fmtInt(counts.stale)} open ${counts.stale === 1 ? "deal has" : "deals have"} not moved in ${t.staleDays}+ days.`} />
      </section>
      {noHistory && <p className="mb-6 text-xs text-muted-foreground" data-testid="history-note">{SHARED_HISTORY_NOTE}</p>}
      <JunkControl m={m} staleCount={t.totals.stale.count} />
      {n && (
        <section className="mb-8" aria-labelledby="my-numbers-h" data-testid="my-numbers">
          <h2 id="my-numbers-h" className="mb-3 text-base font-semibold">This week</h2>
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            <PulseTile testId="my-showrate" label="Show rate" usual={null} onOpen={() => go("appointments")} openLabel="Open Appointments to see the appointments behind this"
              value={n.showRate.now === null ? "Not enough yet" : pct(n.showRate.now)}
              sub={n.showRate.now === null ? `Needs ${n.showRate.minN} appointments with an outcome marked. ${n.showRate.nNow} so far.` : `Of ${n.showRate.nNow} appointments with an outcome, last 30 days.`} />
            <PulseTile testId="my-intarget" label="Answered inside the target" usual={null} onOpen={inTarget(7).length > 0 ? () => m.open(specTarget()) : undefined} openLabel="Show the leads this share is worked out from"
              value={n.inTarget.now === null ? "Not enough yet" : pct(n.inTarget.now)}
              sub={n.inTarget.now === null ? `Needs 5 leads past their target. ${n.inTarget.nNow} so far.` : `Of ${n.inTarget.nNow} leads this week. The target is ${t.targetMinutes} minutes.`} />
          </div>
        </section>
      )}
      <InsightStrip insights={kind === "client" ? m.insights.filter((i) => i.key !== "idle_owner") : m.insights} onOpen={(i) => m.open(specInsight(i, env))} />
      <ComingBlock forecast={t.forecast} targetMinutes={t.targetMinutes} onOpen={(k) => m.open(specComing(k, t.forecast[k], t.targetMinutes))} />
      {t.proof && kind !== "client" && (
        <section className="mb-4 border-t pt-6" aria-labelledby="caught-h" data-testid="today-proof">
          <h2 id="caught-h" className="mb-4 text-base font-semibold">{agency ? "For your next client review" : "What SubSync caught in your account"}</h2>
          <div className="grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <ProofStrip proof={t.proof} title={agency ? undefined : "The last 7 days"} onOpen={(k) => m.open(specAlerts(t.proof!, k))} />
            <RaisedClearedStrip proof={t.proof} selected={day} onSelect={setDay} onOpenDay={(i) => m.open(specAlerts(t.proof!, { day: i }))} />
          </div>
        </section>
      )}
    </div>
  );

  const tabs = [
    { label: "Numbers", node: numbers },
    ...(kind !== "client" ? [
      { label: "People", node: <PeopleTab m={m} t={t} agency={multi} /> },
      { label: "Sources", node: <SourcesTab m={m} t={t} /> },
      { label: "Coverage", node: <CoverageTab m={m} t={t} /> },
    ] : []),
  ];
  const allDone = headline.allClear && !t.access.leadsBlocked && !t.access.apptsBlocked && (mine ? mine.calls.noshows.total + mine.calls.confirm.total === 0 : true);

  return (
    <div data-testid="page" className="ds-enter">
      <PrintReport r={report} now={m.now} />
      <div className="print:hidden">
        <TodayHeader filter={filter} more={moreItems} />
        {error && <InlineAlert tone="danger" className="mb-4" action={<Btn onClick={() => void reload()}>Try again</Btn>}>{error}</InlineAlert>}

        <HeadlineBlock headline={headline} onPart={onPart} action={primary ? <PrimaryButton p={primary} /> : undefined}>
          {blockedLeads && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedLeads}</InlineAlert>}
          {blockedAppts && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedAppts}</InlineAlert>}
          {headline.allClear && t.proof && !blockedLeads && !blockedAppts && kind !== "client" && <p className="mt-3 text-base text-muted-foreground" data-testid="today-proof-line">{proofLine(t.proof)}</p>}
          {!t.actionsReady && <p className="mt-2 text-xs text-muted-foreground" data-testid="needs-update">Done for now and Snooze need the latest database update. Everything else works.</p>}
        </HeadlineBlock>

        {multi ? (
          <>
            <AccountList rows={needing.rows} total={needing.total} urgent={urgent} onShow={(a) => m.open(specAccount(a.locationId, env))} onOnly={(a) => changeAccounts([a.locationId])} onSeeAll={() => m.open(specClients(env))}
              onAct={m.act} canAssign={m.canAssign} assigned={m.assigned} whyOf={m.rowWhy} nextOf={(a) => nextAction(rows, view.items, a.locationId)} onNext={(a, na) => m.open(specNext(na.itemIds, na.text, env))}
              empty={rows.length === 0 ? (view.held.length > 0 ? "Everything left is set aside. It comes back by itself." : "Nothing needs you right now.") : "Nothing here needs you right now."} />
            <HeldLink m={m} />
            {bars.bars.length > 1 && (
              <section className="mb-8" aria-labelledby="where-h" data-testid="today-charts">
                <h2 id="where-h" className="mb-2 text-lg font-semibold tracking-tight">Where the work is</h2>
                <AccountBars title={barsTitle(bars)} bars={bars.bars} rows={rows} more={Math.max(0, bars.accounts - bars.bars.length)}
                  onSegment={(id, k) => m.open(specKind(k, env, id))} onAccount={(id) => m.open(specAccount(id, env))} onMore={() => m.open(specClients(env))} />
              </section>
            )}
          </>
        ) : (
          <>
            {allDone && <DoneForToday data={t} streak={mine?.numbers.streakDays ?? 0} />}
            <ReplyNowList items={waiting} total={counts.replies} newLeads={counts.newLeads} onSeeAll={() => m.open(specKind("replies", env))} onAct={m.act} canAssign={m.canAssign} assigned={m.assigned} />
            <KindList rows={alsoRows} hint={mine ? undefined : "The other kinds of thing in this client account."} />
            {mine && <CallsSection mine={mine} />}
            {mine && <AppointmentsSection mine={mine} go={() => go("appointments")} />}
            <HeldLink m={m} />
          </>
        )}

        {since && <SinceStrip since={since} showAlerts={kind !== "client"} onOpen={(k) => m.open(specSince(k, since, env))} />}

        <MoreDetail open={more} onToggle={() => setMore(!more)} tab={tab} onTab={setTab} tabs={tabs} />
      </div>
      {agency && <CommandPalette commands={commands} hideTrigger open={palette} onOpenChange={setPalette} />}
      {agency && <ViewsMenu current={{ accounts: picked, excludeJunk: m.excludeJunk }} names={nameOf} onApply={applyView} hideTrigger open={views} onOpenChange={setViews} />}
      <TodayLayers m={m} />
      {brief && <BriefPreview onClose={() => setBrief(false)} />}
    </div>
  );
}
