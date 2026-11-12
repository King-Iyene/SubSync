// Finance (stage FN): pure logic, no database, safe for the browser and the server. Unit tested (src/lib/__tests__/finance-core.test.ts).
// Money is always one currency at a time (never added across currencies). Anything the platform does not give is null and said in words, never guessed.
// Every estimate returns its formula so a screen can show it one tap away. Under the minimum sample a figure is "not enough data", never a made-up number.

export const FN_FLAGS = ["fn_module", "fn_mrr", "fn_revenue", "fn_churn", "fn_payouts", "fn_ledger", "fn_today"] as const;
export type FnFlag = (typeof FN_FLAGS)[number];
export const FN_PARTS = ["options", "headline", "overview", "movement", "revenue", "churn", "payouts", "statement", "periods", "ledger", "setup", "find", "export"] as const;
export type FnPart = (typeof FN_PARTS)[number];

export const DAY = 86_400_000;
export const NOT_ENOUGH = "Not enough data";
export const NOT_FROM_PLATFORM = "Not available from the platform yet";
export const MIN_TREND_DAYS = 7; // days of our own record before a trend line is drawn
export const MIN_CLOSED = 10; // won plus lost deals before a win rate is shown
export const MIN_WON_AVG = 3; // won deals before an average deal value is shown
export const MIN_LEADS_CPL = 10; // new leads before a cost per lead is shown
export const MIN_HISTORY_DAYS = 28; // days of record before an activity trend can be judged

