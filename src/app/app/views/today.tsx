"use client";

import type { GoFn } from "../nav";
import { useState } from "react";
import { useApiClient, useData } from "../session";
import { CardRange, DataList, DefinitionTip, EmptyState, HowTo, InlineAlert, Page, Section, SkeletonCards, SkeletonRows, Sparkline, useCardRange } from "../ds";
import { Badge, Btn, ErrorBox, ExtLink, fmtInt, fmtMoney, Stat, type Tone } from "../ui";
import {
  appointmentsLine, attentionLine, auditPick, chooseFirst, describeRangeChange, leadsLine, summaryText, todaySubtitle, UP_IS_BAD, type First, type RangeChange, type Scope,
} from "@/lib/analytics/today-intel";
import type { Audit } from "@/lib/analytics/audit-intel";

// Today, the front door (stage F5). The first screen answers "what needs me right now" in plain words, in the order a lead goes cold: leads waiting for a
// reply, appointments to fix, then what else needs a person. Every figure is the number its own page shows (Speed to lead, Appointments, the Account audit);
// the sentences come from src/lib/analytics/today-intel.ts, which is unit tested. One status line (the shell's) says how fresh the data is: Today says nothing
// about how old the data is. What SubSync watches, and what it does not yet, lives in Settings.

type Daily = {
  readLimit?: string | null;
  connection: { ok: boolean; message: string | null };
  headlines: Array<{ key: string; change: { unusual: "up" | "down" | null } }>;
  attention: Array<{ locationId: string; name: string; severity: "critical" | "warning" | "info"; url: string; items: Array<{ kind: string; title: string; detail: string }> }>;
  fine: Array<{ locationId: string; name: string; checked: string[]; learning: boolean }>;
  accounts: number;
  limited: boolean;
};
type Access = { ok: number; total: number; needsPermission?: unknown[] };
type Speed = { overall: { stillWaiting: number }; neverAnswered?: number; access: Access };
type Appts = { unmarkedTotal?: number; access?: Access };
// Every account is waiting on a permission (not "not read yet"): only then is a zero not a real zero.
const needsPermission = (a: Access | undefined) => Boolean(a && a.total > 0 && a.ok === 0 && (a.needsPermission?.length ?? 0) === a.total);
type AuditData = { audit: Pick<Audit, "findings" | "outlier" | "notes"> };
type Changes = { from: string; to: string; accounts: number; changes: RangeChange[] };

// The card for "what changed" opens on the last 7 days; the person can widen it, and the choice is kept in the address and in this browser (KF-4).
const CHANGES_RANGE = { preset: "7d", compare: "none" } as const;

const tone = (s: string): Tone => (s === "critical" ? "bad" : s === "warning" ? "warn" : "info");
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const toAttention = () => document.getElementById("needs-attention")?.scrollIntoView({ behavior: "smooth", block: "start" });

// The tile's way into the page that holds the same figure; each button says where it goes (N7).
const TILE_LINK: Record<string, { label: string; view: Parameters<GoFn>[0] }> = {
  openValue: { label: "Open Pipeline and deals", view: "pipeline" },
  stale: { label: "Open stale deals", view: "deals" },
  new30: { label: "Open People", view: "people" },
  unread: { label: "Open Unanswered messages", view: "inbox" },
};

