"use client";

import { fullDate } from "@/lib/analytics/chart-format";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MIN_LEADS, type Flow, type FlowLead } from "@/lib/analytics/lead-flow";
import { ReportFilterBar, useReportApi, useReportFilter } from "./report-filter";
import { specClientsAll, specClientsWeek, specFlowLink, specFlowNode } from "@/lib/analytics/flow-records";
import { weeksOf, type ClientEvent } from "@/lib/analytics/clients-flow";
import { tabMeta } from "@/lib/analytics/today-tabs";
import { useApiClient, ApiError } from "../session";
import { EmptyState, Skeleton } from "../ds";
import { LeadFlowChart } from "../ds/lead-flow-chart";
import { TagPill, WhatIs } from "../ds/what-is";
import { fmtInt } from "../ui";
import { fmtFull, fmtStat } from "@/lib/analytics/chart-format";
import { ModeToggle, TimeChart, useChartMode } from "../ds/time-chart";
import type { TodayModel } from "./today-model";

// Two report tabs of Today. Lead flow: where the leads added in a chosen stretch of time went (every step and band opens its people). Clients coming and going: clients added and
// removed each week (agency only). Both read only, from data SubSync already holds. Definitions: docs/METRICS.md.

/** The name, the "To do" or "Report" tag and the one line saying what the tab tells you. */
export function TabIntro({ name }: { name: string }) {
  const m = tabMeta(name);
  if (!m) return null;
  return (
    <div className="mb-5" data-testid="tab-intro">
      <div className="flex flex-wrap items-center gap-2"><h3 className="t-title">{name}</h3><TagPill tag={m.tag} /></div>
      <p className="t-small t-quiet mt-1 max-w-2xl" data-testid="tab-subtitle">{m.subtitle}</p>
    </div>
  );
}

type FlowResponse = { from: string; to: string; accounts: number; flow: Flow; leads: FlowLead[]; sent: number; partial: boolean; needsUpdate: boolean };
const field = "min-h-9 rounded-[4px] border border-[var(--t-rule2)] bg-[var(--t-raise)] px-2 py-1 text-sm cursor-pointer outline-none hover:border-primary focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

