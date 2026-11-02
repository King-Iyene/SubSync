"use client";

import { useState } from "react";
import { waitLabel } from "@/lib/design/ui-logic";
import { measuringSentence } from "@/lib/design/speed-text";
import { useData } from "../session";
import type { GoFn } from "../nav";
import { BarChart, CardRange, ChartPlaceholder, DataList, DrillPanel, EmptyState, HowTo, InlineAlert, LeadDrawer, Page, useCardRange, useDrill, type Column, type LeadSeed } from "../ds";
import { compareWeeks, totalsOf, weekBars, weeksIn, type TrendMember, type TrendWeekData } from "@/lib/design/trend-bars";
import { Badge, Btn, Card, ErrorBox, ExtLink, fmtInt, Loading, type Tone } from "../ui";
import { AccountsCard, leadColumns, leadCopy, leadKey, leadSeed, PeopleCard, SourceCard, SummaryCard, type LeadView, type PersonView } from "./speed-cards";

// The wire shape of the main answer. The cards below the list ask for their own windows (speed-cards.tsx).
type Summary = { leads: number; answered: number; withinTarget: number; answeredLate: number; stillWaiting: number; hitRate: number | null; medianSeconds: number | null; p90Seconds: number | null };
type Waiting = {
  locationId: string; locationName: string; contactId: string; name: string; waitingMinutes: number; url: string; unassigned?: boolean; neverAnswered?: boolean;
  source?: string; owner?: PersonView | null; autoSeconds?: number | null; detailed?: boolean;
};
type Data = {
  targetMinutes: number; windowDays: number;
  access: { ok: number; needsPermission: Array<{ locationId: string; name: string }>; total: number };
  overall: Summary;
  unassignedWaiting?: number;
  trend?: TrendWeekData[];
  neverAnswered?: number;
  leftOut?: Array<{ reason: string; label: string; n: number }>;
  waitingTotal?: number;
  waiting: Waiting[];
  measuring?: { targetMinutes: number; countAutomated: boolean; businessHours: boolean; canChange: boolean };
};

// A waiting row in the shape the shared lead list takes (the same columns as every list behind a figure).
const asLead = (w: Waiting): LeadView => ({
  locationId: w.locationId, locationName: w.locationName, contactId: w.contactId, name: w.name, url: w.url, status: "waiting", neverAnswered: w.neverAnswered === true, minutes: w.waitingMinutes,
  source: w.source ?? "No source recorded", repliedBy: null, owner: w.owner ?? null, unassigned: w.unassigned === true, autoSeconds: w.autoSeconds ?? null, personSeconds: null, detailed: w.detailed === true,
});

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

