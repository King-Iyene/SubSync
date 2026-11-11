"use client";

import { useCallback, useEffect, useState } from "react";
import { useData } from "../../session";
import type { ClAccount, ClPage, ClPart, ClPart2 } from "@/lib/analytics/clients3-types-interim";
import { AGENCY, ACCOUNTS, drillRows, needsList, OVERVIEW, PEOPLE, REPORTS, SETUP, TRENDS } from "./fixtures";

export type ClParams = Record<string, string | number | undefined>;
const FX = /[?&]clfx=(1|empty|error)/;
function fxFound(): string {
  if (typeof window === "undefined") return "";
  const m = FX.exec(window.location.href);
  try { if (m) sessionStorage.setItem("cl3.fx", m[1]); return m ? m[1] : sessionStorage.getItem("cl3.fx") ?? ""; } catch { return m ? m[1] : ""; }
}
if (typeof window !== "undefined") fxFound();
export const fixturesOn = () => fxFound() !== "";
const mode = () => { const v = fxFound(); return v === "empty" || v === "error" ? v : ""; };

/** The address of one part. Only plain filters go in it; the server decides which accounts the person may see and never trusts an id from here. */
export const queryOf = (part: ClPart | ClPart2, p: ClParams): string => {
  const u = new URLSearchParams({ part });
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "" && v !== 0) u.set(k, String(v));
  return `clients3?${u.toString()}`;
};
const paged = <T,>(rows: T[], p: ClParams): ClPage<T> => { const size = Number(p.pageSize ?? 25), pg = Number(p.page ?? 1); return { total: rows.length, page: pg, pageSize: size, rows: rows.slice((pg - 1) * size, pg * size) }; };
const sortAcc = (rows: ClAccount[], p: ClParams) => {
  const k = String(p.sort ?? "attention"), dir = p.dir === "asc" ? 1 : -1;
  const val = (a: ClAccount): number | string => k === "name" ? a.name : k === "leads" ? a.leads : k === "waiting" ? a.waiting : k === "won" ? a.wonCents : k === "stale" ? a.staleShare ?? 0 : a.reasons.reduce((s, r) => s + r.count, 0) + a.reasons.length * 1000;
  return [...rows].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
};
function fixtureFor(part: ClPart | ClPart2, p: ClParams): unknown {
  const q = String(p.q ?? "").toLowerCase();
  const by = <T extends { name: string }>(r: T[]) => (q ? r.filter((x) => x.name.toLowerCase().includes(q)) : r);
  switch (part) {
    case "overview": return OVERVIEW;
    case "accounts": { const base = p.only === "needs" ? needsList() : ACCOUNTS; return paged(sortAcc(by(base), p), p); }
    case "trends": return paged(by(TRENDS), p);
    case "reports": return paged(by(REPORTS), p);
    case "people": return paged(PEOPLE.filter((x) => !q || x.name.toLowerCase().includes(q) || x.accountName.toLowerCase().includes(q)).filter((x) => p.only !== "idle" || x.idle), p);
    case "setup": return paged(by(SETUP).filter((x) => p.only !== "needs" || x.connection !== "ok"), p);
    case "payments": return paged(by(AGENCY).filter((x) => x.billing === null || x.billing.status === "failed"), p);
    case "agency": return paged(by(AGENCY), p);
    case "notes": return { total: 0, page: 1, pageSize: 25, rows: [] };
    case "rows": return paged(drillRows(Number(p.expect ?? 8), String(p.reason ?? "r"), String(p.account ?? "Account")), p);
  }
}
const emptyFor = (part: ClPart | ClPart2): unknown => (part === "overview" ? { ...OVERVIEW, accounts: 0, needAttention: 0, healthy: 0, today: { sentence: "", steps: [] } } : { total: 0, page: 1, pageSize: 25, rows: [] });

/** One part of the Clients API, or typed sample data with ?clfx=1 (?clfx=empty and ?clfx=error show the other two states). */
export function useCl<T>(part: ClPart | ClPart2, p: ClParams = {}) {
  const fx = fixturesOn(), m = fx ? mode() : "";
  const key = queryOf(part, p);
  const live = useData<T>(fx ? null : key);
  const [fix, setFix] = useState<{ data: T | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: fx });
  const reload = useCallback(() => {
    if (!fx) return void live.reload();
    setFix((s) => ({ ...s, loading: true }));
    setTimeout(() => { if (m === "error") return setFix({ data: null, error: true, loading: false }); setFix({ data: (m === "empty" ? emptyFor(part) : fixtureFor(part, p)) as T, error: false, loading: false }); }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, m, key]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (fx) reload(); }, [fx, reload]);
  return fx ? { data: fix.data, error: fix.error ? ({ message: "Could not load this" } as never) : null, loading: fix.loading, reload } : live;
}