export function LeadFlowTab({ m, clients, kind }: { m: TodayModel; clients?: Array<{ id: string; name: string }>; kind?: string }) {
  const f = useReportFilter("l", "7d");
  const api = useReportApi(f);
  const range = f.range;
  const [state, setState] = useState<{ data: FlowResponse | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const latest = useRef(0);
  const query = range && !range.problem ? `from=${range.from}&to=${range.to}` : range ? `from=${range.from}&to=${range.to}` : "";
  const clientQuery = f.client && f.client !== "all" ? `&client=${encodeURIComponent(f.client)}` : "";
  const load = useCallback(async () => {
    if (!range) return;
    const mine = ++latest.current; // an answer for dates the person has already left must never overwrite the newer one
    setState((s) => ({ ...s, loading: true, error: null }));
    try { const data = await api.get<FlowResponse>(`today/lead-flow?${query}${clientQuery}`); if (mine === latest.current) setState({ data, error: null, loading: false }); }
    catch (e) { if (mine === latest.current) setState((s) => ({ data: s.data, error: e instanceof ApiError && e.status !== 500 ? e.message : "Lead flow could not be read. Please try again.", loading: false })); }
  }, [api, range, query, clientQuery]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const d = state.data;
  const input = d && range ? { flow: d.flow, leads: d.leads, sent: d.sent, partial: d.partial, rangeLabel: range.label } : null;
  const won = d?.flow.won ?? 0;
  
  return (
    <div data-testid="flow-tab" className="max-w-5xl">
      <TabIntro name="Lead flow" />
      <ReportFilterBar f={f} label="Lead flow" clients={kind === "agency" ? clients : undefined} datesNote="Every person added as a contact in these dates, followed to where they are now: did a person reply, did they book, did they show up." />
      {state.error && !d && <EmptyState title="Lead flow could not be read" body={state.error} action={<button type="button" onClick={() => void load()} className="ds-press h-9 cursor-pointer rounded-[4px] border border-[var(--t-rule2)] px-3 text-sm">Try again</button>} />}
      {!d && !state.error && <div className="space-y-4" role="status" aria-busy="true" aria-label="Following the leads"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>}
      {d && input && (
        <div aria-busy={state.loading} className={state.loading ? "opacity-60" : undefined}>
          {state.error && <p className="t-small mb-3" role="alert">{state.error}</p>}
          {d.needsUpdate && <p className="t-small t-quiet mb-3" data-testid="flow-needs-update">Needs the latest database update. Ask the person who manages SubSync to apply it.</p>}
          {d.flow.total === 0 ? (
            <EmptyState title="No new leads in these dates" body="Nobody was added as a contact in this stretch. Pick longer dates." />
          ) : (
            <>
              <p className="mb-3 text-[0.9375rem]" data-testid="flow-headline">
                <button type="button" className="ds-press cursor-pointer font-medium text-primary underline underline-offset-4" onClick={() => m.open(specFlowNode(input, "new"))} data-testid="flow-total">{fmtInt(d.flow.total)} new {d.flow.total === 1 ? "lead" : "leads"}</button>
                {" "}{range?.label.toLowerCase()}.
                {won > 0 && <> <button type="button" className="ds-press cursor-pointer text-primary underline underline-offset-4" onClick={() => m.open({ ...specFlowNode(input, "new"), key: "flow-won", title: `New leads that won a deal, ${range?.label.toLowerCase()}`, subtitle: "Leads added in these dates that have a deal marked won.", rows: specFlowNode(input, "new").rows.filter((r) => d.leads.find((l) => l.id === r.id)?.won), count: won })} data-testid="flow-won">{fmtInt(won)} won a deal</button>.</>}
              </p>
              {!d.flow.enough && <p className="t-small t-quiet mb-3" data-testid="flow-too-few">Too few leads to read. Percentages show from {MIN_LEADS} leads. Pick longer dates.</p>}
              <LeadFlowChart flow={d.flow} label={`Where ${d.flow.total} new leads went, ${range?.label.toLowerCase()}`} onNode={(id) => m.open(specFlowNode(input, id))} onLink={(a, b) => m.open(specFlowLink(input, a, b))} />
              {d.flow.unknown > 0 && <p className="t-small t-quiet mt-3" data-testid="flow-unknown">{fmtInt(d.flow.unknown)} {d.flow.unknown === 1 ? "lead is" : "leads are"} shown as &ldquo;Not checked&rdquo;: SubSync only checks whether someone replied for conversations of the last 14 days, so older leads cannot be placed. Their appointments still count.</p>}
              {d.partial && <p className="t-small t-quiet mt-2">SubSync counted the newest 20,000 leads of these dates. Pick shorter dates to count them all.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Clients coming and going ----------

type ClientsResponse = { now: number; current: number; firstSeen: number | null; events: ClientEvent[]; departuresReady: boolean };
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const RECENT_SHOWN = 25;

export function ClientsFlowTab({ m }: { m: TodayModel }) {
  const api = useApiClient();
  const f = useReportFilter("c", "90d");
  const [mode, setMode] = useChartMode("clients");
  const [typed, setTyped] = useState("");
  const [all, setAll] = useState(false);
  const [state, setState] = useState<{ data: ClientsResponse | null; error: string | null }>({ data: null, error: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    try { setState({ data: await api.get<ClientsResponse>("today/clients-flow"), error: null }); }
    catch (e) { setState({ data: null, error: e instanceof ApiError && e.status !== 500 ? e.message : "Clients coming and going could not be read. Please try again." }); }
  }, [api]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const d = state.data;
  const range = f.range;
  const bar = <ReportFilterBar f={f} label="Clients coming and going" datesNote="Dates choose which arrivals and departures are counted. There is no client filter here because this tab is about the clients themselves." />;
  // Only what happened in the chosen dates: the chart, the two counts and the list all read the same events, so a mark and the list it opens agree.
  const events = useMemo(() => {
    if (!d || !range) return [] as ClientEvent[];
    const from = Date.parse(`${range.from}T00:00:00Z`), to = Date.parse(`${range.to}T00:00:00Z`) + 86_400_000;
    return d.events.filter((e) => e.at >= from && e.at < to);
  }, [d, range]);
  const bars = useMemo(() => {
    if (!d || !range) return [];
    const end = Math.min(d.now, Date.parse(`${range.to}T12:00:00Z`));
    const weeks = Math.min(54, Math.max(2, Math.ceil(((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000 + 1) / 7) + 1));
    return weeksOf(events, end, weeks);
  }, [d, range, events]);
  if (state.error) return <div data-testid="clients-flow-tab"><TabIntro name="Clients coming and going" />{bar}<EmptyState title="Clients coming and going could not be read" body={state.error} action={<button type="button" onClick={() => void load()} className="ds-press h-9 cursor-pointer rounded-[4px] border border-[var(--t-rule2)] px-3 text-sm">Try again</button>} /></div>;
  if (!d) return <div><TabIntro name="Clients coming and going" />{bar}<div className="space-y-4" role="status" aria-busy="true" aria-label="Counting clients"><Skeleton className="h-8 w-64" /><Skeleton className="h-48 w-full" /></div></div>;
  const added = events.filter((e) => e.kind === "added").length, removed = events.filter((e) => e.kind === "removed").length;
  const needle = typed.trim().toLowerCase();
  const matching = events.filter((e) => !needle || e.name.toLowerCase().includes(needle));
  const recent = all ? matching : matching.slice(0, RECENT_SHOWN);
  return (
    <div data-testid="clients-flow-tab" className="max-w-5xl">
      <TabIntro name="Clients coming and going" />
      {bar}
      <p className="mb-1 text-[0.9375rem]" data-testid="clients-current"><span className="t-num font-medium" title={fmtFull(d.current)}>{fmtStat(d.current)}</span> {d.current === 1 ? "client" : "clients"} now.
        {" "}<button type="button" className="ds-press cursor-pointer text-primary underline underline-offset-4" onClick={() => m.open(specClientsAll(events, "added"))} data-testid="clients-added-all">{fmtStat(added)} added</button>,
        {" "}<button type="button" className="ds-press cursor-pointer text-primary underline underline-offset-4" onClick={() => m.open(specClientsAll(events, "removed"))} data-testid="clients-removed-all">{fmtStat(removed)} removed</button> {range?.label.toLowerCase() ?? "in these dates"}.
        {" "}<WhatIs text={`${d.firstSeen ? `Counts from ${fmtDay(d.firstSeen)}, the first client SubSync saw. ` : ""}${d.departuresReady ? "Clients that left are recorded from the day this started, so earlier ones are not here." : "Needs the latest database update to record clients that leave. History starts the day it is applied."}`} /></p>
      <div className="mb-2 mt-4 flex items-center justify-between gap-3"><h4 className="t-title">Clients added and removed each week</h4><ModeToggle mode={mode} onChange={setMode} label="Clients added and removed" /></div>
      <TimeChart testId="clients-chart" mode={mode} label="Clients added and removed each week" noun="Week of" hint="Select a week to see which clients."
        points={bars.map((b) => ({ id: b.start, label: `Week of ${fullDate(b.start)}`, short: b.label }))} series={[{ key: "added", name: "Added", colour: "var(--t-c1)", values: bars.map((b) => b.added) }, { key: "removed", name: "Removed", colour: "var(--t-ink3)", values: bars.map((b) => b.removed) }]}
        onPick={(i) => m.open(specClientsWeek(events, bars[i]))} />
      <div className="mt-8 mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="t-title">Recent arrivals and departures</h4>
        <input type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search by client name" aria-label="Search the recent list" data-testid="clients-search" className={`${field} w-56 max-w-full cursor-text`} />
      </div>
      {recent.length === 0 ? <p className="t-small t-quiet" data-testid="clients-none">{needle ? "No client matches that name." : "No clients added or removed in these dates."}</p> : (
        <ul className="max-w-xl" data-testid="clients-recent">
          {recent.map((e, n) => (
            <li key={`${e.locationId}-${e.kind}-${n}`} className="flex min-h-9 items-center gap-3 border-b border-[var(--t-rule)] text-sm last:border-0">
              <span className="min-w-0 flex-1 truncate" title={e.name}>{e.name}</span>
              <span className={`w-16 shrink-0 text-xs ${e.kind === "added" ? "text-[var(--t-ok)]" : "text-[var(--t-ink2)]"}`}>{e.kind === "added" ? "Added" : "Removed"}</span>
              <span className="t-num t-quiet w-28 shrink-0 text-right">{fmtDay(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
      {!all && matching.length > RECENT_SHOWN && <button type="button" onClick={() => setAll(true)} className="ds-press mt-2 cursor-pointer text-sm text-primary underline underline-offset-4" data-testid="clients-more">Show all {fmtInt(matching.length)}</button>}
    </div>
  );
}
