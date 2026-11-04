"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { AccessKind } from "@/lib/access";
import {
  accountBars, accountsNeedingYou, accountsQuery, ageWords, barsTitle, donutTitle, headlineOf, KIND_LABEL, money, parseTodayAccounts, proofLine, replyWords, shareText, slicesOf,
  staleUsual, withTodayAccounts, type Kind, type QueueRow, type Usual,
} from "@/lib/analytics/today-queue";
import type { TodayData } from "@/lib/analytics/today-types";
import type { GoFn } from "../nav";
import { ApiProvider, useApiClient, useData } from "../session";
import {
  AccountBars, DonutChart, EmptyState, FixFirstQueue, HeadlineBlock, InlineAlert, LocalAccountPicker, Page, ProofStrip, PulseSpark, PulseTile, RaisedClearedStrip, RowsPanel,
  remember, remembered, Section, ShowingChip, Skeleton, SkeletonCards, SkeletonRows, useNow,
} from "../ds";
import { Badge, Btn, ErrorBox, fmtInt, fmtMoney } from "../ui";
import { TodayAccount } from "./today-account";

// Today, rebuilt around one question: what do I do first, and what is it worth? One big sentence, four figures against the account's own usual, the Fix first
// queue, two clickable charts that narrow the queue, the accounts that need you and what SubSync caught. Every number is one SubSync already shows on its own page
// (Speed to lead, Appointments, the Account audit, the alerts); see src/lib/analytics/today-queue.ts and docs/METRICS.md. Nothing here writes to the CRM.
// The account selector belongs to this page only: it is kept in this page's address (`ta=`) and in this browser, and the shell's header filter is not drawn here.

type Segments = { accounts: Array<{ id: string; name: string; ignored: boolean }> };
const TODAY_KEY = "today-accounts";
const NOUN: Record<Kind, string> = { leads: "leads", appointments: "appointments", noshows: "no-shows", stale: "deals", unanswered: "conversations" };

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

