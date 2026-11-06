// Speed to lead, second pass (docs/SPEED_REVIEW.md, docs/METRICS.md "Speed to lead, second pass"). Pure: no database, no network, no React, so every sentence,
// every ranking, every list and every number on the rebuilt screen is unit tested. Nothing here measures anything new: the figures are the ones speed-intel.ts
// already defines (judge, summarise, peopleProgress). What this file adds is WHICH leads a list holds (one selection function that the figure and the list
// behind it both use), how a list is searched, sorted and paged, the sentences, the comparison rows, the "who should reply" display and the cost estimate.
import { followUpEstimate } from "./metrics.ts";
import { fmtDuration, isNeverAnswered, judge, MIN_FOR_MEDIAN, MIN_PER_PERSON, peopleProgress, responseSeconds, summarise, type Judged, type Summary } from "./speed-intel.ts";
import type { LoadedRow } from "./speed-parts.ts";

export const DAY = 86_400_000;
/** The headline and the "Reply now" list are about right now: leads of the last 14 days (the same window and the same set Today counts as new leads). */
export const WAITING_WINDOW_DAYS = 14;
/** A percentage or a ranking of accounts needs this many judged leads. */
export const MIN_JUDGED = MIN_FOR_MEDIAN;
export const MAX_PAGE = 50;
export const MIN_TARGET = 1;
export const MAX_TARGET = 1440;

/** A reply target typed by a person: a whole number of minutes from 1 to 1440 (a day). Anything else is refused with a reason in words. */
export function parseTarget(v: unknown): { ok: true; minutes: number } | { ok: false; error: string } {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: "Type a whole number of minutes, for example 15." };
  if (n < MIN_TARGET || n > MAX_TARGET) return { ok: false, error: `Choose between ${MIN_TARGET} and ${MAX_TARGET} minutes.` };
  return { ok: true, minutes: n };
}

// ---------- which leads a list holds ----------

export type LeadStatusFilter = "waiting" | "within" | "late" | "slow" | "answered" | "onlyAuto" | "all";
export const STATUS_FILTERS: readonly LeadStatusFilter[] = ["waiting", "within", "late", "slow", "answered", "onlyAuto", "all"];
export type LeadSort = "wait" | "newest" | "name" | "account";
export const SORTS: readonly LeadSort[] = ["wait", "newest", "name", "account"];
export type LeadQuery = {
  status: LeadStatusFilter;
  /** Only the leads this person replied to first. */
  person?: string | null;
  account?: string | null;
  /** Only leads with this owner id ("none" is "no owner"). */
  owner?: string | null;
  /** The lead's source class (speed-intel SourceClass) is applied by the caller through `extra`. */
  q?: string; sort?: LeadSort;
  /** Further test the caller wants (a source, a week); runs before the counts are made so a figure and its list stay one thing. */
  extra?: (r: LoadedRow, status: Judged) => boolean;
};
type Names = ReadonlyMap<string, string>;

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Does a lead pass the status choice? "waiting" is a lead past its target with no reply from a person (the lead Today counts as a new lead waiting). */
export function passes(r: LoadedRow, status: Judged, q: LeadQuery, accounts: Names): boolean {
  if (q.status === "waiting" && status !== "waiting") return false;
  if (q.status === "within" && status !== "within") return false;
  if (q.status === "late" && status !== "late") return false;
  if (q.status === "slow" && status === "within") return false; // no person reply yet, or a slow one
  if (q.status === "answered" && status === "waiting") return false;
  if (q.status === "onlyAuto" && !(r.detailed === true && r.autoAt != null && r.humanAt == null && status === "waiting")) return false;
  if (q.person && !(r.touchAt !== null && r.userId === q.person)) return false;
  if (q.account && r.locationId !== q.account) return false;
  if (q.owner === "none" && r.assignedTo !== null) return false;
  if (q.owner && q.owner !== "none" && r.assignedTo !== q.owner) return false;
  if (q.q) {
    const hay = norm(`${r.name} ${accounts.get(r.locationId) ?? ""} ${r.source ?? ""} ${r.email ?? ""} ${r.phone ?? ""}`);
    if (!q.q.split(/\s+/).filter(Boolean).every((w) => hay.includes(norm(w)))) return false;
  }
  return q.extra ? q.extra(r, status) : true;
}

/**
 * THE selection. The number on a figure and the rows in the list behind it both come from this one function, so they cannot disagree (KF-6). Sorting: "wait" puts
 * the lead that has waited longest first (answered leads after, newest first), "newest" the latest lead first, "name" and "account" are alphabetical with the wait
 * as the tie-break. Ties always break the same way (by wait, then by name, then by id), so a page never shuffles.
 */
