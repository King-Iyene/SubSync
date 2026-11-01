// The Instant Audit: what is wrong across the accounts right now and what it is costing, in plain
// sentences, ranked. Pure (no database), so it is unit tested. Two rules from the brief's metric-trust
// section are built in: a FACT (money counted from deals) and an ESTIMATE (money inferred from a win rate)
// are never added together, and anything that cannot be known says so instead of showing a made-up number.

export type AuditAccount = {
  locationId: string; name: string | null;
  staleValue: number; staleOpps: number; openValue: number; openOpps: number; excludedOpen: number;
  unanswered: number; winRate: number | null; avgDealValue: number | null; completenessPct: number; contacts: number;
  /** The largest counted open deal that has not moved (outlier guard). */
  topStaleDeal?: number;
};

export type AuditAppointments = {
  /** Accounts whose calendars could be read. */
  readable: number; total: number; needPermission: number;
  unmarked: number; noShowsToRecover: number; unconfirmed48: number;
} | null;

export type Finding = {
  key: "stale" | "slow" | "unmarked" | "noshows" | "permission" | "data" | "junk";
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
};

export type AuditRow = { locationId: string; name: string; staleValue: number; staleOpps: number; waiting: number; estimated: number | null; score: number };

export type Audit = {
  accountsScanned: number;
  /** Counted from deals. */
  staleDollars: number;
  /** Inferred from win rates; null when no account has enough closed deals. */
  estimatedDollars: number | null;
  findings: Finding[];
  rows: AuditRow[];
  headline: string;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// Waiting conversations x average deal x win rate, only where the account has a win rate.
export const slowFollowUpEstimate = (a: Pick<AuditAccount, "unanswered" | "winRate" | "avgDealValue">): number | null =>
  a.unanswered > 0 && a.winRate !== null && a.avgDealValue !== null ? Math.round(a.unanswered * a.avgDealValue * a.winRate) : null;

export function buildAudit(accounts: AuditAccount[], appts: AuditAppointments): Audit {
  const live = accounts;
  const sum = (f: (a: AuditAccount) => number) => live.reduce((s, a) => s + f(a), 0);
  const staleDollars = Math.round(sum((a) => a.staleValue));
  const staleDeals = sum((a) => a.staleOpps);
  const openValue = sum((a) => a.openValue);
  const waiting = sum((a) => a.unanswered);
  const estimates = live.map(slowFollowUpEstimate);
  const estimatedDollars = estimates.some((e) => e !== null) ? estimates.reduce<number>((s, e) => s + (e ?? 0), 0) : null;
  const junk = sum((a) => a.excludedOpen);
  const weakData = live.filter((a) => a.contacts >= 20 && a.completenessPct < 50);

  const findings: Finding[] = [];

  if (staleDeals > 0) {
    const share = openValue > 0 ? staleDollars / openValue : 0;
    // Outlier guard (UX-04): when one deal is most of the figure, the headline says so instead of reading as a pattern across the pipeline.
    const topStale = live.reduce((m, a) => Math.max(m, a.topStaleDeal ?? 0), 0);
    const oneDealShare = staleDollars > 0 ? topStale / staleDollars : 0;
    const guard = staleDeals >= 1 && oneDealShare >= 0.5 ? ` One deal (${money(topStale)}) is ${Math.round(oneDealShare * 100)}% of this figure, so check that it is a real deal before relying on the number.` : "";
    findings.push({
      key: "stale", severity: share >= 0.5 ? "critical" : share >= 0.25 ? "warning" : "info",
      title: `${money(staleDollars)} is sitting in ${plural(staleDeals, "deal")} that ${staleDeals === 1 ? "has" : "have"} not moved`,
      detail: `That is ${Math.round(share * 100)}% of the open pipeline across ${plural(live.length, "account")}. These are the likeliest lost revenue.${guard}`,
      count: staleDeals, dollars: staleDollars, kind: "fact", view: "deals", fix: "Open the stale deals, move each one forward or close it out.",
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
      });
    }
    if (appts.noShowsToRecover > 0) {
      findings.push({
        key: "noshows", severity: appts.noShowsToRecover >= 5 ? "warning" : "info",
        title: `${plural(appts.noShowsToRecover, "recent no-show")} ${appts.noShowsToRecover === 1 ? "has" : "have"} not been rebooked`,
        detail: "People who miss one appointment will often rebook if someone follows up within days.",
        count: appts.noShowsToRecover, dollars: null, kind: "none", view: "appointments", fix: "Call the recovery list, newest first.",
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
    });
  }

  if (junk > 0) {
    findings.push({
      key: "junk", severity: "info", title: `${plural(junk, "open deal")} ${junk === 1 ? "is" : "are"} left out of every dollar figure`,
      detail: "They have no value or no owner, so counting them would make the totals meaningless.", count: junk, dollars: null, kind: "none", view: "deals", fix: "Give each a value and an owner, or close it out.",
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

  return { accountsScanned: live.length, staleDollars, estimatedDollars, findings, rows, headline };
}

// A summary to paste into a message or an email. Facts and estimates are labelled.
export function auditSummary(a: Audit, who: string): string {
  const lines = [`${who}: account audit`, a.headline, ""];
  for (const f of a.findings.filter((x) => x.severity !== "info" || x.key === "stale")) lines.push(`- ${f.title}${f.kind === "estimate" ? " (estimate)" : ""}. ${f.fix}`);
  if (a.rows.length) {
    lines.push("", "Where to start:");
    for (const r of a.rows.slice(0, 5)) lines.push(`- ${r.name}: ${money(r.staleValue)} stale across ${plural(r.staleOpps, "deal")}, ${r.waiting} waiting`);
  }
  if (a.estimatedDollars !== null) lines.push("", `The slow follow-up figure (${money(a.estimatedDollars)}) is an estimate from each account's win rate, not money lost.`);
  return lines.join("\n");
}
