"use client";

import { ChevronRight, X } from "lucide-react";
import { useState, type ReactNode } from "react";

// Two small pieces every clickable chart shares. The hint says what a click does until the first click (then it is gone). The chip says what the page is
// narrowed to after a click, with the way back in the same place, so nobody is left wondering why the numbers changed.

export function ChartHint({ children, used }: { children: ReactNode; /** True once a mark has been clicked: the hint is no longer needed. */ used: boolean }) {
  if (used) return null;
  return <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground" data-testid="chart-hint"><ChevronRight aria-hidden className="size-3.5" />{children}</p>;
}

export function ShowingChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/50 py-0.5 pl-2.5 pr-0.5 text-sm" data-testid="showing-chip">
      <span className="min-w-0 truncate"><span className="text-muted-foreground">Showing: </span><span className="font-medium">{label}</span></span>
      <button type="button" onClick={onClear} aria-label={`Stop showing ${label}`} className="ds-press inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]"><X aria-hidden className="size-4" /></button>
    </span>
  );
}

/** Remembers whether a chart has been clicked, so its hint can go away. */
export function useUsed(): [boolean, () => void] {
  const [used, setUsed] = useState(false);
  return [used, () => setUsed(true)];
}
