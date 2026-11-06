"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { remember, remembered } from "./remember";

// One shared preference for every long list in the app: how dense the rows are (Comfortable or Compact) and how many rows a page shows (20, 50 or 100; the
// server clamps whatever is asked). It lives in this browser only. Every list reads the same value, so changing it in one place changes them all.
export type Density = "comfortable" | "compact";
export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;
const listeners = new Set<() => void>();
let density: Density | null = null;
let size: number | null = null;
const emit = () => listeners.forEach((l) => l());
const readDensity = (): Density => { if (density) return density; return remembered("list-density") === "compact" ? "compact" : "comfortable"; };
const readSize = (): number => { if (size) return size; const n = Number(remembered("list-size")); return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE; };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export function useListPrefs(): { density: Density; size: number; setDensity: (d: Density) => void; setSize: (n: number) => void } {
  const d = useSyncExternalStore(subscribe, readDensity, () => "comfortable" as Density);
  const s = useSyncExternalStore(subscribe, readSize, () => DEFAULT_PAGE_SIZE);
  const setDensity = useCallback((v: Density) => { density = v; remember("list-density", v); emit(); }, []);
  const setSize = useCallback((n: number) => { size = n; remember("list-size", String(n)); emit(); }, []);
  return { density: d, size: s, setDensity, setSize };
}

const seg = (on: boolean) => `inline-flex h-8 items-center px-2.5 text-xs font-medium ${on ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted"}`;
/** The density toggle and the page size selector, one small row. */
export function ListControls({ className = "", sizeToo = true }: { className?: string; sizeToo?: boolean }) {
  const { density: d, size: n, setDensity, setSize } = useListPrefs();
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`} data-testid="list-controls">
      <span className="inline-flex overflow-hidden rounded-md border" role="group" aria-label="Row density">
        <button type="button" className={seg(d === "comfortable")} aria-pressed={d === "comfortable"} onClick={() => setDensity("comfortable")}>Comfortable</button>
        <button type="button" className={seg(d === "compact")} aria-pressed={d === "compact"} onClick={() => setDensity("compact")} data-testid="density-compact">Compact</button>
      </span>
      {sizeToo && <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">Rows per page
        <select value={n} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page" className="h-8 rounded-md border bg-card px-1.5 text-xs text-foreground" data-testid="page-size">
          {PAGE_SIZES.map((v) => <option key={v} value={v}>{v}</option>)}
        </select></label>}
    </div>
  );
}

/** Page numbers to show (0-based): the first, the last, and two either side of the current one, with a gap mark between. */
export function pageNumberList(page: number, pages: number): Array<number | null> {
  const keep = new Set([0, pages - 1, page - 2, page - 1, page, page + 1, page + 2].filter((n) => n >= 0 && n < pages));
  const out: Array<number | null> = []; let prev = -1;
  for (const n of [...keep].sort((a, b) => a - b)) { if (n - prev > 1) out.push(null); out.push(n); prev = n; }
  return out;
}

/** "Showing 41 to 60 of N" with Previous, page numbers and Next. `page` is 0-based. */
export function PageBar({ page, pages, from, to, total, onPage, testId = "page-bar", rangeTestId = "list-range", nextTestId = "page-next" }: { page: number; pages: number; from: number; to: number; total: number; onPage: (p: number) => void; testId?: string; rangeTestId?: string; nextTestId?: string }) {
  const btn = "inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-medium hover:bg-muted disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-muted-foreground" data-testid={testId}>
      <span aria-live="polite" data-testid={rangeTestId}>Showing {from.toLocaleString("en-US")} to {to.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
      {pages > 1 && (
        <span className="flex flex-wrap items-center gap-1">
          <button type="button" aria-label="Previous page" disabled={page <= 0} onClick={() => onPage(page - 1)} className={btn}><ChevronLeft aria-hidden className="size-4" />Previous</button>
          {pageNumberList(page, pages).map((n, i) => n === null ? <span key={`g${i}`} aria-hidden>...</span>
            : <button key={n} type="button" aria-label={`Page ${n + 1}`} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)} className={`${btn} ${n === page ? "!bg-primary !text-primary-foreground" : ""}`}>{n + 1}</button>)}
          <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className={btn} data-testid={nextTestId}>Next<ChevronRight aria-hidden className="size-4" /></button>
        </span>
      )}
    </div>
  );
}
