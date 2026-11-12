// Appointments round 3: the pure part (no database, no network), unit tested. Definitions: docs/METRICS.md "Appointments 3".
import type { Appt3Bucket, Appt3FlowTree, Appt3Overview, Estimate, FlowNode, Rate } from "./appointments3-types.ts";

export const DAY = 86_400_000;
/** Minimums. Under them the screen says "not enough data", never a number. */
export const MIN_SHOW = 5, MIN_CLOSE = 10, MIN_FAIRNESS = 10;
export const GRACE_HOURS = 3;
export const DEFAULT_DEAL_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 366;

export const rate = (n: number, of: number, min = MIN_SHOW): Rate => ({ value: of >= min && of > 0 ? n / of : null, n, of, enough: of >= min });

/** True show rate = showed / (showed + noshow + unmarked past due). Reported rate = showed / (showed + noshow): what the CRM shows when staff forget to mark. */
export const trueShowRate = (showed: number, noshow: number, unmarked: number) => rate(showed, showed + noshow + unmarked);
export const reportedShowRate = (showed: number, noshow: number) => rate(showed, showed + noshow);

export function parseApptWindow(from: string | null | undefined, to: string | null | undefined, now: number): { from: Date; to: Date; days: number; problem: string | null } {
  const t = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v.slice(0, 10)) : null);
  let f = t(from), e = t(to);
  let problem: string | null = null;
  if (e !== null) e += DAY; // "to" is a whole day, inclusive
  if (f === null || e === null) { e = now + DAY - (now % DAY); f = e - 30 * DAY; if (from || to) problem = "That date range was not understood, so the last 30 days are shown."; }
  if (e <= f) { e = now + DAY - (now % DAY); f = e - 30 * DAY; problem = "The end date was before the start date, so the last 30 days are shown."; }
  if (e - f > MAX_WINDOW_DAYS * DAY) { f = e - MAX_WINDOW_DAYS * DAY; problem = "The range is capped at one year."; }
  return { from: new Date(f), to: new Date(e), days: Math.round((e - f) / DAY), problem };
}

export const clampSize = (n: number): 20 | 50 | 100 => (n >= 100 ? 100 : n >= 50 ? 50 : 20);

/** Revenue at risk: a labelled range, never a forecast. low = open deal dollars on no-shows not rebooked; high = low + open deal dollars on appointments with no outcome. */
export function revenueAtRisk(noshowDeals: { value: number; n: number }, unmarkedDeals: { value: number; n: number }): Estimate {
  const low = noshowDeals.value, high = noshowDeals.value + unmarkedDeals.value, n = noshowDeals.n + unmarkedDeals.n;
  return {
    value: n ? (low + high) / 2 : null, low: n ? low : null, high: n ? high : null, enough: n > 0, estimate: true,
    formula: "Low: open deal dollars on no-shows not rebooked. High: low plus open deal dollars on appointments past their time with no outcome. Only counted deals (value above zero, an owner, in play). Not a forecast.",
    minNote: n ? null : "No open deals are linked to these appointments.",
  };
}

