"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "../../session";
import type { PlDeals, PlMoneyFlow, PlPart } from "@/lib/analytics/pipeline3-types-interim";
import { adapt, queryOf } from "./adapters";
import { dealsFixture, FLOW_EMPTY, FLOW_FIXTURE, PIPES_FIXTURE, FORECAST_FIXTURE, HEALTH_FIXTURE, HISTORY_FIXTURE, OVERVIEW_FIXTURE, PEOPLE_FIXTURE, page, PROOF_FIXTURE, SOURCES_FIXTURE, WONLOST_FIXTURE } from "./fixtures";

/** What the person picked. `days` becomes from/to on the server's day boundaries; everything is re-checked on the server (never trusted). */
export type PlFilters = { days: 30 | 45 | 90; locationId: string; pipeline: string; ownerId: string; q: string };
export const DEFAULT_FILTERS: PlFilters = { days: 45, locationId: "", pipeline: "", ownerId: "", q: "" };

const FX = /[?&]plfx=(1|empty|error)/;
function fxFound(): string {
  if (typeof window === "undefined") return "";
  const first = (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.name ?? "";
  const m = FX.exec(window.location.href) ?? FX.exec(first);
  try { if (m) sessionStorage.setItem("pl3.fx", m[1]); return m ? m[1] : sessionStorage.getItem("pl3.fx") ?? ""; } catch { return m ? m[1] : ""; }
}
if (typeof window !== "undefined") fxFound();
export const fixturesOn = () => fxFound() !== "";
const fxMode = () => { const v = fxFound(); return v === "empty" || v === "error" ? v : ""; };

export { queryOf };

function fixtureFor(part: PlPart, extra: Record<string, string | number | undefined>): unknown {
  const pg = Number(extra.page ?? 1), size = Number(extra.pageSize ?? 20);
  const mk = (kind: "stale" | "won" | "lost" | "all", n: number): PlDeals => page(dealsFixture(n, kind).slice((pg - 1) * size, pg * size), n, pg, size);
  switch (part) {
    case "pipelines": return PIPES_FIXTURE;
    case "money-flow": return FLOW_FIXTURE;
    case "overview": return OVERVIEW_FIXTURE;
    case "needs-attention": return mk("stale", 31);
    case "list": return mk(extra.status === "won" ? "won" : extra.status === "lost" ? "lost" : "all", Number(extra.expect ?? 40));
    case "won-lost": return WONLOST_FIXTURE;
    case "forecast": return FORECAST_FIXTURE;
    case "people": return { rows: PEOPLE_FIXTURE };
    case "sources": return { rows: SOURCES_FIXTURE };
    case "stage-history": return HISTORY_FIXTURE;
    case "health": case "accounts": return { rows: HEALTH_FIXTURE };
    case "proof": return PROOF_FIXTURE;
  }
}
const emptyFor = (part: PlPart): unknown => (part === "pipelines" ? { cards: [], next: null, totals: { pipelines: 0, emptyHidden: 0, openValue: 0, wonValue: 0, lostValue: 0, openCount: 0, wonCount: 0, lostCount: 0, staleCount: 0, noOwnerCount: 0 } } : part === "money-flow" ? FLOW_EMPTY : part === "overview" ? { ...OVERVIEW_FIXTURE, headline: { openCount: 0, openValueCents: 0, staleCount: 0, staleValueCents: 0, wonCents: 0, lostCents: 0, winRate: null, winRateDeals: 0 }, leak: null, sentence: "" }
  : part === "forecast" ? { ...FORECAST_FIXTURE, lowCents: null, midCents: null, highCents: null, closedDeals: 0, byStage: [] } : part === "won-lost" ? { won: 0, lost: 0, wonCents: 0, lostCents: 0, winRate: null, byReason: [], bookedToWon: null }
  : part === "stage-history" ? { stages: [], recorded: { since: null, changes: 0 } } : part === "proof" ? { weekLabel: "", rows: [] } : part === "needs-attention" || part === "list" ? page([], 0, 1, 20) : { rows: [] });

/** One part of the pipeline API, or its typed fixture with ?plfx=1 (?plfx=empty and ?plfx=error show the other two states). */
export function usePl<T>(part: PlPart, f: PlFilters, extra: Record<string, string | number | undefined> = {}) {
  const fx = fixturesOn(), mode = fx ? fxMode() : "";
  const key = queryOf(part, f, extra);
  const raw = useData<unknown>(fx ? null : key);
  // The time-lapse comes from its own part of the API (same filters); the flow shows without it until it arrives.
  const replayKey = part === "money-flow" ? queryOf("money-flow", f).replace("part=money-flow", "part=replay") + "&days=" + Math.max(30, Math.min(90, f.days)) : null;
  const aux = useData<unknown>(fx ? null : replayKey);
  const { data: rawData, error: rawError, loading: rawLoading, reload: reloadRaw } = raw, { data: auxData, reload: reloadAux } = aux;
  const live = useMemo(() => ({ data: rawData === null ? null : (adapt(part, rawData, auxData) as T), error: rawError, loading: rawLoading, reload: () => { void reloadRaw(); void reloadAux(); } }), [rawData, rawError, rawLoading, reloadRaw, auxData, reloadAux, part]);
  const [fix, setFix] = useState<{ data: T | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: fx });
  const reload = useCallback(() => {
    if (!fx) return void live.reload();
    setFix((s) => ({ ...s, loading: true }));
    setTimeout(() => {
      if (mode === "error") return setFix({ data: null, error: true, loading: false });
      setFix({ data: (mode === "empty" ? emptyFor(part) : fixtureFor(part, extra)) as T, error: false, loading: false });
    }, 260);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, mode, key]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (fx) reload(); }, [fx, reload]);
  return fx ? { data: fix.data, error: fix.error ? ({ message: "Could not load this" } as never) : null, loading: fix.loading, reload } : live;
}
export type { PlMoneyFlow };
