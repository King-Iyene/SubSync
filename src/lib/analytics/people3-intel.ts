import { MAX_RANGE_DAYS } from "../design/range-limits.ts";
import { unansweredBusinessElapsedMs } from "./unanswered-advanced.ts";
import type {
  Pp3AccountRisk, Pp3LoadState, Pp3Move, Pp3NameState, Pp3Reason, Pp3Role, Pp3TodayLine,
} from "./people3-types.ts";

// Pure rules behind the Team screens (no database, no network; unit tested). Definitions: docs/METRICS.md "Team 3". Every figure here is built from the synced records and
// our own recorded history; nothing is invented. "Idle" is only ever "no activity recorded in your CRM", never "not working".

export const DAY = 86_400_000;
export const MIN_LEADS = 20; // a person needs this many answered leads in an account before they are ranked
export const MIN_DAYS = 14; // ... and this many days of history in that account
export const MIN_NEXT_SAMPLE = 10; // the next-lead estimate needs this many answered leads from a person
export const WAIT_HOURS = 2; // a waiting reply is "old" past this (the Today line); the 24 hour line is the Unanswered screen's
export const IDLE_HOURS = 4; // no human touch in this many working hours while leads wait
export const SINGLE_POINT_PCT = 80; // one person sent this share of an account's replies
export const SINGLE_POINT_MIN = 20; // ... with at least this many replies in 30 days
export const OVER_FACTOR = 2; // open items at least this many times the team's middle
export const UNDER_FACTOR = 0.4; // ... or at most this share of it
export const MIN_TEAM = 3; // the team's "normal" needs at least this many people in the account
export const MIN_LOAD_MIDDLE = 5; // ... and a middle of at least this many open items
export const TIE_POINTS = 0.5; // two people within half a point are tied, so neither is ranked
export const MAX_ROWS = 500; // hard cap of rows in any list or export

export const rate = (n: number, of: number, min = MIN_LEADS) => ({ value: of >= min && of > 0 ? n / of : null, n, of, enough: of >= min });
export const delta = (current: number, previous: number, min = 10) => ({ current, previous, enough: previous >= min, change: previous >= min ? (current - previous) / previous : null });
export const clampSize = (n: number): 25 | 50 | 100 => (n >= 100 ? 100 : n >= 50 ? 50 : 25);

export function parseWindow(from: string | null | undefined, to: string | null | undefined, now: number): { from: Date; to: Date; days: number; problem: string | null } {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const f = from && iso.test(from) ? Date.parse(from) : NaN;
  const t = to && iso.test(to) ? Date.parse(to) : NaN;
  const end = Number.isFinite(t) ? t + DAY : Math.floor(now / DAY) * DAY + DAY;
  const start = Number.isFinite(f) ? f : end - 28 * DAY;
  if (end <= start) return { from: new Date(end - 28 * DAY), to: new Date(end), days: 28, problem: "The start date was after the end date, so the last 28 days are shown." };
  const days = Math.round((end - start) / DAY);
  if (days > MAX_RANGE_DAYS) return { from: new Date(end - MAX_RANGE_DAYS * DAY), to: new Date(end), days: MAX_RANGE_DAYS, problem: `Periods are limited to ${MAX_RANGE_DAYS} days.` };
  return { from: new Date(start), to: new Date(end), days, problem: null };
}
export const mondayOf = (ms: number) => {
  const d = Math.floor(ms / DAY) * DAY;
  return d - ((new Date(d).getUTCDay() + 6) % 7) * DAY;
};

// ---- who a person is ----

export const UNKNOWN_SENTINEL = "~unknown";
export const AUTOMATED_SENTINEL = "~automated";
export const isRealPerson = (userId: string) => !userId.startsWith("~");

export function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} '-]/gu, " ").split(/[ -]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

