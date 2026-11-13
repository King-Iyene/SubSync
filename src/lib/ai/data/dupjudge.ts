import type { GroupRow } from "../../analytics/dq-queries";
import { DIFFERENT_NAMES_WHY, namesConflict } from "../../dq/dupe-tier";
import { runJob, type Deps, type JobResult, type Refusal } from "../gateway";

// Duplicate judge (docs/AI_JOBS_SPEC.md 4). For ONE Likely or Possible group the model summarises the evidence and says "same person", "different people" or "unsure", with reasons. It NEVER
// merges, never picks which record to keep, and can never override the name-mismatch rule: when the names are different people's names the verdict "same" is replaced by "unsure" here, in code.
// The chooser (preview, typed confirmation, undo, the protections) still needs a person to pick. Names, emails and phones are the data, so this needs the account's names opt-in.

export type Verdict = "same" | "different" | "unsure";
export type JudgeResult =
  | { ok: true; runId: string; cached: boolean; verdict: Verdict; reasons: string[]; namesDiffer: boolean; downgraded: boolean; protectedCount: number; costUsd: number }
  | { ok: false; code: Refusal | "tier" | "unverified"; message: string };

const day = (v: string | null) => (v ? v.slice(0, 10) : "unknown");

/** The evidence text for one group. Pure. */
export function judgeFacts(g: GroupRow): { text: string; fields: string[]; namesDiffer: boolean } {
  const namesDiffer = namesConflict(g.people.map((p) => p.name));
  const lines = g.people.map((p, i) => `Record ${i + 1}: name ${p.name}; email ${p.email ?? "none"}; phone ${p.phone ?? "none"}; source ${p.source ?? "none"}; added ${day(p.createdAt)}; open deals ${p.openDeals}; do not disturb ${p.dnd ? "yes" : "no"}`);
  return {
    namesDiffer,
    text: [`Why the matcher grouped these: ${g.badge}`, `Records in the group: ${g.people.length}`, `Do the names look like different people's names: ${namesDiffer ? "yes" : "no"}`, ...lines].join("\n"),
    fields: ["for each record: name, email, phone, source, date added, number of open deals, whether do-not-disturb is on (names, emails and phones: sent only with your opt-in)"],
  };
}

/** The name-mismatch rule, in code: "same" can never stand when the names differ. Pure. */
export function applyNameRule(verdict: Verdict, reasons: string[], namesDiffer: boolean): { verdict: Verdict; reasons: string[]; downgraded: boolean } {
  if (verdict === "same" && namesDiffer) return { verdict: "unsure", reasons: [DIFFERENT_NAMES_WHY, ...reasons].slice(0, 3), downgraded: true };
  return { verdict, reasons, downgraded: false };
}

export async function judgeDuplicates(a: { installationId: string; userKey: string | null; group: GroupRow; deps: Deps; fresh?: boolean }): Promise<JudgeResult> {
  if (a.group.tier === "certain") return { ok: false, code: "tier", message: "This group is already certain. The judge is for Likely and Possible groups." };
  const f = judgeFacts(a.group);
  const r: JobResult = await runJob(a.deps, { installationId: a.installationId, locationId: a.group.locationId, userKey: a.userKey, job: "dup_adjudicate", trigger: "view", fresh: a.fresh, input: { text: f.text, fields: f.fields, includesNames: true } });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  const j = r.json as { verdict?: unknown; reasons?: unknown } | null;
  if (!j || (j.verdict !== "same" && j.verdict !== "different" && j.verdict !== "unsure") || !Array.isArray(j.reasons)) return { ok: false, code: "unverified", message: "The answer was not in a form we could check, so it was not shown." };
  const reasons = (j.reasons as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3);
  const ruled = applyNameRule(j.verdict, reasons, f.namesDiffer);
  return { ok: true, runId: r.runId, cached: r.cached, ...ruled, namesDiffer: f.namesDiffer, protectedCount: a.group.protectedCount, costUsd: r.costUsd };
}
