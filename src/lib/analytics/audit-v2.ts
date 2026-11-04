// The Account audit, rebuilt (stage AUDIT, docs/AUDIT_REVIEW.md). Pure: no database, no React, so every sentence, every number and the counting rule can be unit tested.
//
// The audit measures nothing new. It reads the same four lists as Today (people waiting for a reply, deals gone quiet, no-shows not rebooked, appointments with no
// outcome) and adds three things a buyer asks for: ONE sentence about the money, the findings ranked by money and then by how easy they are to fix, and the good news.
//
// THE COUNTING RULE (docs/METRICS.md, "Account audit, rebuilt"): a person or a deal is counted ONCE across the findings. A person who has a deal that has gone quiet
// belongs to "deals gone quiet" (counted money comes first). A person who is waiting for a reply and was not claimed by a deal belongs to "waiting for a reply". A person
// who is neither and has a no-show not rebooked belongs to "no-shows". Appointments with no outcome keep what is left. A later finding never lists a person an earlier
// one already claimed. The people waiting for a reply are merged by Today's own function (mergeReplies), so a new lead and a conversation of one person are one person.

import { OUTLIER_MIN_DEALS, OUTLIER_SHARE } from "./metrics.ts";
import { rateRange } from "./pipeline-intel.ts";
import { mergeReplies, type TodayItem, type WaitingConversation, type WaitingLead } from "./today-queue.ts";
import { isJunk, junkDaysOf } from "./today-state.ts";
import type { ShareFinding, ShareNote, ShareSource } from "./share-intel.ts";

export const MIN_CLOSED_FOR_PRICE = 20;

export type FindingKey = "stale" | "replies" | "noshows" | "appointments" | "leftovers";
export type Ease = "quick" | "medium" | "slow";
export type DollarKind = "fact" | "estimate" | "none";
const EASE_RANK: Record<Ease, number> = { quick: 0, medium: 1, slow: 2 };
export const EASE_LABEL: Record<Ease, string> = { quick: "Quick fix", medium: "Needs a call or a decision", slow: "Takes a while" };

export type AuditAccount = {
  id: string; name: string;
  /** The account's win rate (null under 20 closed deals) and its average deal value. Together they price a person (docs/METRICS.md). */
  winRate: number | null; avgDeal: number | null; won: number; lost: number;
};
export type Source = { items: TodayItem[]; total: number };
export type V2Input = {
  now: number; staleDays: number; slaHours: number; scope: "all" | "account";
  accounts: AuditAccount[];
  /** Every counted stale deal, largest first (`total` and `totalValue` are the true figures when the list was cut). */
  stale: Source & { totalValue: number };
  waiting: { leads: WaitingLead[]; leadsTotal: number; conversations: WaitingConversation[]; conversationsTotal: number };
  /** Null when no account's calendar can be read: then the two appointment findings say so instead of showing zero. */
  noshows: Source | null; appointments: Source | null;
  /** Calendars that still need the permission, out of all (so a partly read set says so). */
  calendars?: { needPermission: number; total: number };
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
const personKey = (i: Pick<TodayItem, "locationId" | "contactId">) => (i.contactId ? `${i.locationId}|${i.contactId}` : null);

// ---------- the counting rule ----------

export type Claimed = {
  stale: TodayItem[]; replies: TodayItem[]; noshows: TodayItem[]; appointments: TodayItem[];
  /** How many rows each later finding lost to an earlier one. */
  removed: { replies: number; noshows: number; appointments: number };
};

/** Applies the rule above. Rows with no contact are never claimed and never claim (they cannot be matched to anyone). Order inside each list is kept. */
export function claimPeople(i: { stale: TodayItem[]; replies: TodayItem[]; noshows: TodayItem[]; appointments: TodayItem[] }): Claimed {
  const taken = new Set<string>();
  for (const d of i.stale) { const k = personKey(d); if (k) taken.add(k); }
  const free = (rows: TodayItem[]) => rows.filter((r) => { const k = personKey(r); return !k || !taken.has(k); });
  const claim = (rows: TodayItem[]) => { for (const r of rows) { const k = personKey(r); if (k) taken.add(k); } };
  const replies = free(i.replies); claim(replies);
  const noshows = free(i.noshows); claim(noshows);
  const appointments = free(i.appointments);
  return {
    stale: i.stale, replies, noshows, appointments,
    removed: { replies: i.replies.length - replies.length, noshows: i.noshows.length - noshows.length, appointments: i.appointments.length - appointments.length },
  };
}

// ---------- money ----------

/** What one person is worth in the estimate: the account's average deal times its win rate. Null when the account has too few closed deals to know. */
export const personValue = (a: Pick<AuditAccount, "winRate" | "avgDeal">): number | null => (a.winRate !== null && a.avgDeal !== null ? a.avgDeal * a.winRate : null);

export type Priced = { dollars: number | null; range: { low: number; high: number } | null; priced: number; unpriced: number };
/** Prices a set of people (rows) account by account. Accounts that cannot be priced are counted as `unpriced`, never guessed. */
export function priceRows(rows: Array<Pick<TodayItem, "locationId">>, accounts: AuditAccount[]): Priced {
  const by = new Map(accounts.map((a) => [a.id, a]));
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.locationId, (count.get(r.locationId) ?? 0) + 1);
  let dollars = 0, low = 0, high = 0, priced = 0, unpriced = 0, any = false, anyRange = false;
  for (const [loc, n] of count) {
    const a = by.get(loc);
    const v = a ? personValue(a) : null;
    if (!a || v === null) { unpriced += n; continue; }
    any = true; priced += n;
    dollars += n * v;
    const r = a.avgDeal !== null ? rateRange(a.won, a.won + a.lost) : null;
    if (r && a.avgDeal !== null) { anyRange = true; low += n * a.avgDeal * r.low; high += n * a.avgDeal * r.high; }
  }
  return { dollars: any ? Math.round(dollars) : null, range: any && anyRange ? { low: Math.round(low), high: Math.round(high) } : null, priced, unpriced };
}