/** The role a person has, from the CRM roles record: type "agency" or "account"; role "admin" or "user". Anything else is unknown (never guessed). */
export function roleOf(roleType: string | null | undefined, role: string | null | undefined): Pp3Role {
  const t = (roleType ?? "").toLowerCase(), r = (role ?? "").toLowerCase();
  if (t === "agency") return r === "admin" ? "agency_admin" : r === "user" ? "agency_staff" : "unknown";
  if (t === "account" || t === "location") return r === "admin" ? "account_admin" : r === "user" ? "account_user" : "unknown";
  return "unknown";
}
/** Owner and admin rows are shown but left out of rankings by default. */
export const isAdminRole = (r: Pp3Role) => r === "agency_admin" || r === "account_admin";

export function nameStateOf(p: { name: string | null; deleted: boolean; usersState: "ok" | "needs_permission" | "unknown" }): Pp3NameState {
  if (p.deleted) return "former";
  if (p.name && p.name.trim()) return "named";
  return p.usersState === "needs_permission" ? "needs_permission" : "unnamed";
}
export const NAME_PLACEHOLDER = { unnamed: "Unnamed user", former: "Former team member", needs_permission: "A team member" } as const; // the one banner on the screen says why names are missing; a name is never replaced by a permission message

// ---- fair ranking (indirect standardisation) ----

export type RankInput = { userId: string; name: string; isAdmin: boolean; daysOfHistory: number; bySource: Record<string, { n: number; hit: number }> };
export type RankOut = { userId: string; n: number; hit: number; value: number | null; expected: number | null; vsMix: number | null; enough: boolean; rank: number | null; tied: boolean; why: string };

const SRC = (s: string | null | undefined) => (s ?? "").trim().toLowerCase() || "unknown";
/** Merge raw source labels so "Facebook" and "facebook " are one. */
export const normaliseSource = SRC;

/** Rank people WITHIN ONE ACCOUNT, against what everyone else there did on the SAME mix of lead sources (leave-one-out). The sort key is value minus expected, in points.
 *  Under the minimum a person is shown but not ranked. Within TIE_POINTS of another, neither is ranked. At least two people with enough data are needed to rank anyone.
 *  `kind` only changes the wording of `why`. */
export function fairRank(people: readonly RankInput[], opts: { kind: "setters" | "closers"; minN?: number; minDays?: number; includeAdmins?: boolean }): RankOut[] {
  const minN = opts.minN ?? MIN_LEADS, minDays = opts.minDays ?? MIN_DAYS;
  const pool = people.filter((p) => opts.includeAdmins || !p.isAdmin);
  const total: Record<string, { n: number; hit: number }> = {};
  for (const p of pool) for (const [s, v] of Object.entries(p.bySource)) { const t = (total[s] ??= { n: 0, hit: 0 }); t.n += v.n; t.hit += v.hit; }
  const outs: RankOut[] = people.map((p) => {
    const n = Object.values(p.bySource).reduce((a, v) => a + v.n, 0), hit = Object.values(p.bySource).reduce((a, v) => a + v.hit, 0);
    const inPool = pool.some((q) => q.userId === p.userId);
    let exp = 0, weight = 0;
    for (const [s, v] of Object.entries(p.bySource)) {
      const t = total[s] ?? { n: 0, hit: 0 };
      const peersN = t.n - (inPool ? v.n : 0), peersHit = t.hit - (inPool ? v.hit : 0);
      if (peersN <= 0) continue; // nobody else answered this source: it does not count in the comparison
      exp += v.n * (peersHit / peersN); weight += v.n;
    }
    const enough = n >= minN && p.daysOfHistory >= minDays;
    const value = n > 0 ? hit / n : null;
    const expected = weight > 0 ? exp / weight : null;
    const vsMix = value !== null && expected !== null && weight >= Math.min(n, minN) ? Math.round((value - expected) * 1000) / 10 : null;
    return { userId: p.userId, n, hit, value, expected, vsMix, enough, rank: null, tied: false, why: "" };
  });
  const rankable = outs.filter((o) => o.enough && o.vsMix !== null && pool.some((p) => p.userId === o.userId)).sort((a, b) => (b.vsMix as number) - (a.vsMix as number) || b.n - a.n || a.userId.localeCompare(b.userId));
  if (rankable.length >= 2) {
    rankable.forEach((o, i) => {
      const nearTie = rankable.some((q, j) => j !== i && Math.abs((q.vsMix as number) - (o.vsMix as number)) < TIE_POINTS);
      o.tied = nearTie;
      o.rank = nearTie ? null : i + 1;
    });
  }
  for (const o of outs) o.why = whyLine(o, opts.kind, rankable.length >= 2);
  return outs;
}

