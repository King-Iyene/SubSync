"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { AccessKind } from "@/lib/access";
import {
  accountBars, accountsNeedingYou, accountsQuery, ageWords, barsTitle, donutTitle, headlineOf, money, parseTodayAccounts, proofLine, replyWords, shareText, slicesOf,
  staleUsual, withTodayAccounts, type HeadlineAction, type Kind, type QueueRow, type Usual,
} from "@/lib/analytics/today-queue";
import { nextAction } from "@/lib/analytics/today-smart";
import {
  pointEnd, specAccount, specAlerts, specClients, specComing, specDollars, specInsight, specKind, specNext, specReplies, specRow, specSince, specThings,
} from "@/lib/analytics/today-specs";
import type { TodayData } from "@/lib/analytics/today-types";
import type { GoFn } from "../nav";
import { ApiProvider, useApiClient, useData } from "../session";
import {
  AccountBars, ComingBlock, DonutChart, EmptyState, FixFirstQueue, HeadlineBlock, InlineAlert, InsightStrip, LocalAccountPicker, ModuleTabs, Page, ProofStrip, PulseSpark, PulseTile,
  RaisedClearedStrip, remember, remembered, Section, ShowingChip, SinceStrip, Skeleton, SkeletonCards, SkeletonRows,
} from "../ds";
import { Badge, Btn, ErrorBox, fmtInt, fmtMoney } from "../ui";
import { TodayAccount } from "./today-account";
import { useTodayModel, TodayLayers } from "./today-model";
import { BriefPreview, CoverageTab, HeadlineControls, PeopleTab, SourcesTab } from "./today-parts";

// Today, rebuilt around one question: what do I do first, and what is it worth? One big sentence, four figures against the account's own usual, spotted today, the Fix
// first queue, what happens if nobody acts, two charts, the accounts that need you and what SubSync caught, and three more tabs (People, Sources, Coverage). EVERY number,
// slice, bar, day, point and row opens the records behind it in one large panel (src/app/app/ds/records-panel.tsx), built by src/lib/analytics/today-specs.ts so that
// the number pressed equals the rows listed. Done, Snooze and Assign mark a row inside SubSync only; nothing here writes to the CRM. See docs/features/TODAY.md.
// The account selector belongs to this page only: it is kept in this page's address (`ta=`) and in this browser, and the shell's header filter is not drawn here.

type Segments = { accounts: Array<{ id: string; name: string; ignored: boolean }> };
const TODAY_KEY = "today-accounts";

function initialAccounts(enabled: boolean): string[] {
  if (typeof window === "undefined" || !enabled) return [];
  const fromAddress = parseTodayAccounts(window.location.hash);
  if (fromAddress.length > 0) return fromAddress;
  return parseTodayAccounts(`#x?ta=${remembered(TODAY_KEY) ?? ""}`);
}

/** Today's own account choice: in the address (`#today?ta=...`), remembered per person for Today only, and kept in step with Back and Forward. */
function useTodayAccounts(enabled: boolean): [string[], (ids: string[]) => void] {
  const [picked, setPicked] = useState<string[]>(() => initialAccounts(enabled));
  const commit = (ids: string[]) => {
    setPicked(ids);
    try { window.history.replaceState(null, "", withTodayAccounts(window.location.hash || "#today", ids)); } catch { /* the choice still applies */ }
    remember(TODAY_KEY, ids.length ? ids.join(",") : null);
  };
  useEffect(() => {
    if (picked.length > 0 && parseTodayAccounts(window.location.hash).length === 0) {
      try { window.history.replaceState(null, "", withTodayAccounts(window.location.hash || "#today", picked)); } catch { /* see above */ }
    }
    // Once, for a choice restored from this browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const sync = () => setPicked(parseTodayAccounts(window.location.hash));
    window.addEventListener("popstate", sync);
    window.addEventListener("subsync-today-accounts", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("subsync-today-accounts", sync); };
  }, []);
  return [enabled ? picked : [], enabled ? commit : () => undefined];
}

function reasonText(blocked: boolean, kindsOff: string): string | null {
  return blocked ? `Needs permission: ${kindsOff}. Ask the person who manages SubSync to approve it, then run a sync.` : null;
}

