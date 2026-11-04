// Workflows module: health rules and the coverage check. Pure. Every threshold is written in docs/METRICS.md (Workflows health).
// An estimate is said to be one. A number that depends on the logs permission is "not known" without it, never guessed as zero.
import { entityOf, type WfItem } from "./model.ts";

const DAY = 86_400_000;

export const HEALTH = {
  /** A draft untouched this long is probably abandoned. */
  draftDays: 30,
  /** A running or scheduled campaign with no change for this long looks stuck. */
  stuckDays: 14,
  /** A published workflow with no log record in this many days is idle. */
  idleDays: 30,
  /** Failures: at least this many and at least this share of the steps in the window. */
  failMin: 3, failShare: 0.2, failBadShare: 0.5,
} as const;

export type Severity = "critical" | "warning" | "info";
export type FindingKind = "failing" | "idle" | "draft_stale" | "removed" | "coverage" | "stuck" | "campaign_failed" | "turned_off" | "review_due";
export type Finding = {
  key: string; kind: FindingKind; severity: Severity;
  workflowId: string | null; locationId: string; title: string; why: string; next: string; estimate: boolean;
};

export type Basis = { now: number; logsKnown: boolean };

export function findingsFor(items: WfItem[], b: Basis): Finding[] {
  const out: Finding[] = [];
  for (const w of items) {
    if (w.removedSeenAt) continue;
    const base = { workflowId: w.workflowId, locationId: w.locationId };
    if (entityOf(w.workflowId) === "campaign") {
      const quiet = w.updatedAt ? Math.floor((b.now - w.updatedAt) / DAY) : null;
      if (w.status === "failed") out.push({ ...base, key: `cfail:${w.locationId}:${w.workflowId}`, kind: "campaign_failed", severity: "critical", estimate: false, title: `Campaign "${w.name}" reports an error`, why: "The CRM marks this campaign as failed.", next: "Open it in your CRM, read the error and run it again if it is still needed." });
      else if (w.status === "published" && quiet !== null && quiet >= HEALTH.stuckDays) out.push({ ...base, key: `stuck:${w.locationId}:${w.workflowId}`, kind: "stuck", severity: "warning", estimate: true, title: `Campaign "${w.name}" looks stuck`, why: `It is still shown as running or scheduled but nothing changed for ${quiet} days. This is an estimate from its last update time.`, next: "Open it in your CRM and check whether it is still sending, or retire it." });
      else if (w.status === "draft" && quiet !== null && quiet >= HEALTH.draftDays) out.push({ ...base, key: `draft:${w.locationId}:${w.workflowId}`, kind: "draft_stale", severity: "info", estimate: true, title: `Campaign "${w.name}" is a draft nobody has touched for ${quiet} days`, why: "It never started. It may have been abandoned.", next: "Finish it or mark it Retire." });
      continue;
    }
    if (w.status === "published" && w.failed30d !== null && w.runs30d !== null) {
      const share = w.runs30d > 0 ? w.failed30d / w.runs30d : 0;
      if (w.failed30d >= HEALTH.failMin && share >= HEALTH.failShare) {
        out.push({
          ...base, key: `failing:${w.locationId}:${w.workflowId}`, kind: "failing", severity: share >= HEALTH.failBadShare ? "critical" : "warning", estimate: false,
          title: `"${w.name}" has failing steps`, why: `${w.failed30d} of ${w.runs30d} steps in the last 30 days failed (${Math.round(share * 100)}%).`,
          next: "Open the workflow in your CRM, look at the history for the step that fails, fix it and publish again.",
        });
        continue;
      }
    }
    if (w.status === "published" && w.runs30d === 0 && b.logsKnown) {
      out.push({
        ...base, key: `idle:${w.locationId}:${w.workflowId}`, kind: "idle", severity: "warning", estimate: true,
        title: `"${w.name}" is published but nothing ran in 30 days`, why: "No step was recorded in the last 30 days. A workflow that waits for a rare event can be quiet on purpose, so this is an estimate.",
        next: "Check that its trigger still matches real events (a form, a tag, a pipeline stage). If it is no longer needed, mark it Retire.",
      });
      continue;
    }
    if (w.status === "draft") {
      const idle = w.updatedAt ? Math.floor((b.now - w.updatedAt) / DAY) : null;
      if (idle !== null && idle >= HEALTH.draftDays) {
        out.push({
          ...base, key: `draft:${w.locationId}:${w.workflowId}`, kind: "draft_stale", severity: "info", estimate: true,
          title: `"${w.name}" is a draft nobody has touched for ${idle} days`, why: "It never started because it was not published. It may have been abandoned.",
          next: "Publish it if it is ready, or mark it Retire so it stops cluttering the list.",
        });
      }
    }
  }
  return out;
}