export function whyLine(o: Pick<RankOut, "enough" | "vsMix" | "tied" | "n">, kind: "setters" | "closers", enoughPeers: boolean): string {
  if (!o.enough) return `Not enough data yet: ${o.n} so far, ${MIN_LEADS} needed over at least ${MIN_DAYS} days.`;
  if (o.vsMix === null) return "No other person answered the same kinds of leads, so there is nothing fair to compare with.";
  if (!enoughPeers) return "Needs at least two people with enough data in this account before anyone is ranked.";
  if (o.tied) return "Too close to someone else to rank (within half a point).";
  const pts = Math.abs(o.vsMix);
  const what = kind === "setters" ? "of their leads in time" : "of their deals";
  const verb = kind === "setters" ? "Answers" : "Wins";
  if (pts < TIE_POINTS) return `${verb} about the same share ${what} as the team does on the same sources.`;
  return `${verb} ${pts.toFixed(0)} points ${o.vsMix > 0 ? "more" : "fewer"} ${what} than the team does on the same sources.`;
}

/** Top half shown to the owner by default (research warns full rankings demote people); `all` shows everyone; a person sees only their own place. */
export function boardView<T extends { rank: number | null; userId: string }>(ranked: readonly T[], opts: { all: boolean; viewerId: string | null; selfOnly: boolean }) {
  const ordered = [...ranked].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const positioned = ordered.filter((r) => r.rank !== null);
  const half = Math.max(1, Math.ceil(positioned.length / 2));
  const youRow = opts.viewerId ? ordered.find((r) => r.userId === opts.viewerId) ?? null : null;
  if (opts.selfOnly) return { shown: [] as T[], hidden: ordered.length, visibility: "top_half" as const, you: youRow ? { rank: youRow.rank, of: positioned.length } : null };
  if (opts.all) return { shown: ordered, hidden: 0, visibility: "all" as const, you: youRow ? { rank: youRow.rank, of: positioned.length } : null };
  const shown = ordered.filter((r) => r.rank !== null && r.rank <= half);
  return { shown, hidden: ordered.length - shown.length, visibility: "top_half" as const, you: youRow ? { rank: youRow.rank, of: positioned.length } : null };
}

// ---- workload balance ----

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A person's open items against the middle of their account's team. Needs at least MIN_TEAM people and a middle of MIN_LOAD_MIDDLE (else unknown). */
export function loadState(items: number, team: readonly number[]): { state: Pp3LoadState; why: string | null; middle: number | null } {
  const mid = median(team);
  if (team.length < MIN_TEAM || mid === null || mid < MIN_LOAD_MIDDLE) return { state: "unknown", why: null, middle: mid };
  if (items >= mid * OVER_FACTOR) return { state: "over", why: `${(items / mid).toFixed(1)} times the team's middle (${items} open items, the middle is ${Math.round(mid)})`, middle: mid };
  if (items <= mid * UNDER_FACTOR) return { state: "under", why: `${Math.round((items / mid) * 100)}% of the team's middle (${items} open items, the middle is ${Math.round(mid)})`, middle: mid };
  return { state: "normal", why: `${items} open items, the team's middle is ${Math.round(mid)}`, middle: mid };
}

// ---- idle (no recorded human touch while leads wait) ----