export type Money = { amount: number; currency: string };
export type PayBasis = "booked" | "showed" | "won";
export const BASES: PayBasis[] = ["booked", "showed", "won"];
export const BASIS_LABEL: Record<PayBasis, string> = { booked: "Paid on booked", showed: "Paid on showed", won: "Paid on won" };
export const BASIS_HELP: Record<PayBasis, string> = {
  booked: "Each appointment counts when it was booked in the period (cancelled and invalid ones are left out).",
  showed: "Each appointment counts when it took place in the period and was marked as showed.",
  won: "Each deal counts when it was won in the period and the lead had an appointment in the days before the win.",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
export const money = (amount: number, currency: string): string => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: Math.abs(amount) % 1 === 0 || Math.abs(amount) >= 1000 ? 0 : 2 }).format(amount); } catch { return `${Math.round(amount).toLocaleString("en-US")} ${currency}`; }
};
export const cleanCurrency = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null);
export const cleanAmount = (v: unknown, max = 1e9): number | null => { const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v; return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max ? round2(n) : null; };
export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}$/.test(v) && isDay(`${v}-01`);
export const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** A spreadsheet cell that starts with = + - @ (or a tab or return) is read as a formula: prefix it so it stays text. */
export const csvCell = (v: unknown): string => {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export const csvLine = (cells: unknown[]): string => cells.map(csvCell).join(",");

// ---------- MRR ----------

export type PlanFact = { locationId: string; planKey: string | null; planName: string | null; pay: string; monthly: number | null; currency: string | null; source: "platform" | "entered" | "none" };
export type EnteredPrice = { planKey: string; amount: number; currency: string; billingInterval: "month" | "year" };

export const monthlyFrom = (amount: number, billingInterval: string | null | undefined): number => round2((billingInterval ?? "month").toLowerCase().startsWith("year") ? amount / 12 : amount);

/** The money of one account: the platform's price when it gave one, else the price the agency typed for that plan, else none. Only paid, past due, paused and other plans carry a price. */
export function factOf(r: { locationId: string; planId: string | null; planName: string | null; pay: string; monthly: number | null; currency: string | null }, entered: ReadonlyMap<string, EnteredPrice>): PlanFact {
  const key = r.planId ?? r.planName ?? null;
  if (r.monthly !== null && r.monthly >= 0) return { locationId: r.locationId, planKey: key, planName: r.planName, pay: r.pay, monthly: r.monthly, currency: r.currency ?? "USD", source: "platform" };
  const e = key ? entered.get(key) ?? (r.planName ? entered.get(r.planName) : undefined) : undefined;
  if (e) return { locationId: r.locationId, planKey: key, planName: r.planName, pay: r.pay, monthly: monthlyFrom(e.amount, e.billingInterval), currency: e.currency, source: "entered" };
  return { locationId: r.locationId, planKey: key, planName: r.planName, pay: r.pay, monthly: null, currency: null, source: "none" };
}

export type MrrTotals = {
  mrr: Array<Money & { accounts: number }>; atRisk: Array<Money & { accounts: number }>;
  noPrice: { accounts: number; plans: Array<{ planKey: string; planName: string | null; accounts: number }> };
  accounts: { total: number; paid: number; unpaid: number; noPlan: number; unknown: number };
  /** True when any figure rests on a price the agency typed. */
  usesEntered: boolean;
};
const bump = (m: Map<string, { amount: number; accounts: number }>, cur: string, amount: number) => { const e = m.get(cur) ?? { amount: 0, accounts: 0 }; e.amount += amount; e.accounts++; m.set(cur, e); };
const list = (m: Map<string, { amount: number; accounts: number }>) => [...m.entries()].map(([currency, v]) => ({ currency, amount: round2(v.amount), accounts: v.accounts })).sort((a, b) => b.amount - a.amount);

/** MRR counts accounts that are paid up (the platform's own word) and have a price. At risk counts past due and other states that need a look. Cancelled and paused are neither. */
export function totalsOf(facts: readonly PlanFact[]): MrrTotals {
  const mrr = new Map<string, { amount: number; accounts: number }>(), risk = new Map<string, { amount: number; accounts: number }>();
  const missing = new Map<string, { planName: string | null; accounts: number }>();
  const a = { total: facts.length, paid: 0, unpaid: 0, noPlan: 0, unknown: 0 };
  let usesEntered = false;
  for (const f of facts) {
    if (f.pay === "paid") a.paid++;
    else if (f.pay === "past_due" || f.pay === "other" || f.pay === "cancelled" || f.pay === "paused") a.unpaid++;
    else if (f.pay === "none") a.noPlan++;
    else a.unknown++;
    const counts = f.pay === "paid", risky = f.pay === "past_due" || f.pay === "other";
    if (!counts && !risky) continue;
    if (f.monthly === null) {
      if (counts) { const k = f.planKey ?? "(no plan name)"; const e = missing.get(k) ?? { planName: f.planName, accounts: 0 }; e.accounts++; missing.set(k, e); }
      continue;
    }
    if (f.source === "entered") usesEntered = true;
    bump(counts ? mrr : risk, f.currency ?? "USD", f.monthly);
  }
  const plans = [...missing.entries()].map(([planKey, v]) => ({ planKey, planName: v.planName, accounts: v.accounts })).sort((x, y) => y.accounts - x.accounts);
  return { mrr: list(mrr), atRisk: list(risk), noPrice: { accounts: plans.reduce((s, p) => s + p.accounts, 0), plans }, accounts: a, usesEntered };
}

export type SnapRow = { locationId: string; day: string; pay: string; monthly: number | null; currency: string | null };
/** The MRR of one day's snapshot rows, for one currency: only paid accounts with a price. */
export const snapMrr = (rows: readonly SnapRow[], currency: string): number => round2(rows.reduce((s, r) => (r.pay === "paid" && r.monthly !== null && (r.currency ?? "USD") === currency ? s + r.monthly : s), 0));

export type TrendPoint = { day: string; amount: number };
export type Trend = { currency: string | null; points: TrendPoint[]; startsOn: string | null; enough: boolean; message: string };
/** `days` is the per-day totals (oldest first) from our own record. Fewer than MIN_TREND_DAYS points: no line, a calm message with the day the record started. */
export function trendOf(days: ReadonlyArray<{ day: string; amount: number }>, currency: string | null, startsOn: string | null): Trend {
  if (!currency || days.length === 0) return { currency, points: [], startsOn, enough: false, message: startsOn ? `SubSync started recording your plans on ${startsOn}. The line appears after a week of records.` : "SubSync has not recorded any plan yet. The first record is written on the next daily check." };
  if (days.length < MIN_TREND_DAYS) return { currency, points: [], startsOn, enough: false, message: `SubSync started recording on ${startsOn ?? days[0].day}. ${days.length} of ${MIN_TREND_DAYS} days so far; the line appears after a week.` };
  return { currency, points: days.map((d) => ({ day: d.day, amount: d.amount })), startsOn, enough: true, message: "" };
}

export type MoveKind = "new" | "expansion" | "contraction" | "churned";
export type Move = { locationId: string; kind: MoveKind; from: number; to: number; delta: number };
export type Waterfall = {
  currency: string; from: string; to: string; start: number; end: number;
  new: number; expansion: number; contraction: number; churned: number;
  counts: Record<MoveKind, number>; enough: boolean; startsOn: string | null; note: string;
};
/** Compare two snapshot days. An account that is paid with a price on the later day and not on the earlier one is New; the reverse is Churned; paid on both and a different price is Expansion or Contraction. */
export function waterfallOf(a: readonly SnapRow[], b: readonly SnapRow[], currency: string, from: string, to: string, startsOn: string | null): { w: Waterfall; moves: Move[] } {
  const val = (r: SnapRow | undefined) => (r && r.pay === "paid" && r.monthly !== null && (r.currency ?? "USD") === currency ? r.monthly : 0);
  const A = new Map(a.map((r) => [r.locationId, r])), B = new Map(b.map((r) => [r.locationId, r]));
  const moves: Move[] = [];
  for (const id of new Set([...A.keys(), ...B.keys()])) {
    const x = val(A.get(id)), y = val(B.get(id));
    if (x === y) continue;
    const kind: MoveKind = x === 0 ? "new" : y === 0 ? "churned" : y > x ? "expansion" : "contraction";
    moves.push({ locationId: id, kind, from: x, to: y, delta: round2(y - x) });
  }
  const sum = (k: MoveKind) => round2(moves.filter((m) => m.kind === k).reduce((s, m) => s + Math.abs(m.delta), 0));
  const counts = { new: 0, expansion: 0, contraction: 0, churned: 0 } as Record<MoveKind, number>;
  for (const m of moves) counts[m.kind]++;
  const enough = from !== to && a.length > 0;
  return { w: { currency, from, to, start: snapMrr(a, currency), end: snapMrr(b, currency), new: sum("new"), expansion: sum("expansion"), contraction: sum("contraction"), churned: sum("churned"), counts, enough, startsOn, note: enough ? "" : `The record starts on ${startsOn ?? "the first daily check"}, so there is nothing to compare yet.` }, moves };
}
export const WATERFALL_FORMULA = "Start and end are the monthly plan prices of paid accounts on the first and last recorded day of the period (our own daily record). New: not paid at the start, paid at the end. Churned: paid at the start, not at the end. Expansion and contraction: paid on both days at a different price. Prices are the platform's, or the price you entered, per month (a yearly price divided by 12). An estimate of recurring revenue, not an invoice total.";
export const MRR_FORMULA = "Monthly recurring revenue: the monthly price of every client account whose plan is paid up (the platform's price, or the price you entered once). A yearly price is divided by 12. At risk: the same for plans that are past due. An estimate: it is the plan price, not what was collected.";

// ---------- revenue per client ----------

export type DailySums = { newLeads: number; booked: number; showed: number; noshow: number; won: number; wonValue: number; lost: number; lostValue: number };
export type RevenueRow = {
  locationId: string; name: string; vertical: string | null; verticalLabel: string | null;
  billed: Money | null; billedSource: "platform" | "entered" | "none"; pay: string;
  newLeads: number; booked: number; won: number; wonValue: number; lost: number; pipelineValue: number; pipelineCount: number;
  avgDeal: number | null; winRate: number | null; winRateNote: string | null;
  spend: number | null; spendCurrency: string | null; cpl: number | null; roas: number | null;
};
export function avgDealOf(won: number, wonValue: number): number | null { return won >= MIN_WON_AVG ? round2(wonValue / won) : null; }
export function winRateOf(won: number, lost: number): { rate: number | null; note: string | null } {
  const closed = won + lost;
  return closed >= MIN_CLOSED ? { rate: Math.round((won / closed) * 1000) / 10, note: null } : { rate: null, note: `${NOT_ENOUGH}: ${closed} of ${MIN_CLOSED} closed deals` };
}
/** Spend typed for whole months, spread evenly over the days of each month, counted for the days inside the range. */
export function spendInRange(rows: ReadonlyArray<{ month: string; amount: number }>, from: string, toExclusive: string): number {
  let total = 0;
  for (const r of rows) {
    const start = `${r.month.slice(0, 7)}-01`;
    const [y, m] = start.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const lo = start > from ? start : from, hi = next < toExclusive ? next : toExclusive;
    if (hi <= lo) continue;
    total += (r.amount * daysBetween(lo, hi)) / daysBetween(start, next);
  }
  return round2(total);
}
export function cplOf(spend: number | null, leads: number): number | null { return spend !== null && spend > 0 && leads >= MIN_LEADS_CPL ? round2(spend / leads) : null; }
export function roasOf(spend: number | null, wonValue: number): number | null { return spend !== null && spend > 0 ? Math.round((wonValue / spend) * 100) / 100 : null; }
export const REVENUE_FORMULA = "Won: deals marked won in the date range, at the deal amount the CRM holds, counted in the client account the deal sits in (the account of the contact it belongs to). Pipeline: open deals with an amount. Win rate: won divided by won plus lost, shown only from 10 closed deals. Average deal: from 3 won deals. Cost per lead and return on ad spend use ad spend you entered (the platform does not give it to us), spread evenly across each month.";

// ---------- churn watch ----------

export type ChurnInput = {
  plan: { pay: string; monthly: number | null; currency: string | null };
  /** Our record, last 14 days (recent) and the 42 days before it (base), for the same account. */
  leads: { recent: number; base: number }; booked: { recent: number; base: number }; staff: { recent: number; base: number };
  reply: { recentAnswered: number; recentWithin: number; baseAnswered: number; baseWithin: number };
  wins: { recent56: number; prior56: number };
  historyDays: number;
};
export type Evidence = { key: string; label: string; points: number; detail: string };
export type ChurnLevel = "high" | "watch" | "steady" | "not_enough_data" | "left";
export const CHURN_RECENT_DAYS = 14, CHURN_BASE_DAYS = 42;
export const CHURN_FORMULA = [
  `Each client account is compared with its own normal: the last ${CHURN_RECENT_DAYS} days against the ${CHURN_BASE_DAYS} days before (scaled to the same length), from SubSync's own daily record. Needs ${MIN_HISTORY_DAYS} days of record for the activity points; otherwise those parts say "not enough data".`,
  "New leads fell 50% or more: 3 points (30% to 49%: 2), only when the normal was at least 10 leads. No new leads at all when the normal was at least 5: 3 points.",
  "No new appointments booked when the normal was at least 3: 2 points. Reply speed: the share of leads answered inside the target fell 15 points or more, with at least 20 answered leads in each period: 2 points.",
  "Team went quiet: no staff messages when the normal was at least 10: 2 points (fell 60% or more: 1). No won deals in 56 days after at least 2 in the 56 days before: 1 point.",
  "Plan: past due 3 points, paused 2, any other odd status 1. A cancelled plan is shown as Already left, not scored.",
  "5 or more points is High, 3 or 4 is Watch. An estimate from counts, not a prediction that anyone will leave. Logins are not available from the platform yet, so they are not part of the score.",
].join(" ");

const pctDrop = (base: number, now: number) => (base > 0 ? Math.round(((base - now) / base) * 100) : 0);
/** `base` is a 42-day count; scale it to the 14-day length. */
export const scaled = (base: number) => (base * CHURN_RECENT_DAYS) / CHURN_BASE_DAYS;

export function churnOf(i: ChurnInput): { level: ChurnLevel; points: number; evidence: Evidence[]; mrr: Money | null } {
  const ev: Evidence[] = [];
  const mrr = i.plan.monthly !== null && (i.plan.pay === "paid" || i.plan.pay === "past_due" || i.plan.pay === "other" || i.plan.pay === "paused") ? { amount: i.plan.monthly, currency: i.plan.currency ?? "USD" } : null;
  if (i.plan.pay === "cancelled") return { level: "left", points: 0, evidence: [{ key: "plan", label: "Plan cancelled", points: 0, detail: "The plan is cancelled. This client has already left." }], mrr: null };
  if (i.plan.pay === "past_due") ev.push({ key: "plan", label: "Payment failing", points: 3, detail: "The plan is past due." });
  else if (i.plan.pay === "paused") ev.push({ key: "plan", label: "Plan paused", points: 2, detail: "The plan is paused." });
  else if (i.plan.pay === "other") ev.push({ key: "plan", label: "Plan status to check", points: 1, detail: "The plan has a status that needs a look." });
  const hist = i.historyDays >= MIN_HISTORY_DAYS;
  if (hist) {
    const nl = scaled(i.leads.base);
    if (i.leads.recent === 0 && nl >= 5) ev.push({ key: "no_leads", label: "No new leads", points: 3, detail: `No new leads in ${CHURN_RECENT_DAYS} days; their normal is about ${Math.round(nl)}.` });
    else if (nl >= 10) {
      const d = pctDrop(nl, i.leads.recent);
      if (d >= 50) ev.push({ key: "leads_down", label: "Leads down", points: 3, detail: `New leads fell ${d}% (${Math.round(nl)} to ${i.leads.recent} in ${CHURN_RECENT_DAYS} days).` });
      else if (d >= 30) ev.push({ key: "leads_down", label: "Leads down", points: 2, detail: `New leads fell ${d}% (${Math.round(nl)} to ${i.leads.recent} in ${CHURN_RECENT_DAYS} days).` });
    }
    const nb = scaled(i.booked.base);
    if (i.booked.recent === 0 && nb >= 3) ev.push({ key: "no_bookings", label: "No bookings", points: 2, detail: `No appointments booked in ${CHURN_RECENT_DAYS} days; their normal is about ${Math.round(nb)}.` });
    const r = i.reply;
    if (r.recentAnswered >= 20 && r.baseAnswered >= 20) {
      const was = (r.baseWithin / r.baseAnswered) * 100, now = (r.recentWithin / r.recentAnswered) * 100;
      if (was - now >= 15) ev.push({ key: "reply_slow", label: "Reply speed slipping", points: 2, detail: `Leads answered in time fell from ${Math.round(was)}% to ${Math.round(now)}%.` });
    }
    const ns = scaled(i.staff.base);
    if (ns >= 10) {
      if (i.staff.recent === 0) ev.push({ key: "team_quiet", label: "Team went quiet", points: 2, detail: `No staff messages in ${CHURN_RECENT_DAYS} days; their normal is about ${Math.round(ns)}.` });
      else if (pctDrop(ns, i.staff.recent) >= 60) ev.push({ key: "team_quiet", label: "Team quieter", points: 1, detail: `Staff messages fell ${pctDrop(ns, i.staff.recent)}%.` });
    }
    if (i.wins.recent56 === 0 && i.wins.prior56 >= 2) ev.push({ key: "no_wins", label: "No wins lately", points: 1, detail: `No deals won in 56 days; ${i.wins.prior56} in the 56 days before.` });
  }
  const points = ev.reduce((s, e) => s + e.points, 0);
  const level: ChurnLevel = points >= 5 ? "high" : points >= 3 ? "watch" : !hist && points === 0 ? "not_enough_data" : "steady";
  return { level, points, evidence: ev, mrr };
}

export type PlaybookStep = { text: string; go?: "proof" | "speed" | "appointments" | "payments" | "clients" | "pipeline" | "team" };
/** Suggested next steps for the evidence found. Plain words; SubSync never contacts the client for you. */
export function playbookOf(ev: readonly Evidence[]): PlaybookStep[] {
  const keys = new Set(ev.map((e) => e.key));
  const steps: PlaybookStep[] = [];
  if (keys.has("plan")) steps.push({ text: "Ask them to update their card or confirm the plan, before anything else.", go: "payments" });
  if (keys.has("no_leads") || keys.has("leads_down")) steps.push({ text: "Check the ads and forms still send leads to this account, then tell them what you fixed." }, { text: "Send their Proof page so they see what you caught and fixed.", go: "proof" });
  if (keys.has("reply_slow")) steps.push({ text: "Open Speed to lead for this account and fix who answers new leads first.", go: "speed" });
  if (keys.has("no_bookings")) steps.push({ text: "Look at the calendar and the booking link: bookings stopped.", go: "appointments" });
  if (keys.has("team_quiet")) steps.push({ text: "Their team has gone quiet in the CRM. Offer a short training call.", go: "team" });
  if (keys.has("no_wins")) steps.push({ text: "Review the open deals with them and pick the three that can close.", go: "pipeline" });
  steps.push({ text: "Book a 15 minute call this week. Write down what they said, then mark the account Working." });
  return steps.slice(0, 5);
}

// ---------- payouts ----------

export type Role = "setter" | "closer";
export type RateRow = { personId: string; locationId: string; role: Role; pct: number; flat: number };
/** The most specific rate wins: person and account, then person, then account, then everyone. */
export function rateFor(rates: readonly RateRow[], personId: string, locationId: string, role: Role): { pct: number; flat: number; from: "person_account" | "person" | "account" | "role" | "none" } {
  let best: RateRow | null = null, score = -1;
  for (const r of rates) {
    if (r.role !== role || (r.personId !== "" && r.personId !== personId) || (r.locationId !== "" && r.locationId !== locationId)) continue;
    const s = (r.personId !== "" ? 2 : 0) + (r.locationId !== "" ? 1 : 0);
    if (s > score) { best = r; score = s; }
  }
  if (!best) return { pct: 0, flat: 0, from: "none" };
  return { pct: best.pct, flat: best.flat, from: score === 3 ? "person_account" : score === 2 ? "person" : score === 1 ? "account" : "role" };
}
/** What one counted line pays: the flat amount, plus the percentage of the deal value (percentages apply only when paid on won). */
export function lineAmount(basis: PayBasis, value: number | null, rate: { pct: number; flat: number }): number {
  return round2(rate.flat + (basis === "won" && value !== null ? (value * rate.pct) / 100 : 0));
}
export const lineKey = (kind: PayBasis, locationId: string, refId: string, role: Role) => `${kind}:${locationId}:${refId}:${role}`;
export const PAYOUT_FORMULA = "Setter: the person who booked the appointment, else the lead's owner. Closer: the person the appointment is assigned to. Each counted line pays its flat amount, plus the percentage of the deal value when paid on won. The rate is the most specific one you set: person in one account, person, account, then the role default. Lines you flag as disputed are held out of the payable total until you resolve them.";

export type CsvLine = { at: string; person: string; role: string; account: string; kind: string; ref: string; value: number | null; amount: number; disputed: boolean };
export const statementCsv = (rows: readonly CsvLine[], currency: string): string =>
  [csvLine(["Date", "Person", "Role", "Client account", "Counted as", "Reference", `Deal value (${currency})`, `Payout (${currency})`, "Disputed"]),
    ...rows.map((r) => csvLine([r.at.slice(0, 10), r.person, r.role, r.account, r.kind, r.ref, r.value ?? "", r.amount.toFixed(2), r.disputed ? "yes" : ""]))].join("\r\n") + "\r\n";

// ---------- ledger ----------

export type LedgerStatus = "unpaid" | "paid";
export type LedgerBucket = "overdue" | "due_soon" | "upcoming" | "paid";
export function bucketOf(status: LedgerStatus, dueOn: string, today: string): LedgerBucket {
  if (status === "paid") return "paid";
  if (dueOn < today) return "overdue";
  return daysBetween(today, dueOn) <= 7 ? "due_soon" : "upcoming";
}

// ---------- the one-line headline ----------

export type HeadlineIn = {
  atRisk: Money | null; failing: number; highRisk: number; highRiskMrr: Money | null; overdue: { count: number; total: Money | null }; dueSoon: number; disputes: number; mrr: Money | null; noPrice: number;
};
/** The CEO line and the one "what to do today" line, always from the counts, in priority order: money failing, money overdue, accounts about to leave, then the rest. */
export function headlineOf(h: HeadlineIn): { line: string; today: string; target: "overview" | "churn" | "ledger" | "payouts" | "setup" | null } {
  const mrr = h.mrr ? `${money(h.mrr.amount, h.mrr.currency)} a month in plans` : "No plan prices to add up yet";
  const risk = h.atRisk && h.atRisk.amount > 0 ? `, ${money(h.atRisk.amount, h.atRisk.currency)} of it at risk` : "";
  const line = `${mrr}${risk}.`;
  const p = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  if (h.failing > 0) return { line, today: `${p(h.failing, "client has", "clients have")} a payment that did not go through${h.atRisk ? ` (${money(h.atRisk.amount, h.atRisk.currency)} a month)` : ""}. Ask them to update their card.`, target: "overview" };
  if (h.overdue.count > 0) return { line, today: `${p(h.overdue.count, "invoice you noted is", "invoices you noted are")} overdue${h.overdue.total ? ` (${money(h.overdue.total.amount, h.overdue.total.currency)})` : ""}. Send the reminders.`, target: "ledger" };
  if (h.highRisk > 0) return { line, today: `${p(h.highRisk, "client account looks", "client accounts look")} likely to leave${h.highRiskMrr ? ` (${money(h.highRiskMrr.amount, h.highRiskMrr.currency)} a month)` : ""}. Open the churn watch and call the first one.`, target: "churn" };
  if (h.disputes > 0) return { line, today: `${p(h.disputes, "payout line is", "payout lines are")} flagged as disputed. Settle them before you pay.`, target: "payouts" };
  if (h.noPrice > 0) return { line, today: `${p(h.noPrice, "paid account has", "paid accounts have")} no price yet. Enter the plan prices once so the money adds up.`, target: "setup" };
  if (h.dueSoon > 0) return { line, today: `${p(h.dueSoon, "invoice you noted is", "invoices you noted are")} due this week.`, target: "ledger" };
  return { line, today: "Nothing money-related needs you today.", target: null };
}

// ---------- paging ----------

export type Keyset = { k: number | string; id: string };
export const encodeKey = (c: Keyset): string => Buffer.from(JSON.stringify(c)).toString("base64url");
export function decodeKey(v: string | null | undefined): Keyset | null {
  if (!v || v.length > 300) return null;
  try { const o = JSON.parse(Buffer.from(v, "base64url").toString("utf8")); return o && (typeof o.k === "number" || typeof o.k === "string") && typeof o.id === "string" ? { k: o.k, id: o.id } : null; } catch { return null; }
}
/** Descending by key then id, resumed after the cursor. Works on any in-memory list; the SQL lists use the same ordering in the query. */
export function pageDesc<T>(rows: readonly T[], key: (t: T) => number, id: (t: T) => string, cursor: Keyset | null, size: number): { rows: T[]; next: string | null } {
  const sorted = [...rows].sort((a, b) => key(b) - key(a) || (id(a) < id(b) ? 1 : id(a) > id(b) ? -1 : 0));
  const start = cursor ? sorted.findIndex((r) => key(r) < Number(cursor.k) || (key(r) === Number(cursor.k) && id(r) < cursor.id)) : 0;
  const from = start === -1 ? sorted.length : start;
  const page = sorted.slice(from, from + size);
  const last = page[page.length - 1];
  return { rows: page, next: from + size < sorted.length && last ? encodeKey({ k: key(last), id: id(last) }) : null };
}
export const clampSize = (v: number, d = 25, max = 100) => Math.max(5, Math.min(max, Number.isFinite(v) ? Math.floor(v) : d));
