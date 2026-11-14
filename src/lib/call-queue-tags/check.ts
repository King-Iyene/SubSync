import { QUEUES, type QueueTags } from "./tags.ts";

// "Check that it worked": decided from facts the caller read (the account's tags and workflow names) so every case has a test. Read only; it never blames the person.
export type CheckLine = { id: string; label: string; state: "found" | "missing" | "needs_permission"; text: string };
export type CheckResult = { state: "ok" | "missing" | "needs_permission" | "unchecked"; lines: CheckLine[]; summary: string };
export type CheckFacts = {
  /** false when the permission to read tags or workflows has not been granted. */
  tagsReadable: boolean; workflowsReadable: boolean;
  tagNames: readonly string[]; workflowNames: readonly string[];
};

export const NEEDS_PERMISSION = "Needs permission: reconnect";
const norm = (s: string) => s.trim().toLowerCase();

export function judgeSetup(tags: QueueTags, f: CheckFacts): CheckResult {
  const lines: CheckLine[] = [];
  const have = new Set(f.tagNames.map(norm));
  for (const q of QUEUES) {
    if (!f.tagsReadable) { lines.push({ id: `tag:${q.key}`, label: q.label, state: "needs_permission", text: `Tag "${tags[q.key]}": ${NEEDS_PERMISSION}` }); continue; }
    const ok = have.has(norm(tags[q.key]));
    lines.push({ id: `tag:${q.key}`, label: q.label, state: ok ? "found" : "missing", text: ok ? `Tag "${tags[q.key]}": found.` : `Tag "${tags[q.key]}": not found yet. It appears in your CRM once it is created or used on a contact.` });
  }
  const names = new Set(f.workflowNames.map(norm));
  for (const q of QUEUES) {
    if (!q.workflow) continue;
    if (!f.workflowsReadable) { lines.push({ id: `wf:${q.key}`, label: q.workflow, state: "needs_permission", text: `Workflow "${q.workflow}": ${NEEDS_PERMISSION}` }); continue; }
    const ok = names.has(norm(q.workflow));
    lines.push({ id: `wf:${q.key}`, label: q.workflow, state: ok ? "found" : "missing", text: ok ? `Workflow "${q.workflow}": found.` : `Workflow "${q.workflow}": not found yet.` });
  }
  const perm = lines.some((l) => l.state === "needs_permission");
  const miss = lines.some((l) => l.state === "missing");
  const state = perm ? "needs_permission" : miss ? "missing" : "ok";
  const summary = perm ? NEEDS_PERMISSION : miss ? `${lines.filter((l) => l.state === "missing").length} of ${lines.length} items not found yet.` : "Everything is in place.";
  return { state, lines, summary };
}

/** Getting started: the one row's state, from the cached check of each account. `checks` has one entry per account that has been checked. Never ticked by hand: only "ok" everywhere ticks it. */
export function guideRowState(checks: readonly { state: CheckResult["state"] }[], accounts: number): { done: boolean; detail: string } {
  if (checks.length === 0) return { done: false, detail: "Not checked yet. Open Settings, Call queues and press Check that it worked." };
  if (checks.some((c) => c.state === "needs_permission")) return { done: false, detail: NEEDS_PERMISSION };
  if (checks.some((c) => c.state === "missing")) return { done: false, detail: "Some tags or workflows were not found yet. Open Settings, Call queues to see which." };
  if (checks.length < accounts) return { done: false, detail: `${checks.length} of ${accounts} accounts checked so far.` };
  return { done: true, detail: accounts === 1 ? "Your tags and workflows are in place." : `All ${accounts} accounts checked: tags and workflows are in place.` };
}
