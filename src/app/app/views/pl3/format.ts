// Money is whole cents everywhere. Short form for tight labels, full form for tables and tooltips.
export const money = (cents: number): string => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
export const moneyShort = (cents: number): string => {
  const d = cents / 100, a = Math.abs(d);
  return a >= 1_000_000 ? `$${(d / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M` : a >= 10_000 ? `$${Math.round(d / 1000)}k` : a >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${Math.round(d)}`;
};
export const pct = (r: number | null): string => (r === null ? "Not enough data" : `${Math.round(r * 100)}%`);
export const days = (d: number | null): string => (d === null ? "No data yet" : `${d} d`);
