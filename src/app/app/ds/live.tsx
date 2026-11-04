"use client";

import { useEffect, useState } from "react";

/** The current time, refreshed every `everyMs` (default 30 s), so a wait on screen keeps counting ("waiting 2 h 14 min") without a reload. */
export function useNow(everyMs = 30_000, start?: number): number {
  const [now, setNow] = useState<number>(() => start ?? Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