// ---------- findings ----------

export type Finding = {
  key: FindingKey;
  /** "23 people are waiting for a reply". */
  title: string;
  /** What is wrong, in plain words, with the window. */
  what: string;
  /** The number on the button. It equals the rows in the list that button opens (`items`), unless `partial`. */
  count: number;
  noun: { one: string; many: string };
  dollars: number | null; dollarKind: DollarKind; range: { low: number; high: number } | null;
  /** People or deals the estimate could not price (their account has under 20 closed deals). */
  unpriced: number;
  /** The formula behind the dollars, or why there are none. */
  formula: string;
  /** One line: how to fix it. */
  fix: string;
  ease: Ease;
  /** Client accounts that have at least one row in this finding. */
  accounts: number;
  items: TodayItem[];
  /** The list was cut at its cap: `count` is the true number, `items` the rows sent. */
  partial: boolean;
  /** An aside about a subset, never added to the count ("5 of them are new leads"). */
  aside: string | null;
};

const accountsOf = (rows: TodayItem[]) => new Set(rows.map((r) => r.locationId)).size;

export type Verdict = {
  kind: "leak" | "count" | "clear";
  /** The one sentence. */
  text: string;
  /** The estimate, only when it can be worked out. `floor` means a list was cut, so it is at least this. */
  leak: number | null; range: { low: number; high: number } | null; floor: boolean;
  /** Counted money in deals gone quiet (a fact). Never added to `leak`. */
  sitting: number | null;
  /** Why the estimate says what it says, in one or two sentences. */
  sub: string;
  /** The formula, in words. */
  formula: string;
  /** People in accounts that could not be priced. */
  unpriced: number;
  /** One deal that is at least half of the counted deal money (and there are at least 3 deals): said out loud so the figure is not read as a pattern. */
  outlier: { value: number; share: number } | null;
};

export type Grade = { clean: number; checked: number; line: string };

export type AuditV2 = {
  verdict: Verdict;
  findings: Finding[];
  /** The finding to open first (money first, then ease). Null when nothing needs doing. */
  startHere: FindingKey | null;
  grade: Grade | null;
  totals: { things: number; accounts: number; accountsWithProblems: number; people: number; deals: number };
  /** The four lists were cut or a calendar could not be read somewhere: the page says so. */
  notes: string[];
};

const FORMULA_LEAK = "Estimate, not money already lost. For each client account with at least 20 won or lost deals: (people waiting for a reply + no-shows not rebooked, each person counted once) x its average deal x its win rate (the share of its closed deals that were won), added up. The range is the same sum with the margin that so few deals leave on the win rate. It is never added to the counted deal figure.";