function FrontDoor({ go, scope, leads, lines, first, next, blocked, allClear, permission, myDay = false }: {
  go: GoFn; scope: Scope; leads: string; lines: { appointments: string; attention: string; unmarked: number; attentionCount: number };
  first: First | null; next: First | null; blocked: boolean; allClear: boolean; permission: React.ReactNode; myDay?: boolean;
}) {
  const urgent = first?.key === "leads";
  const press = (f: First) => (f.view === "today" ? toAttention() : go(f.view as Parameters<GoFn>[0]));
  return (
    <section className="mb-8 border-y py-5" aria-label="What needs you right now" data-testid="front-door">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What needs you right now</p>
      <h2 className={`mt-1 text-xl font-semibold ${urgent ? "text-destructive" : ""}`} data-testid="leads-headline">{leads}</h2>
      {blocked && permission}

      {first && (
        urgent ? (
          <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="do-first">
            <Btn variant="primary" onClick={() => press(first)}>{first.button}</Btn>
            <span className="text-sm text-muted-foreground">The longest wait is first.</span>
          </div>
        ) : (
          <div className="mt-4 border-l-2 border-primary pl-4" data-testid="do-first">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Do this first</p>
            <p className="mt-1 text-base font-medium">{first.text}</p>
            {first.detail && <p className="mt-1 text-sm text-muted-foreground">{first.detail}</p>}
            {first.note && <p className="mt-1 text-xs"><DefinitionTip term="How this is counted">{first.note}</DefinitionTip></p>}
            <div className="mt-3"><Btn variant="primary" onClick={() => press(first)}>{first.button}</Btn></div>
          </div>
        )
      )}
      {allClear && <p className="mt-3 text-sm text-muted-foreground" data-testid="all-clear">You are all caught up. If something needs you, it shows up here first.</p>}

      <ul className="mt-5 space-y-2 border-t pt-4 text-sm">
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>{lines.appointments}</span>
          {lines.unmarked > 0 && <Btn variant="ghost" onClick={() => go("appointments")}>Fix appointments</Btn>}
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2">
          <span>{lines.attention}</span>
          {lines.attentionCount > 0 && <Btn variant="ghost" onClick={toAttention}>{scope === "account" ? "See what" : "See which"}</Btn>}
        </li>
        {myDay && (
          <li className="flex flex-wrap items-center justify-between gap-2" data-testid="front-door-myday">
            <span className="text-muted-foreground">On a phone, or working your own list? My day shows the same leads and appointments as one short list.</span>
            <Btn variant="ghost" onClick={() => go("myday")}>Open My day</Btn>
          </li>
        )}
        {next && (
          <li className="flex flex-wrap items-center justify-between gap-2" data-testid="front-door-next">
            <span>{next.text}{next.note && <> <DefinitionTip term="How this is counted">{next.note}</DefinitionTip></>}</span>
            <Btn variant="ghost" onClick={() => press(next)}>{next.button}</Btn>
          </li>
        )}
      </ul>
    </section>
  );
}

// One deal worth at least half of the open pipeline is called out, so the dollar figures are not read as a normal spread.
function OutlierNote() {
  const { data } = useData<{ kpis: { outlier: { value: number; share: number; of: number } | null } }>("overview");
  const o = data?.kpis.outlier;
  if (!o) return null;
  return <InlineAlert tone="warning" className="mb-4">One deal ({fmtMoney(o.value)}) is {Math.round(o.share * 100)}% of the open pipeline of {fmtInt(o.of)} deals, so the dollar figures move with it. Amounts are as entered in each account.</InlineAlert>;
}