// Standard lead-handling workflows, found by name only (a definition would need one more read per workflow). The result says "looks like", never "has".
export const STANDARD: ReadonlyArray<{ id: string; label: string; re: RegExp }> = [
  { id: "missed_call", label: "Missed call text back", re: /missed[\s_-]*call|text[\s_-]*back|mctb|call[\s_-]*back/i },
  { id: "new_lead", label: "New lead follow up", re: /new[\s_-]*lead|lead[\s_-]*(follow|nurture|response|reply|intake)|speed[\s_-]*to[\s_-]*lead|inquiry|enquiry|opt[\s_-]*in|form[\s_-]*submit/i },
  { id: "reminder", label: "Appointment reminders", re: /remind|confirm(ation)?|appointment/i },
  { id: "no_show", label: "No show follow up", re: /no[\s_-]*show|missed[\s_-]*appointment|reschedul/i },
];

export type Coverage = { locationId: string; have: string[]; missing: string[]; none: boolean };
export function coverageFor(locationId: string, items: WfItem[]): Coverage {
  const live = items.filter((w) => entityOf(w.workflowId) === "workflow" && w.locationId === locationId && w.status === "published" && !w.removedSeenAt);
  const have = STANDARD.filter((s) => live.some((w) => s.re.test(w.name))).map((s) => s.id);
  const missing = STANDARD.filter((s) => !have.includes(s.id)).map((s) => s.id);
  return { locationId, have, missing, none: live.length === 0 };
}
export const standardLabel = (id: string) => STANDARD.find((s) => s.id === id)?.label ?? id;

/** One finding per account that is missing a standard workflow. Only for accounts whose list is known (the read permission was granted and a sync finished). */
export function coverageFindings(accounts: Array<{ locationId: string; name: string }>, items: WfItem[], known: Set<string>): Finding[] {
  const out: Finding[] = [];
  for (const a of accounts) {
    if (!known.has(a.locationId)) continue;
    const c = coverageFor(a.locationId, items);
    if (c.missing.length === 0) continue;
    const names = c.missing.map(standardLabel);
    out.push({
      key: `coverage:${a.locationId}`, kind: "coverage", severity: c.have.length === 0 ? "warning" : "info", workflowId: null, locationId: a.locationId, estimate: true,
      title: `${a.name} has no published ${names.length === 1 ? names[0].toLowerCase() : `workflow for ${names.slice(0, 2).join(" or ").toLowerCase()}${names.length > 2 ? ` and ${names.length - 2} more` : ""}`}`,
      why: "Found by workflow names only, so this is an estimate. A workflow with an unusual name will not be recognised.",
      next: `Check whether the account needs: ${names.join(", ")}. If a workflow already does this under another name, label it in SubSync.`,
    });
  }
  return out;
}

const RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
export const rankFindings = (f: Finding[]): Finding[] => [...f].sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.title.localeCompare(b.title));

/** The short "what to do next" list: at most three plain sentences. */
export function nextSteps(findings: Finding[], logsKnown: boolean): string[] {
  const out: string[] = [];
  const n = (k: FindingKind) => findings.filter((f) => f.kind === k).length;
  if (n("campaign_failed")) out.push(`${n("campaign_failed")} campaign${n("campaign_failed") === 1 ? "" : "s"} reported an error.`);
  if (n("turned_off")) out.push(`${n("turned_off")} workflow${n("turned_off") === 1 ? " was" : "s were"} turned off since the last look.`);
  if (n("failing")) out.push(`Fix ${n("failing")} failing workflow${n("failing") === 1 ? "" : "s"} first. Contacts are hitting an error step.`);
  if (n("coverage")) out.push(`${n("coverage")} client account${n("coverage") === 1 ? " is" : "s are"} missing a standard lead-handling workflow (estimate, by name).`);
  if (n("idle")) out.push(`Check ${n("idle")} published workflow${n("idle") === 1 ? "" : "s"} that did not run in 30 days.`);
  if (n("draft_stale") && out.length < 3) out.push(`Publish or retire ${n("draft_stale")} old draft${n("draft_stale") === 1 ? "" : "s"}.`);
  if (!logsKnown && out.length < 3) out.push("Allow the workflow history permission to see failing and idle workflows.");
  return out.slice(0, 3);
}

/** What alert drafts to raise for the alert engine. Only failing and coverage gaps page people; the rest stay on the page. */
export function alertDrafts(findings: Finding[]): Array<{ locationId: string; kind: string; severity: "info" | "warning" | "critical"; title: string; detail: Record<string, unknown>; dedupeKey: string }> {
  return findings.filter((f) => f.kind === "failing" || f.kind === "campaign_failed" || f.kind === "turned_off" || (f.kind === "coverage" && f.severity === "warning")).map((f) => ({
    locationId: f.locationId, kind: f.kind === "failing" ? "workflow_failing" : f.kind === "campaign_failed" ? "campaign_failed" : f.kind === "turned_off" ? "workflow_turned_off" : "workflow_coverage", severity: f.severity, title: f.title,
    detail: { why: f.why, next: f.next, workflowId: f.workflowId, estimate: f.estimate }, dedupeKey: `wf:${f.key}`,
  }));
}
