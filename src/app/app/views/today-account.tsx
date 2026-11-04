"use client";

import { CalendarCheck, CircleCheck, ExternalLink, Phone, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { AccessKind } from "@/lib/access";
import { ageWords, headlineOf, replyWords, shareText, vsUsual, type HeadlineAction, type QueueRow, type TodayItem } from "@/lib/analytics/today-queue";
import { judge } from "@/lib/analytics/speed-intel";
import { leadsSpec } from "@/lib/analytics/today-records";
import { pointEnd, specAlerts, specComing, specInsight, specKind, specReplies, specRow, specSince, specThings } from "@/lib/analytics/today-specs";
import type { TodayData, TodayPerson } from "@/lib/analytics/today-types";
import type { GoFn } from "../nav";
import { ComingBlock, EmptyState, FixFirstQueue, HeadlineBlock, InlineAlert, InsightStrip, ModuleTabs, Page, ProofStrip, PulseSpark, PulseTile, RaisedClearedStrip, Section, SinceStrip } from "../ds";
import { Btn, fmtInt } from "../ui";
import { TodayLayers, useTodayModel } from "./today-model";
import { CoverageTab, HeadlineControls, PeopleTab, SourcesTab } from "./today-parts";


// Today for ONE account: a business, a setter, a client's staff. They never see other accounts, fees, settings or plan information (the server sends none of it, and
// reads only their own account whatever the address says). It answers "what do I do now?": the leads to answer with a clock running, the calls to make, today's and
// tomorrow's appointments, this week's numbers against their own usual, and a plain "done for today" when there is nothing left.

const big = "ds-press inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-base font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] active:translate-y-px";

function Waiting({ items, now }: { items: TodayItem[]; now: number }) {
  const [all, setAll] = useState(false);
  const sorted = [...items].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const shown = all ? sorted.slice(0, 30) : sorted.slice(0, 8);
  return (
    <>
      <ul className="divide-y border-y" data-testid="my-leads">
        {shown.map((l) => (
          <li key={l.id} className="ds-row flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="break-words text-base font-semibold">{l.name}</p>
              <p className={`flex items-center gap-1.5 text-sm ${l.never ? "text-destructive" : "text-muted-foreground"}`} data-testid="lead-wait">
                <TriangleAlert aria-hidden className="size-4 shrink-0" />
                {l.never ? "Never answered" : `Waiting ${ageWords(Math.max(0, (now - (l.at ?? now)) / 60_000))}`}
              </p>
            </div>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className={big} data-testid="lead-open">Open in CRM<ExternalLink aria-hidden className="size-4" /><span className="sr-only"> ({l.name}, opens in a new tab)</span></a>
          </li>
        ))}
      </ul>
      {sorted.length > 8 && <div className="mt-2"><Btn variant="ghost" onClick={() => setAll(!all)}>{all ? "Show the first 8" : `See all ${sorted.length}`}</Btn></div>}
    </>
  );
}

function CallRow({ name, sub, url, dnd, phone }: { name: string; sub?: string; url: string; dnd?: boolean; phone: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5" data-testid="call-row" data-dnd={dnd ? "true" : "false"}>
      <div className="min-w-0 flex-1 basis-44"><p className="break-words font-medium">{name}</p>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div>
      {dnd
        ? <button type="button" disabled title="This person asked not to be contacted." className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-lg border px-4 text-sm font-medium text-muted-foreground opacity-70"><Phone aria-hidden className="size-4" />Do not call</button>
        : phone
          ? <a href={url} target="_blank" rel="noopener noreferrer" className="ds-press inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"><Phone aria-hidden className="size-4" />Call in your CRM<span className="sr-only"> ({name}, opens in a new tab)</span></a>
          : <a href={url} target="_blank" rel="noopener noreferrer" className="ds-press inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-medium hover:border-primary/40">Open in CRM (no phone number)</a>}
    </li>
  );
}

function CallGroup({ title, total, children, testId }: { title: string; total: number; children: React.ReactNode; testId: string }) {
  if (total === 0) return null;
  return (
    <div className="mb-5" data-testid={testId}>
      <h3 className="text-sm font-semibold">{title} <span className="tnum text-muted-foreground">({total})</span></h3>
      <ul className="mt-1 divide-y border-y">{children}</ul>
    </div>
  );
}

const stamp = (p: TodayPerson, zone: string) => {
  try { return new Date(p.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: zone }); } catch { return new Date(p.at).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }); }
};

