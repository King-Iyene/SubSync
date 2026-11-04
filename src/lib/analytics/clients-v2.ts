// The Clients module, rebuilt (docs/CLIENTS_REVIEW.md): the agency's client book. Pure rules, no database, no React: how healthy each client looks and why, who needs a
// check-in first, which renewals are coming, what a client pays against what it got, what changed, what to say. The server only gathers the facts and calls these;
// every number on the screen and every list behind it comes from one function here, so a count and its list cannot disagree (src/lib/__tests__/clients-v2.test.ts).
//
// Fee, renewal date and industry are typed by the agency; SubSync does not read them from the CRM. Everything else is worked out from data SubSync already keeps,
// by the rules Today, the Account audit and Speed to lead already use (people waiting, no-shows, quiet deals, replies in time), never by a second definition.

import { MIN_BASE, changeBetween } from "../design/range.ts";
import { REPLY_DELAY_AT_RISK, REPLY_DELAY_WATCH } from "../scoring.ts";
import { MIN_FOR_MEDIAN } from "./speed-intel.ts";
import { renewalStatus, CONTACT_GAP_DAYS } from "./client-intel.ts";

const DAY = 86_400_000;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** A client added less than this many days ago is too new to be judged on its score or its activity. Waiting customers still count: they are real from day one. */
export const NEW_CLIENT_DAYS = 14;
/** Replies in time are judged over the last 14 days (the Account audit's window) and only from this many judged leads (Speed to lead's minimum). */
export const REPLY_WINDOW_DAYS = 14;
export const MIN_REPLY_LEADS = MIN_FOR_MEDIAN;
/** The share of new leads answered in time below which a client is worth watching. */
export const REPLY_SHARE_WATCH = 0.5;
/** No-shows still waiting to be won back at which a client is worth watching (the Appointments rule: last 14 days, no later booking). */
export const NO_SHOWS_WATCH = 3;
/** Deals gone quiet that are worth a line (the Account audit's rule). Shown, never counted into the health label. */
export const QUIET_DEALS_NOTE = 3;
/** A renewal this close (or past) puts a client in "Who needs you" even when its health is fine. */
export const RENEWAL_DUE_DAYS = 14;
export const RENEWAL_SOON_DAYS = 30;
export const RENEWAL_WINDOW_DAYS = 60;
/** The days of history needed before "what changed" compares today with a month ago. */
export const MIN_HISTORY_DAYS = 28;
/** New deals needed in 30 days before "times the fee" is said; under it the dollars are shown without a multiple. */
export const MIN_DEALS_FOR_MULTIPLE = 3;

// ============================================================ health: one label, with the reason

export type Level = "at_risk" | "watch" | "healthy" | "new" | "not_read";
export const LEVEL_WORDS: Record<Level, string> = { at_risk: "At risk", watch: "Watch", healthy: "Healthy", new: "New", not_read: "Not read yet" };

export type ReasonKey = "dormant" | "score_low" | "score_drop" | "waiting" | "reply_speed" | "lead_drop" | "no_shows" | "quiet_deals";
export type Reason = { key: ReasonKey; text: string; weight: "high" | "medium" | "info" };

/** What the server gathers for one client. Counts of people waiting, no-shows and quiet deals come from the Account audit's rows (Today's rules); the score, the churn
 *  warning and the lead-flow drop come from the account as derived everywhere else. */
export type Signals = {
  id: string; name: string;
  /** False until SubSync has finished its first read of the account. */
  read: boolean;
  score: number; churn: "low" | "medium" | "high"; churnReasons: string[];
  dormant: boolean; daysInactive: number | null;
  /** People waiting for a reply under Today's rule. */
  waiting: number;
  /** No-shows not yet won back (Appointments' rule). */
  noShows: number;
  quietDeals: number; quietDealValue: number;
  /** Share of the last 14 days' new leads answered inside the reply target, or null under the minimum, and how many were judged. */
  replyShare: number | null; replyJudged: number; targetMinutes: number;
  /** New contacts against this client's own normal: percent down, only when the account's own history is long enough and its baseline big enough (derive.ts leadFlowDrop). */
  leadDropPct: number | null;
  daysSinceAdded: number | null;
  fee: number | null; renewalDate: string | null; industry: string | null;
  /** Days since someone on the team logged talking to the client, or null when nothing is logged. */
  lastSpokenDays: number | null;
};

export type Renewal = { date: string; /** "12 Dec", or "31 Mar 2027" in another year. */ dateText: string; daysLeft: number; bucket: "overdue" | "30" | "60" | "90" | "later"; words: string; due: boolean };
export type Needs = { kind: "risk" | "renewal"; label: string };
export type Assessment = {
  level: Level; label: string; reasons: Reason[]; /** The one line a row shows under the name. */ line: string;
  renewal: Renewal | null; needs: Needs | null; context: string[];
};