/** Builds every finding from the four lists, with the counting rule applied and the estimate priced account by account. */
export function buildAuditV2(i: V2Input): AuditV2 {
  const junkDays = junkDaysOf(i.staleDays);
  const recoverable = i.stale.items.filter((d) => !isJunk(d, junkDays, i.now));
  const leftovers = i.stale.items.filter((d) => isJunk(d, junkDays, i.now));
  const merged = mergeReplies({ leads: i.waiting.leads, leadsTotal: i.waiting.leadsTotal, conversations: i.waiting.conversations, conversationsTotal: i.waiting.conversationsTotal });
  const c = claimPeople({ stale: recoverable, replies: merged.items, noshows: i.noshows?.items ?? [], appointments: i.appointments?.items ?? [] });

  // Counts. A list that was cut keeps its true total (an upper bound after the rule, which can only be applied to the rows that were loaded).
  const sum = (rows: TodayItem[]) => rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const staleLoaded = i.stale.items.length;
  const staleCut = i.stale.total > staleLoaded;
  const recoverableCount = staleCut ? Math.max(recoverable.length, i.stale.total - leftovers.length) : recoverable.length;
  const recoverableValue = staleCut ? Math.max(sum(recoverable), i.stale.totalValue - sum(leftovers)) : sum(recoverable);
  const repliesCount = Math.max(0, merged.count - c.removed.replies);
  const noshowCount = i.noshows ? Math.max(0, i.noshows.total - c.removed.noshows) : 0;
  const apptCount = i.appointments ? Math.max(0, i.appointments.total - c.removed.appointments) : 0;

  const replyPrice = priceRows(c.replies, i.accounts);
  const noshowPrice = priceRows(c.noshows, i.accounts);
  const anyPrice = replyPrice.dollars !== null || noshowPrice.dollars !== null;
  const leak = anyPrice ? (replyPrice.dollars ?? 0) + (noshowPrice.dollars ?? 0) : null;
  const range = replyPrice.range || noshowPrice.range
    ? { low: (replyPrice.range?.low ?? 0) + (noshowPrice.range?.low ?? 0), high: (replyPrice.range?.high ?? 0) + (noshowPrice.range?.high ?? 0) }
    : null;
  const floor = merged.partial || (i.noshows ? i.noshows.total > i.noshows.items.length : false);
  const unpriced = replyPrice.unpriced + noshowPrice.unpriced;

  const findings: Finding[] = [];
  const noPrice = (what: string) => (unpriced > 0 && !anyPrice ? `No dollar figure: ${what} has under ${MIN_CLOSED_FOR_PRICE} won or lost deals, so SubSync does not guess one.` : "");

  if (recoverableCount > 0) {
    findings.push({
      key: "stale", count: recoverableCount, noun: { one: "deal", many: "deals" }, accounts: accountsOf(c.stale), items: c.stale, partial: staleCut,
      title: `${plural(recoverableCount, "open deal", "open deals")} ${recoverableCount === 1 ? "has" : "have"} gone quiet`,
      what: `Nothing has changed on ${recoverableCount === 1 ? "it" : "them"} for ${i.staleDays} days or more. Deals with no value or no owner, in a closed-out stage, or very old are not counted here.`,
      dollars: Math.round(recoverableValue), dollarKind: "fact", range: null, unpriced: 0,
      formula: `Counted from your CRM, not estimated: the added-up value of open deals that have a value above $0 and an owner, in a stage that is being worked, and that have not changed stage, been updated or been acted on for ${i.staleDays} days or more. Deals older than ${junkDays} days, or named like a test, are in "old or test deals".`,
      fix: "Call each one: move it forward or close it out.", ease: "medium", aside: null,
    });
  }
  if (repliesCount > 0) {
    const nl = merged.newLeads;
    findings.push({
      key: "replies", count: repliesCount, noun: { one: "person", many: "people" }, accounts: accountsOf(c.replies), items: c.replies, partial: merged.partial,
      title: `${plural(repliesCount, "person is", "people are")} waiting for a reply`,
      what: `They wrote in and nobody has replied for more than ${i.slaHours} ${i.slaHours === 1 ? "hour" : "hours"}. Only the last 30 days are counted: after that, nobody is still waiting.`,
      dollars: replyPrice.dollars, dollarKind: replyPrice.dollars === null ? "none" : "estimate", range: replyPrice.range, unpriced: replyPrice.unpriced,
      formula: replyPrice.dollars === null ? `${noPrice("their account")} ${FORMULA_LEAK}` : FORMULA_LEAK,
      fix: "Reply to the longest wait first.", ease: "quick", aside: nl > 0 ? `${plural(Math.min(nl, repliesCount), "of them is a new lead", "of them are new leads")}. They are counted once, not twice.` : null,
    });
  }
  if (i.noshows && noshowCount > 0) {
    findings.push({
      key: "noshows", count: noshowCount, noun: { one: "no-show", many: "no-shows" }, accounts: accountsOf(c.noshows), items: c.noshows, partial: i.noshows.total > i.noshows.items.length,
      title: `${plural(noshowCount, "no-show has", "no-shows have")} not been rebooked`,
      what: "They missed an appointment in the last 14 days and have no later booking.",
      dollars: noshowPrice.dollars, dollarKind: noshowPrice.dollars === null ? "none" : "estimate", range: noshowPrice.range, unpriced: noshowPrice.unpriced,
      formula: FORMULA_LEAK, fix: "Call each one and offer a new time.", ease: "medium", aside: null,
    });
  }
  if (i.appointments && apptCount > 0) {
    findings.push({
      key: "appointments", count: apptCount, noun: { one: "appointment", many: "appointments" }, accounts: accountsOf(c.appointments), items: c.appointments, partial: i.appointments.total > i.appointments.items.length,
      title: `${plural(apptCount, "past appointment has", "past appointments have")} no outcome`,
      what: "Nobody marked them showed or no-show, so every show rate you read is wrong until they are fixed.",
      dollars: null, dollarKind: "none", range: null, unpriced: 0,
      formula: "Counted from your CRM calendars, no dollar figure: an appointment that started more than 3 hours ago, in the last 30 days, that is not cancelled and was never marked showed or no-show.",
      fix: "Mark each one showed or no-show.", ease: "quick", aside: null,
    });
  }
  if (leftovers.length > 0) {
    const v = sum(leftovers);
    findings.push({
      key: "leftovers", count: leftovers.length, noun: { one: "deal", many: "deals" }, accounts: accountsOf(leftovers), items: leftovers, partial: false,
      title: `${plural(leftovers.length, "old or test deal is", "old or test deals are")} still open`,
      what: `Open for more than ${junkDays} days with no change, or named like a test. ${money(v)} of value sits in ${leftovers.length === 1 ? "it" : "them"}. SubSync leaves ${leftovers.length === 1 ? "it" : "them"} out of the money above so one old deal cannot hide a real problem.`,
      dollars: null, dollarKind: "none", range: null, unpriced: 0,
      formula: `Counted from your CRM: open deals with a value and an owner that have not changed for more than ${junkDays} days (three times the quiet-deal setting of ${i.staleDays} days), or whose name looks like a test. No dollar figure is claimed for them.`,
      fix: "Close them out in your CRM so your numbers are honest.", ease: "quick", aside: null,
    });
  }

  findings.sort((a, b) => {
    const ma = a.key === "leftovers" ? -1 : (a.dollars ?? 0), mb = b.key === "leftovers" ? -1 : (b.dollars ?? 0);
    return mb - ma || EASE_RANK[a.ease] - EASE_RANK[b.ease] || b.count - a.count || a.key.localeCompare(b.key);
  });

  // ---- the verdict ----
  const things = findings.filter((f) => f.key !== "leftovers").reduce((s, f) => s + f.count, 0);
  const sitting = recoverableCount > 0 ? Math.round(recoverableValue) : null;
  const peopleCount = repliesCount + noshowCount;
  const top = recoverable.reduce((m, d) => Math.max(m, d.value ?? 0), 0);
  const outlier = !staleCut && recoverable.length >= OUTLIER_MIN_DEALS && recoverableValue > 0 && top / recoverableValue >= OUTLIER_SHARE ? { value: Math.round(top), share: Math.round((top / recoverableValue) * 100) / 100 } : null;
  const who = i.scope === "all" ? "Your client accounts are" : "Your account is";
  let verdict: Verdict;
  if (things === 0 && leftovers.length === 0) {
    verdict = { kind: "clear", text: i.scope === "all" ? "Nothing needs fixing across your client accounts." : "Nothing needs fixing in your account.", leak: null, range: null, floor: false, sitting: null,
      sub: "Nobody is waiting for a reply, no deal has gone quiet, no no-show is waiting to be rebooked and every past appointment has an outcome.", formula: FORMULA_LEAK, unpriced: 0, outlier: null };
  } else if (leak !== null && leak > 0) {
    verdict = {
      kind: "leak", text: `${who} leaking about ${money(leak)} a month.`, leak, range, floor, sitting,
      sub: `Estimate from the last 30 days: ${plural(peopleCount - unpriced, "person", "people")} still waiting or not rebooked, times your average deal, times how often your deals close${range ? `. Most likely between ${money(range.low)} and ${money(range.high)}` : ""}${floor ? ". A list was cut, so it is at least this much" : ""}.${unpriced > 0 ? ` ${plural(unpriced, "person is", "people are")} in accounts with under ${MIN_CLOSED_FOR_PRICE} won or lost deals, so ${unpriced === 1 ? "that person is" : "they are"} counted but not priced.` : ""}`,
      formula: FORMULA_LEAK, unpriced, outlier,
    };
  } else {
    verdict = {
      kind: "count", text: `We found ${plural(things, "thing", "things")} to fix${i.scope === "all" && i.accounts.length > 1 ? ` across ${plural(accountsOf([...c.stale, ...c.replies, ...c.noshows, ...c.appointments]), "client account", "client accounts")}` : ""}.`,
      leak: null, range: null, floor: false, sitting,
      sub: peopleCount > 0 && unpriced > 0 ? `No dollar figure for the people waiting: ${i.scope === "all" ? "their accounts have" : "this account has"} under ${MIN_CLOSED_FOR_PRICE} won or lost deals, so SubSync does not guess one.` : "These are counted, not estimated.",
      formula: FORMULA_LEAK, unpriced, outlier,
    };
  }

  // Four checks: deals, replies, no-shows, appointments. A check that could not be read (no calendar permission) is not counted, never counted as clean.
  const checked = [{ on: true, n: recoverableCount }, { on: true, n: repliesCount }, { on: i.noshows !== null, n: noshowCount }, { on: i.appointments !== null, n: apptCount }];
  const used = checked.filter((x) => x.on);
  const grade: Grade | null = i.scope === "account" ? { clean: used.filter((x) => x.n === 0).length, checked: used.length, line: "" } : null;
  if (grade) grade.line = `${grade.clean === 0 ? (grade.checked === 1 ? "The check is not clean yet" : `None of the ${grade.checked} checks is clean yet`) : `${grade.clean} of ${grade.checked} checks are clean`}. A check is clean when SubSync finds nothing to fix in it.`;

  const notes: string[] = [];
  if (merged.partial) notes.push("The lists of people waiting were cut at their limit, so that number is at most what is shown.");
  if (staleCut) notes.push(`SubSync loaded the ${num(staleLoaded)} biggest deals gone quiet of ${num(i.stale.total)}; the totals above are the true ones.`);
  if (i.noshows === null || i.appointments === null) notes.push("Appointments cannot be read yet: the calendar permission has not been approved, so no-shows and unmarked appointments are not checked. Nothing is guessed.");
  if (i.calendars && i.calendars.needPermission > 0 && i.noshows !== null) notes.push(`${plural(i.calendars.needPermission, "client account", "client accounts")} of ${num(i.calendars.total)} still ${i.calendars.needPermission === 1 ? "needs" : "need"} the calendar permission, so appointments are not checked there. Nothing is guessed.`);
  const touched = new Set([...c.stale, ...c.replies, ...c.noshows, ...c.appointments].map((r) => r.locationId));
  return {
    verdict, findings, startHere: findings.find((f) => f.key !== "leftovers")?.key ?? findings[0]?.key ?? null, grade,
    totals: { things, accounts: i.accounts.length, accountsWithProblems: touched.size, people: peopleCount, deals: recoverableCount },
    notes,
  };
}