export function selectLeads(rows: readonly LoadedRow[], o: { targetMinutes: number; now: number; accounts: Names }, q: LeadQuery): Array<{ row: LoadedRow; status: Judged }> {
  const out: Array<{ row: LoadedRow; status: Judged }> = [];
  for (const r of rows) {
    const status = judge(r, o.targetMinutes, o.now);
    if (status && passes(r, status, q, o.accounts)) out.push({ row: r, status });
  }
  const sort = q.sort ?? "wait";
  const rank = (s: Judged) => (s === "waiting" ? 0 : s === "late" ? 1 : 2);
  const tie = (a: { row: LoadedRow }, b: { row: LoadedRow }) => a.row.leadAt - b.row.leadAt || a.row.name.localeCompare(b.row.name) || (a.row.locationId + a.row.contactId).localeCompare(b.row.locationId + b.row.contactId);
  out.sort((a, b) => {
    if (sort === "newest") return b.row.leadAt - a.row.leadAt || tie(a, b);
    if (sort === "name") return a.row.name.localeCompare(b.row.name) || tie(a, b);
    if (sort === "account") return (o.accounts.get(a.row.locationId) ?? "").localeCompare(o.accounts.get(b.row.locationId) ?? "") || tie(a, b);
    return rank(a.status) - rank(b.status) || (a.status === "waiting" ? tie(a, b) : b.row.leadAt - a.row.leadAt || tie(a, b));
  });
  return out;
}

export function pageOf<T>(list: readonly T[], page: number, size: number): { rows: T[]; page: number; pages: number; total: number; from: number; to: number } {
  const n = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number.isFinite(size) ? size : 25)));
  const pages = Math.max(1, Math.ceil(list.length / n));
  const at = Math.min(Math.max(0, Math.floor(Number.isFinite(page) ? page : 0)), pages - 1);
  const rows = list.slice(at * n, at * n + n);
  return { rows, page: at, pages, total: list.length, from: list.length === 0 ? 0 : at * n + 1, to: at * n + rows.length };
}

// ---------- the people waiting: the headline ----------

export type WaitingFacts = {
  /** Leads past their reply target with no reply from a person, last 14 days. This is the number Today shows as "of which N are new leads". */
  waiting: number;
  /** Of those, the ones nobody answered for more than 3 days. A SUBSET, never added. */
  never: number; noOwner: number; accountsWithWaiting: number; oldestMinutes: number | null;
};

export function waitingFacts(rows: readonly LoadedRow[], o: { targetMinutes: number; now: number }): WaitingFacts {
  let waiting = 0, never = 0, noOwner = 0, oldest: number | null = null;
  const accounts = new Set<string>();
  for (const r of rows) {
    if (r.leadAt <= o.now - WAITING_WINDOW_DAYS * DAY) continue;
    if (judge(r, o.targetMinutes, o.now) !== "waiting") continue;
    const minutes = (o.now - r.leadAt) / 60_000;
    waiting += 1; accounts.add(r.locationId);
    if (isNeverAnswered(minutes)) never += 1;
    if (r.assignedTo === null) noOwner += 1;
    if (oldest === null || minutes > oldest) oldest = minutes;
  }
  return { waiting, never, noOwner, accountsWithWaiting: accounts.size, oldestMinutes: oldest === null ? null : Math.round(oldest) };
}

const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export type HeadlinePart = { t: string; strong?: boolean };
/** One sentence. Same rule as Today: "never answered" is part of the people waiting ("4 of them"), never added to them. */
export function headlineOf(f: WaitingFacts, multi: boolean): { parts: HeadlinePart[]; text: string; allClear: boolean } {
  if (f.waiting === 0) return { parts: [{ t: "Nobody is waiting for a reply right now." }], text: "Nobody is waiting for a reply right now.", allClear: true };
  const parts: HeadlinePart[] = [
    { t: f.waiting.toLocaleString("en-US"), strong: true }, { t: ` ${f.waiting === 1 ? "lead is" : "leads are"} waiting for a reply` },
  ];
  if (multi && f.accountsWithWaiting > 1) parts.push({ t: ` across ${plural(f.accountsWithWaiting, "client")}` });
  parts.push({ t: "." });
  if (f.never > 0) parts.push({ t: ` ${f.never === f.waiting && f.waiting > 1 ? "All of them" : f.never === 1 ? "One of them" : `${f.never.toLocaleString("en-US")} of them`} ${f.never === 1 ? "was" : "were"} never answered.` });
  return { parts, text: parts.map((p) => p.t).join(""), allClear: false };
}

// ---------- who should reply (a display, never a write) ----------

export type Suggestion = { userId: string; medianSeconds: number; replies: number };
/**
 * For a lead nobody owns: the person in that account who has replied to leads fastest lately (the typical first reply, at least 3 replies in the window). Only shown
 * as a suggestion; SubSync never assigns anyone. Null when nobody has enough replies. Ties go to the person with more replies, then to the lower id.
 */