const dateWords = (iso: string, nowMs: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  const sameYear = d.getUTCFullYear() === new Date(nowMs).getUTCFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
};
export { dateWords };

/** "Renews in 12 days", "Renews today", "Renewal was 6 days ago": the countdown, in words (the days come from client-intel's renewalStatus). */
export function renewalWords(daysLeft: number): string {
  if (daysLeft < 0) return `Renewal was ${plural(-daysLeft, "day", "days")} ago`;
  if (daysLeft === 0) return "Renews today";
  if (daysLeft === 1) return "Renews tomorrow";
  if (daysLeft <= 90) return `Renews in ${daysLeft} days`;
  return `Renews in ${Math.round(daysLeft / 30)} months`;
}
export function renewalOf(renewalDate: string | null, nowMs: number): Renewal | null {
  const r = renewalStatus(renewalDate, nowMs);
  if (!r || !renewalDate) return null;
  return { date: renewalDate, dateText: dateWords(renewalDate, nowMs), daysLeft: r.daysLeft, bucket: r.bucket, words: renewalWords(r.daysLeft), due: r.daysLeft <= RENEWAL_DUE_DAYS };
}

const reasonRank: Record<Reason["weight"], number> = { high: 0, medium: 1, info: 2 };
const pct = (x: number) => Math.round(x * 100);

/** How healthy a client looks, and why. The label is one word; the reasons are sentences with the number in them. */
export function assess(s: Signals, nowMs: number): Assessment {
  const renewal = renewalOf(s.renewalDate, nowMs);
  const context: string[] = [];
  if (renewal) context.push(`${renewal.words} (${dateWords(renewal.date, nowMs)}).`);
  if (s.lastSpokenDays !== null) context.push(s.lastSpokenDays === 0 ? "You spoke to them today." : `You last spoke to them ${plural(s.lastSpokenDays, "day", "days")} ago.`);

  const needsOf = (level: Level): Needs | null =>
    level === "at_risk" ? { kind: "risk", label: LEVEL_WORDS.at_risk }
      : level === "watch" ? { kind: "risk", label: LEVEL_WORDS.watch }
        : renewal && renewal.due ? { kind: "renewal", label: renewal.daysLeft < 0 ? "Renewal overdue" : "Renewal due" } : null;

  if (!s.read) {
    return { level: "not_read", label: LEVEL_WORDS.not_read, reasons: [], line: "SubSync has not finished reading this account yet. It usually takes a few minutes.", renewal, needs: needsOf("not_read"), context };
  }

  const isNew = s.daysSinceAdded !== null && s.daysSinceAdded < NEW_CLIENT_DAYS;
  const reasons: Reason[] = [];
  const add = (key: ReasonKey, text: string, weight: Reason["weight"]) => reasons.push({ key, text, weight });

  // Activity: judged only on an account that has been here long enough to have a normal.
  if (!isNew && s.dormant) add("dormant", s.daysInactive === null ? "SubSync has not seen any activity in this account." : `Nothing has happened in the account for ${plural(s.daysInactive, "day", "days")}.`, "high");
  if (!isNew && s.score < 35) add("score_low", `Health score is ${s.score} out of 100.`, "high");
  else if (!isNew && s.score < 55) add("score_low", `Health score is ${s.score} out of 100.`, "medium");
  if (!isNew) for (const r of s.churnReasons) {
    const m = /^Score fell (\d+) points/.exec(r);
    if (m) add("score_drop", `Health score fell ${m[1]} points from its recent average.`, Number(m[1]) >= 25 ? "high" : "medium");
  }
  // Customers waiting are real from the first day, so they count for a new client too. Same thresholds as the health label everywhere else.
  if (s.waiting >= REPLY_DELAY_AT_RISK) add("waiting", `${plural(s.waiting, "person is", "people are")} waiting for a reply.`, "high");
  else if (s.waiting >= REPLY_DELAY_WATCH) add("waiting", `${plural(s.waiting, "person is", "people are")} waiting for a reply.`, "medium");
  else if (s.waiting > 0) add("waiting", `${plural(s.waiting, "person is", "people are")} waiting for a reply.`, "info");
  if (s.replyShare !== null && s.replyJudged >= MIN_REPLY_LEADS && s.replyShare < REPLY_SHARE_WATCH) {
    add("reply_speed", pct(s.replyShare) === 0 ? `None of the last ${s.replyJudged} new leads got a reply in time.` : `Only ${pct(s.replyShare)}% of the last ${s.replyJudged} new leads got a reply in time.`, "medium");
  }
  if (!isNew && s.leadDropPct !== null) add("lead_drop", `New contacts are down ${s.leadDropPct}% against this client's own normal.`, "medium");
  if (s.noShows >= NO_SHOWS_WATCH) add("no_shows", `${plural(s.noShows, "no-show is", "no-shows are")} still waiting to be won back.`, "medium");
  else if (s.noShows > 0) add("no_shows", `${plural(s.noShows, "no-show is", "no-shows are")} still waiting to be won back.`, "info");
  if (s.quietDeals >= QUIET_DEALS_NOTE) add("quiet_deals", `${plural(s.quietDeals, "deal", "deals")} worth ${money(s.quietDealValue)} ${s.quietDeals === 1 ? "has" : "have"} gone quiet.`, "info");

  const high = reasons.some((r) => r.weight === "high") || (!isNew && s.churn === "high");
  const medium = reasons.some((r) => r.weight === "medium") || (!isNew && s.churn === "medium");
  const level: Level = high ? "at_risk" : medium ? "watch" : isNew ? "new" : "healthy";
  // A label above Healthy must always say why: if the churn warning fired for a reason not listed, give the score as the reason.
  if ((level === "at_risk" || level === "watch") && !reasons.some((r) => r.weight !== "info")) add("score_low", `Health score is ${s.score} out of 100.`, level === "at_risk" ? "high" : "medium");
  reasons.sort((a, b) => reasonRank[a.weight] - reasonRank[b.weight]);

  let line: string;
  if (level === "at_risk" || level === "watch") {
    const shown = reasons.filter((r) => r.weight !== "info");
    line = shown[0].text + (shown.length > 1 ? ` And ${plural(shown.length - 1, "more thing", "more things")}.` : "");
  } else if (reasons.length > 0) {
    line = reasons[0].text;
  } else if (level === "new") {
    line = `Added ${s.daysSinceAdded === 0 ? "today" : plural(s.daysSinceAdded ?? 0, "day", "days") + " ago"}. Too early to judge its health.`;
  } else {
    line = s.replyShare !== null && s.replyJudged >= MIN_REPLY_LEADS ? `Nothing needs attention. ${pct(s.replyShare)}% of the last ${s.replyJudged} new leads got a reply in time.` : "Nothing needs attention.";
  }
  if (level === "new" && reasons.length > 0) line = `New client. ${reasons[0].text}`;
  if (level === "healthy" && reasons.length > 0) line = `${reasons[0].text}`;
  return { level, label: LEVEL_WORDS[level], reasons, line, renewal, needs: needsOf(level), context };
}

