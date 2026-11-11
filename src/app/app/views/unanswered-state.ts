"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readListParams, toQuery, type ListParams } from "@/lib/analytics/unanswered-params";

// The choices that shape the list (tab, search, wait, owner, channel, client, deal value, sort, page size), kept in the address as ?u=owner%3Dnone so a link opens the same list.
// Only non-default choices are written; the page number is not (a shared link opens the first page). The address is read once, then the screen owns the state.

export type Choices = Omit<ListParams, "page">;
export const DEFAULT_CHOICES: Choices = { tab: "us", q: "", account: null, owner: null, channel: null, bucket: null, minValue: 0, state: "active", sort: "wait", size: 20, quiet: 24 };

function fromAddress(seePeople: boolean): Choices {
  if (typeof window === "undefined") return DEFAULT_CHOICES;
  try {
    const u = new URLSearchParams(window.location.search).get("u");
    if (!u) return DEFAULT_CHOICES;
    const r = readListParams(new URLSearchParams(u), { seePeople });
    if (!r.ok) return DEFAULT_CHOICES;
    const { page: _page, ...rest } = r.p; void _page;
    return rest;
  } catch { return DEFAULT_CHOICES; }
}

/** One place for the list's choices. `set` changes some of them and goes back to page one. */
export function useChoices(seePeople: boolean, enabled = true) {
  const [choices, setChoices] = useState<Choices>(() => (enabled ? fromAddress(seePeople) : DEFAULT_CHOICES));
  const [page, setPage] = useState(0);
  const first = useRef(true);
  const set = useCallback((patch: Partial<Choices>) => { setChoices((c) => ({ ...c, ...patch })); setPage(0); }, []);
  const reset = useCallback(() => { setChoices(DEFAULT_CHOICES); setPage(0); }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!enabled) return;
    try {
      const url = new URL(window.location.href);
      const q = toQuery(choices);
      if (q) url.searchParams.set("u", q); else url.searchParams.delete("u");
      window.history.replaceState(window.history.state, "", url);
    } catch { /* the address is a convenience */ }
  }, [choices, enabled]);
  return { choices, page, setPage, set, reset };
}

/** The list's address for the server (page included). */
export function listPath(c: Choices, page: number): string {
  const q = toQuery({ ...c, tab: c.tab });
  const sp = new URLSearchParams(q);
  sp.set("part", "list2"); sp.set("tab", c.tab); sp.set("size", String(c.size)); sp.set("page", String(page));
  return `inbox?${sp}`;
}

/** The link to the list as it is now. */
export function shareLink(c: Choices): string {
  const url = new URL(window.location.href);
  const q = toQuery(c);
  if (q) url.searchParams.set("u", q); else url.searchParams.delete("u");
  return url.toString();
}

/** True when any choice differs from the default (the "Clear" button shows). */
export const isNarrowed = (c: Choices) => toQuery(c) !== "";

/** Keys seen before, so a person who appears on a later read can be marked new for a few seconds (the live pulse). */
export function useNewKeys(keys: readonly string[], ms = 9000): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const joined = keys.join("|");
  useEffect(() => {
    if (keys.length === 0 && known.current === null) return;
    if (known.current === null) { known.current = new Set(keys); return; }
    const added = keys.filter((k) => !known.current!.has(k));
    for (const k of keys) known.current.add(k);
    if (added.length === 0) return;
    setFresh((p) => new Set([...p, ...added]));
    setTimeout(() => setFresh((p) => { const n = new Set(p); for (const k of added) n.delete(k); return n; }), ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, ms]);
  return fresh;
}
