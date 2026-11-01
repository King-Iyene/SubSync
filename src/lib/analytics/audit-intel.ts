// The Instant Audit: what is wrong across the accounts right now and what it is costing, in plain
// sentences, ranked. Pure (no database), so it is unit tested. Two rules from the brief's metric-trust
// section are built in: a FACT (money counted from deals) and an ESTIMATE (money inferred from a win rate)
// are never added together, and anything that cannot be known says so instead of showing a made-up number.
//
// Stage F6: the audit calculates nothing of its own that another screen also shows. The account totals come from the shared counted-deal rule
// (the numbers handed in by accountRows), the slow-follow-up figure from `followUpEstimate` (metrics.ts) and its range from `rateRange`
// (pipeline-intel.ts, the forecast's own range). What this file adds is wording: a window and a definition for every number, a "fix first" line,
// and where each finding opens.

import { followUpEstimate } from "./metrics.ts";
import { rateRange } from "./pipeline-intel.ts";

export type AuditAccount = {
  locationId: string; name: string | null;
  staleValue: number; staleOpps: number; openValue: number; openOpps: number; excludedOpen: number;
  unanswered: number; winRate: number | null; avgDealValue: number | null; completenessPct: number; contacts: number;
  /** The largest counted open deal that has not moved (outlier guard). */
  topStaleDeal?: number;
  /** Closed deals, for the range around the estimate. Without them the estimate is shown without a range. */
  wonCount?: number; lostCount?: number;
};

export type AuditAppointments = {
  /** Accounts whose calendars could be read. */
  readable: number; total: number; needPermission: number;
  unmarked: number; noShowsToRecover: number; unconfirmed48: number;
} | null;

export type FindingKey = "stale" | "slow" | "unmarked" | "noshows" | "permission" | "data" | "junk";
/** The key of a definition shown beside a number (see auditNotes). */
export type NoteKey = "stale" | "slow" | "unmarked" | "noshows" | "estimate" | "left_out" | "data";

export type Finding = {
  key: FindingKey;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  count: number | null;
  /** Money, when it can be stated honestly. */
  dollars: number | null;
  /** A fact is counted; an estimate is inferred and must be labelled as one. */
  kind: "fact" | "estimate" | "none";
  view: "deals" | "inbox" | "appointments" | "accounts" | "settings";
  fix: string;
  /** The definition of this number (a key into the notes). Absent where the finding states no number that needs one. */
  note?: NoteKey;
  /** The window the number is counted over, in words. */
  window?: string;
};

export type AuditRow = { locationId: string; name: string; staleValue: number; staleOpps: number; waiting: number; estimated: number | null; score: number };

export type AuditNote = { key: NoteKey; title: string; text: string };

export type Audit = {
  accountsScanned: number;
  /** Counted from deals. */
  staleDollars: number;
  /** Inferred from win rates; null when no account has enough closed deals. */
  estimatedDollars: number | null;
  /** The range the estimate most likely lies in (win rate margin), or null when it cannot be worked out. */
  estimateRange: { low: number; high: number } | null;
  /** One stalled deal that is at least half of the stalled money, so the number is not read as a pattern. */
  outlier: { value: number; share: number } | null;
  /** Open deals left out of every dollar figure (no value, no owner, closed-out stage or unused pipeline). */
  leftOut: number;
  findings: Finding[];
  rows: AuditRow[];
  headline: string;
  /** One sentence: what to do first. Null when nothing needs doing. */
  fixFirst: string | null;
  /** The definition of every number shown, in the order the numbers appear. */
  notes: AuditNote[];
};

