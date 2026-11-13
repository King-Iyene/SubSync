"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useState } from "react";
import { encodeRange, decodeRange, resolveRange, todayOf, type RangeSpec, type Resolved } from "@/lib/design/range";
import { addressWithRange, compareQuery, pageSpecOf, rangeKeyOf, windowQuery, type Saved } from "@/lib/design/page-range";
import { bumpRange, subscribeRange } from "./range-store";
import { remember, remembered } from "./remember";

// The ONE date range of the app, as a hook. Every screen that shows numbers over time reads its window from here (or from useCardRange, which starts from
// it), so the bar's label, the numbers under it, the charts, the captions and the exports are all for the same dates. Nothing in a screen may work out a
// window of its own ("last 30 days" typed in code); if a screen deliberately uses its own window it says so on screen.

const KEY = "range-page";
const sessionGet = (): string | null => { try { return window.sessionStorage.getItem(`subsync-${KEY}`); } catch { return null; } };
const sessionSet = (v: string | null) => { try { if (v === null) window.sessionStorage.removeItem(`subsync-${KEY}`); else window.sessionStorage.setItem(`subsync-${KEY}`, v); } catch { /* the choice still applies in the address */ } };

export const readSaved = (): Saved => ({ session: sessionGet(), local: remembered(KEY) });

/** Applies a new page range (or the default with null): the address, this tab's memory and every listener, in one step. A custom range lives for this tab only. */
export function applyPageRange(spec: RangeSpec | null) {
  if (spec && spec.preset === "custom") { sessionSet(encodeRange(spec)); remember(KEY, null); }
  else if (spec) { sessionSet(null); remember(KEY, encodeRange({ ...spec, compare: "none" })); }
  else { sessionSet(null); remember(KEY, null); }
  try { window.history.replaceState(null, "", addressWithRange(window.location.hash || "#today", spec)); } catch { /* the choice still applies until the page changes */ }
  window.dispatchEvent(new Event("subsync-range"));
  bumpRange();
}

/** The applied range as one stable string (changes only when the window or comparison changes), for useSyncExternalStore. */
const snapshot = () => encodeRange(pageSpecOf(window.location.hash, readSaved()).spec);

export type PageRange = {
  /** False until today's date is known in the browser (never while the page is prepared in advance): screens send no request until it is true. */
  ready: boolean;
  spec: RangeSpec;
  resolved: Resolved | null;
  /** The applied dates, "2026-10-14" form (UTC days, the end day included). Empty until ready. */
  from: string; to: string; days: number;
  /** "09:00" / "17:30" (Lagos time) when the range has hours (Last hour, Last 24 hours, a custom range with times); otherwise empty. `timed` is true then: figures that only exist per day say "day precision". */
  fromTime: string; toTime: string; timed: boolean;
  /** `from=..&to=..` for a request, and the comparison pairs (empty when there is no comparison). */
  qs: string; cmpQs: string;
  /** Changes whenever the window changes: use it as a React key or in a request key so an answer for other dates is never reused. */
  key: string;
  /** The applied range in words ("Last 30 days, 14 Oct to 12 Nov" or "15 Dec 2023 to 11 Nov 2026"). */
  label: string;
  /** Why a typed range was not applied (the window then falls back to the last 30 days), or null. */
  problem: string | null;
  apply: (s: RangeSpec | null) => void;
};

export function usePageRange(): PageRange {
  const snap = useSyncExternalStore(subscribeRange, snapshot, () => "");
  const spec = useMemo<RangeSpec>(() => decodeRange(snap) ?? pageSpecOf("", { session: null, local: null }).spec, [snap]);
  const [today, setToday] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setToday(todayOf(Date.now())); }, []);
  // "Last hour" and "Last 24 hours" are measured from the moment the bar applied them (the clock is read once per applied range, not on every render).
  // eslint-disable-next-line react-hooks/purity, react-hooks/exhaustive-deps
  const nowMs = useMemo(() => (today ? Date.now() : 0), [today, snap]);
  const resolved = useMemo(() => (today ? resolveRange(spec, today, nowMs) : null), [spec, today, nowMs]);
  const apply = useCallback((s: RangeSpec | null) => applyPageRange(s), []);
  return {
    ready: resolved !== null, spec, resolved,
    from: resolved?.current.from ?? "", to: resolved?.current.to ?? "", days: resolved?.current.days ?? 0,
    fromTime: resolved?.at?.fromTime ?? "", toTime: resolved?.at?.toTime ?? "", timed: resolved?.at != null,
    qs: resolved ? windowQuery(resolved) : "", cmpQs: resolved ? compareQuery(resolved) : "", key: resolved ? rangeKeyOf(resolved) : "",
    label: resolved ? resolved.current.label : "", problem: resolved?.problem ?? null, apply,
  };
}