export type Clock = { zone: string | null; businessHours: boolean; openHour: number; closeHour: number };
/** Hours since the last recorded human touch, counting only working hours when the account uses them (else every hour). */
export function quietHours(lastTouchMs: number | null, now: number, c: Clock): number | null {
  if (lastTouchMs === null || lastTouchMs >= now) return lastTouchMs === null ? null : 0;
  try {
    const ms = c.businessHours ? unansweredBusinessElapsedMs(lastTouchMs, now, c.zone, c.openHour, c.closeHour) : now - lastTouchMs;
    return Math.round((ms / 3_600_000) * 10) / 10;
  } catch { return Math.round(((now - lastTouchMs) / 3_600_000) * 10) / 10; }
}
/** Idle only when: the rule is on, they are not marked away, leads are waiting for them, and the quiet time reaches the limit. A person with no touch ever recorded is not judged. */
export function idleOf(i: { lastTouchMs: number | null; now: number; clock: Clock; waitingLeads: number; hours?: number; awayUntilMs?: number | null; deleted?: boolean; holiday?: boolean }): { hours: number; waitingLeads: number } | null {
  if (i.deleted || i.holiday || i.waitingLeads <= 0) return null;
  if (i.awayUntilMs && i.awayUntilMs > i.now) return null;
  const q = quietHours(i.lastTouchMs, i.now, i.clock);
  if (q === null || q < (i.hours ?? IDLE_HOURS)) return null;
  return { hours: q, waitingLeads: i.waitingLeads };
}

// ---- single point of failure ----

export function singlePoint(replies: ReadonlyArray<{ userId: string; name: string; n: number }>): { userId: string; name: string; sharePct: number } | null {
  const total = replies.reduce((a, r) => a + r.n, 0);
  if (total < SINGLE_POINT_MIN) return null;
  const top = [...replies].sort((a, b) => b.n - a.n)[0];
  const pct = Math.round((top.n / total) * 100);
  return top && pct >= SINGLE_POINT_PCT ? { userId: top.userId, name: top.name, sharePct: pct } : null;
}

// ---- who should get the next lead (an estimate; never auto-assigns) ----

export type NextCandidate = { userId: string; name: string; waiting: number; sourceN: number; sourceMedianSec: number | null; overallN: number; overallMedianSec: number | null; away: boolean; deleted: boolean; isAdmin: boolean };
export function suggestNextLead(cands: readonly NextCandidate[], opts: { source: string | null; includeAdmins?: boolean }): { pick: NextCandidate | null; reasons: string[]; hidden: "not_enough_data" | "nobody_available" | null } {
  const pool = cands.filter((c) => !c.away && !c.deleted && (opts.includeAdmins || !c.isAdmin));
  if (!pool.length) return { pick: null, reasons: [], hidden: "nobody_available" };
  const known = pool.filter((c) => c.overallN >= MIN_NEXT_SAMPLE);
  if (!known.length) return { pick: null, reasons: [], hidden: "not_enough_data" };
  const speed = (c: NextCandidate) => (opts.source && c.sourceN >= MIN_NEXT_SAMPLE ? c.sourceMedianSec : c.overallMedianSec) ?? 1e12;
  const ordered = [...known].sort((a, b) => a.waiting - b.waiting || speed(a) - speed(b) || b.overallN - a.overallN || a.userId.localeCompare(b.userId));
  const pick = ordered[0];
  const reasons: string[] = [];
  const mostWaiting = Math.max(...known.map((c) => c.waiting));
  reasons.push(pick.waiting === 0 ? "has no leads waiting for a reply" : pick.waiting <= mostWaiting ? `has ${pick.waiting} lead${pick.waiting === 1 ? "" : "s"} waiting${mostWaiting > pick.waiting ? `, the others have up to ${mostWaiting}` : ""}` : "");
  const sp = speed(pick);
  if (sp < 1e12) {
    const fastest = ordered.every((c) => sp <= speed(c));
    const bySource = !!(opts.source && pick.sourceN >= MIN_NEXT_SAMPLE);
    const kind = bySource ? `${opts.source} leads` : "leads";
    const n = bySource ? pick.sourceN : pick.overallN;
    reasons.push(fastest ? `answers ${kind} fastest, typically in ${fmtSeconds(sp)} (from ${n} leads)` : `answers ${kind} typically in ${fmtSeconds(sp)} (from ${n} leads)`);
  }
  return { pick, reasons: reasons.filter(Boolean), hidden: null };
}

