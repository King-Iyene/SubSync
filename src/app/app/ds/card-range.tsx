"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  COMPARES, DEFAULT_RANGE, decodeRange, encodeRange, PRESETS, rangeFromHash, rangeIntoHash, resolveRange, todayOf, type Compare, type RangePreset, type RangeSpec, type Resolved,
} from "@/lib/design/range";
import { pageRangeFromHash } from "@/lib/design/global-filter";
import { remember, remembered } from "./remember";

// The range and comparison of ONE card (KF-4), separate from the page's filter bar. The window is always stated on the card in words; the choice is carried
// in the page address (r.<key>=30d.prev), remembered in this browser for next time, and overrides the page for this card only. The numbers under it are
// the page's job: it reads resolved.current (and resolved.compare) and filters or asks for exactly that window, then uses changeBetween / shareChange from
// src/lib/design/range.ts so a tiny base never gets a percentage.
const listeners = new Set<() => void>();
const bump = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener("popstate", cb);
  window.addEventListener("hashchange", cb);
  return () => { listeners.delete(cb); window.removeEventListener("popstate", cb); window.removeEventListener("hashchange", cb); };
};

/** Tells every card that the page range changed (the address was rewritten). */
export const notifyRangeChange = bump;

export type CardRangeState = { spec: RangeSpec; resolved: Resolved | null; setSpec: (s: RangeSpec) => void };

/** The state of one card's range. `key` names the card in the address ("speed-trend"); `initial` is the default when nothing is in the link or remembered. */
export function useCardRange(key: string, initial: RangeSpec = DEFAULT_RANGE): CardRangeState {
  const fromLink = useSyncExternalStore(subscribe, () => { const s = rangeFromHash(window.location.hash, key); return s ? encodeRange(s) : ""; }, () => "");
  const saved = useSyncExternalStore(subscribe, () => remembered(`range-${key}`) ?? "", () => "");
  // The global filter bar's range (r.page in the address, else the one remembered for this person) applies to every card that has no choice of its own in the address.
  const pageLink = useSyncExternalStore(subscribe, () => { const s = pageRangeFromHash(window.location.hash); return s ? encodeRange(s) : ""; }, () => "");
  const pageSaved = useSyncExternalStore(subscribe, () => remembered("range-page") ?? "", () => "");
  const spec = useMemo(() => {
    const own = decodeRange(fromLink);
    if (own) return own;
    const page = decodeRange(pageLink) ?? decodeRange(pageSaved);
    const base = decodeRange(saved) ?? initial;
    return page ? { ...page, compare: base.compare } : base;
  }, [fromLink, pageLink, pageSaved, saved, initial]);
  // Today is read in the browser after the page is up (never while it is prepared in advance), so the window is worked out only then.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(todayOf(Date.now()));
  }, []);
  const resolved = useMemo(() => (today ? resolveRange(spec, today) : null), [spec, today]);
  const setSpec = useCallback((s: RangeSpec) => {
    remember(`range-${key}`, encodeRange(s));
    try { window.history.replaceState(null, "", rangeIntoHash(window.location.hash, key, s)); } catch { /* the choice still applies until the page changes */ }
    bump();
  }, [key]);
  return { spec, resolved, setSpec };
}

const select = "min-h-9 rounded-lg border bg-card px-2 py-1 text-xs outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30";

export function CardRange({ state, label, compares = ["none", "previous", "month", "year"], maxDays }: { state: CardRangeState; label: string; compares?: Compare[]; maxDays?: number }) {
  const { spec, resolved, setSpec } = state;
  const options = COMPARES.filter((c) => compares.includes(c.key));
  const short = maxDays !== undefined && resolved && resolved.current.days > maxDays;
  return (
    <div data-testid="card-range" className="text-xs">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Range for ${label}`}>
        <select className={select} aria-label={`${label}: range`} value={spec.preset} onChange={(e) => setSpec({ ...spec, preset: e.target.value as RangePreset, ...(e.target.value === "custom" ? { from: spec.from ?? resolved?.current.from, to: spec.to ?? resolved?.current.to } : {}) })}>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom">Custom dates</option>
        </select>
        {spec.preset === "custom" && (
          <>
            <input type="date" className={select} aria-label={`${label}: from`} value={spec.from ?? ""} max={resolved?.current.to} onChange={(e) => setSpec({ ...spec, from: e.target.value })} />
            <input type="date" className={select} aria-label={`${label}: to`} value={spec.to ?? ""} onChange={(e) => setSpec({ ...spec, to: e.target.value })} />
          </>
        )}
        {options.length > 1 && (
          <select className={select} aria-label={`${label}: compare with`} value={spec.compare} onChange={(e) => setSpec({ ...spec, compare: e.target.value as Compare })}>
            {options.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        )}
      </div>
      <p className="mt-1.5 text-muted-foreground" data-testid="card-range-window" aria-live="polite">{resolved ? resolved.sentence : "Working out the dates..."}</p>
      {resolved?.problem && <p className="mt-1 border-l-2 border-warning pl-2 text-foreground" role="status">{resolved.problem} Showing the last 30 days instead.</p>}
      {short && <p className="mt-1 text-muted-foreground">Only {maxDays} days of history exist here so far, so the older part of this window is empty.</p>}
    </div>
  );
}
