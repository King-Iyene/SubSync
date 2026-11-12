// The pure side of the Today figure strip (no browser, no database). One strip, two lines of figures, one source for "Money at risk".
// Rule: the money figures come from the money read only (Td3Money). The older number from the item list is used ONLY when the money read is hidden for this person, never beside it.
import type { Td3Money, Td3Today } from "./today3-types";

/** Slots of the strip, in order. The skeleton draws exactly these, so nothing jumps when the figures arrive. */
export const STRIP_MAIN_SLOTS = ["risk", "recovered", "pipeline", "revenue"] as const;
export const STRIP_SUB_SLOTS = ["noshows", "appts", "done"] as const;

/** How many figures a line shows: money line is 4 with the revenue card, 3 without; the second line is always 3. */
export const mainSlots = (revenue: boolean): readonly string[] => (revenue ? STRIP_MAIN_SLOTS : STRIP_MAIN_SLOTS.filter((s) => s !== "revenue"));

/** The one "Money at risk" figure. Returns the money read's number when it exists; otherwise (money hidden for this person) the older item-list number. Never both. */
export function riskFigure(m: Td3Money | null, t: Pick<Td3Today, "items">): { dollars: number | null; deals: number; source: "money" | "items" } {
  if (m && !m.hidden && m.atRisk) return { dollars: m.atRisk.dollars, deals: m.atRisk.deals, source: "money" };
  const stale = t.items.find((i) => i.kind === "stale_deals");
  const dollars = t.items.reduce((s, i) => s + (i.money ?? 0), 0);
  return { dollars: dollars > 0 ? dollars : null, deals: stale?.count ?? 0, source: "items" };
}

/** An obvious test value: a round million or more per deal, or one big round deal in an account whose other deals are tiny. A note only, nothing is hidden or changed. */
export function looksLikeTestDeal(dollars: number | null, deals: number, other?: { dollars: number | null; deals: number }): boolean {
  if (dollars === null || deals <= 0) return false;
  const avg = dollars / deals;
  if (avg >= 1_000_000 && avg % 100_000 === 0) return true;
  if (deals === 1 && avg >= 100_000 && avg % 10_000 === 0 && other && other.dollars !== null && other.deals > 1) {
    const rest = (other.dollars - dollars) / (other.deals - 1);
    if (rest > 0 && avg >= rest * 20) return true;
  }
  return false;
}
