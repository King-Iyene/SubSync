"use client";

import { useCallback, useEffect, useState } from "react";
import type { Cl3Meta, Cl3Part } from "@/lib/analytics/clients3-types";
import { useData } from "../../session";
import { sample, type FxParams } from "./fixtures";

// The one place the Clients screen reads. Real part names and parameter names of GET /api/app/clients3?part=... (see src/lib/analytics/clients3-types.ts). Every answer also carries Cl3Meta
// (flags, canSeeAccounts, problem). Sample data is used ONLY when the address carries ?clfx=1 (or empty / error); the real path never touches fixtures.ts.
export type ClParams = FxParams;
export type WithMeta<T> = T & Cl3Meta;

const FX = /[?&]clfx=(1|empty|error)/;
function fxFound(): string {
  if (typeof window === "undefined") return "";
  const m = FX.exec(window.location.href);
  try { if (m) sessionStorage.setItem("cl3.fx", m[1]); return m ? m[1] : sessionStorage.getItem("cl3.fx") ?? ""; } catch { return m ? m[1] : ""; }
}
if (typeof window !== "undefined") fxFound(); // remember ?clfx at load: the shell may drop the query before the module renders
export const fixturesOn = () => fxFound() !== "";
const mode = () => { const v = fxFound(); return v === "empty" || v === "error" ? v : ""; };

/** The address of one part. Only plain filters go in it; the server decides which accounts the person may see and never trusts an id from here. */
export const queryOf = (part: Cl3Part, p: ClParams): string => {
  const u = new URLSearchParams({ part });
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") u.set(k, String(v));
  return `clients3?${u.toString()}`;
};

/** One part of the Clients API, or typed sample data with ?clfx=1. `off` skips the read (used while a choice is incomplete). */
export function useCl<T>(part: Cl3Part, p: ClParams = {}, off = false) {
  const fx = fixturesOn(), m = fx ? mode() : "";
  const key = queryOf(part, p);
  const live = useData<WithMeta<T>>(fx || off ? null : key);
  const [fix, setFix] = useState<{ data: WithMeta<T> | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: fx && !off });
  const reload = useCallback(() => {
    if (!fx) return void live.reload();
    setFix((s) => ({ ...s, loading: true }));
    setTimeout(() => { if (m === "error") return setFix({ data: null, error: true, loading: false }); setFix({ data: sample(part, p, m === "empty") as WithMeta<T>, error: false, loading: false }); }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, m, key]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (fx && !off) reload(); }, [fx, off, reload]);
  if (!fx) return live;
  return { data: fix.data, error: fix.error ? ({ message: "Could not load this" } as never) : null, loading: fix.loading, reload };
}

/** "This part of Clients is not switched on yet." (a 404 from the part's flag): the screen shows its own plain note instead of an error. */
export const notSwitchedOn = (e: unknown) => /not switched on/i.test(String((e as { message?: string } | null)?.message ?? e ?? ""));
