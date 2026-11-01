"use client";

import { useState } from "react";
import { waitLabel } from "@/lib/design/ui-logic";
import { useData } from "../session";
import type { GoFn } from "../nav";
import { BarChart, CardRange, DataList, DefinitionTip, DrillPanel, EmptyState, HowTo, InlineAlert, LeadDrawer, Page, useCardRange, useDrill, type Column, type LeadSeed } from "../ds";
import { compareWeeks, totalsOf, weekBars, weeksIn, type TrendMember, type TrendWeekData } from "@/lib/design/trend-bars";
import { Badge, Btn, Card, ErrorBox, ExtLink, fmtInt, Loading, Stat, Table, Td, Th, type Tone } from "../ui";

type Summary = { leads: number; answered: number; withinTarget: number; answeredLate: number; stillWaiting: number; hitRate: number | null; medianSeconds: number | null; p90Seconds: number | null };
type Waiting = { locationId: string; locationName: string; contactId: string; name: string; waitingMinutes: number; url: string; unassigned?: boolean; neverAnswered?: boolean };
type Data = {
  targetMinutes: number; windowDays: number;
  access: { ok: number; needsPermission: Array<{ locationId: string; name: string }>; total: number };
  overall: Summary;
  bySource?: Array<Summary & { cls: "portal" | "meta" | "form" | "social" | "other"; targetMinutes: number }>;
  unassignedWaiting?: number;
  trend?: TrendWeekData[];
  neverAnswered?: number;
  leftOut?: Array<{ reason: string; label: string; n: number }>;
  perAccount: Array<Summary & { locationId: string; name: string; access: string | null }>;
  people: Array<{ userId: string; label: string; replies: number; medianSeconds: number }>;
  waiting: Waiting[];
};

