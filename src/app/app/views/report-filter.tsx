"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FLOW_PRESETS, type FlowPreset } from "@/lib/analytics/lead-flow";
import { isDefaultState, rangeOf, readReportState, writeReportState, type ReportState } from "@/lib/analytics/report-filter";
import { WhatIs } from "../ds/what-is";
import { usePageRange } from "../ds/page-range";
import { useApiClient, useRootApi, type Api } from "../session";

// ONE filter bar for every report tab of Today (Growth, Lead flow, Clients coming and going, Proof, Forecast, Sources, Coverage): dates and a client. It is the date choice Lead flow
// always had, moved here, not copied. The choice lives in the address (see src/lib/analytics/report-filter.ts), so it survives a reload and a drill-down opens the same people.
// Until the person changes the bar, a tab follows the header (the clients picked at the top of Today); "Reset to header" puts it back.

const field = "min-h-9 rounded-[4px] border border-[var(--t-rule2)] bg-[var(--t-raise)] px-2 py-1 text-sm cursor-pointer outline-none hover:border-primary focus-visible:outline-2 focus-visible:outline-[var(--ring)]";

export function useReportFilter(prefix: string, defaultPreset: FlowPreset) {
  const [state, setState] = useState<ReportState>({ preset: null, from: "", to: "", client: null });
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setState(readReportState(window.location.hash, prefix));
    setToday(new Date().toISOString().slice(0, 10)); read();
    window.addEventListener("popstate", read); window.addEventListener("subsync-report-filter", read);
    return () => { window.removeEventListener("popstate", read); window.removeEventListener("subsync-report-filter", read); };
  }, [prefix]);
  const patch = useCallback((p: Partial<ReportState>) => {
    try { window.history.replaceState(null, "", writeReportState(window.location.hash || "#today", prefix, p)); window.dispatchEvent(new Event("subsync-report-filter")); } catch { setState((s) => ({ ...s, ...p })); }
  }, [prefix]);
  const reset = useCallback(() => patch({ preset: null, from: "", to: "", client: null }), [patch]);
  // Until the person picks dates on this tab, it follows the date bar at the top of the app (one range for the whole app); a choice made here is a labelled override, and "Reset to header" returns to the bar.
  const bar = usePageRange(), followsBar = state.preset === null && bar.ready;
  const range = useMemo(() => (followsBar && bar.resolved ? { from: bar.from, to: bar.to, label: bar.label, problem: bar.problem } : today ? rangeOf(state, defaultPreset, today) : null), [followsBar, bar.resolved, bar.from, bar.to, bar.label, bar.problem, state, defaultPreset, today]);
  return { state, today, range, followsBar, preset: (state.preset ?? defaultPreset) as FlowPreset, patch, reset, differs: !isDefaultState(state, defaultPreset), /** "all" or one client id when chosen on purpose; null follows the header. */ client: state.client };
}
export type ReportFilter = ReturnType<typeof useReportFilter>;

/** The query to add to a read: the dates and the client, only when the person changed them. */
export function filterQuery(f: ReportFilter, withDates = true): string {
  const q: string[] = [];
  if (withDates && f.range && !f.range.problem && (f.state.preset !== null || f.followsBar)) q.push(`from=${f.range.from}`, `to=${f.range.to}`);
  if (f.client && f.client !== "all") q.push(`client=${encodeURIComponent(f.client)}`);
  return q.join("&");
}

export function ReportFilterBar({ f, label, clients, noDates, datesNote }: { f: ReportFilter; label: string; /** Clients the person may pick; omit or give fewer than 2 to hide the client filter (single-account users never see it). */ clients?: Array<{ id: string; name: string }>; noDates?: boolean; datesNote?: string }) {
  const [typed, setTyped] = useState("");
  const showClient = !!clients && clients.length > 1;
  const list = useMemo(() => (typed ? (clients ?? []).filter((c) => c.name.toLowerCase().includes(typed.toLowerCase())) : clients ?? []), [clients, typed]);
  const { range, today, preset, state } = f;
  const pickPreset = (p: FlowPreset) => f.patch(p === "custom" ? { preset: p, from: state.from || range?.from || "", to: state.to || range?.to || "" } : { preset: p });
  const value = state.client ?? "";
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label={`Filters for ${label}`} data-testid="report-filter">
      {!noDates && (
        <>
          <select className={field} aria-label={`${label}: dates`} value={state.preset ?? ""} onChange={(e) => (e.target.value ? pickPreset(e.target.value as FlowPreset) : f.patch({ preset: null, from: "", to: "" }))} data-testid="filter-preset">
            <option value="">Dates at the top of the page</option>
            {FLOW_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          {preset === "custom" && (
            <>
              <input type="date" className={field} aria-label={`${label}: from`} value={state.from} max={today ?? undefined} onChange={(e) => f.patch({ from: e.target.value })} data-testid="filter-from" />
              <input type="date" className={field} aria-label={`${label}: to`} value={state.to} max={today ?? undefined} onChange={(e) => f.patch({ to: e.target.value })} data-testid="filter-to" />
            </>
          )}
        </>
      )}
      {showClient && (
        <>
          {(clients?.length ?? 0) > 8 && <input type="search" className={`${field} w-36 cursor-text`} placeholder="Find a client" aria-label={`${label}: find a client`} value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="filter-client-search" />}
          <select className={`${field} max-w-[14rem] truncate`} aria-label={`${label}: client`} value={value} onChange={(e) => f.patch({ client: e.target.value || null })} data-testid="filter-client" title="Choose one client, or all of them">
            <option value="">Same as the top of the page</option>
            <option value="all">All clients</option>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      )}
      {range && !noDates && <span className="t-small t-quiet" data-testid="filter-window">{range.problem ? "" : range.from === range.to ? range.from : `${range.from} to ${range.to}`}</span>}
      {datesNote && <WhatIs text={datesNote} />}
      {f.differs && <button type="button" onClick={f.reset} className="ds-press cursor-pointer text-sm text-primary underline underline-offset-4" data-testid="filter-reset">Reset to header</button>}
      {range?.problem && <p className="t-small basis-full border-l-2 border-[var(--t-soon)] pl-2" role="status" data-testid="filter-problem">{range.problem} Showing the tab&apos;s usual dates instead.</p>}
    </div>
  );
}

/** The client a tab reads with: the header's own (scoped) one until the tab picks a client, then one with no header narrowing so the tab's choice stands alone. */
export function useReportApi(f: ReportFilter): Api {
  const scoped = useApiClient(), root = useRootApi();
  return f.client !== null && root ? root : scoped;
}
