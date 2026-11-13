import type { PrPayload } from "../../analytics/proof-core";
import { realDeps } from "../brief";
import { hashInput, idempotencyKey, runJob, type Deps, type JobResult, type Refusal } from "../gateway";
import { parseJsonAnswer } from "../safety";
import { dbStore } from "../store";
import {
  anomalyFacts, coachFacts, coachReady, fallbackLine, leadFacts, meetingFacts, oneThingFacts, pickOneThing, reportFacts, shameProblem, summaryReady, summaryText, aliasOf, MAX_STORIES,
  type Anomaly, type Candidate, type Facts, type Journey, type PersonNums, type SummaryJson, type TeamMiddle,
} from "./facts";
import type { TeamJobId } from "./jobs";
import { loadEffective, type Effective } from "./prefs";

// The one place the six team and client jobs are run. Order of checks: this account's own choice (Settings, AI) first, then the gateway's (kill switches, the connection's own job switch, the
// opt-in for names, the monthly limit, the rate limit, the number guard). `mode: "peek"` never calls the provider: it only returns an answer already written for exactly the same figures, so
// opening a page is free. Every function here only suggests; nothing is sent to anyone and nothing is written to the CRM.

export type Fail = { ok: false; code: Refusal | "not_enough" | "not_written"; message: string };
export type Ok<T> = { ok: true; runId: string | null; cached: boolean; costUsd: number } & T;
export type Mode = "run" | "peek";
export type Who = { installationId: string; locationId: string; userKey: string | null; trigger: "scheduled" | "preview" | "view" | "ask"; mode?: Mode; fresh?: boolean; deps?: Deps; /** A choice already worked out by the caller (coaching across the accounts where it is on). */ eff?: Effective };

const OFF = "This is switched off for this client account in Settings, AI.";
const fail = (code: Fail["code"], message: string): Fail => ({ ok: false, code, message });
const notEnough = (message: string) => fail("not_enough", message);

/** Runs (or, in peek mode, only looks up) one job with already-built facts. */
async function exec(w: Who, job: TeamJobId, facts: Facts, eff: Effective): Promise<JobResult | Fail> {
  if (!eff.jobs[job]) return fail("job_off", OFF);
  if (w.mode === "peek") {
    // The same lookup the gateway does: the account's own connection first, then the company's.
    for (const scope of w.locationId ? [w.locationId, ""] : [""]) {
      const conn = await (w.deps?.store ?? dbStore).connection(w.installationId, scope);
      if (!conn) continue;
      if (conn.paused || conn.status !== "connected" || conn.jobs[job] !== true) return fail("not_written", "Not written yet.");
      const hit = await (w.deps?.store ?? dbStore).cachedRun(w.installationId, scope, idempotencyKey(w.installationId, scope, job, hashInput(facts.text)));
      return hit ? { ok: true, runId: hit.id, text: hit.output, json: parseJsonAnswer(hit.output), cached: true, tokensIn: 0, tokensOut: 0, costUsd: 0, scope, model: conn.model, provider: conn.provider } : fail("not_written", "Not written yet.");
    }
    return fail("no_connection", "Connect your AI account first.");
  }
  return runJob(w.deps ?? realDeps(), { installationId: w.installationId, locationId: w.locationId, userKey: w.userKey, job, trigger: w.trigger, input: facts, fresh: w.fresh });
}
const asFail = (r: JobResult | Fail): Fail | null => (r.ok ? null : { ok: false, code: r.code, message: r.message });
const bad = (reason: string): Fail => fail("rejected", reason);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

// ---------------------------------------------------------------- 1. monthly report summary

export async function reportSummary(w: Who, p: PrPayload): Promise<Ok<{ text: string; draft: SummaryJson; toneUsed: string }> | Fail> {
  if (!summaryReady(p)) return notEnough("Not enough has been recorded this month to write a fair summary.");
  const eff = w.eff ?? (await loadEffective(w.installationId, w.locationId));
  const r = await exec(w, "report_summary", reportFacts(p, eff.tone), eff);
  const f = asFail(r); if (f) return f;
  const j = (r as Extract<JobResult, { ok: true }>).json as Record<string, unknown> | null;
  if (!j || typeof j.whatHappened !== "string" || !j.whatHappened.trim()) return bad("The AI answer was not readable.");
  const draft: SummaryJson = { whatHappened: j.whatHappened, caughtAndFixed: typeof j.caughtAndFixed === "string" ? j.caughtAndFixed : "", wins: strs(j.wins), nextMonth: strs(j.nextMonth) };
  const ok = r as Extract<JobResult, { ok: true }>;
  return { ok: true, runId: ok.runId, cached: ok.cached, costUsd: ok.costUsd, text: summaryText(draft), draft, toneUsed: eff.tone };
}

// ---------------------------------------------------------------- 2. lead stories