export function TodayView({ go, kind }: { go: GoFn; kind: AccessKind }) {
  const base = useApiClient();
  const agency = kind === "agency";
  const [picked, setPicked] = useTodayAccounts(agency);
  const scoped = useMemo(() => (picked.length ? base.filtered(accountsQuery(picked)) : base), [base, picked]);
  return <ApiProvider value={scoped}><TodayBody go={go} kind={kind} picked={picked} setPicked={setPicked} /></ApiProvider>;
}

function TodayBody({ go, kind, picked, setPicked }: { go: GoFn; kind: AccessKind; picked: string[]; setPicked: (ids: string[]) => void }) {
  const api = useApiClient();
  const today = useData<TodayData>("today");
  const seg = useData<Segments>(kind === "agency" ? "segments" : null);
  const [syncing, setSyncing] = useState(false);

  const options = useMemo(() => (seg.data?.accounts ?? []).filter((a) => !a.ignored).map((a) => ({ id: a.id, name: a.name })), [seg.data]);
  // A choice that names an account this company does not have (an old remembered choice, a typed address) is dropped; the server ignores it anyway.
  useEffect(() => {
    if (!seg.data || picked.length === 0) return;
    const known = new Set(options.map((o) => o.id));
    const clean = picked.filter((p) => known.has(p));
    if (clean.length !== picked.length) setPicked(clean);
  }, [seg.data, options, picked, setPicked]);

  const t = today.data;
  const sync = async () => { setSyncing(true); try { await api.post("sync"); await today.reload(); } finally { setSyncing(false); } };

  if (today.error && !t) return <Page title="Today"><ErrorBox error={today.error} onRetry={today.reload} /></Page>;
  if (!t) {
    return (
      <Page title="Today" subtitle="Checking every client account for what needs a person.">
        <div className="mb-8 space-y-3" role="status" aria-busy="true" aria-label="Working out what needs you today"><Skeleton className="h-14 w-3/4" /><Skeleton className="h-5 w-1/2" /></div>
        <SkeletonCards cards={4} label="Working out your figures..." />
        <div className="mt-8"><SkeletonRows rows={5} label="Working out what to fix first..." /></div>
      </Page>
    );
  }
  if (kind !== "agency" || t.scope === "account") return <TodayAccount go={go} data={t} kind={kind} reload={async () => { await today.reload(); }} sync={sync} syncing={syncing} />;
  if (t.accounts.length === 0 && picked.length === 0) {
    return (
      <Page title="Today" subtitle="What needs a person across your client accounts, most valuable first.">
        <EmptyState title="SubSync has not found any client accounts yet" body="The first read takes a few minutes after SubSync is installed. Press Sync now, or follow the steps in Getting started."
          action={<div className="flex gap-2"><Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn><Btn onClick={() => go("help")}>Open Getting started</Btn></div>} />
      </Page>
    );
  }
  return <TodayAgency go={go} t={t} reload={async () => { await today.reload(); }} sync={sync} syncing={syncing} options={options} picked={picked} setPicked={setPicked} error={today.error?.message ?? null} />;
}