export function fmtSeconds(s: number): string {
  if (s < 90) return `${Math.max(1, Math.round(s))} seconds`;
  const m = s / 60;
  if (m < 90) return `${Math.round(m)} minutes`;
  const h = m / 60;
  return h < 48 ? `${(Math.round(h * 10) / 10).toString().replace(/\.0$/, "")} hours` : `${Math.round(h / 24)} days`;
}
export const fmtMinutes = (m: number) => fmtSeconds(m * 60);

// ---- coaching: one thing to work on, from the person's own history ----

export type PeriodStats = { firstReplies: number; typicalReplySec: number | null; inTime: number; apptsSet: number; held: number; noShow: number; weeks: number };
const pct = (a: number, b: number) => (b > 0 ? a / b : null);

export function moves(cur: PeriodStats, prev: PeriodStats): Pp3Move[] {
  const out: Pp3Move[] = [];
  const m = (metric: string, label: string, c: number | null, p: number | null, unit: Pp3Move["unit"], higherBetter: boolean, line: (c: number, p: number) => string, enough: boolean) => {
    if (!enough || c === null || p === null) { out.push({ metric, label, current: c, previous: p, unit, better: null, line: "Not enough data to compare." }); return; }
    const better = c === p ? null : higherBetter ? c > p : c < p;
    out.push({ metric, label, current: c, previous: p, unit, better, line: line(c, p) });
  };
  const curRate = pct(cur.inTime, cur.firstReplies), prevRate = pct(prev.inTime, prev.firstReplies);
  m("reply_minutes", "Typical first reply", cur.typicalReplySec === null ? null : cur.typicalReplySec / 60, prev.typicalReplySec === null ? null : prev.typicalReplySec / 60, "minutes", false,
    (c, p) => `${fmtMinutes(c)} now, ${fmtMinutes(p)} in the four weeks before.`, cur.firstReplies >= 10 && prev.firstReplies >= 10);
  m("in_time_pct", "Answered in time", curRate === null ? null : Math.round(curRate * 100), prevRate === null ? null : Math.round(prevRate * 100), "pct", true,
    (c, p) => `${c}% now, ${p}% in the four weeks before.`, cur.firstReplies >= 10 && prev.firstReplies >= 10);
  m("appts_per_week", "Appointments set per week", cur.weeks > 0 ? Math.round((cur.apptsSet / cur.weeks) * 10) / 10 : null, prev.weeks > 0 ? Math.round((prev.apptsSet / prev.weeks) * 10) / 10 : null, "count", true,
    (c, p) => `${c} a week now, ${p} in the four weeks before.`, cur.firstReplies >= 10 && prev.firstReplies >= 10);
  const cs = pct(cur.held, cur.held + cur.noShow), ps = pct(prev.held, prev.held + prev.noShow);
  m("show_pct", "Showed share", cs === null ? null : Math.round(cs * 100), ps === null ? null : Math.round(ps * 100), "pct", true,
    (c, p) => `${c}% showed now, ${p}% in the four weeks before.`, cur.held + cur.noShow >= 10 && prev.held + prev.noShow >= 10);
  return out;
}

