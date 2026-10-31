// The speed-to-lead cost calculator on the home page. Leads that wait too long are assumed lost; the share lost is the
// visitor's own number, so the result is their estimate, not ours.
export function leadCost(leadsPerMonth: number, closeRatePct: number, dealValue: number, slowSharePct: number) {
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, Number.isFinite(n) ? n : 0));
  const leads = clamp(leadsPerMonth, 1_000_000);
  const close = clamp(closeRatePct, 100) / 100;
  const value = clamp(dealValue, 10_000_000);
  const slow = clamp(slowSharePct, 100) / 100;
  const lostLeads = leads * slow;
  const lostPerMonth = lostLeads * close * value;
  return { lostLeads: Math.round(lostLeads), lostPerMonth: Math.round(lostPerMonth), lostPerYear: Math.round(lostPerMonth * 12) };
}
