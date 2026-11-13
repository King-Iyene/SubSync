"use client";

import { onDataChanged } from "./data-changed";
import { quietRefreshDelay } from "@/lib/sync/incremental";
import { plainError } from "@/lib/design/plain-error";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Holds the signed session in memory (never storage or cookies: third-party cookies are
// unreliable inside an iframe) and wraps fetch so every call carries it. On a 401 it asks the
// host page for fresh user context once and retries.

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(plainError(status, body));
    this.status = status;
    this.body = body;
  }
}

/** How long a read may take before it stops with a message (milliseconds). */
export const REQUEST_TIMEOUT_MS = 60_000;

export type Api = {
  /** `fresh` (a Try again) skips the shared and held answers and sends a new request, so it never joins a read that is stuck. */
  get: <T>(path: string, opts?: { fresh?: boolean; swr?: boolean }) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body?: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
  download: (path: string, filename: string) => Promise<void>;
  demo: boolean;
  /** The last answer this browser tab got for a read (kept in memory only, never in storage), or undefined. A screen shows it at once and refreshes it in the background. */
  peek?: <T>(path: string) => T | undefined;
  /** Start a read now so the answer is waiting when the person clicks (hover, idle). Never throws. */
  prefetch?: (path: string) => void;
  /** The same client with a filter (like industry=medical) added to every read. */
  filtered: (query: string) => Api;
  /** The filter added to every read ("" when none). It is part of what an answer is FOR: an answer read under another filter is never shown under this one. */
  scope?: string;
};

// How many reads are on their way right now, so the filter bar can say "Updating the numbers" after a date or client change instead of leaving old numbers
// under a new label with no sign that they are about to change.
let readsOnTheWay = 0;
const inflightListeners = new Set<() => void>();
const touchInflight = (by: number) => { readsOnTheWay = Math.max(0, readsOnTheWay + by); inflightListeners.forEach((l) => l()); };
export function useInflight(): number {
  return useSyncExternalStore((cb) => { inflightListeners.add(cb); return () => { inflightListeners.delete(cb); }; }, () => readsOnTheWay, () => 0);
}
/** The part of a read's address that decides which dates it is for (from, to, days and the comparison). Two reads with the same key are for the same window. */
export function rangeKeyOfPath(path: string | null): string {
  if (!path) return "";
  const q = path.indexOf("?");
  if (q === -1) return "";
  const p = new URLSearchParams(path.slice(q + 1));
  return ["from", "to", "wfrom", "wto", "days", "cmpFrom", "cmpTo", "period", "since", "weeks", "months"].map((k) => p.get(k) ?? "").join("|");
}

const ApiContext = createContext<Api | null>(null);
export const ApiProvider = ApiContext.Provider;
/** The client with no filter added: Today's report tabs use it when a tab's own client choice replaces the header's. */
export const RootApiContext = createContext<Api | null>(null);
export const RootApiProvider = RootApiContext.Provider;
export function useRootApi(): Api | null { return useContext(RootApiContext); }

export function useApiClient(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiProvider is missing");
  return api;
}

// Two parts of a screen often ask for the very same read at the same moment (the options of a list, the freshness line). One request answers them all: an identical GET that is
// still on its way is shared, each asker gets its own copy of the answer, and any change (POST, PUT, DELETE) drops the shared reads so a refresh after a change always asks again.
const inflight = new WeakMap<object, Map<string, Promise<unknown>>>();

// Answers held for 20 seconds so a click back to a heavy tab is instant. Only the Speed to lead and Appointments part reads (not the live race); every change drops them.
const RECENT_MS = 20_000;
const recent = new WeakMap<object, Map<string, { at: number; data: unknown }>>();
const heavyPath = (path: string) => /^(speed|appointments)(\/[a-z-]+)?\?/.test(path) && path.includes("part=") && !path.includes("part=race");
function recentAnswer(shared: object, key: string, path: string): unknown {
  if (!heavyPath(path)) return undefined;
  const hit = recent.get(shared)?.get(key);
  return hit && Date.now() - hit.at < RECENT_MS ? hit.data : undefined;
}
function rememberAnswer(shared: object, key: string, path: string, data: unknown) {
  if (!heavyPath(path)) return;
  let m = recent.get(shared); if (!m) { m = new Map(); recent.set(shared, m); }
  if (m.size > 60) m.clear();
  m.set(key, { at: Date.now(), data });
}
function forgetRecent(shared: object) { recent.get(shared)?.clear(); }

// Round 6 (lightning fast): the LAST answer of every read, kept in memory for the life of the page (never localStorage or cookies: it is customer data). A screen opened again renders from it
// at once and asks again in the background; the new answer replaces it. The key holds the filter and the exact address (dates included), so an answer is never shown for another window or client set.
const held = new WeakMap<object, Map<string, unknown>>();
function holdAnswer(shared: object, key: string, data: unknown) {
  let m = held.get(shared); if (!m) { m = new Map(); held.set(shared, m); }
  if (m.size > 150) m.delete(m.keys().next().value as string);
  m.delete(key); m.set(key, data);
}
const copy = <T,>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : v);