// ============================================================ the book: one row per client, ranked

export type BookRow = {
  id: string; name: string; level: Level; label: string; line: string; reasons: Reason[]; needs: Needs | null; renewal: Renewal | null; context: string[];
  score: number; fee: number | null; industry: string | null; lastSpokenDays: number | null; daysSinceAdded: number | null;
};

export function rowOf(s: Signals, nowMs: number): BookRow {
  const a = assess(s, nowMs);
  return { id: s.id, name: s.name, level: a.level, label: a.label, line: a.line, reasons: a.reasons, needs: a.needs, renewal: a.renewal, context: a.context, score: s.score, fee: s.fee, industry: s.industry, lastSpokenDays: s.lastSpokenDays, daysSinceAdded: s.daysSinceAdded };
}

const NEEDS_ORDER: Record<string, number> = { at_risk: 0, watch: 1, renewal: 2 };
const LEVEL_ORDER: Record<Level, number> = { at_risk: 0, watch: 1, not_read: 3, new: 4, healthy: 5 };
const rankGroup = (r: BookRow) => (r.needs ? NEEDS_ORDER[r.level === "at_risk" ? "at_risk" : r.level === "watch" ? "watch" : "renewal"] : LEVEL_ORDER[r.level]);
const byName = (a: BookRow, b: BookRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Who needs attention first: at risk, then watch, then a renewal that is due, then the rest. Inside a group the renewal that is soonest comes first, then the bigger fee
 *  (money first), then the lower health score, then the name. */
export function byAttention(a: BookRow, b: BookRow): number {
  const g = rankGroup(a) - rankGroup(b);
  if (g !== 0) return g;
  const ra = a.renewal && a.renewal.daysLeft <= RENEWAL_SOON_DAYS ? a.renewal.daysLeft : Infinity;
  const rb = b.renewal && b.renewal.daysLeft <= RENEWAL_SOON_DAYS ? b.renewal.daysLeft : Infinity;
  if (ra !== rb) return ra < rb ? -1 : 1;
  const fa = a.fee ?? 0, fb = b.fee ?? 0;
  if (fa !== fb) return fb - fa;
  return a.score - b.score || byName(a, b);
}

export type Filter = "all" | "needs" | "at_risk" | "watch" | "healthy" | "new" | "not_read" | "renewing" | "overdue" | "no_fee";
export const FILTERS: Filter[] = ["all", "needs", "at_risk", "watch", "healthy", "new", "not_read", "renewing", "overdue", "no_fee"];
export const FILTER_WORDS: Record<Filter, string> = {
  all: "All", needs: "Needs you", at_risk: "At risk", watch: "Watch", healthy: "Healthy", new: "New", not_read: "Not read yet", renewing: `Renewing in ${RENEWAL_WINDOW_DAYS} days`, overdue: "Renewal overdue", no_fee: "No fee yet",
};
export const parseFilter = (v: string | null | undefined): Filter => (FILTERS.includes(v as Filter) ? (v as Filter) : "all");

/** Renewing = overdue or due inside the window. The window is the whole "next 60 days" list, counted once. */
const renewingNow = (r: BookRow) => r.renewal !== null && r.renewal.daysLeft <= RENEWAL_WINDOW_DAYS;
const PRED: Record<Filter, (r: BookRow) => boolean> = {
  all: () => true,
  needs: (r) => r.needs !== null,
  at_risk: (r) => r.level === "at_risk",
  watch: (r) => r.level === "watch",
  healthy: (r) => r.level === "healthy",
  new: (r) => r.level === "new",
  not_read: (r) => r.level === "not_read",
  renewing: renewingNow,
  overdue: (r) => r.renewal !== null && r.renewal.daysLeft < 0,
  no_fee: (r) => r.fee === null,
};

export type Sort = "attention" | "name" | "fee" | "renewal" | "score";
export const SORTS: Sort[] = ["attention", "name", "fee", "renewal", "score"];
export const SORT_WORDS: Record<Sort, string> = { attention: "Needs you first", name: "Name", fee: "Biggest fee first", renewal: "Renewal soonest", score: "Lowest health first" };
export const parseSort = (v: string | null | undefined): Sort => (SORTS.includes(v as Sort) ? (v as Sort) : "attention");

const SORTERS: Record<Sort, (a: BookRow, b: BookRow) => number> = {
  attention: byAttention,
  name: byName,
  fee: (a, b) => (b.fee ?? -1) - (a.fee ?? -1) || byName(a, b),
  // A renewal sorts by its day; clients with no date go last, never first.
  renewal: (a, b) => (a.renewal?.daysLeft ?? Infinity) - (b.renewal?.daysLeft ?? Infinity) || byName(a, b),
  score: (a, b) => a.score - b.score || byName(a, b),
};

/** The one function that picks, searches and orders clients. A headline number and the list behind it both call it, so they cannot differ. */
export function selectClients(rows: readonly BookRow[], o: { filter?: Filter; q?: string; sort?: Sort } = {}): BookRow[] {
  const q = (o.q ?? "").trim().toLowerCase();
  const keep = PRED[o.filter ?? "all"];
  const out = rows.filter((r) => keep(r) && (!q || r.name.toLowerCase().includes(q) || (r.industry ?? "").toLowerCase().includes(q)));
  return out.sort(SORTERS[o.sort ?? "attention"]);
}

export type Facets = Record<Filter, number>;
export const facetsOf = (rows: readonly BookRow[]): Facets => Object.fromEntries(FILTERS.map((f) => [f, selectClients(rows, { filter: f }).length])) as Facets;

export type Summary = {
  total: number; atRisk: number; watch: number; healthy: number; newClients: number; notRead: number; needYou: number;
  renewalsDue: number; renewalsOverdue: number; renewals60: number; renewals60Fee: number;
  feeTotal: number; feeCount: number; atRiskFee: number; atRiskFeeKnown: number; noFees: boolean; noRenewals: boolean; noIndustry: boolean;
};

/** Every figure of the first screen, each one counted with selectClients so it equals the list it opens. */
export function summarize(rows: readonly BookRow[]): Summary {
  const n = (f: Filter) => selectClients(rows, { filter: f }).length;
  const atRisk = selectClients(rows, { filter: "at_risk" });
  const renewing = selectClients(rows, { filter: "renewing" });
  const withFee = rows.filter((r) => r.fee !== null);
  const due = rows.filter((r) => r.renewal !== null && r.renewal.daysLeft <= RENEWAL_SOON_DAYS);
  return {
    total: rows.length, atRisk: atRisk.length, watch: n("watch"), healthy: n("healthy"), newClients: n("new"), notRead: n("not_read"), needYou: n("needs"),
    renewalsDue: due.length, renewalsOverdue: n("overdue"), renewals60: renewing.length, renewals60Fee: renewing.reduce((s, r) => s + (r.fee ?? 0), 0),
    feeTotal: withFee.reduce((s, r) => s + (r.fee ?? 0), 0), feeCount: withFee.length,
    atRiskFee: atRisk.reduce((s, r) => s + (r.fee ?? 0), 0), atRiskFeeKnown: atRisk.filter((r) => r.fee !== null).length,
    noFees: withFee.length === 0, noRenewals: rows.every((r) => r.renewal === null), noIndustry: rows.every((r) => !r.industry),
  };
}

// ============================================================ the sentence and the one button

export type HeadlinePart = { t: string; strong?: boolean };
export type Headline = { parts: HeadlinePart[]; text: string; allClear: boolean };
const textOf = (parts: HeadlinePart[]) => parts.map((p) => p.t).join("");

/** "3 clients look at risk, 2 renewals due within 30 days, $4,200 a month at stake." The money is the monthly fees the agency typed for the clients at risk. */
export function headlineOf(s: Summary): Headline {
  const P = (t: string): HeadlinePart => ({ t });
  const S = (t: string): HeadlinePart => ({ t, strong: true });
  if (s.total === 0) return { parts: [P("No client accounts yet.")], text: "No client accounts yet.", allClear: false };
  if (s.atRisk === 0 && s.watch === 0 && s.renewalsDue === 0) {
    const parts = s.healthy + s.newClients === s.total && s.total > 1 ? [S(String(s.total)), P(" clients look healthy. Nobody needs a check-in.")] : [P("No client needs a check-in.")];
    return { parts, text: textOf(parts), allClear: true };
  }
  const parts: HeadlinePart[] = [];
  if (s.atRisk > 0) parts.push(S(String(s.atRisk)), P(s.atRisk === 1 ? " client looks at risk" : " clients look at risk"));
  else if (s.watch > 0) parts.push(P("No client looks at risk, "), S(String(s.watch)), P(s.watch === 1 ? " is worth watching" : " are worth watching"));
  else parts.push(P("No client looks at risk"));
  if (s.renewalsDue > 0) parts.push(P(", "), S(String(s.renewalsDue)), P(s.renewalsDue === 1 ? ` renewal due within ${RENEWAL_SOON_DAYS} days` : ` renewals due within ${RENEWAL_SOON_DAYS} days`));
  if (s.atRisk > 0 && s.atRiskFeeKnown > 0) parts.push(P(", "), S(money(s.atRiskFee)), P(" a month at stake"));
  parts.push(P("."));
  return { parts, text: textOf(parts), allClear: false };
}

/** The line under the sentence: where the money figure comes from, said once, or what to add to get it. */
export function supportLine(s: Summary): string {
  if (s.total === 0) return "";
  if (s.noFees) return "SubSync does not know what your clients pay you. Add a fee for each client to see how much is at stake.";
  if (s.atRisk > 0 && s.atRiskFeeKnown < s.atRisk) return `The money is the monthly fees you typed. ${s.atRiskFeeKnown} of the ${s.atRisk} clients at risk ${s.atRiskFeeKnown === 1 ? "has" : "have"} one.`;
  if (s.atRisk > 0) return "The money is the monthly fees you typed for the clients at risk.";
  return `${plural(s.feeCount, "client has", "clients have")} a fee you typed, ${money(s.feeTotal)} a month in all.`;
}

export type Primary = { label: string; kind: "queue" | "fee"; filter: Filter | null };
/** The one button: check in with the clients at risk; else the ones to watch; else the renewals that are due; else, on first use, add a fee. */
export function primaryOf(s: Summary, first: { name: string } | null): Primary | null {
  if (s.atRisk > 0) return { label: s.atRisk === 1 && first ? `Check in with ${first.name}` : `Check in with the ${s.atRisk} clients at risk`, kind: "queue", filter: "at_risk" };
  if (s.watch > 0) return { label: s.watch === 1 && first ? `Look at ${first.name}` : `Look at the ${s.watch} clients to watch`, kind: "queue", filter: "watch" };
  if (s.renewalsDue > 0) return { label: s.renewalsDue === 1 ? "Prepare the renewal" : `Prepare the ${s.renewalsDue} renewals`, kind: "queue", filter: "needs" };
  if (s.noFees && s.total > 0) return { label: "Add your first client fee", kind: "fee", filter: null };
  return null;
}

/** What to do when nothing is wrong: the next useful thing, never an empty page. */
export function nextStep(s: Summary): string | null {
  if (s.total === 0) return null;
  if (s.noFees) return "Add what each client pays you, so the money at stake and the value created can be shown.";
  if (s.noRenewals) return "Add each client's renewal date so no renewal catches you by surprise.";
  if (s.feeCount < s.total) return `Add a fee for the ${plural(s.total - s.feeCount, "client", "clients")} without one.`;
  if (s.noIndustry) return "Choose each client's industry so the reply targets and onboarding steps fit.";
  if (s.renewals60 > 0) return `Look at the ${plural(s.renewals60, "renewal", "renewals")} in the next ${RENEWAL_WINDOW_DAYS} days and get ready to show what you delivered.`;
  return "Nothing to do right now. Log your next conversation with a client so the next person knows where things stand.";
}

// ============================================================ fee against value created

export type ValueIn = { fee: number | null; pipeline30: number; dealsStarted30: number; won30: number; wonCount30: number };
export type Value =
  | { kind: "needs_fee"; sentence: string }
  | { kind: "ok"; multiple: number | null; pipeline30: number; won30: number; sentence: string };

/** The Value created sentence, in plain words. Counted deals only (a value above zero and an owner). A multiple needs the fee and at least 3 new deals; otherwise the dollars
 *  are shown and the sentence says there are too few to call it a multiple. It is an estimate: new deals are not money in the bank. */
export function valueOf(v: ValueIn): Value {
  if (v.fee === null || !(v.fee > 0)) return { kind: "needs_fee", sentence: "Add what this client pays you to see how it compares with the new deals they got." };
  if (v.dealsStarted30 === 0) return { kind: "ok", multiple: null, pipeline30: 0, won30: v.won30, sentence: `No new deals started in the last 30 days. They pay you ${money(v.fee)} a month.` };
  const won = v.wonCount30 > 0 ? ` ${plural(v.wonCount30, "deal was", "deals were")} won, worth ${money(v.won30)}.` : "";
  if (v.dealsStarted30 < MIN_DEALS_FOR_MULTIPLE) return { kind: "ok", multiple: null, pipeline30: v.pipeline30, won30: v.won30, sentence: `${plural(v.dealsStarted30, "new deal", "new deals")} worth ${money(v.pipeline30)} started in the last 30 days. That is too few to compare with the ${money(v.fee)} fee.${won}` };
  const multiple = Math.round((v.pipeline30 / v.fee) * 10) / 10;
  return { kind: "ok", multiple, pipeline30: v.pipeline30, won30: v.won30, sentence: `${plural(v.dealsStarted30, "new deal", "new deals")} worth ${money(v.pipeline30)} started in the last 30 days: about ${multiple}x the ${money(v.fee)} they pay you each month.${won}` };
}
/** What the account produced, with no fee in it (it is said to the client and printed in the summary): "6 new deals worth $18,000 started in the last 30 days." Null when none started. */
export function dealsLine(v: Pick<ValueIn, "pipeline30" | "dealsStarted30" | "won30" | "wonCount30">): string | null {
  if (v.dealsStarted30 === 0 && v.wonCount30 === 0) return null;
  const started = v.dealsStarted30 > 0 ? `${plural(v.dealsStarted30, "new deal", "new deals")} worth ${money(v.pipeline30)} started in the last 30 days` : null;
  const won = v.wonCount30 > 0 ? `${plural(v.wonCount30, "deal was", "deals were")} won, worth ${money(v.won30)}` : null;
  return `${[started, won].filter(Boolean).join("; ")}.`;
}
/** The formula, in plain words, with a worked example computed by the same arithmetic. */
export function valueFormula(): string {
  const ex = Math.round((18_000 / 2_500) * 10) / 10;
  return `Value created is the value of the new deals that started in the last 30 days (only deals with a value above zero and an owner, the same deals every page counts), divided by what the client pays you each month. A client paying $2,500 a month who got $18,000 of new deals shows ${ex}x. It is an estimate: new deals are not money in the bank, and needs the fee you typed.`;
}

// ============================================================ what changed, from the daily record

export type DayPoint = { day: string; healthScore: number | null; openValue: number | null; newContacts30d: number | null };
export type Changed = { lines: string[]; historyDays: number; enough: boolean; note: string | null };

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
/** What moved in the last month, against the client's own daily record. Says so plainly when the record is shorter than four weeks, and never compares a day counted by older rules. */
export function whatChanged(points: readonly DayPoint[]): Changed {
  const pts = [...points].sort((a, b) => a.day.localeCompare(b.day));
  if (pts.length === 0) return { lines: [], historyDays: 0, enough: false, note: "SubSync has no daily record of this client yet." };
  const last = pts[pts.length - 1];
  const historyDays = Math.round((dayMs(last.day) - dayMs(pts[0].day)) / DAY) + 1;
  if (historyDays < MIN_HISTORY_DAYS) return { lines: [], historyDays, enough: false, note: `SubSync has watched this client for ${plural(historyDays, "day", "days")}. Changes show once there are ${MIN_HISTORY_DAYS} days of record.` };
  const target = dayMs(last.day) - 30 * DAY;
  // The latest day on or before that date that has a value, and not a week or more earlier than it (a gap in the record is not compared across).
  const before = (pick: (p: DayPoint) => number | null) => [...pts].reverse().find((p) => dayMs(p.day) <= target && dayMs(p.day) > target - 7 * DAY && pick(p) !== null) ?? null;
  const lines: string[] = [];
  const h0 = before((p) => p.healthScore);
  if (h0 && last.healthScore !== null && h0.healthScore !== null) {
    const d = last.healthScore - h0.healthScore;
    if (Math.abs(d) >= 5) lines.push(`Health score ${d > 0 ? "rose" : "fell"} from ${h0.healthScore} to ${last.healthScore}.`);
  }
  const c0 = before((p) => p.newContacts30d);
  if (c0 && last.newContacts30d !== null && c0.newContacts30d !== null) {
    const ch = changeBetween(last.newContacts30d, c0.newContacts30d, "new contacts");
    if (ch.kind === "percent" && Math.abs(ch.percent ?? 0) >= 20) lines.push(`New contacts: ${ch.text.charAt(0).toLowerCase()}${ch.text.slice(1)}.`);
    else if (ch.kind === "difference" && Math.abs(last.newContacts30d - c0.newContacts30d) >= 3) lines.push(`New contacts: ${ch.text.charAt(0).toLowerCase()}${ch.text.slice(1)}.`);
  }
  const o0 = before((p) => p.openValue);
  if (o0 && last.openValue !== null && o0.openValue !== null && Math.max(o0.openValue, last.openValue) >= MIN_BASE * 100) {
    const ch = changeBetween(Math.round(last.openValue), Math.round(o0.openValue), "", 500);
    if (ch.kind === "percent" && Math.abs(ch.percent ?? 0) >= 20) lines.push(`Open pipeline went from ${money(o0.openValue)} to ${money(last.openValue)}.`);
  }
  return { lines, historyDays, enough: true, note: lines.length === 0 ? "Nothing moved much in the last month." : null };
}

// ============================================================ what to say

type Talk = { say: (r: Reason, ctx: TalkCtx) => string; step: string };
export type TalkCtx = { name: string; /** What the account produced, without the fee (said to the client). */ dealsLine: string | null; nowMs: number };
const TALK: Record<ReasonKey, Talk> = {
  waiting: { say: (r) => `${r.text.replace(/\.$/, "")}. Who on your team can answer them today? I can send you the list of names.`, step: "Reply to the people who are waiting, then agree who answers new ones." },
  reply_speed: { say: (r) => `${r.text} New leads go cold fast. Let's agree who answers them and how, then look at the speed again in two weeks.`, step: "Agree who answers every new lead and how fast, then check the reply speed again in two weeks." },
  dormant: { say: (r) => `${r.text.replace(/\.$/, "")}. Has something changed on your side? Let's pick one campaign to restart it.`, step: "Book a call to find out why it went quiet, and agree one campaign to restart it." },
  score_low: { say: (r) => `${r.text} Activity in the account is low. Can we book 20 minutes this week to look at what is holding it back?`, step: "Book 20 minutes to look at what is holding the account back." },
  score_drop: { say: (r) => `${r.text} Something changed in the last few weeks. Can we look at it together?`, step: "Look at what changed in the last few weeks, together with the client." },
  lead_drop: { say: (r) => `${r.text} Did an ad, a form or a page change? Let's check where the leads used to come from.`, step: "Check where new contacts used to come from: ads, forms, pages." },
  no_shows: { say: (r) => `${r.text.replace(/\.$/, "")}. A quick text or call usually wins half of them back. Shall we set that up?`, step: "Call or text the no-shows to rebook them." },
  quiet_deals: { say: (r) => `${r.text.replace(/\.$/, "")}. Shall we go through them together: win it, move it or close it?`, step: "Go through the quiet deals: win it, move it or close it." },
};

export type TalkingPoint = { key: string; reason: string; say: string };
/** Text only, to read out or paste. Nothing here is sent anywhere. Each reason gets a line; a renewal that is due gets one that leads with what was delivered. */
export function talkingPoints(reasons: readonly Reason[], renewal: Renewal | null, ctx: TalkCtx): TalkingPoint[] {
  const out: TalkingPoint[] = reasons.filter((r) => r.weight !== "info" || r.key === "waiting" || r.key === "quiet_deals" || r.key === "no_shows").map((r) => ({ key: r.key, reason: r.text, say: TALK[r.key].say(r, ctx) }));
  if (renewal && renewal.due) {
    const when = renewal.daysLeft < 0 ? `renewal date was ${dateWords(renewal.date, ctx.nowMs)}` : `agreement renews on ${dateWords(renewal.date, ctx.nowMs)}`;
    out.push({ key: "renewal", reason: renewal.words, say: `Your ${when}. Before then I would like to show you what the account has produced${ctx.dealsLine ? `: ${ctx.dealsLine.replace(/\.$/, "")}` : ""}. When is a good time this week?` });
  }
  return out;
}

/** The days to start the renewal conversation: 60, 30 and 14 days before the date, the ones still ahead. A display, never sent. */
export function reminderDays(renewalDate: string | null, nowMs: number): Array<{ before: number; date: string; words: string }> {
  if (!renewalDate || !/^\d{4}-\d{2}-\d{2}$/.test(renewalDate)) return [];
  const t = dayMs(renewalDate);
  const today = Math.floor(nowMs / DAY) * DAY;
  return [60, 30, 14].map((before) => ({ before, ms: t - before * DAY })).filter((x) => x.ms >= today).map((x) => ({ before: x.before, date: new Date(x.ms).toISOString().slice(0, 10), words: `${dateWords(new Date(x.ms).toISOString().slice(0, 10), nowMs)}: ${x.before} days before` }));
}

// ============================================================ a summary to copy or print (never the fee, never the private notes)

export type SummaryIn = { name: string; brand: string | null; label: string; reasons: readonly Reason[]; changed: Changed; valueLine: string | null; renewalLine: string | null; on: string };
/** A client summary an agency can paste into an email or print. It leaves out what the client pays and the team's private notes, and never names the product. */
export function clientSummaryText(i: SummaryIn): string {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  const shown = i.reasons.filter((r) => r.weight !== "info" || ["waiting", "quiet_deals", "no_shows"].includes(r.key));
  const steps = [...new Set(shown.map((r) => TALK[r.key].step))];
  return [
    `${i.brand ? `${i.brand}: ` : ""}Account check-in, ${i.name}, ${i.on}`, "",
    `Where things stand: ${i.label}.`,
    ...(shown.length ? ["", "What we noticed", list(shown.map((r) => r.text))] : []),
    ...(i.changed.lines.length ? ["", "What changed in the last month", list(i.changed.lines)] : []),
    ...(i.valueLine ? ["", "What the account produced", `- ${i.valueLine}`] : []),
    ...(i.renewalLine ? ["", i.renewalLine] : []),
    ...(steps.length ? ["", "Suggested next steps", list(steps)] : []),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export { CONTACT_GAP_DAYS };

// ============================================================ the words under every column and figure (two lines each)

/** The honest label for everything the agency types (KF-7). */
export const USER_ENTERED_LABEL = "You enter this; SubSync does not read it from your CRM.";
/** Two lines for every column and figure of the screen: what it is, then where it comes from and what to do. */
export const COLUMN_HELP: Record<"health" | "fee" | "renews" | "industry" | "monthlyFees" | "feesAtRisk" | "renewals", [string, string]> = {
  health: ["How this client looks right now, with the reason. At risk: gone quiet, a very low score, or 15 or more people waiting for a reply. Watch: something is slipping.", "SubSync works this out from what it reads in your CRM. Open a client to see each reason and what to say."],
  fee: ["What this client pays you each month.", `${USER_ENTERED_LABEL} Press it to change it.`],
  renews: ["The day this client's contract renews, and how long is left.", `${USER_ENTERED_LABEL} Press it to change it.`],
  industry: ["The kind of business this client runs.", `${USER_ENTERED_LABEL} It decides the reply target and onboarding steps that fit.`],
  monthlyFees: ["What your clients pay you each month, added up.", `${USER_ENTERED_LABEL} Clients with no fee are left out and counted.`],
  feesAtRisk: ["The monthly fees of the clients that look at risk.", "The fees are what you typed; who is at risk is worked out by SubSync. Check in with these clients first."],
  renewals: [`Contracts renewing in the next ${RENEWAL_WINDOW_DAYS} days, or already overdue.`, `${USER_ENTERED_LABEL} Add each client's renewal date so none catches you by surprise.`],
};
