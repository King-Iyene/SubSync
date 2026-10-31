// The agency profit calculator on the home page. One price per client account; the agency sets its own client price.
export const SUBSYNC_PRICE = 9;

export function profit(accounts: number, clientPrice: number, ourPrice = SUBSYNC_PRICE) {
  const n = Math.max(0, Math.floor(Number.isFinite(accounts) ? accounts : 0));
  const price = Math.max(0, Number.isFinite(clientPrice) ? clientPrice : 0);
  const cost = n * ourPrice;
  const revenue = n * price;
  return { accounts: n, cost, revenue, margin: revenue - cost, yearlyMargin: (revenue - cost) * 12 };
}
