"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Holds the signed session in memory (never storage or cookies: third-party cookies are
// unreliable inside an iframe) and wraps fetch so every call carries it. On a 401 it asks the
// host page for fresh user context once and retries.

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

/** How long a read may take before it stops with a message (milliseconds). */
export const REQUEST_TIMEOUT_MS = 60_000;

export type Api = {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body?: unknown) => Promise<T>;
  del: <T>(path: string) => Promise<T>;
  download: (path: string, filename: string) => Promise<void>;
  demo: boolean;
  /** The same client with a filter (like industry=medical) added to every read. */
  filtered: (query: string) => Api;
};

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

export function makeApi(initialToken: string, refresh: () => Promise<string | null>, demo: boolean, filterQuery = "", shared: { token: string } = { token: initialToken }): Api {
  const request = async (method: string, path: string, body?: unknown, retried = false): Promise<Response> => {
    // A filter only narrows what is read; it is added to every GET. A share link of the audit is made from a read, so it carries the filter too:
    // the link covers the client accounts the person was looking at (N8), and the server decides which accounts those are.
    const url = (method === "GET" || path === "audit/share") && filterQuery && !path.startsWith("segments") ? `${path}${path.includes("?") ? "&" : "?"}${filterQuery}` : path;
    // Nothing waits forever: a read that has not answered in a minute (a change in two) stops with a plain message and a Try again, so a panel is never silently blank.
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
    } finally { clearTimeout(timer); }
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
    filtered: (query: string) => makeApi(initialToken, refresh, demo, query, shared),
    get: async (path) => parse(await request("GET", path)),
    post: async (path, body) => parse(await request("POST", path, body ?? {})),
    put: async (path, body) => parse(await request("PUT", path, body ?? {})),
    del: async (path) => parse(await request("DELETE", path)),
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
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: path !== null });
  // The path being shown right now. An answer is used when it is for this path, even if a newer request for the same path started meanwhile: a screen that asks again every few seconds
  // (a refresh, a poll) must not throw away every slow answer and stay on its loading state forever. An answer for a path the screen has moved away from is dropped.
  const current = useRef<string | null>(path);
  useEffect(() => { current.current = path; }, [path]);

  const load = useCallback(async () => {
    if (path === null) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await api.get<T>(path);
      if (current.current === path) setState({ data, error: null, loading: false });
    } catch (error) {
      if (current.current === path) setState({ data: null, error: error as ApiError, loading: false });
    }
  }, [api, path]);

  useEffect(() => {
    // Subscribing to the server for this path; the result is stored when it arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return { ...state, reload: load };
}