/** The single weakest metric against their own previous four weeks: the one that got worse by the largest share, at least 10% worse. Null when nothing got clearly worse. */
export function oneThing(ms: readonly Pp3Move[]): { metric: string; line: string; evidence: string } | null {
  let worst: { m: Pp3Move; worse: number } | null = null;
  for (const m of ms) {
    if (m.better !== false || m.current === null || m.previous === null || m.previous === 0) continue;
    const worse = Math.abs(m.current - m.previous) / Math.abs(m.previous);
    if (worse >= 0.1 && (!worst || worse > worst.worse)) worst = { m, worse };
  }
  if (!worst) return null;
  const phrase: Record<string, string> = {
    reply_minutes: "Reply to new leads faster.", in_time_pct: "Get more new leads answered inside the target.",
    appts_per_week: "Book more appointments from the leads you answer.", show_pct: "Confirm appointments so more of them show.",
  };
  return { metric: worst.m.metric, line: phrase[worst.m.metric] ?? "Work on this number.", evidence: worst.m.line };
}

export function headlineOf(i: { name: string; answered: number; typicalReplySec: number | null; inTimePct: number | null; apptsSet: number; waiting: number; enough: boolean; days: number }): string {
  if (!i.enough || i.answered === 0) return `${i.name}: not enough recorded activity in the last ${i.days} days to judge.`;
  const parts = [`answered ${i.answered} new lead${i.answered === 1 ? "" : "s"} first`];
  if (i.typicalReplySec !== null) parts.push(`typically within ${fmtSeconds(i.typicalReplySec)}`);
  if (i.inTimePct !== null) parts.push(`${Math.round(i.inTimePct * 100)}% in time`);
  if (i.apptsSet > 0) parts.push(`set ${i.apptsSet} appointment${i.apptsSet === 1 ? "" : "s"}`);
  const tail = i.waiting > 0 ? `; ${i.waiting} lead${i.waiting === 1 ? " is" : "s are"} waiting for a reply now` : "";
  return `${i.name} ${parts.join(", ")} in the last ${i.days} days${tail}.`;
}

// ---- the Today lines ----

export type TodayInput = {
  waitingOld: Array<{ userId: string; name: string; locationId: string; locationName: string; count: number }>;
  idle: Array<{ userId: string; name: string; locationId: string; locationName: string; hours: number; waiting: number }>;
  over: Array<{ userId: string; name: string; locationId: string; locationName: string; items: number; why: string }>;
  risks: Pp3AccountRisk[];
  newPeople: number;
  /** For a person without full access: speak about "you". */
  selfId: string | null;
};
export function todayLines(i: TodayInput, max = 3): Pp3TodayLine[] {
  const lines: Array<Pp3TodayLine & { w: number }> = [];
  const who = (id: string, name: string) => (i.selfId && id === i.selfId ? "You have" : `${name} has`);
  for (const r of i.waitingOld) lines.push({ w: 1000 + r.count, kind: "waiting", count: r.count, userId: r.userId, locationId: r.locationId, reason: "waiting_old",
    text: `${who(r.userId, r.name)} ${r.count} lead${r.count === 1 ? "" : "s"} waiting more than ${WAIT_HOURS} hours${i.selfId ? "" : ` in ${r.locationName}`}.` });
  for (const r of i.idle) lines.push({ w: 600 + r.waiting, kind: "idle", count: r.waiting, userId: r.userId, locationId: r.locationId, reason: "waiting",
    text: `No activity recorded in your CRM for ${i.selfId && r.userId === i.selfId ? "you" : r.name} for ${Math.round(r.hours)} hours in ${r.locationName}, and ${r.waiting} lead${r.waiting === 1 ? "" : "s"} wait.` });
  for (const r of i.over) lines.push({ w: 400 + r.items, kind: "overload", count: r.items, userId: r.userId, locationId: r.locationId, reason: "waiting",
    text: `${r.name} has ${r.items} open items in ${r.locationName}, well above the team's middle.` });
  for (const r of i.risks) lines.push({ w: r.kind === "nobody_active" ? 500 : 300, kind: r.kind === "nobody_active" ? "nobody_active" : "single_point", count: 1, userId: r.person?.userId ?? null, locationId: r.location.locationId, reason: null, text: r.line });
  if (i.newPeople > 0 && !i.selfId) lines.push({ w: 100, kind: "new_person", count: i.newPeople, userId: null, locationId: null, reason: null, text: `${i.newPeople} new person${i.newPeople === 1 ? "" : "s"} appeared in your CRM activity. Name ${i.newPeople === 1 ? "them" : "them"} so their numbers read properly.` });
  return lines.sort((a, b) => b.w - a.w).slice(0, max).map((l) => { const { w, ...rest } = l; void w; return rest; });
}

