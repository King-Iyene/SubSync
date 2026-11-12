import type { Td3Kind, Td3OpenKind } from "./today3-types";

/** The kinds still open, biggest first, zero dropped. The counts add up to the still-open total, so the rows behind them can be checked against it. `labelOf` gives the plain words. */
export function openKindsOf(m: ReadonlyMap<Td3Kind, number>, labelOf: (kind: Td3Kind, count: number) => string): Td3OpenKind[] {
  return [...m.entries()].filter(([, c]) => c > 0).map(([kind, count]) => ({ kind, label: labelOf(kind, count), count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}
