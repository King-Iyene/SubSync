"use client";

import { useCallback, useEffect, useState } from "react";
import { useData } from "../../session";
import { sample, type FxParams } from "./fixtures";

// The one place the Today screen reads. Part names and parameters of GET /api/app/today3?part=... (src/lib/analytics/today3-types.ts). Sample data is used ONLY when the address
// carries ?tdfx=1 (or empty / error); the real path never touches fixtures.ts. Every answer also carries the flags, the level and a problem line.
export type TdParams = FxParams;
export type TdMeta = { generatedAt: string; cached: boolean; canSee: boolean; level: "all" | "account" | "self"; flags: Record<string, boolean>; problem: string | null; timezone: string };
export type WithMeta<T> = T & TdMeta;

const FX = /[?&]tdfx=(1|empty|error)/;
function fxFound(): string {
  if (typeof window === "undefined") return "";
  const m = FX.exec(window.location.href);
  try { if (m) sessionStorage.setItem("td3.fx", m[1]); return m ? m[1] : sessionStorage.getItem("td3.fx") ?? ""; } catch { return m ? m[1] : ""; }
}
if (typeof window !== "undefined") fxFound(); // remember ?tdfx at load: the shell may drop the query before the module renders
export const fixturesOn = () => fxFound() !== "";
const mode = () => { const v = fxFound(); return v === "empty" || v === "error" ? v : ""; };

export const queryOf = (part: string, p: TdParams): string => {
  const u = new URLSearchParams({ part });
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") u.set(k, String(v));
  return `today3?${u.toString()}`;
};

/** One part of the Today API, or typed sample data with ?tdfx=1. `off` skips the read. */
export function useTd<T>(part: string, p: TdParams = {}, off = false) {
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

/** A 404 from the part's flag: the screen shows its own plain note instead of an error. */
export const notSwitchedOn = (e: unknown) => /not switched on/i.test(String((e as { message?: string } | null)?.message ?? e ?? ""));

/** True once a read has been loading for `ms` (default 12 s): the screen then says it is slow and offers Try again, so a loading block never sits there for the full minute the request waits. */
export function useSlow(on: boolean, ms = 12_000): boolean {
  const [slow, setSlow] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!on) { setSlow(false); return; } const t = setTimeout(() => setSlow(true), ms); return () => clearTimeout(t); }, [on, ms]);
  return on && slow;
}
