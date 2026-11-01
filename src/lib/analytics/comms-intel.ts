// Communication, setup and daily-priority rules (spec 4.3, 4.18, 11.1, 12.1). Pure and unit tested.

// ---------------- reply aging (4.3) ----------------

export type AgingBucket = { label: string; min: number; max: number; count: number };

// How long the customers who are waiting for a reply have waited (N15). The hours passed in must be the waiting set the Inbox list shows
// (the customer wrote last, past the reply target, inside the window), so the chart and the list can never disagree.
// "Critical" is a customer who has waited more than a day but is still worth winning: up to a week. A thread older than a week is in the
// "Older than a week" bucket and is never critical, so an alarm is never raised on data that is mostly dead.
export const CRITICAL_FROM_HOURS = 24;
export const CRITICAL_UNTIL_HOURS = 7 * 24;

// The wait buckets, one list for this function and for the chart on the Unanswered messages page, so the two cannot disagree.
export const AGING_DEFS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: "Under 1 hour", min: 0, max: 1 }, { label: "1 to 4 hours", min: 1, max: 4 }, { label: "4 to 12 hours", min: 4, max: 12 },
  { label: "12 to 24 hours", min: 12, max: 24 }, { label: "24 to 48 hours", min: 24, max: 48 }, { label: "2 to 7 days", min: 48, max: CRITICAL_UNTIL_HOURS },
  { label: "Older than a week", min: CRITICAL_UNTIL_HOURS, max: Infinity },
];

export function replyAging(waitingHours: number[]): { buckets: AgingBucket[]; critical: number; older: number; total: number } {
  const buckets: AgingBucket[] = AGING_DEFS.map((d) => ({ ...d, count: 0 }));
  const valid = waitingHours.filter((h) => Number.isFinite(h) && h >= 0);
  for (const h of valid) {
    const bucket = buckets.find((x) => h >= x.min && h < x.max);
    if (bucket) bucket.count++;
  }
  return {
    buckets,
    critical: valid.filter((h) => h >= CRITICAL_FROM_HOURS && h < CRITICAL_UNTIL_HOURS).length,
    older: valid.filter((h) => h >= CRITICAL_UNTIL_HOURS).length,
    total: valid.length,
  };
}

// ---------------- after hours (4.18) ----------------

export function afterHoursSummary(i: { leads: number; afterHours: number; weekend: number; afterHoursWonValue: number; afterHoursWonCount: number }) {
  const pct = (n: number) => (i.leads > 0 ? Math.round((n / i.leads) * 100) : null);
  const afterPct = pct(i.afterHours);
  return {
    leads: i.leads, afterHours: i.afterHours, afterHoursPct: afterPct, weekend: i.weekend, weekendPct: pct(i.weekend),
    wonValue: i.afterHoursWonValue, wonCount: i.afterHoursWonCount,
    // 4.18: when a real share of leads arrive while nobody is at their desk, an after-hours answer pays for itself.
    suggestion: afterPct !== null && afterPct >= 30 && i.leads >= 20
      ? `${afterPct}% of new contacts arrive outside business hours (weekdays 9 to 5, their local time). Consider an automatic reply or an after-hours setter.`
      : null,
  };
}

// ---------------- setup score (11.1) ----------------

export type SetupFacts = {
  pipelines: number | null; calendars: number | null; contacts: number; completenessPct: number;
  emailAuth: "ok" | "warning" | "critical" | "error" | "unchecked"; daysInactive: number | null;
};

// 0 to 100 from six things that mean an account is actually set up to work. Calendar and pipeline
// counts of null mean "not synced yet", which is treated as unknown, not as missing.
export function setupScore(f: SetupFacts): { score: number; missing: string[] } {
  const missing: string[] = [];
  let score = 0;
  const part = (ok: boolean | null, points: number, label: string) => {
    if (ok === null) { score += points / 2; return; }
    if (ok) score += points; else missing.push(label);
  };
  part(f.pipelines === null ? null : f.pipelines > 0, 25, "a sales pipeline");
  part(f.calendars === null ? null : f.calendars > 0, 15, "a booking calendar");
  part(f.contacts > 0, 15, "any contacts");
  part(f.completenessPct >= 60, 15, "complete contact data (60% or more)");
  if (f.emailAuth === "unchecked") { score += 10; } else part(f.emailAuth === "ok", 20, "working email authentication (SPF, DKIM, DMARC)");
  part(f.daysInactive !== null && f.daysInactive <= 30, 10, "recent activity");
  return { score: Math.min(100, Math.round(score)), missing };
}

export function worstDomainStatus(statuses: string[]): SetupFacts["emailAuth"] {
  if (statuses.length === 0) return "unchecked";
  for (const s of ["critical", "error", "warning"] as const) if (statuses.includes(s)) return s;
  return "ok";
}

// ---------------- daily priorities (12.1, rule-based) ----------------

export type Priority = { key: string; title: string; detail: string; go: string; preset?: string };

export type BriefInput = {
  newLeadsLastHour: number;
  overSla: number; oldestWaitingHours: number | null;
  topDeal: { name: string; account: string | null; value: number; score: number; reason: string } | null;
  vipsNeedingContact: number;
  atRiskAccounts: number; dormantAccounts: number;
  renewalsWithin30: number;
  staleValue: number; staleDeals: number;
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Fixed order of importance: money walking away today comes first, slow burns last.
export function dailyPriorities(i: BriefInput, limit = 5): Priority[] {
  const out: Priority[] = [];
  if (i.newLeadsLastHour > 0) out.push({ key: "speed", title: `${plural(i.newLeadsLastHour, "new lead")} in the last hour with no reply`, detail: "The first business to respond usually wins. Call them now.", go: "calls", preset: "lead_recency" });
  if (i.overSla > 0) out.push({ key: "sla", title: `${plural(i.overSla, "message")} waiting past your reply target`, detail: i.oldestWaitingHours ? `The oldest has waited ${Math.round(i.oldestWaitingHours)} hours.` : "Reply before they go elsewhere.", go: "inbox" });
  if (i.topDeal) out.push({ key: "deal", title: `${i.topDeal.name} (${money(i.topDeal.value)}) is slipping`, detail: `${i.topDeal.account ?? "A client"}: risk ${i.topDeal.score} of 100. ${i.topDeal.reason}.`, go: "pipeline" });
  if (i.vipsNeedingContact > 0) out.push({ key: "vip", title: `${plural(i.vipsNeedingContact, "valuable contact")} not contacted in 30+ days`, detail: "A quick check-in protects your best relationships.", go: "leads" });
  if (i.renewalsWithin30 > 0) out.push({ key: "renewal", title: `${plural(i.renewalsWithin30, "client renewal")} due within 30 days`, detail: "Prepare the review and the value you delivered.", go: "clients" });
  if (i.atRiskAccounts + i.dormantAccounts > 0) out.push({ key: "accounts", title: `${plural(i.atRiskAccounts + i.dormantAccounts, "client")} at risk or gone quiet`, detail: "Reach out before they cancel.", go: "accounts" });
  if (i.staleDeals > 0) out.push({ key: "stale", title: `${money(i.staleValue)} sitting in ${plural(i.staleDeals, "stale deal")}`, detail: "Move them forward or close them out.", go: "deals" });
  return out.slice(0, limit);
}