export function suggestReplier(rows: readonly LoadedRow[], locationId: string): Suggestion | null {
  const mine = rows.filter((r) => r.locationId === locationId);
  const ranked = peopleProgress(mine).filter((p) => p.ranked && p.medianSeconds !== null);
  if (ranked.length === 0) return null;
  const best = [...ranked].sort((a, b) => (a.medianSeconds as number) - (b.medianSeconds as number) || b.replies - a.replies || a.userId.localeCompare(b.userId))[0];
  return { userId: best.userId, medianSeconds: best.medianSeconds as number, replies: best.replies };
}

// ---------- the response-time picture ----------

export type Pct = { text: string; value: number | null };
/** "58%", or null below the minimum: a percentage on a tiny base is never shown. */
export function pctOf(n: number, total: number, min = MIN_JUDGED): Pct {
  return total >= min ? { text: `${Math.round((n / total) * 100)}%`, value: n / total } : { text: "", value: null };
}

export type CompareRow = Summary & {
  id: string; name: string; judged: number; ranked: boolean;
  /** Plain words for a row that is not ranked yet: "3 of 5 leads so far". */
  progress: string | null;
};

export function judgedCount(s: Summary): number { return s.withinTarget + s.answeredLate + s.stillWaiting; }

/** One row per client account: how its leads were answered. Slowest first (lowest share answered in time), accounts with too few leads after them. */
export function compareAccounts(rows: readonly LoadedRow[], o: { targetMinutes: number; now: number; accounts: Names }): CompareRow[] {
  const by = new Map<string, LoadedRow[]>();
  for (const r of rows) by.set(r.locationId, [...(by.get(r.locationId) ?? []), r]);
  const out: CompareRow[] = [];
  for (const [id, mine] of by) {
    const s = summarise(mine, o.targetMinutes, o.now);
    const judged = judgedCount(s);
    if (judged === 0) continue;
    const ranked = judged >= MIN_JUDGED;
    out.push({ ...s, id, name: o.accounts.get(id) ?? "Client account", judged, ranked, progress: ranked ? null : `${judged} of ${MIN_JUDGED} leads so far` });
  }
  return out.sort((a, b) => Number(b.ranked) - Number(a.ranked) || (a.ranked && b.ranked ? (a.hitRate ?? 1) - (b.hitRate ?? 1) : 0) || b.stillWaiting - a.stillWaiting || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export type PersonRow = { userId: string; replies: number; medianSeconds: number | null; ranked: boolean; progress: string | null };
/** People who sent a first reply. Ranked ones (3 or more replies) slowest typical first, so the person to talk to is on top; the rest follow with "2 of 3 replies so far". */
export function comparePeople(rows: readonly LoadedRow[]): PersonRow[] {
  const all = peopleProgress(rows as LoadedRow[]).map((p): PersonRow => ({ ...p, progress: p.ranked ? null : `${p.replies} of ${MIN_PER_PERSON} replies so far` }));
  const ranked = all.filter((p) => p.ranked).sort((a, b) => (b.medianSeconds as number) - (a.medianSeconds as number) || b.replies - a.replies || a.userId.localeCompare(b.userId));
  const rest = all.filter((p) => !p.ranked).sort((a, b) => b.replies - a.replies || a.userId.localeCompare(b.userId));
  return [...ranked, ...rest];
}

// ---------- the cost estimate ----------

export type AccountFacts = { locationId: string; winRate: number | null; avgDealValue: number | null };
export type CostEstimate = {
  /** Null when no account that has leads waiting also has a win rate and an average deal. */
  amount: number | null;
  waiting: number; countedAccounts: number; leftOutAccounts: number; leftOutWaiting: number;
  /** The sum written out, so it can be shown one tap away: "3 x $4,000 x 25% = $3,000". */
  parts: Array<{ locationId: string; waiting: number; avgDealValue: number; winRate: number; amount: number }>;
};
/**
 * What the leads still waiting may cost, an ESTIMATE. Per client account: leads waiting past the target x the account's average deal x its win rate (the one
 * formula `followUpEstimate` that the Account audit uses too). An account without a win rate (fewer than 20 closed deals) or without an average deal is left
 * out and counted, never guessed.
 */
export function costEstimate(waitingByAccount: ReadonlyMap<string, number>, facts: readonly AccountFacts[]): CostEstimate {
  const f = new Map(facts.map((x) => [x.locationId, x]));
  const parts: CostEstimate["parts"] = [];
  let leftOutAccounts = 0, leftOutWaiting = 0, waiting = 0;
  for (const [loc, n] of waitingByAccount) {
    if (n <= 0) continue;
    waiting += n;
    const x = f.get(loc);
    const amount = x ? followUpEstimate({ unanswered: n, winRate: x.winRate, avgDealValue: x.avgDealValue }) : null;
    if (!x || amount === null || x.winRate === null || x.avgDealValue === null) { leftOutAccounts += 1; leftOutWaiting += n; continue; }
    parts.push({ locationId: loc, waiting: n, avgDealValue: Math.round(x.avgDealValue), winRate: x.winRate, amount });
  }
  const total = parts.reduce((s, p) => s + p.amount, 0);
  return { amount: parts.length === 0 ? null : total, waiting, countedAccounts: parts.length, leftOutAccounts, leftOutWaiting, parts };
}

export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

/** The one line under the headline: the estimate with its label, or the plain reason there is none. */
export function costLine(c: CostEstimate): string | null {
  if (c.waiting === 0) return null;
  if (c.amount === null) return "SubSync cannot estimate what this costs yet: it needs an account with at least 20 closed deals to know its win rate.";
  const left = c.leftOutAccounts > 0 ? ` ${plural(c.leftOutAccounts, "client")} ${c.leftOutAccounts === 1 ? "is" : "are"} left out because ${c.leftOutAccounts === 1 ? "it has" : "they have"} fewer than 20 closed deals.` : "";
  return `About ${money(c.amount)} of business may be at risk (an estimate).${left}`;
}
export function costFormula(c: CostEstimate): string {
  if (c.parts.length === 0) return "Leads waiting x the client's average deal x its win rate. A client needs at least 20 closed deals before SubSync works out a win rate.";
  const sample = c.parts.slice(0, 3).map((p) => `${plural(p.waiting, "lead")} x ${money(p.avgDealValue)} x ${Math.round(p.winRate * 100)}% = ${money(p.amount)}`);
  return `For each client: leads waiting x its average deal x its win rate. ${sample.join("; ")}${c.parts.length > 3 ? `; and ${c.parts.length - 3} more` : ""}. This is a guess from past deals, not a promise: change the reply target or fix the replies and it changes.`;
}

// ---------- the typical reply sentence and the next best action ----------

export type NextAction = { key: "reply" | "owners" | "slow_account" | "sources" | "appointments" | "target" | "none"; text: string };
/** The calm all-clear's one next step, in the order that matters most to the money. */
export function nextBestAction(i: { waiting: number; noOwner: number; slowestAccount: { name: string; hitRate: number } | null; unknownSourceShare: number | null; typicalSeconds: number | null; canChangeTarget: boolean }): NextAction {
  if (i.waiting > 0) return { key: "reply", text: "Reply to the lead that has waited longest." };
  if (i.slowestAccount && i.slowestAccount.hitRate < 0.5) return { key: "slow_account", text: `${i.slowestAccount.name} answers only ${Math.round(i.slowestAccount.hitRate * 100)}% of leads in time. Look at who covers it.` };
  if (i.unknownSourceShare !== null && i.unknownSourceShare >= 0.34) return { key: "sources", text: "Many leads have no source recorded. Set the source on your forms so you can tell which kind of lead goes cold." };
  if (i.typicalSeconds !== null && i.typicalSeconds > 60 * 60 && i.canChangeTarget) return { key: "target", text: "Replies are slow at the moment. Check the reply target is one your team can hit." };
  return { key: "none", text: "Nothing to do here. Check Appointments for outcomes still to mark." };
}

/** "Typical first reply 2 h 14 min over the last 30 days, from 41 replies", or why there is none. */
export function typicalLine(s: Summary, windowWords: string): string {
  if (s.medianSeconds === null) return s.answered === 0 ? `No replies in the ${windowWords} yet.` : `${plural(s.answered, "reply", "replies")} so far in the ${windowWords}. A typical time shows from ${MIN_FOR_MEDIAN}.`;
  return `Typical first reply ${fmtDuration(s.medianSeconds)} in the ${windowWords}, from ${plural(s.answered, "reply", "replies")}.`;
}

/** Plain text to paste into a message or print: the sentence, the proof line, the top of the list and the slowest clients. */
export function summaryText(i: { who: string; headline: string; typical: string; cost: string | null; waiting: Array<{ name: string; account: string | null; waited: string; owner: string }>; slow: Array<{ name: string; line: string }> }): string {
  const lines = [`Speed to lead: ${i.who}`, i.headline, i.typical, ...(i.cost ? [i.cost] : [])];
  if (i.waiting.length > 0) lines.push("", "Waiting longest:", ...i.waiting.map((w) => `- ${w.name}${w.account ? `, ${w.account}` : ""}: waiting ${w.waited}, ${w.owner}`));
  if (i.slow.length > 0) lines.push("", "Slowest to reply:", ...i.slow.map((s) => `- ${s.name}: ${s.line}`));
  return lines.join("\n");
}

export { responseSeconds };