export function TodayAccount({ go, data: t, kind, reload, sync, syncing }: { go: GoFn; data: TodayData; kind: AccessKind; reload: () => Promise<void>; sync: () => Promise<void>; syncing: boolean }) {
  const m = useTodayModel({ t, kind, reload });
  const { view, env, now } = m;
  const mine = t.mine;
  const [onlyUnmarked, setOnlyUnmarked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [day, setDay] = useState<number | null>(null);
  const headline = headlineOf({ scope: "account", rows: view.queue, totals: view.totals, outlier: view.outlier });
  const leads = view.items.filter((i) => i.kind === "leads");
  const alsoRows = view.queue.filter((r) => r.kind !== "leads");
  const onPart = (a: HeadlineAction) => m.open(a === "dollars" ? specKind("stale", env) : specThings(env));
  const name = t.accounts[0]?.name ?? "My day";
  const calls = mine?.calls;
  const callTotal = (calls?.newLeads.total ?? 0) + (calls?.noshows.total ?? 0) + (calls?.confirm.total ?? 0);
  const appts = mine ? [...mine.appointments.today.map((p) => ({ p, day: "Today" })), ...mine.appointments.tomorrow.map((p) => ({ p, day: "Tomorrow" }))] : [];
  const apptsShown = onlyUnmarked ? appts.filter((a) => a.p.noOutcome) : appts;
  const unmarkedHere = appts.filter((a) => a.p.noOutcome).length;
  const done = headline.allClear && callTotal === 0 && !t.access.leadsBlocked && !t.access.apptsBlocked;

  const copy = async () => {
    const extra = [calls ? `${callTotal} ${callTotal === 1 ? "call" : "calls"} to make` : null, appts.length ? `${appts.length} ${appts.length === 1 ? "appointment" : "appointments"} today and tomorrow` : null].filter(Boolean).join(", ");
    const text = shareText({ who: name, headline, rows: view.queue }) + (extra ? `\n${extra}.` : "");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt("Copy this summary", text); }
  };

  const n = mine?.numbers;
  const show = n ? vsUsual({ now: n.showRate.now, usual: n.showRate.usual, nNow: n.showRate.nNow, nUsual: n.showRate.nUsual, minN: n.showRate.minN, lowerIsBetter: false, fmt: (x) => `${Math.round(x * 100)}%`, tolerance: 0.05 }) : null;
  const target = n ? vsUsual({ now: n.inTarget.now, usual: n.inTarget.usual, nNow: n.inTarget.nNow, nUsual: n.inTarget.nUsual, minN: 5, lowerIsBetter: false, fmt: (x) => `${Math.round(x * 100)}%`, tolerance: 0.05 }) : null;

  const insights = kind === "client" ? m.insights.filter((i) => i.key !== "idle_owner") : m.insights;
  const since = t.sinceVisit && (t.sinceVisit.newLeads.length + t.sinceVisit.breached.length + t.sinceVisit.answered.length + t.sinceVisit.clearedAlerts.length > 0) ? t.sinceVisit : null;
  const judgedIn = (days: number) => env.ledger.filter((l) => l.leadAt > now - days * 86_400_000 && l.leadAt <= now && judge(l, t.targetMinutes, now) !== null);
  const specTarget = () => { const rows = judgedIn(7).map(({ zone: _z, ...r }) => { void _z; return r; }); return leadsSpec(rows, now, { key: "in-target", title: "Leads this week, judged against the reply target", subtitle: `Leads of the last 7 days that were answered, or are past the ${t.targetMinutes}-minute target without an answer. The share is the ones answered inside the target.`, noun: rows.length === 1 ? "lead" : "leads", count: rows.length, exportName: "leads-this-week" }); };

  const overview = (
    <>
      {since && <SinceStrip since={since} showAlerts={kind === "business"} onOpen={(k) => m.open(specSince(k, since, env))} />}
      {done && (
        <section className="mb-9 flex flex-wrap items-center gap-x-6 gap-y-3 border-b pb-8" aria-label="Done for today" data-testid="done-for-today">
          <CircleCheck aria-hidden className="size-14 shrink-0 text-success" />
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">Done for today</h2>
            <p className="mt-1 text-base text-muted-foreground" data-testid="streak">
              {mine && mine.numbers.streakDays > 0
                ? `${mine.numbers.streakDays} ${mine.numbers.streakDays === 1 ? "day" : "days"} in a row with every new lead answered inside ${t.targetMinutes} minutes.`
                : `Every lead has an answer. Keep each new one under ${t.targetMinutes} minutes.`}
            </p>
          </div>
        </section>
      )}

      {leads.length > 0 && (
        <Section id="my-leads" title={`My leads waiting (${fmtInt(view.totals.leads.count)})`} hint="The longest wait is first. The clock keeps counting while this page is open."
          action={<Btn variant="ghost" onClick={() => m.open(specKind("leads", env))} testId="leads-show-all">Show all {fmtInt(view.totals.leads.count)}</Btn>}>
          <Waiting items={leads} now={now} />
        </Section>
      )}

      {calls && callTotal > 0 && (
        <Section id="my-calls" title="Calls to make today" hint="Calls open the contact in your CRM, where you dial. Anyone who asked not to be contacted is shown as Do not call.">
          <CallGroup title="New leads nobody has answered" total={calls.newLeads.total} testId="calls-new">
            {calls.newLeads.rows.map((r) => <CallRow key={r.contactId} name={r.name} url={r.url} phone={r.hasPhone} />)}
          </CallGroup>
          <CallGroup title="No-shows to recover" total={calls.noshows.total} testId="calls-noshows">
            {calls.noshows.rows.map((p, i) => <CallRow key={`${p.contactId}-${i}`} name={p.name} sub={`Missed ${stamp(p, mine!.timeZone)}${p.calendar ? `, ${p.calendar}` : ""}`} url={p.url} dnd={p.dnd} phone={!!p.phone} />)}
          </CallGroup>
          <CallGroup title="Appointments to confirm" total={calls.confirm.total} testId="calls-confirm">
            {calls.confirm.rows.map((p, i) => <CallRow key={`${p.contactId}-${i}`} name={p.name} sub={`${stamp(p, mine!.timeZone)}${p.calendar ? `, ${p.calendar}` : ""}`} url={p.url} dnd={p.dnd} phone={!!p.phone} />)}
          </CallGroup>
        </Section>
      )}

      {mine && (
        <Section id="my-appts" title="My appointments today and tomorrow"
          hint={appts.length === 0 ? undefined : unmarkedHere > 0 ? `${unmarkedHere} of ${appts.length} have no outcome marked yet.` : "Every appointment that has passed has an outcome marked."}
          action={unmarkedHere > 0 ? <Btn variant="ghost" onClick={() => setOnlyUnmarked(!onlyUnmarked)}>{onlyUnmarked ? "Show all" : "Only those with no outcome"}</Btn> : undefined}>
          {apptsShown.length === 0 ? (
            <EmptyState compact title={appts.length === 0 ? "No appointments today or tomorrow" : "Nothing left with no outcome"} body={appts.length === 0 ? "New bookings appear here as they come in." : "Every appointment shown has an outcome marked."} />
          ) : (
            <ul className="divide-y border-y" data-testid="my-appts-list">
              {apptsShown.map(({ p, day: d }, i) => (
                <li key={`${p.contactId}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5" data-testid="my-appt" data-no-outcome={p.noOutcome ? "true" : "false"}>
                  <CalendarCheck aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 basis-44"><span className="font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{d}, {stamp(p, mine.timeZone).replace(/^\w+, /, "")}{p.calendar ? `, ${p.calendar}` : ""}</span></p>
                  {p.noOutcome && <span className="flex items-center gap-1.5 text-sm font-medium text-warning"><TriangleAlert aria-hidden className="size-4" />No outcome marked</span>}
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="min-h-9 rounded-lg px-2.5 py-1.5 text-sm text-primary underline-offset-4 hover:underline">Open in CRM<span className="sr-only"> ({p.name}, opens in a new tab)</span></a>
                </li>
              ))}
            </ul>
          )}
          {unmarkedHere > 0 && <div className="mt-2"><Btn variant="ghost" onClick={() => go("appointments")}>Mark outcomes in Appointments</Btn></div>}
        </Section>
      )}

      <InsightStrip insights={insights} onOpen={(i) => m.open(specInsight(i, env))} />

      {alsoRows.length > 0 && (
        <FixFirstQueue single rows={alsoRows} max={5} title="Also needs you" hint="Other things in this account, ranked by money at stake, then by how long they have been wrong."
          onShow={(r: QueueRow) => m.open(specRow(r, env))} empty="Nothing else needs you." assigned={m.assigned} whyOf={m.rowWhy} onAct={m.act} canAssign={m.canAssign} busyKey={m.busy} />
      )}

      <ComingBlock forecast={t.forecast} targetMinutes={t.targetMinutes} onOpen={(k) => m.open(specComing(k, t.forecast[k], t.targetMinutes))} />

      {n && (
        <section className="mb-9 border-t pt-6" aria-labelledby="my-numbers-h" data-testid="my-numbers">
          <h2 id="my-numbers-h" className="mb-1 text-base font-semibold">My numbers this week</h2>
          <p className="mb-5 text-xs text-muted-foreground">Each one is compared with the week before. A comparison shows only when there are enough leads or appointments behind it.</p>
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-3">
            <PulseTile testId="my-reply" label="Typical first reply" usual={n.reply.verdict} onOpen={n.reply.current.answered > 0 ? () => m.open(specReplies(env, now, 7, "Typical first reply, last 7 days")) : undefined} openLabel="Show the replies this is worked out from"
              value={n.reply.current.seconds === null ? `${fmtInt(n.reply.current.answered)} ${n.reply.current.answered === 1 ? "reply" : "replies"}` : replyWords(n.reply.current.seconds)}
              sub={n.reply.current.seconds === null ? "A typical time needs at least 5 replies." : `From ${fmtInt(n.reply.current.answered)} replies in 7 days.`}
              spark={<PulseSpark points={t.pulse.reply.points.map((p) => ({ label: p.day, value: p.value, note: p.window }))} label="Typical first reply, last 7 days" format={replyWords}
                onPoint={(i) => m.open(specReplies(env, pointEnd(t.pulse.reply.points[i].day, now), 7, `Typical first reply, 7 days to ${t.pulse.reply.points[i].day}`))}
                pointInfo={(i) => { const end = pointEnd(t.pulse.reply.points[i].day, now); const c = env.ledger.filter((l) => l.touchAt !== null && l.leadAt > end - 7 * 86_400_000 && l.leadAt <= end).length; return c > 0 ? { open: true, text: `Click to see the ${c} replies behind it.` } : { open: false, text: "SubSync no longer holds the leads behind this point." }; }} />} />
            <PulseTile testId="my-showrate" label="Show rate" usual={show} onOpen={() => go("appointments")} openLabel="Open Appointments to see the appointments behind this"
              value={n.showRate.now === null ? "Not enough yet" : `${Math.round(n.showRate.now * 100)}%`}
              sub={n.showRate.now === null ? `Needs ${n.showRate.minN} appointments with an outcome marked. ${n.showRate.nNow} so far.` : `Of ${n.showRate.nNow} appointments with an outcome, last 30 days.`} />
            <PulseTile testId="my-intarget" label="Leads answered inside the target" usual={target} onOpen={judgedIn(7).length > 0 ? () => m.open(specTarget()) : undefined} openLabel="Show the leads this share is worked out from"
              value={n.inTarget.now === null ? "Not enough yet" : `${Math.round(n.inTarget.now * 100)}%`}
              sub={n.inTarget.now === null ? `Needs 5 leads past their target. ${n.inTarget.nNow} so far.` : `Of ${n.inTarget.nNow} leads this week. The target is ${t.targetMinutes} minutes.`} />
          </div>
        </section>
      )}

      {kind === "business" && t.proof && (
        <section className="mb-4 border-t pt-6" aria-labelledby="caught-h" data-testid="today-proof">
          <h2 id="caught-h" className="mb-4 text-base font-semibold">What SubSync caught in your account</h2>
          <div className="grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <ProofStrip proof={t.proof} title="The last 7 days" onOpen={(k) => m.open(specAlerts(t.proof!, k))} />
            <RaisedClearedStrip proof={t.proof} selected={day} onSelect={setDay} onOpenDay={(i) => m.open(specAlerts(t.proof!, { day: i }))} />
          </div>
        </section>
      )}
    </>
  );

  return (
    <Page title="Today" subtitle="Leads to answer, calls to make and appointments to mark, most urgent first."
      actions={<><Btn variant="ghost" onClick={copy}>{copied ? "Copied to your clipboard" : "Share my day"}</Btn><Btn onClick={sync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</Btn></>}>
      <HeadlineBlock headline={headline} onPart={onPart}>
        {t.access.leadsBlocked && <InlineAlert tone="warning" className="mt-3">Needs permission: replies cannot be timed until the conversations permission is approved. Ask the person who manages SubSync.</InlineAlert>}
        {t.access.apptsBlocked && <InlineAlert tone="warning" className="mt-3">Needs permission: appointments cannot be checked until the calendar permission is approved.</InlineAlert>}
        <HeadlineControls m={m} staleCount={t.totals.stale.count} />
        {!t.actionsReady && <p className="mt-2 text-xs text-muted-foreground" data-testid="needs-update">Done and Snooze need the latest database update. Everything else works.</p>}
      </HeadlineBlock>
      {kind === "business" ? (
        <ModuleTabs label="Today views" tabs={[
          { label: "Overview", node: overview },
          { label: "People", node: <PeopleTab m={m} t={t} agency={false} /> },
          { label: "Sources", node: <SourcesTab m={m} t={t} /> },
          { label: "Coverage", node: <CoverageTab m={m} t={t} /> },
        ]} />
      ) : overview}
      <TodayLayers m={m} />
      <button type="button" onClick={() => void reload()} className="sr-only">Refresh Today</button>
    </Page>
  );
}