function reasonText(t: TodayData, blocked: boolean, kindsOff: string): string | null {
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
  const [focus, setFocus] = useState<{ kind: Kind | null; row: string | null }>({ kind: null, row: null });
  const [used, setUsed] = useState({ donut: false, bars: false });
  const [day, setDay] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [allAccounts, setAllAccounts] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const now = useNow();

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
  // Any change of accounts starts the page from the top: no half-open list from the earlier choice.
  const changeAccounts = (ids: string[]) => { setFocus({ kind: null, row: null }); setDay(null); setPicked(ids); };

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
  if (kind !== "agency" || t.scope === "account") return <TodayAccount go={go} data={t} kind={kind} reload={today.reload} sync={sync} syncing={syncing} now={now} />;

  if (t.accounts.length === 0 && picked.length === 0) {
    return (
      <Page title="Today" subtitle="What needs a person across your client accounts, most valuable first.">
        <EmptyState title="SubSync has not found any client accounts yet" body="The first read takes a few minutes after SubSync is installed. Press Sync now, or follow the steps in Getting started."
          action={<div className="flex gap-2"><Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn><Btn onClick={() => go("help")}>Open Getting started</Btn></div>} />
      </Page>
    );
  }

  const rows = t.queue;
  const headline = headlineOf({ scope: "all", rows, totals: t.totals, outlier: t.outlier });
  const slices = slicesOf(t.totals);
  const bars = accountBars(rows);
  const needing = accountsNeedingYou(rows, new Map(t.accounts.map((a) => [a.id, a])), allAccounts ? 50 : 5);
  const shownRows = focus.kind ? rows.filter((r) => r.kind === focus.kind) : rows;
  const chosenRow = focus.row ? rows.find((r) => r.key === focus.row) ?? null : null;
  const listItems = chosenRow ? t.items.filter((i) => chosenRow.itemIds.includes(i.id)) : focus.kind ? t.items.filter((i) => i.kind === focus.kind) : [];
  const listCount = chosenRow ? chosenRow.count : focus.kind ? t.totals[focus.kind].count : 0;
  const listKind = chosenRow?.kind ?? focus.kind;
  const listTitle = chosenRow ? `${chosenRow.accountName}, ${KIND_LABEL[chosenRow.kind].toLowerCase()}` : focus.kind ? KIND_LABEL[focus.kind] : "";
  const pickedNames = picked.map((id) => options.find((o) => o.id === id)?.name ?? "1 client account");

  const open = (next: { kind: Kind | null; row: string | null }) => {
    setFocus(next);
    setTimeout(() => document.getElementById("today-list")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };
  const clearFocus = () => setFocus({ kind: null, row: null });
  const onSlice = (k: Kind) => { setUsed((u) => ({ ...u, donut: true })); if (focus.kind === k && !focus.row) clearFocus(); else open({ kind: k, row: null }); };
  const onBar = (id: string) => { setUsed((u) => ({ ...u, bars: true })); changeAccounts(picked.length === 1 && picked[0] === id ? [] : [id]); };

  const copy = async () => {
    const text = shareText({ who: picked.length > 0 ? pickedNames.join(", ") : "Your client accounts", headline, rows });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };

  // ---- the four figures, each against the account's own usual (only above the minimum sample) ----
  const oldestLead = t.items.filter((i) => i.kind === "leads" && !i.never && i.at !== null).reduce<number | null>((m, i) => (m === null ? i.at : Math.min(m, i.at as number)), null);
  const never = t.items.filter((i) => i.kind === "leads" && i.never).length;
  const oldestAppt = t.items.filter((i) => i.kind === "appointments" && i.at !== null).reduce<number | null>((m, i) => (m === null ? i.at : Math.min(m, i.at as number)), null);
  const noUsual: Usual = { verdict: "not_enough", text: "Not enough history yet to compare with your usual." };
  const reply = t.pulse.reply;
  const blockedLeads = reasonText(t, t.access.leadsBlocked, "replies cannot be timed until the conversations permission is approved");
  const blockedAppts = reasonText(t, t.access.apptsBlocked, "appointments cannot be checked until the calendar permission is approved");

  return (
    <Page title="Today" subtitle="What needs a person across your client accounts, most valuable first."
      actions={<><Btn variant="ghost" onClick={copy}>{copied ? "Copied to your clipboard" : "Share Today"}</Btn><Btn onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn></>}>
      {(options.length >= 2 || picked.length > 0 || focus.kind || focus.row) && (
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="today-toolbar">
          <LocalAccountPicker accounts={options} picked={picked} onChange={changeAccounts} />
          {picked.length > 0 && <ShowingChip label={pickedNames.length === 1 ? pickedNames[0] : `${pickedNames.length} client accounts`} onClear={() => changeAccounts([])} />}
          {chosenRow ? <ShowingChip label={`${chosenRow.accountName}, ${KIND_LABEL[chosenRow.kind].toLowerCase()}`} onClear={clearFocus} />
            : focus.kind ? <ShowingChip label={KIND_LABEL[focus.kind]} onClear={clearFocus} /> : null}
        </div>
      )}
      {today.error && <InlineAlert tone="danger" className="mb-4" action={<Btn onClick={() => void today.reload()}>Try again</Btn>}>{today.error.message}</InlineAlert>}

      <HeadlineBlock headline={headline}>
        {blockedLeads && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedLeads}</InlineAlert>}
        {blockedAppts && <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>{blockedAppts}</InlineAlert>}
        {headline.allClear && t.proof && !blockedLeads && !blockedAppts && <p className="mt-3 text-base text-muted-foreground" data-testid="today-proof-line">{proofLine(t.proof)}</p>}
      </HeadlineBlock>

      <section className="mb-9 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-4" aria-label="Four figures against your usual" data-testid="today-pulse">
        <PulseTile testId="pulse-leads" label="Leads waiting now" usual={blockedLeads ? null : noUsual}
          value={blockedLeads ? "Not available" : fmtInt(t.totals.leads.count)}
          sub={blockedLeads ? "Needs permission: reconnect." : t.totals.leads.count === 0 ? "No lead is past its reply target." : <>{oldestLead !== null && <span data-testid="pulse-oldest">Oldest has waited {ageWords(Math.max(0, (now - oldestLead) / 60_000))}.</span>}{never > 0 && <> {fmtInt(never)} {never === 1 ? "was" : "were"} never answered.</>}</>} />
        <PulseTile testId="pulse-reply" label="Typical first reply" usual={reply.verdict}
          value={reply.current.seconds === null ? `${fmtInt(reply.current.answered)} ${reply.current.answered === 1 ? "reply" : "replies"}` : replyWords(reply.current.seconds)}
          sub={reply.current.seconds === null ? "Last 7 days. A typical time needs at least 5 replies." : `Last 7 days, from ${fmtInt(reply.current.answered)} replies.`}
          spark={<PulseSpark points={reply.points.map((p) => ({ label: p.day, value: p.value, note: p.window }))} label="Typical first reply, last 7 days" format={replyWords} />} />
        <PulseTile testId="pulse-appointments" label="Appointments to mark" usual={blockedAppts ? null : noUsual}
          value={blockedAppts ? "Not available" : fmtInt(t.totals.appointments.count)}
          sub={blockedAppts ? "Needs permission: reconnect." : t.totals.appointments.count === 0 ? "Every past appointment has an outcome." : oldestAppt !== null ? `The oldest started ${ageWords(Math.max(0, (now - oldestAppt) / 60_000))} ago.` : null} />
        <PulseTile testId="pulse-risk" label="Open pipeline at risk" usual={staleUsual(t.pulse.stale)}
          value={t.totals.stale.dollars ? fmtMoney(t.totals.stale.dollars) : "$0"}
          sub={t.totals.stale.count === 0 ? "No open deal has gone quiet." : `${fmtInt(t.totals.stale.count)} open ${t.totals.stale.count === 1 ? "deal has" : "deals have"} not moved in ${t.staleDays}+ days.`} />
      </section>

      <FixFirstQueue rows={shownRows} onShow={(r: QueueRow) => open({ kind: null, row: r.key })} title="Fix first"
        empty={rows.length === 0 ? "Nothing needs fixing right now." : "Nothing of this kind needs fixing right now."} />

      <section className="mb-9 border-t pt-6" aria-labelledby="where-h" data-testid="today-charts">
        <h2 id="where-h" className="mb-4 text-base font-semibold">Where the work is</h2>
        {slices.length === 0 ? (
          <EmptyState compact title="Nothing to chart yet" body={blockedLeads || blockedAppts ? "Some figures cannot be counted until a permission is approved, so the charts would be incomplete." : "Nothing needs attention right now, so there is nothing to split up."} />
        ) : (
          <div className="grid grid-cols-1 gap-x-14 gap-y-9 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <DonutChart title={donutTitle(t.totals)} slices={slices} selected={focus.row ? null : focus.kind} onSelect={onSlice} used={used.donut}
              hint="Click a slice or a name to see exactly what is in it." />
            <AccountBars title={barsTitle(bars)} bars={bars.bars} rows={rows} selected={picked.length === 1 ? picked[0] : null} onSelect={onBar} used={used.bars} />
          </div>
        )}
        <div ref={listRef} className="mt-6">
          {listKind && <RowsPanel title={listTitle} count={listCount} noun={NOUN[listKind]} items={listItems} onClose={clearFocus} />}
          {listKind && listCount > listItems.length && <p className="mt-2 text-xs text-muted-foreground" data-testid="today-list-capped">The list shows the first {listItems.length} of {fmtInt(listCount)}. Open the account to see the rest.</p>}
        </div>
      </section>

      <Section id="needs-you" title="Accounts needing you" hint="One reason each, the most valuable first. Open one in your CRM, or narrow Today to it.">
        {needing.rows.length === 0 ? (
          <EmptyState compact title="No client account needs you" body="Every account is on track against its own usual." />
        ) : (
          <ul className="divide-y border-y" data-testid="needing-you">
            {needing.rows.map((a) => (
              <li key={a.locationId} className="ds-row grid items-center gap-x-5 gap-y-1.5 py-3 md:grid-cols-[minmax(0,1.1fr)_9rem_minmax(0,2fr)_auto]" data-testid="needing-row">
                <p className="break-words font-semibold">{a.name}</p>
                <p className="text-sm"><Badge tone={a.state === "Needs you now" ? "bad" : a.state === "Needs a look" ? "warn" : "neutral"}>{a.state}</Badge></p>
                <p className="min-w-0 break-words text-sm text-muted-foreground">{a.reason}{a.count > 1 && <span> and {a.count - 1} more things</span>}{a.dollars ? <span>. {money(a.dollars)} at stake.</span> : null}</p>
                <div className="flex flex-wrap items-center gap-x-1 md:justify-end">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="ds-press inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">Open in CRM<ExternalLink aria-hidden className="size-3.5" /><span className="sr-only"> ({a.name}, opens in a new tab)</span></a>
                  <button type="button" onClick={() => changeAccounts([a.locationId])} className="ds-press min-h-9 rounded-lg px-2.5 text-sm text-muted-foreground underline-offset-4 hover:bg-muted hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring)]">Only this account</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {needing.total > 5 && <div className="mt-2"><Btn variant="ghost" onClick={() => setAllAccounts(!allAccounts)}>{allAccounts ? "Show the top 5" : `All ${needing.total} accounts`}</Btn></div>}
      </Section>

      {t.proof && (
        <section className="mb-4 border-t pt-6" aria-labelledby="caught-h" data-testid="today-proof">
          <h2 id="caught-h" className="mb-4 text-base font-semibold">For your next client review</h2>
          <div className="grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <ProofStrip proof={t.proof} />
            <RaisedClearedStrip proof={t.proof} selected={day} onSelect={setDay} />
          </div>
        </section>
      )}
    </Page>
  );
}