// ---------- the good news ----------

export type HealthyInput = {
  scope: "all" | "account";
  /** Leads answered inside the reply target in the last 14 days, and how many leads that judged (null share: under the minimum). */
  leadsInTarget: { share: number | null; judged: number; minutes: number } | null;
  /** Show rate over the last 30 days (null under the minimum number of outcomes) against the account's own target. */
  showRate: { rate: number | null; outcomes: number; target: number } | null;
  /** Counted open pipeline value, and how much of it has gone quiet. */
  openValue: number; staleValue: number;
  /** Which of the four checks found nothing. */
  clean: { replies: boolean; stale: boolean; noshows: boolean | null; appointments: boolean | null };
};

/** What is healthy, in sentences. Only things that are true and measured on enough cases; nothing here is a guess. */
export function healthyLines(h: HealthyInput): string[] {
  const out: string[] = [];
  const you = h.scope === "all" ? "across your client accounts" : "";
  if (h.clean.replies) out.push(`Nobody is waiting for a reply${you ? " " + you : ""}.`);
  if (h.clean.stale) out.push(`No open deal has gone quiet${you ? " " + you : ""}.`);
  if (h.clean.noshows === true) out.push("Every no-show from the last 14 days has been rebooked.");
  if (h.clean.appointments === true) out.push("Every past appointment has an outcome, so your show rate can be trusted.");
  if (h.leadsInTarget && h.leadsInTarget.share !== null && h.leadsInTarget.share >= 0.8) out.push(`${Math.round(h.leadsInTarget.share * 100)}% of new leads were answered within ${h.leadsInTarget.minutes} minutes (last 14 days, ${num(h.leadsInTarget.judged)} leads).`);
  if (h.showRate && h.showRate.rate !== null && h.showRate.rate >= h.showRate.target) out.push(`Show rate is ${Math.round(h.showRate.rate * 100)}%, at or above your ${Math.round(h.showRate.target * 100)}% target (last 30 days, ${num(h.showRate.outcomes)} appointments with an outcome).`);
  if (!h.clean.stale && h.openValue > 0 && h.staleValue / h.openValue < 0.25) out.push(`${Math.round((1 - h.staleValue / h.openValue) * 100)}% of your open pipeline money has moved in the last 30 days.`);
  return out.slice(0, 4);
}

