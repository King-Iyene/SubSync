import type { ClAgencyInfo, ClAccount, ClDrillRow, ClOverview, ClPerson, ClReason, ClReasonKey, ClReportRow, ClSetupRow, ClTrendRow } from "@/lib/analytics/clients3-types-interim";

// Sample data only (no database). Open Clients with ?clfx=1 (or empty / error) to see every state. 160 accounts prove the lists scale.
const NAMES = ["Northside Roofing", "Bright Smiles Dental", "Lakeview Realty", "Harbor Med Spa", "Summit Solar", "Cedar Coaching", "Ironwood HVAC", "Maple Family Law"];
const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
export const LABEL: Record<string, string> = { waiting: "waiting for a reply", slow: "slow first replies", noshow: "no-shows not rebooked", unmarked: "appointments with no outcome", stale: "stuck deals", quiet: "staff gone quiet", leads_down: "fewer new leads", no_owner: "leads with no owner", sync: "out of date" };
export const ACCOUNTS: ClAccount[] = Array.from({ length: 160 }, (_, i) => {
  const r = (k: number) => rnd(i, k);
  const leads = 20 + Math.floor(r(1) * 140), waiting = r(2) > 0.97 ? 3 + Math.floor(r(3) * 15) : 0, unmarked = r(4) > 0.98 ? 2 + Math.floor(r(5) * 7) : 0, noShow = r(6) > 0.985 ? 1 + Math.floor(r(7) * 5) : 0;
  const stale = r(8) > 0.98 ? 0.4 + Math.round(r(9) * 30) / 100 : Math.round(r(9) * 25) / 100, staff = 2 + Math.floor(r(10) * 6), active = Math.max(0, staff - (r(11) > 0.98 ? 3 : 0));
  const prev = Math.round(leads * (0.85 + r(13) * 0.3)), connection: ClAccount["connection"] = i % 37 === 5 ? "reconnect" : i % 41 === 7 ? "scopes" : "ok";
  const pairs: Array<[ClReasonKey, number]> = [["waiting", waiting], ["unmarked", unmarked], ["noshow", noShow], ["stale", stale >= 0.4 ? Math.round(stale * 30) : 0], ["quiet", staff - active > 1 ? staff - active : 0], ["leads_down", leads < prev * 0.75 ? prev - leads : 0]];
  const reasons: ClReason[] = pairs.filter(([, c]) => c > 0).map(([key, count]) => ({ key, label: LABEL[key], count }));
  return { locationId: `loc${i}`, name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`, reasons, leads, leadsPrev: prev, waiting, medianReplyMin: r(14) > 0.1 ? Math.round(3 + r(15) * 90) : null,
    booked: Math.floor(leads * 0.3), showed: Math.floor(leads * 0.2), noShow, unmarked, dealsOpen: 5 + Math.floor(r(16) * 60), staleShare: stale, wonCents: Math.round(r(17) * 40000) * 100, lostCents: Math.round(r(18) * 20000) * 100,
    staffTotal: staff, staffActive: active, missingOwner: r(19) > 0.7 ? Math.floor(r(20) * 12) : 0, missingPhone: Math.floor(r(21) * 6),
    syncedAt: new Date(Date.UTC(2026, 10, 11, 6) - (connection === "ok" ? (i % 5) * 3_600_000 : 3 * 86_400_000)).toISOString(), connection };
});
export const needsList = () => ACCOUNTS.filter((a) => a.reasons.length > 0).sort((a, b) => b.reasons.length - a.reasons.length || b.reasons.reduce((s, r) => s + r.count, 0) - a.reasons.reduce((s, r) => s + r.count, 0));
export const OVERVIEW: ClOverview = (() => {
  const n = needsList(), top = n.slice(0, 3);
  return { accounts: ACCOUNTS.length, needAttention: n.length, healthy: ACCOUNTS.length - n.length, historySince: "2026-10-01",
    totals: { leads: ACCOUNTS.reduce((s, a) => s + a.leads, 0), waiting: ACCOUNTS.reduce((s, a) => s + a.waiting, 0), unmarked: ACCOUNTS.reduce((s, a) => s + a.unmarked, 0), staleDealsCents: 41_800_000 },
    today: { sentence: `${n.length} of ${ACCOUNTS.length} client accounts need a look. Start with ${top[0].name}.`, steps: top.map((a) => ({ title: `${a.reasons[0].count} ${a.reasons[0].label}`, count: a.reasons[0].count, accountName: a.name, locationId: a.locationId, reason: a.reasons[0].key })) } };
})();
const wk = ["Oct 12", "Oct 19", "Oct 26", "Nov 2", "Nov 9"];
export const TRENDS: ClTrendRow[] = ACCOUNTS.map((a, i) => ({ locationId: a.locationId, name: a.name, weeks: wk, leads: wk.map((_, k) => Math.round((a.leads / 4) * (0.7 + rnd(i, 30 + k) * 0.6))), answeredPct: wk.map((_, k) => (k === 0 && i % 9 === 0 ? null : Math.round(60 + rnd(i, 40 + k) * 40))), booked: wk.map((_, k) => Math.round((a.booked / 4) * (0.6 + rnd(i, 50 + k) * 0.8))), wonCents: wk.map((_, k) => Math.round((a.wonCents / 4) * (0.5 + rnd(i, 60 + k)))) }));
export const REPORTS: ClReportRow[] = ACCOUNTS.map((a) => ({ locationId: a.locationId, name: a.name, came: a.leads, answered: Math.max(0, a.leads - a.waiting), booked: a.booked, showed: a.showed, won: Math.round(a.wonCents / 500000), wonCents: a.wonCents, caught: a.reasons.reduce((s, r) => s + r.count, 0) }));
export const PEOPLE: ClPerson[] = ACCOUNTS.slice(0, 40).flatMap((a, i) => Array.from({ length: a.staffTotal }, (_, k) => ({ id: `u${i}-${k}`, locationId: a.locationId, accountName: a.name, name: ["Mia Okafor", "Dan Reyes", "Priya Shah", "Leo Grant", "Ana Silva", "Tom Weber"][k % 6], sent: k < a.staffActive ? 5 + Math.floor(rnd(i, 70 + k) * 120) : 0, lastActive: k < a.staffActive ? "2026-11-10" : null, idle: k >= a.staffActive })));
export const SETUP: ClSetupRow[] = ACCOUNTS.map((a) => ({ locationId: a.locationId, name: a.name, connection: a.connection, missingScopes: a.connection === "scopes" ? ["Conversations", "Calendars"] : [], syncedAt: a.syncedAt }));
export const drillRows = (n: number, reason: string, name: string): ClDrillRow[] => Array.from({ length: Math.min(n, 12) }, (_, i) => ({ id: `${reason}${i}`, title: `${["Contact", "Lead", "Deal"][i % 3]} ${i + 1} (${name})`, sub: `${i + 1} day${i ? "s" : ""} ago`, url: null }));

const PLANS = ["Starter", "Growth", "Pro"];
export const AGENCY: ClAgencyInfo[] = ACCOUNTS.map((a, i) => ({ locationId: a.locationId, name: a.name,
  billing: i % 11 === 4 ? null : { plan: PLANS[i % 3], status: i % 13 === 2 ? "failed" : i % 17 === 3 ? "trial" : i % 29 === 6 ? "cancelled" : "active", failedCount: i % 13 === 2 ? 1 + (i % 3) : 0, nextPayment: i % 29 === 6 ? null : "2026-11-" + String(12 + (i % 15)).padStart(2, "0"), amountCents: (99 + (i % 3) * 100) * 100 },
  apps: i % 9 === 1 ? null : { installed: 1 + (i % 5), names: ["Reviews", "Booking page", "Reports", "Texting", "Calls"].slice(0, 1 + (i % 5)), setupDone: 3 + (i % 3), setupTotal: 6 } }));
