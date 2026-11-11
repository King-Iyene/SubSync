"use client";

import { useCallback, useEffect, useState } from "react";
import type { PmPart, PmMeta } from "@/lib/analytics/payments-types";
import { useData } from "../../session";
import { sample } from "./fixtures";

// The one place the Payments screen reads. Real part names and parameters of GET /api/app/payments?part=... (see src/lib/analytics/payments-types.ts). Sample data is used ONLY when the
// address carries ?pmfx=1 (or empty / error); the real path never touches fixtures.ts, and sample screens say "Sample data".
export type WithMeta<T> = T & PmMeta;
export type PmParams = Record<string, string | number | boolean | undefined | null>;
const FX = /[?&]pmfx(=(1|empty|error))?(&|#|$)/;
function fxFound(): string {
  if (typeof window === "undefined") return "";
  const m = FX.exec(window.location.href);
  try { if (m) sessionStorage.setItem("pm.fx", m[2] ?? "1"); return m ? (m[2] ?? "1") : sessionStorage.getItem("pm.fx") ?? ""; } catch { return m ? (m[2] ?? "1") : ""; }
}
if (typeof window !== "undefined") fxFound();
export const fixturesOn = () => fxFound() !== "";
const mode = () => { const v = fxFound(); return v === "empty" || v === "error" ? v : ""; };

export const queryOf = (part: PmPart, p: PmParams): string => {
  const u = new URLSearchParams({ part });
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, v === true ? "1" : String(v));
  return `payments?${u.toString()}`;
};

export function usePm<T>(part: PmPart, p: PmParams = {}, off = false) {
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

export const notSwitchedOn = (e: unknown) => /not switched on/i.test(String((e as { message?: string } | null)?.message ?? e ?? ""));
