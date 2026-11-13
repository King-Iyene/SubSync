"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  BAR_PRESETS, COMPARES, DEFAULT_RANGE, decodeRange, encodeRange, rangeFromHash, rangeIntoHash, resolveRange, todayOf, type Compare, type RangePreset, type RangeSpec, type Resolved,
} from "@/lib/design/range";
import { zoneWord } from "@/lib/design/zone";
import { pageSpecOf } from "@/lib/design/page-range";
import { readSaved } from "./page-range";
import { bumpRange, subscribeRange } from "./range-store";
import { remember, remembered } from "./remember";

// The range and comparison of ONE card (KF-4), separate from the page's filter bar. The window is always stated on the card in words; the choice is carried
// in the page address (r.<key>=30d.prev), remembered in this browser for next time, and overrides the page for this card only. The numbers under it are
// the page's job: it reads resolved.current (and resolved.compare) and filters or asks for exactly that window, then uses changeBetween / shareChange from
// src/lib/design/range.ts so a tiny base never gets a percentage.
/** Tells every card that the page range changed (the address was rewritten). */
export const notifyRangeChange = bumpRange;
const pageSnapshot = () => encodeRange(pageSpecOf(window.location.hash, readSaved()).spec);

export type CardRangeState = { spec: RangeSpec; resolved: Resolved | null; setSpec: (s: RangeSpec) => void; /** True only while this card has its OWN dates (chosen on the card): otherwise it uses the dates in the bar above. */ overridden: boolean; /** Back to the dates in the bar above. */ followBar: () => void };

/** The state of one card's range. `key` names the card in the address ("speed-trend"); `initial` is the default when nothing is in the link or remembered. */
export function useCardRange(key: string, initial: RangeSpec = DEFAULT_RANGE): CardRangeState {
  const subscribe = subscribeRange;
  const fromLink = useSyncExternalStore(subscribe, () => { const s = rangeFromHash(window.location.hash, key); return s ? encodeRange(s) : ""; }, () => "");
  const saved = useSyncExternalStore(subscribe, () => remembered(`range-${key}`) ?? "", () => "");
  // The global filter bar's range (r.page in the address, else this tab's choice, else the default) is where every card starts, so the numbers under the bar and the
  // label on the card are for the same dates. Only a choice made ON the card (in the address, until the bar changes again) overrides it.
  const pageSnap = useSyncExternalStore(subscribe, pageSnapshot, () => "");
  const spec = useMemo(() => {
    const own = decodeRange(fromLink);
    if (own) return own;
    const page = decodeRange(pageSnap);
    const base = decodeRange(saved) ?? initial;
    return page ? { ...page, compare: page.compare !== "none" ? page.compare : base.compare } : base;
  }, [fromLink, pageSnap, saved, initial]);
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
    bumpRange();
  }, [key]);
  const followBar = useCallback(() => {
    try { window.history.replaceState(null, "", rangeIntoHash(window.location.hash, key, null)); } catch { /* the bar applies again on the next change */ }
    remember(`range-${key}`, null);
    bumpRange();
  }, [key]);
  return { spec, resolved, setSpec, overridden: decodeRange(fromLink) !== null, followBar };
}

const select = "min-h-9 rounded-lg border bg-card px-2 py-1 text-xs outline-none hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring/30";

export function CardRange({ state, label, compares = ["none", "previous", "month", "year"], maxDays }: { state: CardRangeState; label: string; compares?: Compare[]; maxDays?: number }) {
  const { spec, resolved, setSpec, overridden, followBar } = state;
  const [editing, setEditing] = useState(false);
  const options = COMPARES.filter((c) => compares.includes(c.key));
  const short = maxDays !== undefined && resolved && resolved.current.days > maxDays;
  return (
    <div data-testid="card-range" className="text-xs">
      {!overridden && !editing ? (
        <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground" data-testid="card-range-window" aria-live="polite">
          <span>{resolved ? `Dates from the bar above: ${resolved.sentence}, ${zoneWord()} time.` : "Working out the dates..."}</span>
          <button type="button" className="min-h-9 underline" onClick={() => setEditing(true)} data-testid="card-range-change">Change for this card only</button>
        </p>
      ) : (<>
      {overridden && <p className="mb-1.5 inline-flex flex-wrap items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-foreground" role="status" data-testid="card-range-override">This card only: {resolved?.sentence}. <button type="button" className="min-h-9 underline" onClick={() => { followBar(); setEditing(false); }} data-testid="card-range-reset">Use the dates above</button></p>}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Range for ${label}`}>
        <select className={select} aria-label={`${label}: range`} value={spec.preset} onChange={(e) => setSpec({ ...spec, preset: e.target.value as RangePreset, ...(e.target.value === "custom" ? { from: spec.from ?? resolved?.current.from, to: spec.to ?? resolved?.current.to } : {}) })}>
          {BAR_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
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
      </>)}
      {resolved?.problem && <p className="mt-1 border-l-2 border-warning pl-2 text-foreground" role="status">{resolved.problem} Showing the last 30 days instead.</p>}
      {short && <p className="mt-1 text-muted-foreground">Only {maxDays} days of history exist here so far, so the older part of this window is empty.</p>}
    </div>
  );
}
