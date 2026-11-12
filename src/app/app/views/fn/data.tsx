"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCardRange } from "../../ds";
import { useApiClient, useData } from "../../session";
import { sample } from "./fixtures";
import type { FnPage } from "./types";

// The one place Finance reads. Real parts and parameters of GET /api/app/finance?part=... Sample data is used ONLY when the address carries ?fnfx (the real path never calls fixtures.ts) and
// every sample screen says "Sample data". The date comes from the shell's date bar (useCardRange follows it), so every number is for the range the bar shows.
export type Params = Record<string, string | number | boolean | undefined | null>;
const FX = /[?&]fnfx(=(1|empty|error))?(&|#|$)/;
function fxFound(): string {
  if (typeof window === "undefined") return "";
  const m = FX.exec(window.location.href);
  try { if (m) sessionStorage.setItem("fn.fx", m[2] ?? "1"); return m ? (m[2] ?? "1") : sessionStorage.getItem("fn.fx") ?? ""; } catch { return m ? (m[2] ?? "1") : ""; }
}
if (typeof window !== "undefined") fxFound();
export const fnfxOn = () => fxFound() !== "";
const fxMode = () => { const v = fxFound(); return v === "empty" || v === "error" ? v : ""; };
export const notSwitchedOn = (e: unknown) => /not switched on/i.test(String((e as { message?: string } | null)?.message ?? e ?? ""));
export const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "That did not work. Nothing was changed.");

export const queryOf = (part: string, p: Params): string => {
  const u = new URLSearchParams({ part });
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== "" && v !== false) u.set(k, v === true ? "1" : String(v));
  return `finance?${u.toString()}`;
};

/** The shell's date range, resolved to inclusive days. `ready` is false until today is known in the browser. */
export function useWindow() {
  const r = useCardRange("finance");
  const w = r.resolved?.current ?? null;
  return { ready: w !== null, from: w?.from ?? "", to: w?.to ?? "", label: w?.label ?? "", days: w?.days ?? 0 };
}

/** One read. `ranged` adds the shell's date range. `off` skips the read. */
export function useFn<T>(part: string, p: Params = {}, o: { ranged?: boolean; off?: boolean } = {}) {
  const win = useWindow();
  const fx = fnfxOn(), mode = fx ? fxMode() : "";
  const full = { ...p, ...(o.ranged ? { from: win.from, to: win.to } : {}) };
  const wait = Boolean(o.off) || (Boolean(o.ranged) && !win.ready);
  const key = queryOf(part, full);
  const live = useData<T>(fx || wait ? null : key);
  const [fix, setFix] = useState<{ data: T | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: fx && !wait });
  const reload = useCallback(() => {
    if (!fx) return void live.reload();
    setFix((s) => ({ ...s, loading: true }));
    setTimeout(() => { if (mode === "error") return setFix({ data: null, error: true, loading: false }); setFix({ data: sample(part, full, mode === "empty") as T, error: false, loading: false }); }, 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, mode, key]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (fx && !wait) reload(); }, [fx, wait, reload]);
  if (!fx) return wait ? { data: null as T | null, error: null, loading: !o.off, reload } : live;
  return { data: fix.data, error: fix.error ? ({ message: "Could not load this" } as never) : null, loading: fix.loading, reload };
}

/** A list read with keyset paging: the first page, then "Show more" adds the next page. `first` is the whole first answer (totals and tiles ride along with it). */
export function useKeyset<R, X extends FnPage<R> = FnPage<R>>(part: string, p: Params = {}, o: { ranged?: boolean; off?: boolean; size?: number } = {}) {
  const api = useApiClient(), win = useWindow();
  const fx = fnfxOn(), mode = fx ? fxMode() : "";
  const size = o.size ?? 20;
  const full = { ...p, ...(o.ranged ? { from: win.from, to: win.to } : {}), size };
  const wait = Boolean(o.off) || (Boolean(o.ranged) && !win.ready);
  const base = queryOf(part, full);
  const [st, setSt] = useState<{ rows: R[]; next: string | null; total: number; first: X | null; loading: boolean; more: boolean; error: unknown }>({ rows: [], next: null, total: 0, first: null, loading: !wait, more: false, error: null });
  const seq = useRef(0);
  const run = useCallback(async (cursor: string | null) => {
    const me = ++seq.current;
    setSt((s) => ({ ...s, loading: cursor === null, more: cursor !== null, error: null }));
    try {
      const data: X = fx ? ((await new Promise<unknown>((res, rej) => setTimeout(() => (mode === "error" ? rej(new Error("Could not load this")) : res(sample(part, { ...full, cursor }, mode === "empty"))), 100))) as X) : await api.get<X>(cursor ? `${base}&cursor=${encodeURIComponent(cursor)}` : base);
      if (me !== seq.current) return;
      setSt((s) => ({ rows: cursor ? [...s.rows, ...data.rows] : data.rows, next: data.next, total: data.total, first: cursor ? s.first : data, loading: false, more: false, error: null }));
    } catch (error) { if (me === seq.current) setSt((s) => ({ ...s, loading: false, more: false, error })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, base, fx, mode]);
  useEffect(() => { if (!wait) void run(null); else setSt((s) => ({ ...s, rows: [], first: null, loading: !o.off })); }, [wait, run, o.off]);
  return { ...st, showMore: () => st.next && void run(st.next), reload: () => void run(null) };
}