// "What changed": the four headline figures, compared with the day before the window the card names (KF-4). A percentage appears only when the earlier
// figure is large enough to measure against (N6); below that the plain difference is shown and says why.
function Changes({ go, unusual }: { go: GoFn; unusual: Map<string, "up" | "down" | null> }) {
  const range = useCardRange("today-changes", CHANGES_RANGE);
  const r = range.resolved;
  const changes = useData<Changes>(r ? `daily/changes?from=${r.current.from}&to=${r.current.to}` : null);
  return (
    <Section title="What changed" hint="Each figure is compared with its value on the day before the window starts. Press a figure's link to see what is behind it."
      action={<CardRange state={range} label="What changed" compares={["none"]} maxDays={366} />}>
      <OutlierNote />
      {(!r || (changes.loading && !changes.data)) && <SkeletonCards cards={4} label="Working out what changed..." />}
      {changes.error && <InlineAlert tone="danger" className="mb-3" action={<Btn onClick={() => void changes.reload()}>Try again</Btn>}>{changes.error.message}</InlineAlert>}
      {changes.data && changes.data.changes.length === 0 && (
        <EmptyState compact title="No history to compare yet" body="SubSync records these figures once a day, so a comparison appears from the second day." />
      )}
      {changes.data && changes.data.changes.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="change-tiles">
          {changes.data.changes.map((c) => {
            const fmt = c.money ? fmtMoney : fmtInt;
            const flag = unusual.get(c.key) ?? null;
            const bad = flag !== null && (flag === "up") === UP_IS_BAD.has(c.key);
            const link = TILE_LINK[c.key];
            return (
              <div key={c.key} data-testid={`tile-${c.key}`}>
                <Stat label={c.label} value={fmt(c.now)} tone={flag ? (bad ? "bad" : "good") : undefined}
                  sub={<>
                    {describeRangeChange(c, fmt)}
                    {!c.coversWindow && c.thenDay && <><br />SubSync has watched only since {shortDay(c.thenDay)}.</>}
                    {flag && <><br /><strong>Unusual: {flag === "up" ? "higher" : "lower"} than normal</strong></>}
                  </>} />
                {c.points.length >= 4 && r && <div className="mt-1 px-1"><Sparkline values={c.points} label={`${c.label}, ${r.current.label}`} min={4} format={fmt} /></div>}
                {link && <button type="button" onClick={() => go(link.view)} className="mt-1 min-h-9 px-1 text-xs font-medium text-primary underline-offset-2 hover:underline">{link.label}</button>}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

export function TodayView({ go }: { go: GoFn }) {
  const api = useApiClient();
  const daily = useData<Daily>("daily");
  const speed = useData<Speed>("speed");
  const appts = useData<Appts>("appointments");
  // The audit is read without the rows behind each number (lists=0): Today needs only its first finding.
  const audit = useData<AuditData>("audit?lists=0");
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState(false);
  const sync = async () => {
    setSyncing(true);
    try { await api.post("sync"); await Promise.all([daily.reload(), speed.reload(), appts.reload(), audit.reload()]); } finally { setSyncing(false); }
  };

  const d = daily.data;
  const single = d ? d.limited || d.accounts === 1 : false;
  const scope: Scope = single ? "account" : "all";
  const name = d ? d.attention[0]?.name ?? d.fine[0]?.name ?? null : null;
  const waiting = speed.data ? Math.max(0, speed.data.overall.stillWaiting - (speed.data.neverAnswered ?? 0)) : null;
  const never = speed.data?.neverAnswered ?? 0;
  // Replies cannot be timed until the conversations permission is approved: "no leads waiting" would be a false all-clear.
  const blocked = needsPermission(speed.data?.access);
  // Calendars that cannot be read are not "no problems": the line says so instead of claiming every appointment is fine.
  const apptBlocked = needsPermission(appts.data?.access);
  const unmarked = apptBlocked ? null : appts.data?.unmarkedTotal ?? null;
  const attentionCount = d ? d.attention.length : null;
  const leads = leadsLine({ waiting, never, loading: speed.loading, blocked });
  const auditData = audit.data?.audit ?? null;
  const ready = Boolean(d) && !speed.loading && !appts.loading && !audit.loading;
  const first = blocked ? null : chooseFirst({ waiting, never, unmarked, attention: attentionCount, scope, audit: auditData });
  const shownFirst = first && (first.key === "leads" || !audit.loading) ? first : null;
  const nextPick = shownFirst?.key === "leads" ? auditPick(auditData) : null;
  const next = nextPick && nextPick.key !== "unmarked" && nextPick.key !== "permission" ? nextPick : null;
  const lines = { appointments: appointmentsLine(unmarked, apptBlocked), attention: attentionLine(attentionCount, scope), unmarked: unmarked ?? 0, attentionCount: attentionCount ?? 0 };
  const allClear = ready && !blocked && shownFirst === null && (d?.accounts ?? 0) > 0 && waiting === 0 && never === 0 && unmarked === 0 && attentionCount === 0;

  const copy = async () => {
    const text = summaryText({ who: single ? name ?? "Your account" : "Your client accounts", leads, appointments: lines.appointments, attention: lines.attention, first: shownFirst });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };
  const permission = (
    <InlineAlert tone="warning" className="mt-3" action={<Btn onClick={() => go("settings")}>Open Settings</Btn>}>
      Replies cannot be timed yet because a permission has not been approved, so SubSync does not say that nothing is waiting. Ask the person who manages SubSync to approve it.
    </InlineAlert>
  );

  // The leads line does not wait for the slower daily read: it appears as soon as its own number arrives.
  if (daily.loading && !d) return (
    <Page title="Today" subtitle={todaySubtitle("all", null)}>
      <FrontDoor go={go} scope="all" leads={leads} lines={lines} first={shownFirst} next={null} blocked={blocked} allClear={false} permission={permission} />
      <SkeletonRows rows={4} label="Working out what needs you today..." />
    </Page>
  );
  if (daily.error) return <ErrorBox error={daily.error} onRetry={daily.reload} />;
  if (!d) return null;

  if (d.accounts === 0) {
    return (
      <Page title="Today" subtitle={todaySubtitle("all", null)} actions={<Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn>}>
        <EmptyState title="SubSync has not found any client accounts yet" body="The first read takes a few minutes after SubSync is installed. Press Sync now, or follow the steps in Getting started." action={<Btn variant="primary" onClick={() => go("help")}>Open Getting started</Btn>} />
      </Page>
    );
  }

  const unusual = new Map(d.headlines.map((h) => [h.key, h.change.unusual] as [string, "up" | "down" | null]));
  const noun = single ? "this account" : "your client accounts";
  const accountPage = d.limited ? "overview" : "account";

  return (
    <Page title="Today" subtitle={todaySubtitle(scope, name)}
      actions={<><Btn variant="ghost" onClick={copy}>{copied ? "Copied" : "Copy summary"}</Btn><Btn variant="primary" onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn></>}>
      <HowTo id="today-how" title="How to use Today" action={<Btn variant="ghost" onClick={() => go("help")}>Open Getting started</Btn>}>
        Read the large sentence first and press the button under it. Below are the other things that need a person, then what changed. What SubSync watches, and what it does not yet, is listed in Settings.
      </HowTo>

      {!d.connection.ok && <InlineAlert tone="danger" className="mb-4">{d.connection.message}</InlineAlert>}
      {d.readLimit && <div className="mb-4" data-testid="read-limit"><InlineAlert tone="info">{d.readLimit}</InlineAlert></div>}

      <FrontDoor go={go} scope={scope} leads={leads} lines={lines} first={shownFirst} next={next} blocked={blocked} allClear={allClear} permission={permission} myDay={d.limited} />

      <Section id="needs-attention" title={d.attention.length ? `Needs attention today (${d.attention.length})` : "Needs attention today"}
        hint={single ? "What to look at in this account, most important first." : "The client accounts that need a person, most important first."}>
        {d.attention.length === 0 ? (
          <EmptyState compact title="Nothing needs you today" body={`${noun[0].toUpperCase() + noun.slice(1)} ${single ? "is" : "are"} all within ${single ? "its" : "their"} own normal range. Replies, deals, new leads and setup were all checked.`} />
        ) : (
          <ul className="divide-y border-y" data-testid="attention-list">
            {d.attention.map((a, i) => (
              <li key={a.locationId} className="py-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {!single && <span className="tnum text-sm text-muted-foreground">{i + 1}.</span>}
                  {!single && <span className="font-medium">{a.name}</span>}
                  <Badge tone={tone(a.severity)}>{a.severity === "critical" ? "Do first" : a.severity === "warning" ? "Soon" : "When you can"}</Badge>
                </div>
                <ul className={`space-y-2 ${single ? "" : "pl-6"}`}>
                  {a.items.map((it) => (
                    <li key={it.kind} className="text-sm"><span className="font-medium">{it.title}.</span> <span className="text-muted-foreground">{it.detail}</span></li>
                  ))}
                </ul>
                <div className={`mt-3 flex flex-wrap items-center gap-3 ${single ? "" : "pl-6"}`}>
                  {single
                    ? <Btn onClick={() => go(accountPage, a.locationId)}>Open the full account page</Btn>
                    : <Btn onClick={() => go("today", a.locationId)}>Open this account&apos;s Today</Btn>}
                  <ExtLink href={a.url}>Open in your CRM</ExtLink>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3"><Btn variant="ghost" onClick={() => go("alerts")}>See every open alert and dismiss resolved ones</Btn></div>
      </Section>

      <Changes go={go} unusual={unusual} />

      {d.fine.length > 0 && (
        <Section title={`Fine today (${d.fine.length})`} hint={`Checked for each: ${d.fine[0].checked.join(", ")}.`}>
          <DataList rows={d.fine} rowKey={(f) => f.locationId} caption="Client accounts that are fine today" onOpen={single ? undefined : (f) => go("today", f.locationId)}
            columns={[
              { key: "name", header: "Client account", primary: true, width: "minmax(0,1fr)", cell: (f) => f.name },
              { key: "why", header: "Status", width: "minmax(0,2fr)", cell: (f) => <span className="text-muted-foreground">{f.learning ? "Nothing wrong, but still learning what is normal here (less than a week of history)" : "Nothing unusual compared with its last week"}</span> },
            ]} />
        </Section>
      )}
    </Page>
  );
}
