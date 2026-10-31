// The shared definitions behind every deal number on every screen (docs/METRICS.md). Pure functions, no database.
// One definition of a counted deal, one minimum for a win rate, one outlier rule. Screens never calculate these themselves.

/** A win rate, a forecast or anything built on one needs at least this many closed (won or lost) deals. */
export const MIN_CLOSED_DEALS = 20;

/** One deal this large a share of a dollar figure is called out on the card. */
export const OUTLIER_SHARE = 0.5;
/** An outlier note needs at least this many deals, so a single-deal account is not flagged for being itself. */
export const OUTLIER_MIN_DEALS = 3;

export type DealLike = { status: string; value: number; assignedTo?: string | null };

export const isOpenDeal = (d: DealLike) => d.status === "open";

/** A counted deal has a value above zero and a person it belongs to. Only counted open deals feed a dollar figure or a count. */
export const isCounted = (d: DealLike) => Number.isFinite(d.value) && d.value > 0 && Boolean(d.assignedTo);

export const countedOpen = <T extends DealLike>(deals: T[]): T[] => deals.filter((d) => isOpenDeal(d) && isCounted(d));

export function openPipeline(deals: DealLike[]) {
  const open = deals.filter(isOpenDeal);
  const counted = open.filter(isCounted);
  const left = open.filter((d) => !isCounted(d));
  return {
    count: counted.length,
    value: counted.reduce((s, d) => s + d.value, 0),
    excludedCount: left.length,
    noValue: left.filter((d) => !(d.value > 0)).length,
    noOwner: left.filter((d) => d.value > 0 && !d.assignedTo).length,
  };
}

/** Won divided by won plus lost, or null (with the number still needed) below the minimum. */
export function winRateOf(won: number, lost: number, min = MIN_CLOSED_DEALS): { rate: number | null; closed: number; needed: number } {
  const closed = won + lost;
  return { rate: closed >= min ? won / closed : null, closed, needed: Math.max(0, min - closed) };
}

export function winRate(deals: DealLike[]): number | null {
  return winRateOf(deals.filter((d) => d.status === "won").length, deals.filter((d) => d.status === "lost").length).rate;
}

/** The one deal that dominates a dollar figure, if any: the largest counted open deal when it is at least half the total. */
export function outlier(deals: DealLike[]): { value: number; share: number; of: number } | null {
  const counted = countedOpen(deals);
  if (counted.length < OUTLIER_MIN_DEALS) return null;
  const total = counted.reduce((s, d) => s + d.value, 0);
  const top = Math.max(...counted.map((d) => d.value));
  const share = total > 0 ? top / total : 0;
  return share >= OUTLIER_SHARE ? { value: top, share: Math.round(share * 100) / 100, of: counted.length } : null;
}