export function headlineOf(o: { unmarked: number; trueRate: Rate; reportedRate: Rate; noshowToRecover: number; booked: number }): string {
  const pct = (r: Rate) => Math.round((r.value ?? 0) * 100);
  if (!o.booked) return "No appointments in this period yet.";
  const parts: string[] = [];
  if (o.unmarked > 0) parts.push(`${o.unmarked} appointment${o.unmarked === 1 ? "" : "s"} past due with no outcome`);
  if (o.trueRate.enough && o.reportedRate.enough && o.reportedRate.value !== null && o.trueRate.value !== null && pct(o.reportedRate) !== pct(o.trueRate)) parts.push(`true show rate ${pct(o.trueRate)}%, not ${pct(o.reportedRate)}%`);
  else if (o.trueRate.enough) parts.push(`show rate ${pct(o.trueRate)}%`);
  else parts.push("not enough outcomes yet for a show rate");
  if (o.noshowToRecover > 0) parts.push(`${o.noshowToRecover} no-show${o.noshowToRecover === 1 ? "" : "s"} not rebooked`);
  const s = parts.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

/** The one button on the overview: the biggest money problem first. */
export function pickButton(o: { unmarked: number; noshowToRecover: number; noDeal: number }): Appt3Overview["button"] {
  if (o.unmarked > 0) return { label: `Mark ${o.unmarked} outcome${o.unmarked === 1 ? "" : "s"}`, part: "needs-outcome", bucket: "unmarked", count: o.unmarked };
  if (o.noshowToRecover > 0) return { label: `Recover ${o.noshowToRecover} no-show${o.noshowToRecover === 1 ? "" : "s"}`, part: "noshow-recovery", bucket: "noshow", count: o.noshowToRecover };
  if (o.noDeal > 0) return { label: `Link ${o.noDeal} to a deal`, part: "list", bucket: "no_deal", count: o.noDeal };
  return null;
}

// ---------- the Flow Tree ----------

/** One row of the SQL aggregate: setter (booker) by closer (owner). null id = not recorded. */
export type FlowAgg = {
  setter: string | null; closer: string | null; booked: number; showed: number; noshow: number; cancelled: number; unmarked: number; upcoming: number;
  won: number; lost: number; open: number; wonValue: number; ltbMedianMin: number | null;
};

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
/** Health 0..1: show rate (true) blended with close rate when both are known; null when the show rate is not known. */
export function healthOf(showRate: Rate, closeRate: Rate): number | null {
  if (!showRate.enough || showRate.value === null) return null;
  return closeRate.enough && closeRate.value !== null ? 0.5 * showRate.value + 0.5 * Math.min(1, closeRate.value * 2) : showRate.value;
}
const LABEL_NONE = "Not recorded";

function badgesOf(rows: FlowAgg[], median: number | null): NonNullable<FlowNode["badges"]> {
  const booked = sum(rows, (r) => r.booked), showed = sum(rows, (r) => r.showed), noshow = sum(rows, (r) => r.noshow), unmarked = sum(rows, (r) => r.unmarked);
  const won = sum(rows, (r) => r.won), lost = sum(rows, (r) => r.lost);
  return {
    bookings: booked, showRate: trueShowRate(showed, noshow, unmarked), noshowRate: rate(noshow, showed + noshow + unmarked), closeRate: rate(won, won + lost, MIN_CLOSE),
    wonValue: sum(rows, (r) => r.wonValue), leadToBookedMedianMinutes: median,
  };
}
const weightedMedian = (rows: FlowAgg[]) => {
  const xs = rows.filter((r) => r.ltbMedianMin !== null && r.booked > 0);
  const w = sum(xs, (r) => r.booked);
  return w ? Math.round(sum(xs, (r) => (r.ltbMedianMin as number) * r.booked) / w) : null;
};

const LEAVES: Array<{ k: NonNullable<FlowNode["leaf"]>; f: (r: FlowAgg) => number; bucket: Appt3Bucket }> = [
  { k: "showed", f: (r) => r.showed, bucket: "showed" }, { k: "noshow", f: (r) => r.noshow, bucket: "noshow" }, { k: "cancelled", f: (r) => r.cancelled, bucket: "cancelled" },
  { k: "unmarked", f: (r) => r.unmarked, bucket: "unmarked" }, { k: "won", f: (r) => r.won, bucket: "won" }, { k: "lost", f: (r) => r.lost, bucket: "lost" },
];

/** Builds the tree from the setter-by-closer aggregate. Top N setters by bookings (the rest are summed into one "Everyone else" node and counted in hiddenPeople). */
export function buildFlowTree(aggs: FlowAgg[], names: (id: string | null) => string, period: { from: string; to: string }, topN = 12, compareIds: [string, string] | null = null, skip = 0): Appt3FlowTree {
  const total = sum(aggs, (r) => r.booked);
  const bySetter = new Map<string | null, FlowAgg[]>();
  for (const r of aggs) bySetter.set(r.setter, [...(bySetter.get(r.setter) ?? []), r]);
  const ranked = [...bySetter.entries()].sort((a, b) => sum(b[1], (r) => r.booked) - sum(a[1], (r) => r.booked));
  const shown = ranked.slice(skip, skip + topN), rest = ranked.slice(skip + topN); // 'See all' pages through the people; skip = how many were already shown
  const nodes: FlowNode[] = [{
    id: "root", level: "root", label: "Booked", userId: null, parentId: null, count: total, health: null, best: false,
    badges: badgesOf(aggs, weightedMedian(aggs)), open: {},
  }];
  const mk = (level: "setter" | "closer", id: string, parent: string, userId: string | null, label: string, rows: FlowAgg[], open: FlowNode["open"]): FlowNode => {
    const b = badgesOf(rows, weightedMedian(rows));
    return { id, level, label, userId, parentId: parent, count: b.bookings, health: healthOf(b.showRate, b.closeRate), best: false, badges: b, open };
  };
  const addLeaves = (parent: string, rows: FlowAgg[], open: FlowNode["open"]) => {
    for (const l of LEAVES) {
      const n = sum(rows, l.f);
      if (n > 0) nodes.push({ id: `${parent}:${l.k}`, level: "leaf", label: l.k, userId: null, parentId: parent, count: n, health: null, best: false, badges: null, leaf: l.k, open: { ...open, bucket: l.bucket } });
    }
  };
  for (const [sid, rows] of shown) {
    const sId = `s:${sid ?? "none"}`;
    nodes.push(mk("setter", sId, "root", sid, sid ? names(sid) : LABEL_NONE, rows, { setter: sid }));
    const byCloser = new Map<string | null, FlowAgg[]>();
    for (const r of rows) byCloser.set(r.closer, [...(byCloser.get(r.closer) ?? []), r]);
    const closers = [...byCloser.entries()].sort((a, b) => sum(b[1], (r) => r.booked) - sum(a[1], (r) => r.booked)).slice(0, 8);
    for (const [cid, cr] of closers) {
      const cId = `${sId}>c:${cid ?? "none"}`;
      nodes.push(mk("closer", cId, sId, cid, cid ? names(cid) : LABEL_NONE, cr, { setter: sid, closer: cid }));
      addLeaves(cId, cr, { setter: sid, closer: cid });
    }
  }
  if (rest.length) {
    const rows = rest.flatMap(([, r]) => r);
    nodes.push({ ...mk("setter", "s:others", "root", null, `Everyone else (${rest.length})`, rows, {}), health: null });
    addLeaves("s:others", rows, {});
  }
  // Best converters: the two healthiest per level among those with enough data and health at least 0.7.
  for (const level of ["setter", "closer"] as const) {
    const cand = nodes.filter((n) => n.level === level && n.health !== null && n.health >= 0.7 && n.id !== "s:others").sort((a, b) => (b.health as number) - (a.health as number)).slice(0, 2);
    for (const n of cand) n.best = true;
  }
  return {
    nodes, period, totalBooked: total, topN, hiddenPeople: rest.length, leak: findLeak(nodes),
    compare: compareIds ? { a: nodes.find((n) => n.userId === compareIds[0] && n.level === "setter") ?? nodes[0], b: nodes.find((n) => n.userId === compareIds[1] && n.level === "setter") ?? nodes[0] } : null,
  };
}

/** The leak finder: the closer node (under one setter) that loses the most appointments to no-show or no outcome, when it is clearly worse than the account at large. */
export function findLeak(nodes: FlowNode[]): Appt3FlowTree["leak"] {
  const root = nodes[0]?.badges;
  if (!root) return null;
  let best: { n: FlowNode; lost: number; rate: number } | null = null;
  for (const n of nodes) {
    if (n.level !== "closer" || !n.badges || !n.badges.showRate.enough || n.badges.bookings < 10) continue;
    const loss = 1 - (n.badges.showRate.value ?? 1), base = 1 - (root.showRate.value ?? 1);
    const excess = Math.round((loss - base) * n.badges.bookings);
    if (loss - base >= 0.15 && excess >= 2 && (!best || excess > best.lost)) best = { n, lost: excess, rate: loss };
  }
  if (!best) return null;
  const setter = nodes.find((x) => x.id === best!.n.parentId);
  return {
    text: `${best.n.label} loses ${Math.round(best.rate * 100)}% of the appointments ${setter?.label && setter.label !== LABEL_NONE ? setter.label + " hands over" : "booked for them"}: about ${best.lost} more than the account's usual.`,
    nodeId: best.n.id, lostAppointments: best.lost,
  };
}

// ---------- calendars ----------

/** Two appointments on the same calendar (or for the same owner) overlap. A forced overlap is one that was booked after the other already existed AND was created by a person (not the booking page). */
export function overlapMinutes(a: { start: number; end: number }, b: { start: number; end: number }): number {
  return Math.max(0, Math.round((Math.min(a.end, b.end) - Math.max(a.start, b.start)) / 60_000));
}

/** Round robin fairness per appointment: the largest closer's share against an even split. Needs MIN_FAIRNESS owned bookings. */
export function fairness(owned: number[]) {
  const total = sum(owned, (x) => x);
  if (owned.length < 2 || total < MIN_FAIRNESS) return { enough: false, maxSharePct: null, evenSharePct: null, closers: owned.length };
  return { enough: true, maxSharePct: Math.round((Math.max(...owned) / total) * 100), evenSharePct: Math.round(100 / owned.length), closers: owned.length };
}

export const speedBand = (minutes: number | null): "under_5m" | "5_to_30m" | "30m_to_2h" | "over_2h" | "none" =>
  minutes === null ? "none" : minutes < 5 ? "under_5m" : minutes < 30 ? "5_to_30m" : minutes < 120 ? "30m_to_2h" : "over_2h";
export const SPEED_LABELS = { under_5m: "Under 5 minutes", "5_to_30m": "5 to 30 minutes", "30m_to_2h": "30 minutes to 2 hours", over_2h: "Over 2 hours", none: "No reply recorded" } as const;
export const leadTimeBand = (days: number) => (days < 1 ? "Same day" : days < 3 ? "1 to 2 days" : days < 7 ? "3 to 6 days" : "A week or more");

// ---------- people (who is in which account) ----------

export type PeopleMember = { locationId: string; userId: string; name: string };
export type PeopleBooking = { locationId: string; userId: string; n: number; lastAt: string | null };
export type PersonAccount = { locationId: string; accountName: string | null; bookings: number; lastBookingAt: string | null; member: boolean };
export type PersonRollup = {
  userId: string; name: string;
  /** false = seen as a booker or owner but in no account's team list (left or no access). Never flagged idle. */
  inTeamList: boolean; bookings: number; sharePct: number; lastBookingAt: string | null;
  /** Team role as a plain label, and the calendars the person is on. */
  roleLabel?: string; calendars?: string[];
  accounts: PersonAccount[];
  /** Accounts the person belongs to where they have zero bookings in these dates. */
  idleIn: string[];
  /** Zero bookings in ALL accounts they belong to. */
  idleEverywhere: boolean;
};

/** One row per person. Built from the accounts' team lists (location_users) PLUS anyone seen booking, so a new user appears with zero bookings until they book (no code change) and a removed
 *  user keeps their history. Membership is per account: a person is only ever idle in an account they belong to. With one account in scope the caller passes only that account's rows. */
export function buildPeople(members: PeopleMember[], bookings: PeopleBooking[], accountNames: Map<string, string | null>, nameOf: (id: string) => string): PersonRollup[] {
  const mem = new Set(members.map((m) => `${m.locationId}|${m.userId}`));
  const memberLocs = new Map<string, Set<string>>();
  for (const m of members) memberLocs.set(m.userId, (memberLocs.get(m.userId) ?? new Set()).add(m.locationId));
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const book = new Map(bookings.map((b) => [`${b.locationId}|${b.userId}`, b]));
  const ids = new Set([...members.map((m) => m.userId), ...bookings.map((b) => b.userId)]);
  const total = sum(bookings, (b) => b.n);
  const out: PersonRollup[] = [];
  for (const id of ids) {
    const locs = new Set([...(memberLocs.get(id) ?? []), ...bookings.filter((b) => b.userId === id).map((b) => b.locationId)]);
    const accounts: PersonAccount[] = [...locs].map((loc) => { const b = book.get(`${loc}|${id}`); return { locationId: loc, accountName: accountNames.get(loc) ?? null, bookings: b?.n ?? 0, lastBookingAt: b?.lastAt ?? null, member: mem.has(`${loc}|${id}`) }; })
      .sort((a, b) => b.bookings - a.bookings || (a.accountName ?? "").localeCompare(b.accountName ?? ""));
    const n = sum(accounts, (a) => a.bookings), inList = (memberLocs.get(id)?.size ?? 0) > 0;
    const last = accounts.map((a) => a.lastBookingAt).filter((x): x is string => !!x).sort().pop() ?? null;
    out.push({
      userId: id, name: names.get(id) ?? nameOf(id), inTeamList: inList, bookings: n, sharePct: total ? Math.round((n / total) * 100) : 0, lastBookingAt: last, accounts,
      idleIn: accounts.filter((a) => a.member && a.bookings === 0).map((a) => a.accountName ?? "another account"), idleEverywhere: inList && n === 0,
    });
  }
  return out.sort((a, b) => b.bookings - a.bookings || a.name.localeCompare(b.name));
}

/** Team role keys (as stored) to the plain labels people see. */
export const TEAM_ROLE_LABEL: Record<string, string> = { agency_admin: "Admin, all accounts", agency_staff: "Staff, all accounts", account_admin: "Account admin", account_user: "Account user", unknown: "Team member" };
export const teamRoleLabel = (role: string | null | undefined) => TEAM_ROLE_LABEL[role ?? "unknown"] ?? "Team member";
/** "none this period" and "never" are different things: the first has history, the second has no bookings in anything we hold. */
export const bookingState = (inPeriod: number, ever: number): "booked" | "none_this_period" | "never" => (inPeriod > 0 ? "booked" : ever > 0 ? "none_this_period" : "never");