function TodayAgency({ go, t, reload, sync, syncing, options, picked, setPicked, error }: {
  go: GoFn; t: TodayData; reload: () => Promise<void>; sync: () => Promise<void>; syncing: boolean;
  options: Array<{ id: string; name: string }>; picked: string[]; setPicked: (ids: string[]) => void; error: string | null;
}) {
  const m = useTodayModel({ t, kind: "agency", reload });
  const { view, env } = m;
  const [day, setDay] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [allAccounts, setAllAccounts] = useState(false);
  const [used, setUsed] = useState({ donut: false, bars: false });
  const [tab, setTab] = useState(0);
  const [brief, setBrief] = useState(false);
  const changeAccounts = (ids: string[]) => { m.close(); setDay(null); setPicked(ids); };

  const rows = view.queue;
  const headline = headlineOf({ scope: "all", rows, totals: view.totals, outlier: t.outlier });
  const slices = slicesOf(view.totals);
  const bars = accountBars(rows);
  const accountMap = useMemo(() => new Map(t.accounts.map((a) => [a.id, a])), [t.accounts]);
  const needing = accountsNeedingYou(rows, accountMap, allAccounts ? 50 : 5);
  const pickedNames = picked.map((id) => options.find((o) => o.id === id)?.name ?? "1 client account");
  const openKey = m.panel?.key ?? "";

  const onPart = (a: HeadlineAction) => m.open(a === "clients" ? specClients(env) : a === "dollars" ? specDollars(env) : specThings(env));
  const copy = async () => {
    const text = shareText({ who: picked.length > 0 ? pickedNames.join(", ") : "Your client accounts", headline, rows });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };

  // ---- the four figures, each against the account's own usual (only above the minimum sample) ----
  const oldestLead = view.items.filter((i) => i.kind === "leads" && !i.never && i.at !== null).reduce<number | null>((x, i) => (x === null ? i.at : Math.min(x, i.at as number)), null);
  const never = view.items.filter((i) => i.kind === "leads" && i.never).length;
  const oldestAppt = view.items.filter((i) => i.kind === "appointments" && i.at !== null).reduce<number | null>((x, i) => (x === null ? i.at : Math.min(x, i.at as number)), null);
  const noUsual: Usual = { verdict: "not_enough", text: "Not enough history yet to compare with your usual." };
  const reply = t.pulse.reply;
  const blockedLeads = reasonText(t.access.leadsBlocked, "replies cannot be timed until the conversations permission is approved");
  const blockedAppts = reasonText(t.access.apptsBlocked, "appointments cannot be checked until the calendar permission is approved");
  const points = reply.points.map((p) => ({ label: p.day, value: p.value, note: p.window }));
  const windowReplies = (i: number) => env.ledger.filter((l) => l.touchAt !== null && l.leadAt > pointEnd(reply.points[i].day, m.now) - 7 * 86_400_000 && l.leadAt <= pointEnd(reply.points[i].day, m.now)).length;
  const since = t.sinceVisit && (t.sinceVisit.newLeads.length + t.sinceVisit.breached.length + t.sinceVisit.answered.length + t.sinceVisit.clearedAlerts.length > 0) ? t.sinceVisit : null;

  const overview = (
    <>
      {since && <SinceStrip since={since} showAlerts onOpen={(k) => m.open(specSince(k, since, env))} />}
      <section className="mb-9 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4" aria-label="Four figures against your usual" data-testid="today-pulse">
        <PulseTile testId="pulse-leads" label="Leads waiting now" usual={blockedLeads ? null : noUsual} onOpen={blockedLeads ? undefined : () => m.open(specKind("leads", env))} openLabel="Show the leads waiting"
          value={blockedLeads ? "Not available" : fmtInt(view.totals.leads.count)}
          sub={blockedLeads ? "Needs permission: reconnect." : view.totals.leads.count === 0 ? "No lead is past its reply target." : <>{oldestLead !== null && <span data-testid="pulse-oldest">Oldest has waited {ageWords(Math.max(0, (m.now - oldestLead) / 60_000))}.</span>}{never > 0 && <> {fmtInt(never)} {never === 1 ? "was" : "were"} never answered.</>}</>} />
        <PulseTile testId="pulse-reply" label="Typical first reply" usual={reply.verdict} onOpen={reply.current.answered > 0 ? () => m.open(specReplies(env, m.now, 7, "Typical first reply, last 7 days")) : undefined} openLabel="Show the replies this is worked out from"
          value={reply.current.seconds === null ? `${fmtInt(reply.current.answered)} ${reply.current.answered === 1 ? "reply" : "replies"}` : replyWords(reply.current.seconds)}
          sub={reply.current.seconds === null ? "Last 7 days. A typical time needs at least 5 replies." : `Last 7 days, from ${fmtInt(reply.current.answered)} replies.`}
          spark={<PulseSpark points={points} label="Typical first reply, last 7 days" format={replyWords}
            onPoint={(i) => m.open(specReplies(env, pointEnd(reply.points[i].day, m.now), 7, `Typical first reply, 7 days to ${reply.points[i].day}`))}
            pointInfo={(i) => { const n = windowReplies(i); return n > 0 ? { open: true, text: `Click to see the ${n} replies behind it.` } : { open: false, text: "SubSync no longer holds the leads behind this point." }; }} />} />
        <PulseTile testId="pulse-appointments" label="Appointments to mark" usual={blockedAppts ? null : noUsual} onOpen={blockedAppts ? undefined : () => m.open(specKind("appointments", env))} openLabel="Show the appointments to mark"
          value={blockedAppts ? "Not available" : fmtInt(view.totals.appointments.count)}
          sub={blockedAppts ? "Needs permission: reconnect." : view.totals.appointments.count === 0 ? "Every past appointment has an outcome." : oldestAppt !== null ? `The oldest started ${ageWords(Math.max(0, (m.now - oldestAppt) / 60_000))} ago.` : null} />
        <PulseTile testId="pulse-risk" label="Open pipeline at risk" usual={staleUsual(t.pulse.stale)} onOpen={() => m.open(specDollars(env))} openLabel="Show the deals this adds up"
          value={view.totals.stale.dollars ? fmtMoney(view.totals.stale.dollars) : "$0"}
          sub={view.totals.stale.count === 0 ? "No open deal has gone quiet." : `${fmtInt(view.totals.stale.count)} open ${view.totals.stale.count === 1 ? "deal has" : "deals have"} not moved in ${t.staleDays}+ days.`} />
      </section>

      <InsightStrip insights={m.insights} onOpen={(i) => m.open(specInsight(i, env))} />

      <FixFirstQueue rows={rows} onShow={(r: QueueRow) => m.open(specRow(r, env))} title="Fix first" assigned={m.assigned} whyOf={m.rowWhy} onAct={m.act} canAssign={m.canAssign} busyKey={m.busy}
        empty={rows.length === 0 ? (view.held.length > 0 ? "Everything left is set aside. It comes back by itself." : "Nothing needs fixing right now.") : "Nothing of this kind needs fixing right now."} />

      <ComingBlock forecast={t.forecast} targetMinutes={t.targetMinutes} onOpen={(k) => m.open(specComing(k, t.forecast[k], t.targetMinutes))} />

      <section className="mb-9 border-t pt-6" aria-labelledby="where-h" data-testid="today-charts">
        <h2 id="where-h" className="mb-4 text-base font-semibold">Where the work is</h2>
        {slices.length === 0 ? (
          <EmptyState compact title="Nothing to chart yet" body={blockedLeads || blockedAppts ? "Some figures cannot be counted until a permission is approved, so the charts would be incomplete." : "Nothing needs attention right now, so there is nothing to split up."} />
        ) : (
          <div className="grid grid-cols-1 gap-x-14 gap-y-9 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <DonutChart title={donutTitle(view.totals)} slices={slices} selected={(slices.find((s) => openKey === `kind:${s.kind}`)?.kind ?? null) as Kind | null} used={used.donut} hint="Click a slice or a name to see exactly what is in it."
              onSelect={(k) => { setUsed((u) => ({ ...u, donut: true })); m.open(specKind(k, env)); }} />
            <AccountBars title={barsTitle(bars)} bars={bars.bars} rows={rows} selected={bars.bars.find((b) => openKey === `account:${b.locationId}`)?.locationId ?? null} used={used.bars}
              onSelect={(id) => { setUsed((u) => ({ ...u, bars: true })); m.open(specAccount(id, env)); }} />
          </div>
        )}
      </section>

      <Section id="needs-you" title="Accounts needing you" hint="One reason each, the most valuable first, and the next step to take. Open one in your CRM, or narrow Today to it.">
        {needing.rows.length === 0 ? (
          <EmptyState compact title="No client account needs you" body="Every account is on track against its own usual." />
        ) : (
          <ul className="@container divide-y border-y" data-testid="needing-you">
            {needing.rows.map((a) => {
              const na = nextAction(rows, view.items, a.locationId);
              return (
                <li key={a.locationId} className="ds-row grid grid-cols-[minmax(0,1fr)_9rem] items-start gap-x-4 gap-y-1.5 py-3 @4xl:grid-cols-[minmax(0,1.1fr)_9rem_minmax(0,2fr)_9.5rem_8rem]" data-testid="needing-row">
                  <p className="min-w-0 break-words font-semibold" data-col="name">{a.name}</p>
                  <p className="text-sm" data-col="state"><Badge tone={a.state === "Needs you now" ? "bad" : a.state === "Needs a look" ? "warn" : "neutral"}>{a.state}</Badge></p>
                  <div className="col-span-2 min-w-0 text-sm text-muted-foreground @4xl:col-span-1" data-col="reason">
                    <p className="break-words">{a.reason}{a.count > 1 && <span> and {a.count - 1} more things</span>}{a.dollars ? <span>. {money(a.dollars)} at stake.</span> : null}</p>
                    {na && <p className="mt-1" data-testid="next-step"><span className="font-medium text-foreground">Next step: </span><button type="button" onClick={() => m.open(specNext(na.itemIds, na.text, env))} className="rounded px-0.5 text-left underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-testid="next-step-button">{na.text}</button>. {na.effect}</p>}
                  </div>
                  <div className="col-span-2 grid grid-cols-[9.5rem_8rem] justify-end gap-x-2 @4xl:contents">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="ds-press inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border bg-card px-2 text-sm font-medium hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]" data-col="crm">Open in CRM<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({a.name}, opens in a new tab)</span></a>
                    <button type="button" onClick={() => changeAccounts([a.locationId])} className="ds-press inline-flex min-h-9 w-full items-center justify-center rounded-lg px-2 text-sm text-muted-foreground underline-offset-4 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]" data-col="only">Only this account</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {needing.total > 5 && <div className="mt-2"><Btn variant="ghost" onClick={() => setAllAccounts(!allAccounts)}>{allAccounts ? "Show the top 5" : `All ${needing.total} accounts`}</Btn></div>}
      </Section>

      {t.proof && (
        <section className="mb-4 border-t pt-6" aria-labelledby="caught-h" data-testid="today-proof">
          <h2 id="caught-h" className="mb-4 text-base font-semibold">For your next client review</h2>
          <div className="grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <ProofStrip proof={t.proof} onOpen={(k) => m.open(specAlerts(t.proof!, k))} />
            <RaisedClearedStrip proof={t.proof} selected={day} onSelect={setDay} onOpenDay={(i) => m.open(specAlerts(t.proof!, { day: i }))} />
          </div>
        </section>
      )}
    </>
  );

  return (
    <Page title="Today" subtitle="What needs a person across your client accounts, most valuable first."
      actions={<><Btn variant="ghost" onClick={() => setBrief(true)} testId="brief-preview">Preview the daily email</Btn><Btn variant="ghost" onClick={copy}>{copied ? "Copied to your clipboard" : "Share Today"}</Btn><Btn onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn></>}>
      {(options.length >= 2 || picked.length > 0) && (
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="today-toolbar">
          <LocalAccountPicker accounts={options} picked={picked} onChange={changeAccounts} />
          {picked.length > 0 && <ShowingChip label={pickedNames.length === 1 ? pickedNames[0] : `${pickedNames.length} client accounts`} onClear={() => changeAccounts([])} />}
        </div>
      )}
      {error && <InlineAlert tone="danger" className="mb-4" action={<Btn onClick={() => void reload()}>Try again</Btn>}>{error}</InlineAlert>}

      <HeadlineBlock headline={headline} onPart={onPart}>
        {blockedLeads && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedLeads}</InlineAlert>}
        {blockedAppts && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedAppts}</InlineAlert>}
        {headline.allClear && t.proof && !blockedLeads && !blockedAppts && <p className="mt-3 text-base text-muted-foreground" data-testid="today-proof-line">{proofLine(t.proof)}</p>}
        <HeadlineControls m={m} staleCount={t.totals.stale.count} />
        {!t.actionsReady && <p className="mt-2 text-xs text-muted-foreground" data-testid="needs-update">Done and Snooze need the latest database update. Everything else works.</p>}
      </HeadlineBlock>

      <ModuleTabs label="Today views" value={tab} onChange={setTab} tabs={[
        { label: "Overview", node: overview },
        { label: "People", node: <PeopleTab m={m} t={t} agency /> },
        { label: "Sources", node: <SourcesTab m={m} t={t} /> },
        { label: "Coverage", node: <CoverageTab m={m} t={t} /> },
      ]} />
      <TodayLayers m={m} />
      {brief && <BriefPreview onClose={() => setBrief(false)} />}
    </Page>
  );
}