// ---------- the text to paste ----------

/** A summary to paste into a message. Estimates are labelled as estimates, counted money as counted; no contact names and no deal names. */
export function auditSummaryV2(a: AuditV2, who: string, healthy: string[] = []): string {
  const v = a.verdict;
  const lines = [`${who}: account audit`, v.text, v.sub];
  if (v.sitting !== null) lines.push(`Counted: ${money(v.sitting)} sits in open deals nobody has touched for a while (not part of the estimate).${v.outlier ? ` One deal (${money(v.outlier.value)}) is ${Math.round(v.outlier.share * 100)}% of it, so check that it is a real deal.` : ""}`);
  const first = a.findings.find((f) => f.key === a.startHere);
  if (first) lines.push("", `Start here: ${first.title}. ${first.fix}`);
  const rest = a.findings.filter((f) => f.key !== "leftovers");
  if (rest.length) {
    lines.push("", "What we found:");
    for (const f of rest) lines.push(`- ${f.title}${f.dollars !== null ? ` (${f.dollarKind === "estimate" ? "estimate" : "counted"}: ${money(f.dollars)})` : ""}. ${f.fix}`);
  }
  if (healthy.length) lines.push("", "What is healthy:", ...healthy.map((h) => `- ${h}`));
  return lines.join("\n");
}

