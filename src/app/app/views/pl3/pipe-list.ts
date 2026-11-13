import type { PipeCard, Pl3Cards } from "@/lib/analytics/pipeline3-types";
import { money, moneyShort } from "./format.ts";

// Pure pieces of the pipeline list (pipes.tsx), kept apart so tests can read them without a browser.
const d = (v: number) => money(v * 100), n = (v: number) => v.toLocaleString("en-US");
export const PIPE_PAGE = 12;

/** Every reason open deals are left out of a pipeline's money, as counts. The same shape feeds a row, the river header and the Overview line, so they cannot disagree. */
export type LeftOutCounts = { zeroValue: number; noOwner: number; test: number; outlier?: number; outlierCents?: number; /** "Count deals without an owner" is on: they are inside the money, so they are not "left out". */ ownerCounted?: boolean; /** Test-named deals are counted (screen toggle or setting). */ testsCounted?: boolean };
export type LeftOutReasonKey = "no_value" | "no_owner" | "test" | "outlier";
const dealsOf = (k: number) => `${n(k)} ${k === 1 ? "deal" : "deals"}`;
/** One entry per reason with a count above zero, in a fixed order. `key` is the drill-down bucket that opens exactly these rows. */
export function leftOutParts(x: LeftOutCounts): Array<{ key: LeftOutReasonKey; count: number; text: string }> {
  const out: Array<{ key: LeftOutReasonKey; count: number; text: string }> = [];
  if (x.zeroValue > 0) out.push({ key: "no_value", count: x.zeroValue, text: `${dealsOf(x.zeroValue)} without a value` });
  if (x.noOwner > 0 && !x.ownerCounted) out.push({ key: "no_owner", count: x.noOwner, text: `${dealsOf(x.noOwner)} without an owner` });
  if (x.test > 0 && !x.testsCounted) out.push({ key: "test", count: x.test, text: `${n(x.test)} test-named` });
  const o = x.outlier ?? 0;
  if (o > 0) out.push({ key: "outlier", count: o, text: `${n(o)} big deal${o === 1 ? "" : "s"} apart${x.outlierCents ? ` (${moneyShort(x.outlierCents)})` : ""}` });
  return out;
}
/** The one quiet sentence: "Left out of the money: 17 deals without a value, 19 deals without an owner." Null when nothing is left out. */
export function leftOutSentence(x: LeftOutCounts | null | undefined): string | null {
  const parts = x ? leftOutParts(x) : [];
  return parts.length ? `Left out of the money: ${parts.map((p) => p.text).join(", ")}.` : null;
}
/** How many deals the line above names (what the parts add up to). */
export const leftOutTotal = (x: LeftOutCounts): number => leftOutParts(x).reduce((a, p) => a + p.count, 0);

/** A row's left-out counts, from its card. `opts` says which of the switches already count their deals. */
export const cardLeftOut = (c: PipeCard, opts: { ownerCounted?: boolean; testsCounted?: boolean } = {}): LeftOutCounts =>
  ({ zeroValue: c.zeroValueCount, noOwner: c.noOwnerCount, test: c.testCount ?? 0, outlier: c.outlierCount, outlierCents: c.outlierValue * 100, ...opts });

/** The quiet notes under a row's name: one short reason each, every reason that left deals out (the counts add up to the deals the row does not count). */
export function rowNotes(c: PipeCard, opts: { ownerCounted?: boolean; testsCounted?: boolean } = {}): string[] {
  return leftOutParts(cardLeftOut(c, opts)).map((p) => p.text);
}

/** The line about deals without an owner: how many are left out, why, and one tap to count them (company setting, with a preview). Null when there is nothing to say. */
export function ownerlessNote(count: number, counted: boolean): { text: string; action: "count" | "leave" | null } | null {
  if (counted) return { text: "Deals without an owner are counted, because \"Count deals without an owner\" is on in Settings, Targets.", action: "leave" };
  if (count <= 0) return null;
  return { text: `${dealsOf(count)} without an owner (not counted in money): assign owners in your CRM or tap Count them.`, action: "count" };
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

/** The Deals column of a pipeline row: every open deal the person gets by clicking in, never only the deals inside the money. `inMoney` is the money-counted part. */
export function dealsCell(c: Pick<PipeCard, "openCount" | "allOpenCount">): { total: number; inMoney: number } {
  return { total: Math.max(c.allOpenCount ?? c.openCount, c.openCount), inMoney: c.openCount };
}
