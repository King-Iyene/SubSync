import { delta, rate, reasonsOf, levelOf, summaryOf, todayOf, type AccountSignals } from "@/lib/analytics/clients3-intel";
import type {
  Cl3Account, Cl3Billing, Cl3Compare, Cl3List, Cl3ListRow, Cl3Options, Cl3Overview, Cl3People, Cl3Person, Cl3Reason, Cl3Receipt, Cl3ReceiptList, Cl3Setup, Cl3SetupList, Cl3Side, Cl3Trends,
} from "@/lib/analytics/clients3-types";

// SAMPLE DATA ONLY (open Clients with ?clfx=1, ?clfx=empty or ?clfx=error). No database, no real clients; the screen says "Sample data" whenever this is used. 160 accounts prove the lists scale.
// The reasons, levels and "what to do today" sentence come from the same pure rules the server uses (clients3-intel), so the sample behaves like the real thing.
const NAMES = ["Northside Roofing", "Bright Smiles Dental", "Lakeview Realty", "Harbor Med Spa", "Summit Solar", "Cedar Coaching", "Ironwood HVAC", "Maple Family Law"];
const INDUSTRIES = ["Home services", "Dental", "Real estate", "Med spa", "Solar", "Coaching", "Home services", "Legal"];
const FIRST = ["Ava", "Liam", "Noah", "Mia", "Ella", "Owen", "Zoe", "Eli", "Ivy", "Max"], LAST = ["Brown", "Khan", "Silva", "Reed", "Okafor", "Lopez", "Nguyen", "Ward"];
const rnd = (i: number, k: number) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const NOW = Date.parse("2026-11-11T08:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

export const ACCOUNTS: Cl3Account[] = Array.from({ length: 160 }, (_, i) => {
  const r = (k: number) => rnd(i, k);
  const cur = 20 + Math.floor(r(1) * 140), prev = Math.round(cur * (0.85 + r(13) * 0.3)) + (r(20) > 0.97 ? 60 : 0);
  const waiting = r(2) > 0.95 ? 3 + Math.floor(r(3) * 15) : 0, waitingOld = waiting > 0 && r(21) > 0.5 ? Math.ceil(waiting / 2) : 0;
  const unmarked = r(4) > 0.96 ? 3 + Math.floor(r(5) * 7) : 0, noshows = r(6) > 0.97 ? 3 + Math.floor(r(7) * 4) : 0;
  const open = 5 + Math.floor(r(16) * 60), stale = r(8) > 0.96 ? Math.round(open * 0.6) : Math.round(open * r(9) * 0.3);
  const staff = 2 + Math.floor(r(10) * 6), quiet = r(11) > 0.96 ? 2 : 0;
  const syncAge = r(30) > 0.97 ? 80 : 1 + r(31) * 10, needsPermission = i % 37 === 5 ? ["calendar"] : i % 41 === 7 ? ["users"] : [];
  const noOwner = Math.round(r(32) * 120), contacts = 400 + Math.floor(r(33) * 3000), noPhone = Math.round(r(34) * 90);
  const newLeads = delta(cur, prev);
  const sig: AccountSignals = { newLeads, waiting, waitingOld, unmarked, noshows, staleDeals: stale, openDeals: open, noOwner: rate(noOwner, contacts), noPhone: rate(noPhone, contacts), staffQuiet: quiet, syncAgeHours: syncAge, needsPermission, hasAnyData: true };
  const reasons = reasonsOf(sig), level = levelOf(sig, reasons);
  const booked = Math.floor(cur * 0.3);
  return {
    locationId: `loc${i}`, name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${Math.floor(i / NAMES.length) + 1}` : ""}`, industry: INDUSTRIES[i % NAMES.length], level, summary: level === "ok" ? null : summaryOf(reasons), reasons,
    newLeads, booked: delta(booked, Math.round(booked * (0.8 + r(35) * 0.4))), wonValue: delta(Math.round(r(17) * 40000), Math.round(r(18) * 40000), 1),
    waiting, waitingOld, medianReplyMinutes: r(14) > 0.1 ? Math.round((3 + r(15) * 90) * 10) / 10 : null, unmarked, noshows, staleDealsPct: rate(stale, open, 5), openValue: Math.round(open * (1000 + r(36) * 4000)),
    staffMessages: delta(Math.round(cur * 4 * r(37)), Math.round(cur * 4 * r(38))), staffActive: Math.max(0, staff - quiet), staffIdle: quiet, noOwnerPct: sig.noOwner, noPhonePct: sig.noPhone,
    lastSyncAt: iso(NOW - syncAge * 3_600_000), syncOld: syncAge > 24, needsPermission, sparkLeads: [...Array(8)].map((_, k) => Math.round(cur * (0.7 + rnd(i, 50 + k) * 0.6))), historyStarts: "2026-09-14", enough: true, url: null, quieted: [],
  };
});

const pageOf = <T,>(all: T[], page: number, size: number) => { const pages = Math.max(1, Math.ceil(all.length / size)), p = Math.min(Math.max(0, page), pages - 1); return { rows: all.slice(p * size, p * size + size), total: all.length, page: p, size, pages, truncated: false }; };
const RANK = { act: 0, watch: 1, unknown: 2, ok: 3 } as const;
const byAttention = (a: Cl3Account, b: Cl3Account) => RANK[a.level] - RANK[b.level] || b.reasons.length - a.reasons.length || a.name.localeCompare(b.name);
export type FxParams = Record<string, string | number | undefined>;
const text = (p: FxParams, k: string) => String(p[k] ?? "");
const filtered = (p: FxParams) => {
  const q = text(p, "q").toLowerCase(), ind = text(p, "industry");
  return ACCOUNTS.filter((a) => (!q || a.name.toLowerCase().includes(q)) && (!ind || a.industry === ind));
};

function overview(p: FxParams): Cl3Overview {
  const a = filtered(p), sorted = [...a].sort(byAttention), sum = (f: (x: Cl3Account) => number) => a.reduce((t, x) => t + f(x), 0);
  const top = new Map<Cl3Reason, { reason: Cl3Reason; count: number; label: string; why: string }>();
  for (const x of a) for (const r of x.reasons) { const e = top.get(r.reason); top.set(r.reason, e ? { ...e, count: e.count + r.count } : { ...r }); }
  return {
    period: { from: "2026-10-12", to: "2026-11-11", days: 30 }, today: todayOf(sorted), accounts: a.length, ok: a.filter((x) => x.level === "ok").length, watch: a.filter((x) => x.level === "watch").length, act: a.filter((x) => x.level === "act").length, unknown: 0,
    totals: { newLeads: delta(sum((x) => x.newLeads.current), sum((x) => x.newLeads.previous)), booked: delta(sum((x) => x.booked.current), sum((x) => x.booked.previous)), wonValue: delta(sum((x) => x.wonValue.current), sum((x) => x.wonValue.previous), 1), waiting: sum((x) => x.waiting), unmarked: sum((x) => x.unmarked) },
    topReasons: [...top.values()].sort((x, y) => y.count - x.count).slice(0, 6), worst: sorted.filter((x) => x.level !== "ok").slice(0, 5), historyStarts: "2026-09-14",
  };
}
function attention(p: FxParams) {
  const all = filtered(p), levels = { act: 0, watch: 0, ok: 0, unknown: 0 };
  for (const x of all) levels[x.level]++;
  const lv = text(p, "level"), sort = text(p, "sort");
  let rows = all.filter((x) => !lv || x.level === lv).sort(byAttention);
  if (sort === "name") rows = [...rows].sort((x, y) => x.name.localeCompare(y.name) * (p.dir === "desc" ? -1 : 1));
  if (sort === "leads") rows = [...rows].sort((x, y) => y.newLeads.current - x.newLeads.current);
  if (sort === "waiting") rows = [...rows].sort((x, y) => y.waiting - x.waiting);
  if (sort === "won") rows = [...rows].sort((x, y) => y.wonValue.current - x.wonValue.current);
  return { ...pageOf(rows, Number(p.page ?? 0), Number(p.size ?? 20)), levels };
}
function trends(p: FxParams): Cl3Trends {
  const a = filtered(p), month = p.grain === "month", n = month ? 6 : 8;
  const points = [...Array(n)].map((_, k) => ({ start: iso(NOW - (n - k) * (month ? 30 : 7) * 86_400_000).slice(0, 10), newLeads: 900 + Math.round(rnd(k, 1) * 300), booked: 280 + Math.round(rnd(k, 2) * 80), showed: 200 + Math.round(rnd(k, 3) * 60), noshow: 40 + Math.round(rnd(k, 4) * 20), won: 60 + Math.round(rnd(k, 5) * 20), wonValue: 40000 + Math.round(rnd(k, 6) * 30000), staffMessages: 3000 + Math.round(rnd(k, 7) * 800), waitingEnd: Math.round(rnd(k, 8) * 30) }));
  const rows = a.map((x) => ({ locationId: x.locationId, name: x.name, newLeads: x.newLeads, booked: x.booked, wonValue: x.wonValue, staffMessages: x.staffMessages, spark: x.sparkLeads }));
  return { grain: month ? "month" : "week", currentFrom: "2026-11-02", previousFrom: "2026-10-26", points, rows: pageOf(rows, Number(p.page ?? 0), Number(p.size ?? 20)), historyStarts: "2026-09-14" };
}
function compare(p: FxParams): Cl3Compare {
  const ids = text(p, "ids").split(",").filter(Boolean).slice(0, 2);
  const sides: Cl3Side[] = ids.map((id) => ACCOUNTS.find((x) => x.locationId === id)).filter((x): x is Cl3Account => !!x).map((x) => ({
    locationId: x.locationId, name: x.name, industry: x.industry, level: x.level, newLeads: x.newLeads.current, booked: x.booked.current, showRate: rate(Math.round(x.booked.current * 0.7), x.booked.current), waiting: x.waiting, medianReplyMinutes: x.medianReplyMinutes,
    wonValue: x.wonValue.current, openValue: x.openValue, staleDealsPct: x.staleDealsPct, staffMessages: x.staffMessages.current, noOwnerPct: x.noOwnerPct, spark: x.sparkLeads,
  }));
  return { sides, period: { from: "2026-10-12", to: "2026-11-11" } };
}
function receipts(p: FxParams): Cl3ReceiptList {
  const rows: Cl3Receipt[] = filtered(p).map((x) => {
    const cameIn = x.newLeads.current, answered = Math.round(cameIn * 0.9);
    return { locationId: x.locationId, name: x.name, weekStart: "2026-11-02", weekEnd: "2026-11-08", enough: cameIn >= 5, cameIn, cameInPrev: x.newLeads.previous, answered, answeredFast: Math.round(answered * 0.7), stillWaiting: x.waiting, medianReplyMinutes: x.medianReplyMinutes, booked: x.booked.current, showed: Math.round(x.booked.current * 0.7), noshow: x.noshows, unmarked: x.unmarked, dealsStarted: 6, won: 3, wonValue: x.wonValue.current, lostValue: 1200,
      lines: [`${cameIn} new enquiries came in (${x.newLeads.previous} the week before).`, `${answered} were answered by the team.`, `${x.booked.current} appointments booked.`], historyStarts: "2026-09-14" };
  });
  return { weekStart: "2026-11-02", rows, total: rows.length };
}
function people(p: FxParams): Cl3People {
  const all: Cl3Person[] = ACCOUNTS.slice(0, 60).flatMap((a, i) => [...Array(3)].map((_, k) => { const idle = (i + k) % 11 === 0; return { userId: `u${i}-${k}`, name: `${FIRST[(i + k) % 10]} ${LAST[(i * 3 + k) % 8]}`, locationId: a.locationId, accountName: a.name, messagesSent: idle ? 0 : 20 + Math.round(rnd(i, k) * 200), leadsTouched: idle ? 0 : 10 + Math.round(rnd(k, i) * 60), lastActiveAt: iso(NOW - (idle ? 12 : 0.5 + rnd(i, k)) * 86_400_000), idleDays: idle ? 12 : 0, idle }; }));
  const q = text(p, "q").toLowerCase(), rows = all.filter((x) => !q || x.name.toLowerCase().includes(q) || x.accountName.toLowerCase().includes(q)).sort((a, b) => Number(b.idle) - Number(a.idle));
  return { ...pageOf(rows, Number(p.page ?? 0), Number(p.size ?? 20)), idleCount: rows.filter((x) => x.idle).length, accountsWithoutStaff: 2 };
}
function setup(p: FxParams): Cl3SetupList {
  const rows: Cl3Setup[] = filtered(p).map((x) => {
    const bad = x.needsPermission.length > 0, help = [...(bad ? ["Needs permission: reconnect"] : []), ...(x.syncOld ? ["Data is out of date"] : [])];
    return { locationId: x.locationId, name: x.name, connected: true, lastSyncAt: x.lastSyncAt, syncOld: x.syncOld, scopes: { calendar: x.needsPermission.includes("calendar") ? ("needs_permission" as const) : ("ok" as const), users: x.needsPermission.includes("users") ? ("needs_permission" as const) : ("ok" as const) },
      message: bad ? "Needs permission: reconnect" : null, contacts: 800, conversations: 300, appointments: 90, deals: 40, channelsSeen: ["sms", "email"], users: 4, usersState: x.needsPermission.includes("users") ? ("needs_permission" as const) : ("ok" as const), needsHelp: help };
  }).sort((a, b) => b.needsHelp.length - a.needsHelp.length);
  return { ...pageOf(rows, Number(p.page ?? 0), Number(p.size ?? 20)), needAction: rows.filter((x) => x.needsHelp.length > 0).length };
}
function billing(p: FxParams) {
  const rows: Cl3Billing[] = filtered(p).map((x, i) => {
    const state = i % 19 === 3 ? "needs_permission" : i % 23 === 4 ? "not_available" : i % 29 === 5 ? "no_plan" : "ok";
    return { locationId: x.locationId, name: x.name, state, plan: state === "ok" ? "Growth plan" : null, subscriptionStatus: state === "ok" ? (i % 17 === 2 ? "past_due" : "active") : null, paymentFailing: null, nextPaymentAt: null, appsInstalled: null, fetchedAt: iso(NOW - 3_600_000), message: state === "needs_permission" ? "Needs permission: reconnect" : state === "no_plan" ? "Not on a plan" : state === "not_available" ? "Not available from the platform yet" : null } as Cl3Billing;
  });
  return { ...pageOf(rows, Number(p.page ?? 0), Number(p.size ?? 20)), needPermission: rows.filter((x) => x.state === "needs_permission").length, notActive: rows.filter((x) => x.subscriptionStatus === "past_due").length };
}
function list(p: FxParams): Cl3List {
  const reason = text(p, "reason") as Cl3Reason, loc = text(p, "location");
  const accts = loc ? ACCOUNTS.filter((a) => a.locationId === loc) : ACCOUNTS.filter((a) => a.reasons.some((r) => r.reason === reason)).slice(0, 12);
  const rows: Cl3ListRow[] = accts.flatMap((a, i) => [...Array(Math.min(6, a.reasons.find((r) => r.reason === reason)?.count ?? 3))].map((_, k) => ({ locationId: a.locationId, accountName: a.name, contactId: `c${i}${k}`, contactName: `${FIRST[(i + k) % 10]} ${LAST[(i + 2 * k) % 8]}`, detail: reason === "waiting" || reason === "waiting_old" ? "Wrote last, no answer yet" : reason.replace(/_/g, " "), at: iso(NOW - (k + 1) * 5_400_000), value: reason === "stale_deals" ? 1500 + k * 400 : null, url: null })));
  return { ...pageOf(rows, Number(p.page ?? 0), Number(p.size ?? 20)), reason, label: reason.replace(/_/g, " ") };
}
const options = (): Cl3Options => ({ accounts: ACCOUNTS.map((x) => ({ locationId: x.locationId, name: x.name })), industries: [...new Set(INDUSTRIES)].sort() });

const META = { generatedAt: iso(NOW), cached: false, canSeeAccounts: true, problem: null, flags: Object.fromEntries(["cl_overview", "cl_attention", "cl_trends", "cl_compare", "cl_reports", "cl_people", "cl_setup", "cl_billing", "cl_rollup", "cl_module"].map((f) => [f, true])) };
/** The sample answer for one part, in the exact shape the real route returns (or the empty answer, for ?clfx=empty). */
export function sample(part: string, p: FxParams, empty: boolean): unknown {
  const pp: FxParams = empty ? { ...p, q: "zzz-none" } : p;
  let b: Record<string, unknown>;
  switch (part) {
    case "overview": b = overview(pp) as unknown as Record<string, unknown>; break;
    case "needs-attention": b = attention(pp); break;
    case "trends": b = trends(pp) as unknown as Record<string, unknown>; if (empty) b.points = []; break;
    case "compare": b = compare(empty ? { ...p, ids: "" } : p) as unknown as Record<string, unknown>; break;
    case "receipt": b = receipts(pp) as unknown as Record<string, unknown>; break;
    case "people": b = people(pp) as unknown as Record<string, unknown>; break;
    case "setup": b = setup(pp) as unknown as Record<string, unknown>; break;
    case "billing": b = billing(pp); break;
    case "list": b = list(empty ? { ...p, reason: "none", location: "none" } : p) as unknown as Record<string, unknown>; break;
    case "options": b = (empty ? { accounts: [], industries: [] } : options()) as unknown as Record<string, unknown>; break;
    default: b = {};
  }
  return { ...b, ...META };
}
