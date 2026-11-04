"use client";

import { useEffect, useState } from "react";

/**
 * The current time, refreshed every `everyMs` (default 30 s), so a wait on screen keeps counting ("waiting 2 h 14 min") without a reload.
 * It starts at `start` (0 unless given) and takes the real time as soon as the page is up, so a page prepared in advance never freezes a clock into its markup.
 */
export function useNow(everyMs = 30_000, start = 0): number {
  const [now, setNow] = useState<number>(start);
  useEffect(() => {
    setNow(Date.now()); // eslint-disable-line react-hooks/set-state-in-effect
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