const dur = (s: number | null) => {
  if (s === null) return "none";
  if (s < 60) return `${s} sec`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${Math.floor(h / 24)} d ${h % 24} h`;
};
const pct = (n: number | null) => (n === null ? "n/a" : `${Math.round(n * 100)}%`);
const rateTone = (n: number | null): Tone => (n === null ? "neutral" : n >= 0.8 ? "good" : n >= 0.5 ? "warn" : "bad");

// The waiting list: ten rows and "View all", each name opens the lead in the side panel (stage D0 components).
const columns = (): Array<Column<Waiting>> => [
  { key: "name", header: "Lead", primary: true, width: "minmax(0,2fr)", cell: (w) => w.name },
  { key: "account", header: "Client account", width: "minmax(0,1.5fr)", cell: (w) => <span className="text-muted-foreground">{w.locationName}</span> },
  { key: "wait", header: "Waiting", width: "11rem", cell: (w) => <Badge tone="bad">{w.neverAnswered ? "never answered" : "waiting"} {waitLabel(w.waitingMinutes)}</Badge> },
  { key: "owner", header: "Owner", width: "6rem", cell: (w) => (w.unassigned ? <Badge tone="warn">no owner</Badge> : <span className="text-muted-foreground">assigned</span>) },
  { key: "open", header: "", width: "7rem", align: "right", cell: (w) => <ExtLink href={w.url}>Open contact</ExtLink> },
];

// The leads behind one week of the trend chart: the rows of the list are the leads the bar counts (KF-6).
const statusTone: Record<TrendMember["status"], Tone> = { within: "good", late: "warn", waiting: "bad" };
const statusText: Record<TrendMember["status"], string> = { within: "answered in time", late: "answered late", waiting: "still waiting" };
const memberColumns: Array<Column<TrendMember>> = [
  { key: "name", header: "Lead", primary: true, width: "minmax(0,2fr)", cell: (m) => m.name },
  { key: "account", header: "Client account", width: "minmax(0,1.5fr)", cell: (m) => <span className="text-muted-foreground">{m.locationName}</span> },
  { key: "status", header: "What happened", width: "11rem", cell: (m) => <Badge tone={statusTone[m.status]}>{statusText[m.status]}{m.status === "waiting" ? ` ${waitLabel(m.minutes)}` : m.status === "late" ? ` after ${waitLabel(m.minutes)}` : ""}</Badge> },
  { key: "open", header: "", width: "7rem", align: "right", cell: (m) => <ExtLink href={m.url}>Open contact</ExtLink> },
];
const INITIAL_RANGE = { preset: "90d", compare: "none" } as const;

// How fast new leads get a first reply from a person. Replies from workflows and campaigns do not count.
export function SpeedView({ go }: { go: GoFn }) {
  const { data, error, loading, reload } = useData<Data>("speed");
  const [open, setOpen] = useState<number | null>(null);
  const drill = useDrill();
  const range = useCardRange("speed-trend", INITIAL_RANGE);
  if (loading && !data) return <Loading label="Timing first replies..." />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  const o = data.overall;
  // One plain sentence first: how many leads are waiting for a reply right now, and how many were missed.
  const never = data.neverAnswered ?? 0;
  const waitingNow = Math.max(0, o.stillWaiting - never);
  const headline = waitingNow === 0 && never === 0
    ? "No leads are waiting for a reply right now."
    : `${waitingNow} ${waitingNow === 1 ? "lead is" : "leads are"} waiting for a reply${never > 0 ? `, and ${never} ${never === 1 ? "was" : "were"} never answered` : ""}.`;
  const none = data.access.total > 0 && data.access.ok === 0;
  const seeds: LeadSeed[] = data.waiting.map((w) => ({ contactId: w.contactId, locationId: w.locationId, name: w.name, locationName: w.locationName, unassigned: w.unassigned, url: w.url, note: `${w.neverAnswered ? "Never answered" : "Waiting for a reply"} for ${waitLabel(w.waitingMinutes)}.` }));

  return (
    <Page title="Speed to lead" subtitle={`How long new leads wait for a first reply from a person. Target ${data.targetMinutes} minutes, last ${data.windowDays} days.`}>
      {data.access.needsPermission.length > 0 && (
        <InlineAlert tone="warning" className="mb-4">
          Reading the messages inside conversations needs a permission that {data.access.needsPermission.length === data.access.total ? "none of your accounts has" : `${data.access.needsPermission.length} of ${data.access.total} accounts have not`} approved yet
          ({data.access.needsPermission.slice(0, 3).map((a) => a.name).join(", ")}{data.access.needsPermission.length > 3 ? " and more" : ""}). Until then those accounts are left out, and nothing is guessed.
        </InlineAlert>
      )}

      {o.leads === 0 ? (
        <EmptyState title={none ? "Waiting for permission" : "No new leads to time yet"} body={none ? "Approve the new permissions when SubSync asks, then run a sync. First replies appear here after that." : "A lead appears here once a new contact has a conversation. Check back after the next sync."} action={<Btn onClick={() => go("help")}>Open Getting started</Btn>} />
      ) : (
        <>
          <HowTo id="speed" title="How to use this page" action={<button type="button" onClick={() => go("help")} className="text-xs font-medium text-primary underline">More in Getting started</button>}>
            Start at the top of the list: the longest wait is first. Tap a name to see the lead and step to the next one. Click a bar in the chart to see the leads behind it.
          </HowTo>
          <p className="mb-1 text-sm font-medium">{headline}</p>
          {waitingNow > 0 && <p className="mb-3 text-xs text-muted-foreground" data-testid="what-to-do">What to do: reply to the first leads in the list, then assign the ones with no owner.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={<DefinitionTip term="Typical first reply" label="How the typical reply is worked out">The middle of all first reply times: half of the leads were answered faster, half slower. It needs at least 5 replies.</DefinitionTip>} value={o.medianSeconds === null ? "Not enough data" : dur(o.medianSeconds)} sub={o.p90Seconds !== null ? `9 in 10 were answered within ${dur(o.p90Seconds)}` : "Needs at least 5 replies"} />
            <Stat label={`Answered within ${data.targetMinutes} min`} value={pct(o.hitRate)} tone={o.hitRate === null ? undefined : o.hitRate >= 0.8 ? undefined : "warn"} sub={`${fmtInt(o.withinTarget)} of ${fmtInt(o.withinTarget + o.answeredLate + o.stillWaiting)} leads`} />
            <Stat label="Waiting right now" value={fmtInt(Math.max(0, o.stillWaiting - (data.neverAnswered ?? 0)))} tone={o.stillWaiting - (data.neverAnswered ?? 0) > 0 ? "bad" : undefined} sub={(data.neverAnswered ?? 0) > 0 ? `past the target, under 3 days old. Plus ${data.neverAnswered} never answered (older than 3 days)` : "no person has replied, past the target"} />
            <Stat label="Answered late" value={fmtInt(o.answeredLate)} sub="a person replied, after the target" />
          </div>

          {(data.leftOut ?? []).length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {fmtInt((data.leftOut ?? []).reduce((s, x) => s + x.n, 0))} new contacts were not counted as leads: {(data.leftOut ?? []).map((x) => `${fmtInt(x.n)} ${x.label}`).join(", ")}.
            </p>
          )}

          {data.waiting.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 text-base font-semibold">Leads waiting or missed ({o.stillWaiting})</h2>
              <p className="mb-2 text-xs text-muted-foreground">Longest waiting first. Tap a name to see the lead.</p>
              <DataList rows={data.waiting} columns={columns()} rowKey={(w) => w.locationId + w.contactId} onOpen={(_, i) => setOpen(i)} caption="Leads waiting or missed"
                copyText={(w) => `${w.name}, ${w.locationName}, ${w.neverAnswered ? "never answered" : "waiting"} ${waitLabel(w.waitingMinutes)}`} />
            </div>
          )}

          {(data.unassignedWaiting ?? 0) > 0 && (
            <InlineAlert tone="warning" className="mt-4" title={`${data.unassignedWaiting} waiting lead${data.unassignedWaiting === 1 ? " has" : "s have"} no owner.`}>
              Nobody is responsible for answering {data.unassignedWaiting === 1 ? "it" : "them"}. Assign them, or fix the routing so new leads always reach a person.
            </InlineAlert>
          )}

          {data.trend && data.trend.some((w) => w.leads > 0) && (() => {
            const all = data.trend ?? [];
            const win = range.resolved;
            const weeks = win ? weeksIn(all, win.current) : all;
            const cmp = win ? compareWeeks(all, win.current, win.compare) : null;
            const picked = drill.selected !== null ? weeks[drill.selected] : undefined;
            return (
              <Card title="Are replies getting faster?" className="mt-6">
                <CardRange state={range} label="Replies by week" compares={["none", "previous"]} maxDays={56} />
                <p className="mb-3 mt-3 text-xs text-muted-foreground">The share of new leads answered by a person inside your {data.targetMinutes}-minute target, by the week the lead came in. A week with fewer than 5 leads shows no bar. Click a bar to see its leads.</p>
                {cmp?.change && <p className="mb-3 text-sm" data-testid="trend-compare">{cmp.change.text}.</p>}
                {win?.compare && cmp && !cmp.covered && <p className="mb-3 text-xs text-muted-foreground" data-testid="trend-compare-missing">There is not enough history to compare with {win.compare.label}: only 8 weeks are kept so far.</p>}
                <BarChart title="Answered within target, by week" axisLabel="% of new leads" unit="%" format={(n) => `${Math.round(n)}`} sample={totalsOf(weeks).total} min={5} need="leads" noun="leads"
                  bars={weekBars(weeks)} onSelect={(i) => drill.select(i)} selected={drill.selected} />
                {picked && (
                  <DrillPanel drill={drill} title={`Week of ${weekBars([picked])[0].label}`} count={picked.leads} noun={picked.leads === 1 ? "lead" : "leads"} rows={picked.members} columns={memberColumns} rowKey={(m) => m.locationId + m.contactId}
                    toLead={(m) => ({ contactId: m.contactId, locationId: m.locationId, name: m.name, locationName: m.locationName, url: m.url, note: `${statusText[m.status][0].toUpperCase()}${statusText[m.status].slice(1)}.` })} />
                )}
              </Card>
            );
          })()}

          {data.bySource && data.bySource.length > 0 && (
            <Card title="By where the lead came from" className="mt-6">
              <p className="mb-2 text-xs text-muted-foreground">Each source is judged against its own target: portal and phone leads 5 minutes, Facebook and Instagram lead forms 10, web forms 15, social messages 60. These are common practice targets, not rules.</p>
              <Table head={<tr><Th>Source</Th><Th className="text-right">Target</Th><Th className="text-right">Typical</Th><Th className="text-right">In target</Th><Th className="text-right">Waiting</Th></tr>}>
                {data.bySource.map((s) => (
                  <tr key={s.cls}>
                    <Td className="font-medium">{({ portal: "Portals and phone", meta: "Facebook and Instagram lead forms", form: "Web forms and chat", social: "Social messages", other: "Other sources" } as const)[s.cls]}</Td>
                    <Td className="text-right tabular-nums">{s.targetMinutes} min</Td>
                    <Td className="text-right tabular-nums">{dur(s.medianSeconds)}</Td>
                    <Td className="text-right"><Badge tone={rateTone(s.hitRate)}>{pct(s.hitRate)}</Badge></Td>
                    <Td className="text-right tabular-nums">{s.stillWaiting}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="By account, slowest first" className="lg:col-span-2">
              <Table head={<tr><Th>Account</Th><Th className="text-right">Typical</Th><Th className="text-right">In target</Th><Th className="text-right">Waiting</Th></tr>}>
                {data.perAccount.map((a) => (
                  <tr key={a.locationId}>
                    <Td><button type="button" className="font-medium hover:underline" onClick={() => go("account", a.locationId)}>{a.name}</button></Td>
                    <Td className="text-right tabular-nums">{a.access === "needs_permission" ? "needs permission" : dur(a.medianSeconds)}</Td>
                    <Td className="text-right"><Badge tone={rateTone(a.hitRate)}>{pct(a.hitRate)}</Badge></Td>
                    <Td className="text-right tabular-nums">{a.stillWaiting}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="Who replies fastest">
              {data.people.length === 0 ? <p className="text-sm text-muted-foreground">Needs at least 3 replies from a person before they are ranked.</p> : (
                <ul className="divide-y text-sm">
                  {data.people.map((p, i) => (
                    <li key={p.userId} className="flex items-center justify-between gap-2 py-2.5"><span><span className="mr-2 text-muted-foreground">{i + 1}.</span>{p.label}</span><span className="tabular-nums text-muted-foreground">{dur(p.medianSeconds)} typical · {p.replies} replies</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
      <p className="mt-4 text-xs text-muted-foreground">A lead is a new contact with a conversation. The clock starts when the contact is created or the first message arrives, whichever is earlier, and stops at the first message a person sent from the app. Automatic texts do not stop it unless you change that in Settings.</p>
      <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </Page>
  );
}