export function risksOf(a: { location: { locationId: string; name: string }; replies30: ReadonlyArray<{ userId: string; name: string; n: number }>; activePeople: number; people: number }): Pp3AccountRisk[] {
  const out: Pp3AccountRisk[] = [];
  if (a.people > 0 && a.activePeople === 0) out.push({ location: a.location, kind: "nobody_active", person: null, sharePct: null, line: `Nobody in ${a.location.name} has a recorded reply in the last 14 days. No activity recorded in your CRM.` });
  const sp = singlePoint(a.replies30);
  if (sp) out.push({ location: a.location, kind: "single_point", person: { userId: sp.userId, name: sp.name }, sharePct: sp.sharePct, line: `${sp.name} sends ${sp.sharePct}% of the replies in ${a.location.name}. If they are away, nobody else is covering.` });
  return out;
}

// ---- proof receipt wording ----

export function proofLines(i: { leads: number; answered: number; typicalReplyMinutes: number | null; targetMinutes: number | null; inTime: number; showed: number; noShow: number; appointments: number; days: number }): string[] {
  const out: string[] = [];
  if (i.leads > 0) out.push(`${i.answered} of ${i.leads} new leads got a reply from a person in the last ${i.days} days.`);
  if (i.typicalReplyMinutes !== null) out.push(`The typical first reply took ${fmtMinutes(i.typicalReplyMinutes)}${i.targetMinutes ? ` (the target is ${i.targetMinutes} minutes)` : ""}.`);
  if (i.answered >= 5 && i.targetMinutes) out.push(`${Math.round((i.inTime / i.answered) * 100)}% of those replies were inside the target.`);
  if (i.appointments > 0) out.push(`${i.appointments} appointment${i.appointments === 1 ? "" : "s"} booked; ${i.showed} showed and ${i.noShow} did not.`);
  return out;
}

// ---- cursors ----

export type Cursor = { v: number | string | null; id: string };
export function encodeCursor(c: Cursor): string { return Buffer.from(JSON.stringify([c.v, c.id])).toString("base64url"); }
export function decodeCursor(s: string | null | undefined): Cursor | null {
  if (!s || s.length > 400) return null;
  try {
    const a = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (!Array.isArray(a) || a.length !== 2 || typeof a[1] !== "string" || a[1].length > 128) return null;
    if (a[0] !== null && typeof a[0] !== "number" && typeof a[0] !== "string") return null;
    return { v: a[0], id: a[1] };
  } catch { return null; }
}

/** The reasons a list can open, with the words the screen uses. */
export const REASON_TEXT: Record<Pp3Reason, { label: string; why: string }> = {
  waiting: { label: "Waiting for a reply", why: "The lead wrote last and nobody has answered yet." },
  waiting_old: { label: `Waiting more than ${WAIT_HOURS} hours`, why: `The lead wrote last, more than ${WAIT_HOURS} hours ago, and nobody has answered.` },
  stale_deals: { label: "Quiet deals", why: "Open deals with a value and an owner that have not moved stage for 30 days." },
  open_deals: { label: "Open deals", why: "Open deals with a value and an owner, the same rule as the Pipeline." },
  needs_outcome: { label: "No outcome recorded", why: "Appointments more than 3 hours past their start with no showed, no-show or cancelled mark." },
  upcoming: { label: "Coming up", why: "Appointments that have not started yet." },
  no_owner: { label: "No owner", why: "Waiting replies nobody owns." },
};