export function makeApi(initialToken: string, refresh: () => Promise<string | null>, demo: boolean, filterQuery = "", shared: { token: string } = { token: initialToken }): Api {
  const sharedReads = (): Map<string, Promise<unknown>> => { let m = inflight.get(shared); if (!m) { m = new Map(); inflight.set(shared, m); } return m; };
  const request = async (method: string, path: string, body?: unknown, retried = false): Promise<Response> => {
    // A filter only narrows what is read; it is added to every GET. A share link of the audit is made from a read, so it carries the filter too:
    // the link covers the client accounts the person was looking at (N8), and the server decides which accounts those are.
    const url = (method === "GET" || path === "audit/share") && filterQuery && !path.startsWith("segments") ? `${path}${path.includes("?") ? "&" : "?"}${filterQuery}` : path;
    // Nothing waits forever: a read that has not answered in a minute (a change in two) stops with a plain message and a Try again, so a panel is never silently blank.
    const counted = method === "GET"; if (counted) touchInflight(1);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), method === "GET" ? REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS * 2);
    let res: Response;
    try {
      res = await fetch(`/api/app/${url}`, {
        method,
        headers: { Authorization: `Bearer ${shared.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch (e) {
      throw e instanceof DOMException && e.name === "AbortError" ? new ApiError(408, { error: "This is taking too long. Nothing was lost: try again in a moment." }) : new ApiError(0, { error: "SubSync could not be reached. Check your connection and try again." });
    } finally { clearTimeout(timer); if (counted) touchInflight(-1); }
    if (res.status === 401 && !retried) {
      const fresh = await refresh();
      if (fresh) {
        shared.token = fresh;
        return request(method, path, body, true);
      }
    }
    return res;
  };
  const parse = async <T,>(res: Response): Promise<T> => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data as Record<string, unknown>);
    return data as T;
  };
  return {
    demo,
    scope: filterQuery,
    filtered: (query: string) => makeApi(initialToken, refresh, demo, query, shared),
    peek: <T,>(path: string) => { const v = held.get(shared)?.get(`${filterQuery}|${path}`); return v === undefined ? undefined : copy(v as T); },
    prefetch: (path: string) => { const key = `${filterQuery}|${path}`; if (held.get(shared)?.has(key) || sharedReads().has(key)) return; void makeApi(initialToken, refresh, demo, filterQuery, shared).get(path).catch(() => undefined); },
    get: async <T,>(path: string, opts?: { fresh?: boolean; swr?: boolean }): Promise<T> => {
      const reads = sharedReads(), key = `${filterQuery}|${path}`, running = opts?.fresh ? undefined : reads.get(key);
      if (opts?.fresh) {
        // Try again: a new request that is not tied to one already on its way (which may be the stuck one); the answer replaces what is shared.
        const sep = path.includes("?") ? "&" : "?";
        const p = (async () => { const data = await parse<T>(await request("GET", `${path}${sep}_r=${Date.now().toString(36)}`)); rememberAnswer(shared, key, path, data); holdAnswer(shared, key, data); return data; })();
        reads.set(key, p);
        const done = () => { if (reads.get(key) === p) reads.delete(key); };
        p.then(done, done);
        return p;
      }
      if (running) { const data = await (running as Promise<T>); return typeof structuredClone === "function" ? structuredClone(data) : data; }
      // Round 4: going back to a Speed to lead or Appointments tab within 20 seconds shows the answer already held (a change drops them; the server also keeps its own for 30 s).
      const recentHit = opts?.swr ? undefined : recentAnswer(shared, key, path);
      if (recentHit !== undefined) return (typeof structuredClone === "function" ? structuredClone(recentHit) : recentHit) as T;
      const p = (async () => { const data = await parse<T>(await request("GET", path)); rememberAnswer(shared, key, path, data); holdAnswer(shared, key, data); return data; })();
      reads.set(key, p);
      const done = () => { if (reads.get(key) === p) reads.delete(key); };
      p.then(done, done);
      return p;
    },
    post: async (path, body) => { sharedReads().clear(); forgetRecent(shared); try { return await parse(await request("POST", path, body ?? {})); } finally { sharedReads().clear(); } },
    put: async (path, body) => { sharedReads().clear(); forgetRecent(shared); try { return await parse(await request("PUT", path, body ?? {})); } finally { sharedReads().clear(); } },
    del: async (path) => { sharedReads().clear(); forgetRecent(shared); try { return await parse(await request("DELETE", path)); } finally { sharedReads().clear(); } },
    download: async (path, filename) => {
      const res = await request("GET", path);
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}

// Load data for a view. `reload` refetches; changing `path` refetches automatically.
export function useData<T>(path: string | null) {
  const api = useApiClient();
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean; key: string }>(() => {
    const h = path !== null ? api.peek?.<T>(path) : undefined;
    return h !== undefined ? { data: h, error: null, loading: false, key: `${api.scope ?? ""}#${rangeKeyOfPath(path)}` } : { data: null, error: null, loading: path !== null, key: "" };
  });
  // What an answer is FOR: the client accounts counted (the api's filter) and the dates asked. An answer for another window or another set of clients is never
  // handed to a screen that now shows this one (stale numbers under a new label), only a Loading state until the new answer arrives.
  const askedKey = `${api.scope ?? ""}#${rangeKeyOfPath(path)}`;
  // The path being shown right now. An answer is used when it is for this path, even if a newer request for the same path started meanwhile: a screen that asks again every few seconds
  // (a refresh, a poll) must not throw away every slow answer and stay on its loading state forever. An answer for a path the screen has moved away from is dropped.
  const current = useRef<string | null>(path);
  useEffect(() => { current.current = path; }, [path]);

  // Only the newest request of this screen may answer: an older one that is still stuck must not overwrite a retry that came back.
  const seq = useRef(0);
  const lastRead = useRef(0); // when this screen last asked the server (a background change is not re-read sooner than a minute after it)
  const run = useCallback(async (fresh: boolean, quiet = false) => {
    if (path === null) return;
    const mine = ++seq.current;
    lastRead.current = Date.now();
    const key = `${api.scope ?? ""}#${rangeKeyOfPath(path)}`;
    // A quiet re-read (after a sync landed): ask the server again, keep what is on screen untouched until the answer arrives (no spinner, no skeleton, no jump), and keep it if the read fails.
    if (quiet) {
      try {
        const data = await api.get<T>(path, { fresh: true });
        if (current.current === path && mine === seq.current) setState({ data, error: null, loading: false, key });
      } catch { /* the screen keeps the numbers it has */ }
      return;
    }
    // Last answer for exactly this read (same dates, same client filter): show it now, refresh quietly. A "Try again" always shows its loading state.
    const heldAnswer = fresh ? undefined : api.peek?.<T>(path);
    if (heldAnswer !== undefined) setState({ data: heldAnswer, error: null, loading: false, key });
    else setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get<T>(path, fresh ? { fresh: true } : heldAnswer !== undefined ? { swr: true } : undefined);
      if (current.current === path && mine === seq.current) setState({ data, error: null, loading: false, key });
    } catch (error) {
      // A background refresh that fails keeps the answer already on screen.
      if (current.current === path && mine === seq.current && !(heldAnswer !== undefined && !fresh)) setState({ data: null, error: error as ApiError, loading: false, key });
    }
  }, [api, path]);
  // `reload` is what "Try again" and every refresh after a change call: it always asks the server again.
  const load = useCallback(() => run(true), [run]);

  // After any sync lands (automatic, real-time, manual or full) every open read of this screen is asked again quietly. Counts and lists come from the same answer, so they still agree.
  // A person's sync re-reads at once. A background change (the server finishes a read every few minutes on a busy account) is held back: at most one quiet re-read a minute per screen, spread out so the
  // screen's reads do not all hit the server together, and not at all while the tab is hidden (it re-reads when the tab comes back). Before this every finished background read made every open screen reload.
  useEffect(() => {
    if (path === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let waiting = false;
    const go = () => { timer = null; waiting = false; lastRead.current = Date.now(); void run(true, true); };
    const off = onDataChanged((d) => {
      const delay = quietRefreshDelay({ force: d.force === true, nowMs: Date.now(), lastReadMs: lastRead.current, spread01: Math.random() });
      if (delay === null) { if (timer) clearTimeout(timer); go(); return; }
      if (timer || waiting) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") { waiting = true; return; }
      timer = setTimeout(go, delay);
    });
    const onVisible = () => { if (waiting && document.visibilityState === "visible") { waiting = false; timer = setTimeout(go, quietRefreshDelay({ force: false, nowMs: Date.now(), lastReadMs: lastRead.current, spread01: Math.random() }) ?? 0); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { off(); document.removeEventListener("visibilitychange", onVisible); if (timer) clearTimeout(timer); };
  }, [path, run]);

  useEffect(() => {
    // Subscribing to the server for this path; the result is stored when it arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(false);
  }, [run]);

  const stale = path !== null && state.key !== askedKey && (state.data !== null || state.error !== null);
  return stale ? { data: null, error: null, loading: true, reload: load } : { data: state.data, error: state.error, loading: state.loading, reload: load };
}
