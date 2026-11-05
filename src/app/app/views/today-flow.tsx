"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MIN_LEADS, type Flow, type FlowLead } from "@/lib/analytics/lead-flow";
import { ReportFilterBar, useReportApi, useReportFilter } from "./report-filter";
import { specClientsAll, specClientsWeek, specFlowLink, specFlowNode } from "@/lib/analytics/flow-records";
import { weeksOf, type ClientEvent, type WeekBar } from "@/lib/analytics/clients-flow";
import { tabMeta } from "@/lib/analytics/today-tabs";
import { useApiClient, ApiError } from "../session";
import { EmptyState, Skeleton } from "../ds";
import { LeadFlowChart } from "../ds/lead-flow-chart";
import { TagPill, WhatIs } from "../ds/what-is";
import { fmtInt } from "../ui";
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

function WeekChart({ bars, onBar }: { bars: WeekBar[]; onBar: (b: WeekBar, kind: "added" | "removed") => void }) {
  const [hot, setHot] = useState<string | null>(null);
  const W = 640, H = 190, L = 28, B = 24, T = 12;
  const max = Math.max(3, ...bars.map((b) => Math.max(b.added, b.removed)));
  const step = (W - L) / bars.length, bw = Math.min(14, step * 0.32);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const label = (b: WeekBar) => `Week of ${b.label}: ${b.added} ${b.added === 1 ? "client" : "clients"} added, ${b.removed} removed`;
  const tip = bars.find((b) => b.start === hot);
  return (
    <figure data-testid="clients-chart" className="min-w-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="group" aria-label="Clients added and removed each week">
        <line x1={L} x2={W} y1={y(0)} y2={y(0)} stroke="var(--t-rule)" />
        <text x={L - 6} y={y(max)} textAnchor="end" dominantBaseline="middle" className="t-num" style={{ fontSize: 10.5, fill: "var(--t-ink3)" }}>{max}</text>
        {bars.map((b, i) => {
          const cx = L + step * i + step / 2;
          return (
            <g key={b.start}>
              {([["added", cx - bw - 1, "var(--t-c1)", b.added], ["removed", cx + 1, "var(--t-ink3)", b.removed]] as const).map(([kind, x, fill, v]) => (
                <rect key={kind} x={x} y={y(v) - (v === 0 ? 0 : 0)} width={bw} height={Math.max(v === 0 ? 0 : 2, y(0) - y(v))} rx={1.5} fill={fill} pointerEvents="none" fillOpacity={hot === b.start ? 1 : 0.8} />
              ))}
              {(["added", "removed"] as const).map((kind, k) => (
                <rect key={`hit-${kind}`} x={cx - bw - 1 + k * (bw + 2)} y={T} width={bw} height={H - T - B} fill="transparent" role="button" tabIndex={0} aria-label={`${label(b)}. See the ${kind} clients.`} data-testid={`week-${kind}`} data-week={b.start} data-count={b[kind]}
                  className="cursor-pointer outline-none focus-visible:stroke-[var(--t-ink)] focus-visible:stroke-2" onClick={() => onBar(b, kind)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBar(b, kind); } }}
                  onMouseEnter={() => setHot(b.start)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(b.start)} onBlur={() => setHot(null)}><title>{label(b)}</title></rect>
              ))}
              {(i % 2 === 0 || i === bars.length - 1) && <text x={cx} y={H - 6} textAnchor="middle" style={{ fontSize: 10.5, fill: "var(--t-ink3)" }}>{b.label}</text>}
            </g>
          );
        })}
      </svg>
      <p className="t-small t-quiet mt-1 min-h-5" role="status" aria-live="polite">{tip ? label(tip) : "Left bar: clients added that week. Right bar: clients removed. Select a bar to see which clients."}</p>
      <div className="sr-only"><table><caption>Clients added and removed each week</caption><thead><tr><th>Week of</th><th>Added</th><th>Removed</th></tr></thead><tbody>{bars.map((b) => <tr key={b.start}><td>{b.label}</td><td>{b.added}</td><td>{b.removed}</td></tr>)}</tbody></table></div>
    </figure>
  );
}

export function ClientsFlowTab({ m }: { m: TodayModel }) {
  const api = useApiClient();
  const [state, setState] = useState<{ data: ClientsResponse | null; error: string | null }>({ data: null, error: null });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    try { setState({ data: await api.get<ClientsResponse>("today/clients-flow"), error: null }); }
    catch (e) { setState({ data: null, error: e instanceof ApiError && e.status !== 500 ? e.message : "Clients coming and going could not be read. Please try again." }); }
  }, [api]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const d = state.data;
  const bars = useMemo(() => (d ? weeksOf(d.events, d.now, 12) : []), [d]);
  if (state.error) return <div data-testid="clients-flow-tab"><TabIntro name="Clients coming and going" /><EmptyState title="Clients coming and going could not be read" body={state.error} action={<button type="button" onClick={() => void load()} className="ds-press h-9 cursor-pointer rounded-[4px] border border-[var(--t-rule2)] px-3 text-sm">Try again</button>} /></div>;
  if (!d) return <div><TabIntro name="Clients coming and going" /><div className="space-y-4" role="status" aria-busy="true" aria-label="Counting clients"><Skeleton className="h-8 w-64" /><Skeleton className="h-48 w-full" /></div></div>;
  const recent = d.events.slice(0, 12);
  const added = d.events.filter((e) => e.kind === "added").length, removed = d.events.filter((e) => e.kind === "removed").length;
  return (
    <div data-testid="clients-flow-tab" className="max-w-5xl">
      <TabIntro name="Clients coming and going" />
      <p className="mb-1 text-[0.9375rem]" data-testid="clients-current"><span className="t-num font-medium">{fmtInt(d.current)}</span> {d.current === 1 ? "client" : "clients"} now.
        {" "}<button type="button" className="ds-press cursor-pointer text-primary underline underline-offset-4" onClick={() => m.open(specClientsAll(d.events, "added"))} data-testid="clients-added-all">{fmtInt(added)} added</button>,
        {" "}<button type="button" className="ds-press cursor-pointer text-primary underline underline-offset-4" onClick={() => m.open(specClientsAll(d.events, "removed"))} data-testid="clients-removed-all">{fmtInt(removed)} removed</button> so far.</p>
      <p className="t-small t-quiet mb-5" data-testid="clients-since">{d.firstSeen ? `Counts from ${fmtDay(d.firstSeen)}, the first client SubSync saw.` : "Counts from the first client SubSync saw."}{d.departuresReady ? " Clients that left are recorded from the day this started, so earlier ones are not here." : " Needs the latest database update to record clients that leave. History starts the day it is applied."}</p>
      <WeekChart bars={bars} onBar={(b, kind) => m.open(specClientsWeek(d.events, b, kind))} />
      <h4 className="t-title mt-8 mb-2">Recent arrivals and departures</h4>
      {recent.length === 0 ? <p className="t-small t-quiet" data-testid="clients-none">No clients yet.</p> : (
        <ul className="max-w-xl" data-testid="clients-recent">
          {recent.map((e, n) => (
            <li key={`${e.locationId}-${e.kind}-${n}`} className="flex min-h-9 items-center gap-3 border-b border-[var(--t-rule)] text-sm last:border-0">
              <span className="min-w-0 flex-1 truncate">{e.name}</span>
              <span className={`w-16 shrink-0 text-xs ${e.kind === "added" ? "text-[var(--t-ok)]" : "text-[var(--t-ink2)]"}`}>{e.kind === "added" ? "Added" : "Removed"}</span>
              <span className="t-num t-quiet w-28 shrink-0 text-right">{fmtDay(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