// How fast new leads get a first reply from a person. Replies from workflows and campaigns do not count. SubSync measures replies; it never sends one.
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
  const showAccount = data.access.total > 1;
  const leads = data.waiting.map(asLead);
  const seeds: LeadSeed[] = leads.map(leadSeed);
  const m = data.measuring;

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
            Start at the top of the list: the longest wait is first. Tap a name to see the lead and step to the next one. Every number below opens the leads behind it. SubSync measures replies; it does not send them.
          </HowTo>
          <p className="mb-1 text-sm font-medium" data-testid="speed-headline">{headline}</p>
          {waitingNow > 0 && <p className="mb-1 text-xs text-muted-foreground" data-testid="what-to-do">What to do: reply to the first leads in the list, then assign the ones with no owner.</p>}
          {m && (
            <p className="mb-3 text-xs text-muted-foreground" data-testid="measuring">
              {measuringSentence(m)}{" "}
              {m.canChange ? <button type="button" onClick={() => go("settings")} className="font-medium text-primary underline" data-testid="speed-settings-link">Change the target or this option in Settings</button> : "Ask the person who manages your account to change this."}
            </p>
          )}

          {leads.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-2 text-base font-semibold">Leads waiting or missed ({data.waitingTotal ?? o.stillWaiting})</h2>
              <p className="mb-2 text-xs text-muted-foreground">Longest waiting first. Tap a name to see the lead.</p>
              <DataList rows={leads} columns={leadColumns(showAccount)} rowKey={leadKey} total={data.waitingTotal} onOpen={(_, i) => setOpen(i)} caption="Leads waiting or missed" copyText={leadCopy(showAccount)} />
            </div>
          )}

          {(data.leftOut ?? []).length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {fmtInt((data.leftOut ?? []).reduce((s, x) => s + x.n, 0))} new contacts were not counted as leads: {(data.leftOut ?? []).map((x) => `${fmtInt(x.n)} ${x.label}`).join(", ")}.
            </p>
          )}

          {(data.unassignedWaiting ?? 0) > 0 && (
            <InlineAlert tone="warning" className="mt-4" title={`${data.unassignedWaiting} waiting lead${data.unassignedWaiting === 1 ? " has" : "s have"} no owner.`}>
              Nobody is responsible for answering {data.unassignedWaiting === 1 ? "it" : "them"}. Assign them, or fix the routing so new leads always reach a person.
            </InlineAlert>
          )}

          <SummaryCard showAccount={showAccount} />

          {data.trend && data.trend.some((w) => w.leads > 0) && (() => {
            const all = data.trend ?? [];
            const win = range.resolved;
            const weeks = win ? weeksIn(all, win.current) : all;
            const cmp = win ? compareWeeks(all, win.current, win.compare) : null;
            const picked = drill.selected !== null ? weeks[drill.selected] : undefined;
            const noBars = weeks.every((w) => w.hitRate === null);
            return (
              <Card title="Are replies getting faster?" className="mt-6">
                <CardRange state={range} label="Replies by week" compares={["none", "previous"]} maxDays={56} />
                <p className="mb-3 mt-3 text-xs text-muted-foreground">The share of new leads answered by a person inside your {data.targetMinutes}-minute target, by the week the lead came in. A week with fewer than 5 leads shows no bar. Click a bar to see its leads.</p>
                {cmp?.change && <p className="mb-3 text-sm" data-testid="trend-compare">{cmp.change.text}.</p>}
                {win?.compare && cmp && !cmp.covered && <p className="mb-3 text-xs text-muted-foreground" data-testid="trend-compare-missing">There is not enough history to compare with {win.compare.label}: only 8 weeks are kept so far.</p>}
                {noBars ? (
                  <ChartPlaceholder title="This chart" need={5} have={weeks.reduce((best, w) => Math.max(best, w.leads), 0)} unit="leads in one week">{" "}It needs a week with 5 or more judged leads before it shows a bar.</ChartPlaceholder>
                ) : (
                  <BarChart title="Answered within target, by week" axisLabel="% of new leads" unit="%" format={(n) => `${Math.round(n)}`} sample={totalsOf(weeks).total} min={5} need="leads" noun="leads"
                    bars={weekBars(weeks)} onSelect={(i) => drill.select(i)} selected={drill.selected} />
                )}
                {picked && (
                  <DrillPanel drill={drill} title={`Week of ${weekBars([picked])[0].label}`} count={picked.leads} noun={picked.leads === 1 ? "lead" : "leads"} rows={picked.members} columns={memberColumns} rowKey={(x) => x.locationId + x.contactId}
                    toLead={(x) => ({ contactId: x.contactId, locationId: x.locationId, name: x.name, locationName: x.locationName, url: x.url, note: `${statusText[x.status][0].toUpperCase()}${statusText[x.status].slice(1)}.` })} />
                )}
              </Card>
            );
          })()}

          <SourceCard showAccount={showAccount} />
          {showAccount && <AccountsCard go={go} />}
          <PeopleCard showAccount={showAccount} />
        </>
      )}
      <p className="mt-4 text-xs text-muted-foreground">A lead is a new contact with a conversation. The clock starts when the contact is created or the first message arrives, whichever is earlier, and stops at the first message a person sent from the app. Automatic texts do not stop it unless you change that in Settings.</p>
      <LeadDrawer leads={seeds} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
    </Page>
  );
}
