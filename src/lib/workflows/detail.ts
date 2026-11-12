// Workflows module: the inline detail (so nobody has to leave SubSync to see what a workflow does) and the working-queue marks. Pure.
// The definition is read from the platform on request and summarised in words. Nothing from it is stored except in the saved copy taken before a change.
import type { Finding } from "./health.ts";
import { toMs } from "./model.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** "contact_created" becomes "Contact created". */
export const human = (s: string) => { const t = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : ""; };

export type Summary = { triggers: string[]; steps: Array<{ n: number; name: string; kind: string }>; stepCount: number; branches: number; settings: string[] };
export function summarise(def: unknown): Summary | null {
  const root = obj(def);
  const d = typeof root.definition === "object" && root.definition ? obj(root.definition) : root;
  if (!Array.isArray(d.actions) && !Array.isArray(d.triggers)) return null;
  const triggers = (Array.isArray(d.triggers) ? d.triggers : []).map((t) => { const o = obj(t); return typeof o.name === "string" && o.name ? o.name : human(String(o.type ?? "")); }).filter(Boolean).slice(0, 10);
  const actions = Array.isArray(d.actions) ? d.actions : [];
  const steps = actions.slice(0, 40).map((a, i) => { const o = obj(a); const kind = human(String(o.type ?? "step")); return { n: i + 1, name: typeof o.name === "string" && o.name ? o.name : kind, kind }; });
  const edges = Array.isArray(d.edges) ? d.edges : [];
  const out = new Map<string, number>();
  for (const e of edges) { const f = String(obj(e).from ?? ""); out.set(f, (out.get(f) ?? 0) + 1); }
  const s = obj(d.settings);
  const settings = [s.allowReEntry === true ? "A contact can enter again" : s.allowReEntry === false ? "A contact can enter only once" : "", s.stopOnResponse === true ? "Stops when the contact replies" : ""].filter(Boolean);
  return { triggers, steps, stepCount: actions.length, branches: [...out.values()].filter((n) => n > 1).length, settings };
}

export type LogLine = { at: number | null; status: string; step: string; words: string };
const BAD_WORDS: Record<string, string> = { error: "an error stopped this step", failed: "this step failed", failed_retry_limit_reached: "this step failed and gave up after retrying" };
/** Recent failing step records in plain words. Field names are CHECK items, so several spellings are read and a missing one is left out. */
export function parseLogs(json: unknown): LogLine[] {
  const o = obj(json);
  const list = Array.isArray(o.logs) ? o.logs : Array.isArray(o.data) ? o.data : [];
  return list.slice(0, 10).map((r) => {
    const x = obj(r), meta = obj(x.meta);
    const status = String(x.status ?? "");
    const why = [meta.reason, meta.error, meta.message, meta.failureReason].find((v) => typeof v === "string" && v) as string | undefined;
    return { at: toMs(x.createdAt ?? x.timestamp ?? x.executedAt ?? x.date), status, step: String(x.stepName ?? x.name ?? human(String(x.type ?? "step"))), words: `${BAD_WORDS[status] ?? human(status)}${why ? `: ${why.slice(0, 160)}` : ""}` };
  });
}

// ---------------------------------------------------------------- the working queue (Done, Snooze, owner), kept only in SubSync
export type Mark = { fixedAt: number | null; snoozedUntil: number | null };
export const FIXED_DAYS = 7;
export const markKey = (f: Pick<Finding, "locationId" | "workflowId">) => `${f.locationId}|${f.workflowId ?? "coverage"}`;
/** A finding marked fixed stays quiet for a week, a snoozed one until its date. If the problem is still there afterwards it comes back by itself. */
export function applyMarks(findings: Finding[], marks: Map<string, Mark>, now: number): { open: Finding[]; muted: Array<Finding & { why: "fixed" | "snoozed"; until: number }> } {
  const open: Finding[] = [], muted: Array<Finding & { why: "fixed" | "snoozed"; until: number }> = [];
  for (const f of findings) {
    const m = marks.get(markKey(f));
    if (m?.fixedAt && now < m.fixedAt + FIXED_DAYS * 86_400_000) muted.push({ ...f, why: "fixed", until: m.fixedAt + FIXED_DAYS * 86_400_000 });
    else if (m?.snoozedUntil && now < m.snoozedUntil) muted.push({ ...f, why: "snoozed", until: m.snoozedUntil });
    else open.push(f);
  }
  return { open, muted };
}
export const snoozeUntil = (choice: string, now: number): number | null => (choice === "day" ? now + 86_400_000 : choice === "week" ? now + 7 * 86_400_000 : choice === "month" ? now + 30 * 86_400_000 : null);

/** The weekly Proof: what was caught, what cleared, what is still open. Counts come from the alerts table rows passed in. */
export type ProofAlert = { kind: string; title: string; createdAt: number; resolvedAt: number | null; locationId: string | null };
/** `days` counts back from `now`; or give `win` (the date bar's dates, `until` is the start of the day after the last day) and the window is exactly that: what was raised and cleared inside it, and what was still open at its end. */
export function proofOf(alerts: ProofAlert[], now: number, days: number, win?: { from: number; until: number }) {
  const from = win ? win.from : now - days * 86_400_000, until = win ? Math.min(win.until, Number.MAX_SAFE_INTEGER) : Infinity;
  const raised = alerts.filter((a) => a.createdAt >= from && a.createdAt < until);
  const cleared = alerts.filter((a) => a.resolvedAt !== null && a.resolvedAt >= from && a.resolvedAt < until);
  const open = win && win.until <= now ? alerts.filter((a) => a.createdAt < until && (a.resolvedAt === null || a.resolvedAt >= until)) : alerts.filter((a) => a.resolvedAt === null);
  return { from, raised, cleared, open };
}
