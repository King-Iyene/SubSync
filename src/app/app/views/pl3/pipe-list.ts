import type { PipeCard, Pl3Cards } from "@/lib/analytics/pipeline3-types";
import { money, moneyShort } from "./format.ts";

// Pure pieces of the pipeline list (pipes.tsx), kept apart so tests can read them without a browser.
const d = (v: number) => money(v * 100), ds = (v: number) => moneyShort(v * 100), n = (v: number) => v.toLocaleString("en-US");
export const PIPE_PAGE = 12;

/** The quiet notes under a row's name. */
export function rowNotes(c: PipeCard): string[] {
  const out: string[] = [];
  if (c.zeroValueCount > 0) out.push(`${n(c.zeroValueCount)} ${c.zeroValueCount === 1 ? "deal" : "deals"} without a value (not counted in money)`);
  if (c.noOwnerCount > 0) out.push(`${n(c.noOwnerCount)} no owner`);
  if (c.outlierCount > 0) out.push(`${c.outlierCount} big deal${c.outlierCount === 1 ? "" : "s"} apart (${ds(c.outlierValue)}), not added to open money`);
  return out;
}

/** The line about test-named deals: how many are left out and one tap to count them (or leave them out again). Null when there is nothing to say. */
export function testNamesNote(t: Pl3Cards["totals"] | undefined): { text: string; action: "count" | "leave" | null } | null {
  if (!t) return null;
  if (t.countsTests === "setting") return { text: "Deals with test names are counted, because \"Count deals that look like tests\" is on in Settings, Targets.", action: null };
  const k = t.testCount ?? 0;
  if (k <= 0) return null;
  const what = `${n(k)} ${k === 1 ? "deal" : "deals"} (${d(t.testValue ?? 0)})`;
  if (t.countsTests === "toggle") return { text: `${what} with test names ${k === 1 ? "is" : "are"} counted in these rows.`, action: "leave" };
  return { text: `${what} left out: test names.`, action: "count" };
}

export type PageLoad = { n: number; next: string | null };
/** Where the paging stands: rows shown so far, the cursor of the NEXT page (only the last loaded page can offer one), and whether that last page is still loading. One button below the list reads this. */
export function pageProgress(loaded: Record<string, PageLoad | undefined>, rk: string, cursors: string[], total: number): { shown: number; next: string | null; loading: boolean; label: string; done: boolean } {
  const pages = ["", ...cursors], key = (c: string) => `${rk}#${c}`, tail = loaded[key(pages[pages.length - 1])];
  const shown = pages.reduce((a, c) => a + (loaded[key(c)]?.n ?? 0), 0), next = tail?.next ?? null;
  const shownOfTotal = Math.min(shown, Math.max(total, shown));
  return { shown, next, loading: tail === undefined, label: `Showing ${n(shownOfTotal)} of ${n(Math.max(total, shown))}`, done: tail !== undefined && next === null };
}
