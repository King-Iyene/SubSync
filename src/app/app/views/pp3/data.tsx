"use client";

import { useCallback, useEffect, useState } from "react";
import type { PpMeta, PpPart, PpWith } from "@/lib/analytics/people3-types-interim";
import { useData } from "../../session";
import { sample, type FxParams } from "./fixtures";

// The one place the Team screen reads: GET /api/app/people3?part=... (types: src/lib/analytics/people3-types-interim.ts, to be swapped for the data builder's people3-types.ts).
// Every answer also carries PpMeta (flags, ownRowOnly, problem). Sample data is used ONLY when the address carries ?ppfx=1 (or empty / error) and the screen says "Sample data".
export type PpParams = FxParams;
export type { PpMeta, PpWith };

const FX = /[?&]ppfx=(1|empty|error)/;
function fxFound(): string {
  if (typeof window === "undefined") return "";
  const m = FX.exec(window.location.href);
  try { if (m) sessionStorage.setItem("pp3.fx", m[1]); return m ? m[1] : sessionStorage.getItem("pp3.fx") ?? ""; } catch { return m ? m[1] : ""; }
}
if (typeof window !== "undefined") fxFound(); // remember ?ppfx at load: the shell may drop the query before the module renders
export const fixturesOn = () => fxFound() !== "";
const mode = () => { const v = fxFound(); return v === "empty" || v === "error" ? v : ""; };

/** The address of one part. Only plain filters go in it; the server decides which people the caller may see and never trusts an id from here. */
export const queryOf = (part: PpPart, p: PpParams): string => {
  const u = new URLSearchParams({ part });
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") u.set(k, String(v));
  return `people3?${u.toString()}`;
};

/** One part of the Team API, or typed sample data with ?ppfx=1. `off` skips the read (used while a choice is incomplete). */
export function usePp<T>(part: PpPart, p: PpParams = {}, off = false) {
  const fx = fixturesOn(), m = fx ? mode() : "";
  const key = queryOf(part, p);
  const live = useData<PpWith<T>>(fx || off ? null : key);
  const [fix, setFix] = useState<{ data: PpWith<T> | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: fx && !off });
  const reload = useCallback(() => {
    if (!fx) return void live.reload();
    setFix((s) => ({ ...s, loading: true }));
    setTimeout(() => { if (m === "error") return setFix({ data: null, error: true, loading: false }); setFix({ data: sample(part, p, m === "empty") as PpWith<T>, error: false, loading: false }); }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, m, key]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (fx && !off) reload(); }, [fx, off, reload]);
  if (!fx) return live;
  return { data: fix.data, error: fix.error ? ({ message: "Could not load this" } as never) : null, loading: fix.loading, reload };
}

/** A part whose flag is off answers "not switched on": the screen shows its own plain note instead of an error. */
export const notSwitchedOn = (e: unknown) => /not switched on/i.test(String((e as { message?: string } | null)?.message ?? e ?? ""));
