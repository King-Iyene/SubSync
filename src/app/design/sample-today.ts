import { buildQueue, emptyTotals, KINDS, proofOf, type AccountFacts, type AlertFact, type Kind, type TodayItem, type Totals } from "@/lib/analytics/today-queue";

// Made-up items for Today's building blocks on /design. The SAME pure functions the real page uses (buildQueue, slicesOf, accountBars, proofOf) build the queue,
// the slices and the bars from them, so the style guide cannot show a number the app would count differently. Nothing here is a real person or business.
const NOW = Date.parse("2026-11-03T12:00:00Z");
const DAY = 86_400_000;
const FIRST = ["Ada", "Ben", "Chloe", "Dmitri", "Esi", "Femi", "Grace", "Hugo"];
const LAST = ["Okafor", "Silva", "Meyer", "Haddad", "Tanaka", "Brown"];
const ACCOUNTS: AccountFacts[] = ["demoMapleDental", "demoHarborRealty", "demoNorthRoofing", "demoSunriseSpa", "demoBrightSolar"].map((id, i) => ({
  id, name: ["Maple Dental", "Harbor Realty", "North Roofing", "Sunrise Med Spa", "Bright Solar"][i], followUpEstimate: [null, 4200, null, 1800, null][i], url: "https://example.com/open",
}));
// kind, account index, how many, value of each (deals only)
const PLAN: Array<[Kind, number, number, number | null]> = [
  ["replies", 0, 5, null], ["replies", 1, 3, null], ["replies", 3, 2, null], ["appointments", 2, 4, null], ["noshows", 3, 3, null],
  ["stale", 1, 4, 2400], ["stale", 4, 2, 6300], ["replies", 2, 2, null],
];
let n = 0;
export const SAMPLE_TODAY_ITEMS: TodayItem[] = PLAN.flatMap(([kind, a, count, value]) => Array.from({ length: count }, (_, j) => {
  n += 1;
  return {
    id: `s${n}`, kind, locationId: ACCOUNTS[a].id, accountName: ACCOUNTS[a].name, name: `${FIRST[n % FIRST.length]} ${LAST[(n * 3) % LAST.length]}`,
    detail: kind === "stale" ? `$${value} in Proposal, no change for ${34 + j * 7} days` : kind === "replies" ? `Waiting ${1 + j} h` : "Waiting for a reply",
    at: NOW - (kind === "stale" ? (34 + j * 7) * DAY : kind === "appointments" ? (2 + j) * DAY : (1 + j) * 3_600_000),
    value, contactId: `demoContact${n}`, url: "https://example.com/open", never: kind === "replies" && j === 0 && a === 0, newLead: kind === "replies" && j < 2,
  };
}));
export const SAMPLE_TODAY_TOTALS: Totals = (() => {
  const t = emptyTotals();
  for (const k of KINDS) { const m = SAMPLE_TODAY_ITEMS.filter((x) => x.kind === k); t[k] = { count: m.length, dollars: k === "stale" ? m.reduce((s, x) => s + (x.value ?? 0), 0) : null, shown: m.length, ...(k === "replies" ? { newLeads: m.filter((x) => x.newLead).length } : {}) }; }
  return t;
})();
export const SAMPLE_TODAY_QUEUE = buildQueue({ items: SAMPLE_TODAY_ITEMS, totals: SAMPLE_TODAY_TOTALS, accounts: new Map(ACCOUNTS.map((a) => [a.id, a])), staleDays: 30, now: NOW });
export const SAMPLE_PICKER_ACCOUNTS = ACCOUNTS.map((a) => ({ id: a.id, name: a.name }));
export const SAMPLE_REPLY_POINTS = ([[41, "28 Oct"], [38, "29 Oct"], [35, "30 Oct"], [37, "31 Oct"], [29, "1 Nov"], [26, "2 Nov"], [22, "3 Nov"]] as const)
  .map(([m, d]) => ({ label: d, value: m * 60, note: `Leads that arrived in the 7 days up to ${d}` }));

const alert = (id: string, a: number, created: number, resolved: number | null): AlertFact => ({
  id, locationId: ACCOUNTS[a].id, accountName: ACCOUNTS[a].name, title: ["14 conversations waiting over 4h", "5 stale deals worth $12,300", "3 no-shows in the last 3 days"][a % 3], severity: "warning", createdAt: created, resolvedAt: resolved,
});
export const SAMPLE_PROOF = proofOf([
  alert("p1", 1, NOW - 6 * DAY, NOW - 4 * DAY), alert("p2", 2, NOW - 5 * DAY, NOW - 3 * DAY), alert("p3", 3, NOW - 5 * DAY, NOW - 5 * DAY + 3_600_000), alert("p4", 0, NOW - 3 * DAY, NOW - 1 * DAY),
  alert("p5", 1, NOW - 2 * DAY, null), alert("p6", 4, NOW - 1 * DAY, NOW - 3_600_000), alert("p7", 2, NOW - 5 * 3_600_000, null),
], NOW);