export async function leadStories(w: Who, journeys: readonly Journey[], targetMinutes: number): Promise<Ok<{ lines: string[]; aiLines: boolean[] }> | Fail> {
  const page = journeys.slice(0, MAX_STORIES);
  const eff = w.eff ?? (await loadEffective(w.installationId, w.locationId));
  const fallback = page.map((j) => fallbackLine(j, targetMinutes));
  if (!page.length) return { ok: true, runId: null, cached: true, costUsd: 0, lines: [], aiLines: [] };
  const r = await exec(w, "lead_story", leadFacts(page, targetMinutes, eff.tone), eff);
  const f = asFail(r); if (f) return f;
  const ok = r as Extract<JobResult, { ok: true }>;
  const stories = ((ok.json as { stories?: unknown } | null)?.stories ?? []) as Array<{ id?: unknown; line?: unknown }>;
  const byId = new Map<string, string>();
  for (const s of stories) if (typeof s.id === "string" && typeof s.line === "string" && s.line.trim()) byId.set(s.id, s.line.trim());
  const aiLines = page.map((_, i) => byId.has(aliasOf(i)));
  return { ok: true, runId: ok.runId, cached: ok.cached, costUsd: ok.costUsd, lines: page.map((_, i) => byId.get(aliasOf(i)) ?? fallback[i]), aiLines };
}

// ---------------------------------------------------------------- 3. coaching notes

export type CoachNote = { strengths: string[]; fix: string };
export async function coachNote(w: Who, nums: PersonNums, team: TeamMiddle | null, targetMinutes: number): Promise<Ok<CoachNote> | Fail> {
  if (!coachReady(nums)) return notEnough("Not enough first replies yet for a fair note (at least 10 in the last 30 days).");
  const eff = w.eff ?? (await loadEffective(w.installationId, w.locationId));
  const r = await exec(w, "coach_note", coachFacts(nums, team, targetMinutes, eff.tone), eff);
  const f = asFail(r); if (f) return f;
  const ok = r as Extract<JobResult, { ok: true }>;
  const j = ok.json as Record<string, unknown> | null;
  if (!j || typeof j.fix !== "string" || !j.fix.trim()) return bad("The AI answer was not readable.");
  const note: CoachNote = { strengths: strs(j.strengths).slice(0, 2), fix: j.fix.trim() };
  const shame = shameProblem([...note.strengths, note.fix].join(" "));
  if (shame) return bad(shame);
  return { ok: true, runId: ok.runId, cached: ok.cached, costUsd: ok.costUsd, ...note };
}

// ---------------------------------------------------------------- 4. anomaly reasons

export type AnomalyExplanation = { summary: string; reasons: Array<{ reason: string; check: string }> };
export async function explainAnomaly(w: Who, a: Anomaly, context: readonly string[]): Promise<Ok<AnomalyExplanation> | Fail> {
  const eff = w.eff ?? (await loadEffective(w.installationId, w.locationId));
  const r = await exec(w, "anomaly_explain", anomalyFacts(a, context, eff.tone), eff);
  const f = asFail(r); if (f) return f;
  const ok = r as Extract<JobResult, { ok: true }>;
  const j = ok.json as { summary?: unknown; reasons?: unknown } | null;
  const reasons = (Array.isArray(j?.reasons) ? (j?.reasons as Array<Record<string, unknown>>) : []).filter((x) => typeof x.reason === "string" && typeof x.check === "string").map((x) => ({ reason: x.reason as string, check: x.check as string })).slice(0, 4);
  if (!j || typeof j.summary !== "string" || !reasons.length) return bad("The AI answer was not readable.");
  return { ok: true, runId: ok.runId, cached: ok.cached, costUsd: ok.costUsd, summary: j.summary, reasons };
}

// ---------------------------------------------------------------- 5. meeting

export type MeetingDraft = { summary: string; followUp: string };
export async function meetingDraft(w: Who, m: { summary: string | null; actionItems: readonly string[] }): Promise<Ok<MeetingDraft> | Fail> {
  if (!m.summary || !m.summary.trim()) return notEnough("Your meeting tool sent no summary for this call.");
  const eff = w.eff ?? (await loadEffective(w.installationId, w.locationId));
  const r = await exec(w, "meeting_summary", meetingFacts(m, eff.tone), eff);
  const f = asFail(r); if (f) return f;
  const ok = r as Extract<JobResult, { ok: true }>;
  const j = ok.json as Record<string, unknown> | null;
  if (!j || typeof j.summary !== "string" || typeof j.followUp !== "string" || !j.followUp.trim()) return bad("The AI answer was not readable.");
  return { ok: true, runId: ok.runId, cached: ok.cached, costUsd: ok.costUsd, summary: j.summary, followUp: j.followUp };
}

// ---------------------------------------------------------------- 6. one thing to fix

export type OneThing = { text: string; top: Candidate };
export async function oneThing(w: Who, cands: readonly Candidate[]): Promise<Ok<OneThing> | Fail> {
  const pick = pickOneThing(cands);
  if (!pick) return notEnough("Nothing needs fixing for this account right now.");
  const eff = w.eff ?? (await loadEffective(w.installationId, w.locationId));
  const r = await exec(w, "one_thing", oneThingFacts(pick.top, pick.others, eff.tone), eff);
  const f = asFail(r); if (f) return f;
  const ok = r as Extract<JobResult, { ok: true }>;
  return { ok: true, runId: ok.runId, cached: ok.cached, costUsd: ok.costUsd, text: ok.text.trim(), top: pick.top };
}