// ---------- the shared link ----------


/**
 * What goes into a shared link: the sentence, the figures, the finding titles and fixes, and how each number is counted. Never a client account name, a person or a deal
 * (the lists stay in the app). The rebuilt audit reuses the older share format, so a link made before still opens.
 */
export function shareSourceOf(a: AuditV2, healthy: string[], accountCount: number): ShareSource {
  const shown = a.findings.filter((f) => f.key !== "leftovers");
  const noteKey = (f: Finding) => (f.key === "replies" || f.key === "noshows" ? "estimate" : f.key);
  const notes: ShareNote[] = [{ key: "estimate", title: "The monthly estimate", text: FORMULA_LEAK }];
  for (const f of shown) if (f.key === "stale" || f.key === "appointments") notes.push({ key: f.key, title: f.key === "stale" ? "Deals that went quiet" : "Appointments with no outcome", text: f.formula });
  const first = shown[0];
  return {
    headline: a.verdict.text, accountsScanned: accountCount, staleDollars: a.verdict.sitting ?? 0, estimatedDollars: a.verdict.leak,
    estimateRange: a.verdict.range,
    findings: shown.map((f, n): ShareFinding => ({
      severity: n === 0 ? "critical" : "warning", title: f.title, count: f.count, dollars: f.dollars, kind: f.dollarKind, fix: f.fix, note: noteKey(f), what: f.what,
    })),
    fixFirst: first ? `${first.title}. ${first.fix}` : null, outlier: a.verdict.outlier, leftOut: 0, notes,
    verdictSub: a.verdict.sub, healthy, grade: a.grade?.line ?? null,
  };
}