export type AuditOptions = {
  /** Settings: a deal is stalled after this many days, a conversation is waiting after this many hours. */
  staleDays?: number; slaHours?: number;
  /** The note about conversations that were not all read (readLimitNote), if any. */
  readLimit?: string | null;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Where each finding opens, in the words of the menu. Every "Open" button says where it goes (N7). */
export const OPEN_TARGET: Record<Finding["view"], string> = {
  deals: "Pipeline and deals", inbox: "Unanswered messages", appointments: "Appointments", accounts: "Accounts", settings: "Settings",
};
export const openLabel = (view: Finding["view"]) => `Open in ${OPEN_TARGET[view]}`;

/** The windows that the appointments code counts over (docs/METRICS.md, Appointments). A test holds these to the code. */
export const AUDIT_UNMARKED_GRACE_HOURS = 3;
export const AUDIT_UNMARKED_DAYS = 30;
export const AUDIT_NOSHOW_DAYS = 14;
/** The conversations window (WAITING_WINDOW_DAYS in waiting.ts). A test holds this to the code too. */
export const AUDIT_WAITING_DAYS = 30;

// Waiting conversations x average deal x win rate, only where the account has a win rate. One formula, shared with the account tiles.
export const slowFollowUpEstimate = (a: Pick<AuditAccount, "unanswered" | "winRate" | "avgDealValue">): number | null => followUpEstimate(a);

/** The same estimate with the margin of its win rate (the range the forecast uses), summed over the accounts that have one. */
function estimateRangeOf(live: AuditAccount[]): { low: number; high: number } | null {
  let low = 0, high = 0, any = false;
  for (const a of live) {
    if (slowFollowUpEstimate(a) === null || a.wonCount === undefined || a.lostCount === undefined || a.avgDealValue === null) continue;
    const r = rateRange(a.wonCount, a.wonCount + a.lostCount);
    if (!r) continue;
    any = true;
    low += a.unanswered * a.avgDealValue * r.low;
    high += a.unanswered * a.avgDealValue * r.high;
  }
  return any ? { low: Math.round(low), high: Math.round(high) } : null;
}

const NOTE_TITLE: Record<NoteKey, string> = {
  stale: "Deals that stopped moving", slow: "Conversations waiting for a reply", unmarked: "Appointments with no outcome", noshows: "No-shows not rebooked",
  estimate: "Cost of slow follow-up (estimate)", left_out: "Deals left out of the dollar figures", data: "Thin contact records",
};

/** What each number counts, in plain words, with the settings that were used. Mirrors docs/METRICS.md. */
export function noteText(key: NoteKey, o: AuditOptions = {}): string {
  const staleDays = o.staleDays ?? 30, slaHours = o.slaHours ?? 4;
  switch (key) {
    case "stale":
      return `Counted from your CRM. An open deal with a value above $0 and an owner, in a stage that is being worked, that has not changed stage, been updated or been acted on for ${staleDays} days or more. The dollar figure is the sum of those deals' values.`;
    case "slow":
      return `Counted from your CRM. A conversation whose last message is from the customer, with no reply for more than ${slaHours} ${slaHours === 1 ? "hour" : "hours"}, newer than ${AUDIT_WAITING_DAYS} days (older ones are not counted: nobody is still waiting).${o.readLimit ? ` ${o.readLimit}` : ""}`;
    case "unmarked":
      return `Counted from your CRM calendars. An appointment that started more than ${AUDIT_UNMARKED_GRACE_HOURS} hours ago, in the last ${AUDIT_UNMARKED_DAYS} days, that is not cancelled and was never marked showed or no-show.`;
    case "noshows":
      return `Counted from your CRM calendars. A no-show from the last ${AUDIT_NOSHOW_DAYS} days whose contact has no later booking.`;
    case "estimate":
      return "Estimate, not a fact. For each client account with at least 20 won or lost deals: conversations waiting x its average deal x its win rate. The range is the same sum with the margin that so few deals leave on the win rate. It is the size of the problem, not money lost, and it is never added to a counted figure.";
    case "left_out":
      return "Open deals with no value, no owner, or in a closed-out stage or an unused pipeline are not counted in any dollar figure. They are left out, not deleted.";
    case "data":
      return "Fewer than half of the contacts in a client account have an email, a phone and a tag. Accounts with fewer than 20 contacts are not judged.";
  }
}

export function buildAudit(accounts: AuditAccount[], appts: AuditAppointments, opts: AuditOptions = {}): Audit {
  const live = accounts;
  const sum = (f: (a: AuditAccount) => number) => live.reduce((s, a) => s + f(a), 0);
  const staleDollars = Math.round(sum((a) => a.staleValue));
  const staleDeals = sum((a) => a.staleOpps);
  const openValue = sum((a) => a.openValue);
  const waiting = sum((a) => a.unanswered);
  const estimates = live.map(slowFollowUpEstimate);
  const estimatedDollars = estimates.some((e) => e !== null) ? estimates.reduce<number>((s, e) => s + (e ?? 0), 0) : null;
  const estimateRange = estimatedDollars === null ? null : estimateRangeOf(live);
  const junk = sum((a) => a.excludedOpen);
  const weakData = live.filter((a) => a.contacts >= 20 && a.completenessPct < 50);
  const staleDays = opts.staleDays ?? 30, slaHours = opts.slaHours ?? 4;

  const findings: Finding[] = [];

  // Outlier guard (UX-04): when one deal is most of the figure, the headline says so instead of reading as a pattern across the pipeline.
  const topStale = live.reduce((m, a) => Math.max(m, a.topStaleDeal ?? 0), 0);
  const oneDealShare = staleDollars > 0 ? topStale / staleDollars : 0;
  const outlier = staleDeals >= 1 && oneDealShare >= 0.5 ? { value: Math.round(topStale), share: Math.round(oneDealShare * 100) / 100 } : null;

  if (staleDeals > 0) {
    const share = openValue > 0 ? staleDollars / openValue : 0;
    const guard = outlier ? ` One deal (${money(outlier.value)}) is ${Math.round(outlier.share * 100)}% of this figure, so check that it is a real deal before relying on the number.` : "";
    findings.push({
      key: "stale", severity: share >= 0.5 ? "critical" : share >= 0.25 ? "warning" : "info",
      title: `${money(staleDollars)} is sitting in ${plural(staleDeals, "deal")} that ${staleDeals === 1 ? "has" : "have"} not moved`,
      detail: `That is ${Math.round(share * 100)}% of the open pipeline across ${plural(live.length, "account")}. These are the likeliest lost revenue.${guard}`,
      count: staleDeals, dollars: staleDollars, kind: "fact", view: "deals", fix: "Open the stale deals, move each one forward or close it out.",
      note: "stale", window: `No change for ${staleDays} days or more, counted now`,
    });
  }

  if (waiting > 0) {
    findings.push({
      key: "slow", severity: waiting >= 10 ? "critical" : "warning",
      title: `${plural(waiting, "conversation")} ${waiting === 1 ? "is" : "are"} waiting past the reply target`,
      detail: estimatedDollars !== null
        ? `A rough size of the problem is up to ${money(estimatedDollars)}, worked out from each account's own win rate and average deal. It is an estimate, not money lost.`
        : "No account has enough closed deals yet to turn this into a dollar figure, so none is shown.",
      count: waiting, dollars: estimatedDollars, kind: estimatedDollars !== null ? "estimate" : "none", view: "inbox", fix: "Reply to the oldest first. The inbox lists them longest-waiting at the top.",
      note: "slow", window: `Customer's last message more than ${slaHours} ${slaHours === 1 ? "hour" : "hours"} ago, within the last ${AUDIT_WAITING_DAYS} days`,
    });
  }

  if (appts === null || appts.readable === 0) {
    findings.push({
      key: "permission", severity: "info", title: "Appointments cannot be read yet",
      detail: "Show rate, unmarked appointments and no-show recovery need the calendar permission, which has not been approved. Nothing is guessed in the meantime.",
      count: appts ? appts.needPermission : null, dollars: null, kind: "none", view: "appointments", fix: "Approve the new permissions when SubSync asks, then run a sync.",
    });
  } else {
    if (appts.unmarked > 0) {
      findings.push({
        key: "unmarked", severity: appts.unmarked >= 10 ? "warning" : "info",
        title: `${plural(appts.unmarked, "past appointment")} never ${appts.unmarked === 1 ? "got" : "got an"} outcome`,
        detail: "Nobody marked them showed or no-show, so every show rate you read is wrong until they are fixed.",
        count: appts.unmarked, dollars: null, kind: "none", view: "appointments", fix: "Mark each one showed or no-show.",
        note: "unmarked", window: `Started more than ${AUDIT_UNMARKED_GRACE_HOURS} hours ago, in the last ${AUDIT_UNMARKED_DAYS} days`,
      });
    }
    if (appts.noShowsToRecover > 0) {
      findings.push({
        key: "noshows", severity: appts.noShowsToRecover >= 5 ? "warning" : "info",
        title: `${plural(appts.noShowsToRecover, "recent no-show")} ${appts.noShowsToRecover === 1 ? "has" : "have"} not been rebooked`,
        detail: "People who miss one appointment will often rebook if someone follows up within days.",
        count: appts.noShowsToRecover, dollars: null, kind: "none", view: "appointments", fix: "Call the recovery list, newest first.",
        note: "noshows", window: `No-shows in the last ${AUDIT_NOSHOW_DAYS} days with no later booking`,
      });
    }
    if (appts.needPermission > 0) {
      findings.push({
        key: "permission", severity: "info", title: `${plural(appts.needPermission, "account")} still ${appts.needPermission === 1 ? "needs" : "need"} the calendar permission`,
        detail: `Appointments were read for ${appts.readable} of ${appts.total} accounts. The rest are left out of the numbers above.`,
        count: appts.needPermission, dollars: null, kind: "none", view: "appointments", fix: "Approve the permission on those accounts.",
      });
    }
  }

  if (weakData.length > 0) {
    findings.push({
      key: "data", severity: "info", title: `${plural(weakData.length, "account")} ${weakData.length === 1 ? "has" : "have"} thin contact records`,
      detail: `Fewer than half the contacts have an email, a phone and a tag (${weakData.slice(0, 3).map((a) => a.name ?? "Unnamed").join(", ")}${weakData.length > 3 ? " and more" : ""}). Follow-up and lists cannot work well on that.`,
      count: weakData.length, dollars: null, kind: "none", view: "accounts", fix: "Open the account, add the missing details or switch on data cleanup.",
      note: "data", window: "Counted now over every contact in the account",
    });
  }

  if (junk > 0) {
    findings.push({
      key: "junk", severity: "info", title: `${plural(junk, "open deal")} ${junk === 1 ? "is" : "are"} left out of every dollar figure`,
      detail: "They have no value or no owner, so counting them would make the totals meaningless.", count: junk, dollars: null, kind: "none", view: "deals", fix: "Give each a value and an owner, or close it out.",
      note: "left_out", window: "Every open deal, counted now",
    });
  }

  const order = { critical: 0, warning: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || (b.dollars ?? 0) - (a.dollars ?? 0));

  const rows: AuditRow[] = live.map((a) => {
    const est = slowFollowUpEstimate(a);
    return { locationId: a.locationId, name: a.name ?? "Unnamed account", staleValue: Math.round(a.staleValue), staleOpps: a.staleOpps, waiting: a.unanswered, estimated: est, score: a.staleValue + (est ?? 0) + a.unanswered * 100 };
  }).filter((r) => r.staleOpps > 0 || r.waiting > 0).sort((x, y) => y.score - x.score).slice(0, 10);

  const bits: string[] = [];
  if (staleDollars > 0) bits.push(`${money(staleDollars)} in stale deals`);
  if (waiting > 0) bits.push(`${plural(waiting, "conversation")} waiting`);
  if (appts && appts.unmarked > 0) bits.push(`${plural(appts.unmarked, "appointment")} with no outcome`);
  const headline = bits.length === 0 ? `Nothing urgent across ${plural(live.length, "account")}.` : `Across ${plural(live.length, "account")}: ${bits.join(", ")}.`;

  const audit: Audit = { accountsScanned: live.length, staleDollars, estimatedDollars, estimateRange, outlier, leftOut: junk, findings, rows, headline, fixFirst: null, notes: [] };
  audit.fixFirst = fixFirstLine(audit);
  audit.notes = auditNotes(audit, opts);
  return audit;
}

/**
 * What to fix first, in one sentence: the most serious finding that needs a person to do something. Nothing urgent gives null, so the page never
 * invents an order for problems that are not there. Information-only findings (a permission, thin records) are never "first".
 */
export function fixFirstFinding(a: Pick<Audit, "findings">): Finding | null {
  return a.findings.find((x) => x.severity !== "info") ?? a.findings.find((x) => x.key === "stale" || x.key === "unmarked" || x.key === "noshows") ?? null;
}

export function fixFirstLine(a: Pick<Audit, "findings">): string | null {
  const f = fixFirstFinding(a);
  return f ? `${f.title}. ${f.fix}` : null;
}

/**
 * The definition of every number the audit shows, once each, in the order the numbers appear: the two headline figures, then the findings.
 * The shared page numbers them (see note 2) and the app puts each one behind a question mark beside its number.
 */
export function auditNotes(a: Pick<Audit, "findings" | "leftOut">, o: AuditOptions = {}): AuditNote[] {
  const keys: NoteKey[] = ["stale", "estimate"];
  for (const f of a.findings) if (f.note && !keys.includes(f.note)) keys.push(f.note);
  if (a.leftOut > 0 && !keys.includes("left_out")) keys.push("left_out");
  return keys.map((key) => ({ key, title: NOTE_TITLE[key], text: noteText(key, o) }));
}

// A summary to paste into a message or an email. Facts and estimates are labelled.
export function auditSummary(a: Audit, who: string): string {
  const lines = [`${who}: account audit`, a.headline, ""];
  if (a.fixFirst) lines.push(`Fix first: ${a.fixFirst}`, "");
  for (const f of a.findings.filter((x) => x.severity !== "info" || x.key === "stale")) lines.push(`- ${f.title}${f.kind === "estimate" ? " (estimate)" : ""}. ${f.fix}`);
  if (a.rows.length) {
    lines.push("", "Where to start:");
    for (const r of a.rows.slice(0, 5)) lines.push(`- ${r.name}: ${money(r.staleValue)} stale across ${plural(r.staleOpps, "deal")}, ${r.waiting} waiting`);
  }
  if (a.estimatedDollars !== null) {
    const range = a.estimateRange ? `, most likely between ${money(a.estimateRange.low)} and ${money(a.estimateRange.high)}` : "";
    lines.push("", `The slow follow-up figure (${money(a.estimatedDollars)}${range}) is an estimate from each account's win rate, not money lost.`);
  }
  return lines.join("\n");
}
