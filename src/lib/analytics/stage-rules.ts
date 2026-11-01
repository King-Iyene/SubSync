// Which pipelines and stages count as "in play" (N38), and the win probability the owner assumes for a stage (N37). Pure: no database.
//
// A stage named "Disqualified" or "Wrong Phone Number" is closed out by design, and a pipeline named "[Not IN USE]" is not a pipeline anyone
// works. Deals sitting there are never open pipeline, never stale and never "dead pipeline to clean up", because nobody is meant to move them.
// The owner can say otherwise for any stage or pipeline; with no rule from the owner the suggestion made from the name applies, and the screen
// says so. The same two patterns are used by the SQL in stage-rules-sql.ts (Postgres reads them with ~*), so the screen and the totals agree.

export type StageClass = "active" | "closed_out" | "ignore";
export type PipelineClass = "in_use" | "not_in_use";

/** Words that make a STAGE name look closed out. Whole words only (the pattern is read by JavaScript and by Postgres alike). */
export const CLOSED_OUT_STAGE_PATTERN =
  "(^|[^a-z])(disqualified|bad fit|not a fit|not qualified|unqualified|wrong number|wrong phone|wrong contact|unreachable|do not contact|dnc|junk|spam|not interested|closed lost|lost|dead|archived|abandoned)([^a-z]|$)";

/** Words that make a PIPELINE name look unused. */
export const NOT_IN_USE_PIPELINE_PATTERN = "(^|[^a-z])(not in use|not-in-use|unused|deprecated|do not use|inactive|archived|retired|obsolete)([^a-z]|$)";

const CLOSED_OUT_RE = new RegExp(CLOSED_OUT_STAGE_PATTERN, "i");
const NOT_IN_USE_RE = new RegExp(NOT_IN_USE_PIPELINE_PATTERN, "i");

/** The key a rule is stored under: the name, trimmed and in lower case. */
export const ruleKey = (name: string | null | undefined): string => (name ?? "").trim().toLowerCase();

export const suggestStageClass = (stageName: string | null | undefined): StageClass => (CLOSED_OUT_RE.test(stageName ?? "") ? "closed_out" : "active");
export const suggestPipelineClass = (pipelineName: string | null | undefined): PipelineClass => (NOT_IN_USE_RE.test(pipelineName ?? "") ? "not_in_use" : "in_use");

/** A stored rule. `stageKey` is "" for a rule about the pipeline itself. */
export type StoredRule = { pipelineKey: string; stageKey: string; cls: string | null; winProbability: number | null };

export type Treatment = {
  /** True when deals in this stage are left out of open pipeline, stale deals, dead pipeline and the forecast. */
  out: boolean;
  /** Plain words for the screen. */
  label: "Active" | "Closed out" | "Ignored" | "Pipeline not in use";
  /** Who decided: the owner, the name (a suggestion nobody changed), or nothing (an ordinary stage). */
  source: "owner" | "name" | "default";
  /** One sentence for "why". */
  why: string;
};

/** How a stage is treated, from the owner's rules first and the names second. */
export function treatmentOf(pipelineName: string | null | undefined, stageName: string | null | undefined, rules: StoredRule[]): Treatment {
  const pk = ruleKey(pipelineName);
  const sk = ruleKey(stageName);
  const pipeRule = rules.find((r) => r.pipelineKey === pk && r.stageKey === "" && r.cls !== null);
  if (pipeRule) {
    if (pipeRule.cls === "not_in_use") return { out: true, label: "Pipeline not in use", source: "owner", why: "You marked this pipeline as not in use." };
  } else if (suggestPipelineClass(pipelineName) === "not_in_use") {
    return { out: true, label: "Pipeline not in use", source: "name", why: "The pipeline's name says it is not in use. Change this if it is wrong." };
  }
  const stageRule = rules.find((r) => r.pipelineKey === pk && r.stageKey === sk && sk !== "" && r.cls !== null);
  if (stageRule) {
    if (stageRule.cls === "closed_out") return { out: true, label: "Closed out", source: "owner", why: "You marked this stage as closed out." };
    if (stageRule.cls === "ignore") return { out: true, label: "Ignored", source: "owner", why: "You told SubSync to ignore this stage." };
    return { out: false, label: "Active", source: "owner", why: "You marked this stage as active." };
  }
  if (suggestStageClass(stageName) === "closed_out") return { out: true, label: "Closed out", source: "name", why: "The stage's name says the deal is closed out. Change this if it is wrong." };
  return { out: false, label: "Active", source: "default", why: "An ordinary stage." };
}

/** The owner's win probability for a stage (0 to 1), or null when none was set. Never a default: an unset stage has no assumption. */
export function stageProbability(pipelineName: string | null | undefined, stageName: string | null | undefined, rules: StoredRule[]): number | null {
  const pk = ruleKey(pipelineName);
  const sk = ruleKey(stageName);
  const r = rules.find((x) => x.pipelineKey === pk && x.stageKey === sk && sk !== "");
  return r && r.winProbability !== null ? r.winProbability / 100 : null;
}

export const STAGE_CLASSES: readonly string[] = ["active", "closed_out", "ignore"];
export const PIPELINE_CLASSES: readonly string[] = ["in_use", "not_in_use"];

export type RulePatch = { pipeline: string; stage: string | null; cls?: string | null; winProbability?: number | null };

/** Check one change an owner asked for. Returns the cleaned change or the reason it was refused. */
export function parseRulePatch(raw: unknown): { ok: true; patch: RulePatch } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Send the pipeline and the change" };
  const r = raw as Record<string, unknown>;
  if (typeof r.pipeline !== "string" || r.pipeline.trim() === "" || r.pipeline.length > 120) return { ok: false, error: "Choose a pipeline" };
  const stage = r.stage === null || r.stage === undefined || r.stage === "" ? null : r.stage;
  if (stage !== null && (typeof stage !== "string" || stage.length > 120)) return { ok: false, error: "Choose a stage" };
  const patch: RulePatch = { pipeline: r.pipeline, stage: stage as string | null };
  if ("cls" in r) {
    if (r.cls === null || r.cls === "") patch.cls = null;
    else if (typeof r.cls === "string" && (stage === null ? PIPELINE_CLASSES : STAGE_CLASSES).includes(r.cls)) patch.cls = r.cls;
    else return { ok: false, error: stage === null ? "A pipeline is either in use or not in use" : "A stage is active, closed out or ignored" };
  }
  if ("winProbability" in r) {
    if (r.winProbability === null || r.winProbability === "") patch.winProbability = null;
    else {
      const n = Number(r.winProbability);
      if (stage === null) return { ok: false, error: "A win probability belongs to a stage" };
      if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: "A win probability is between 0 and 100" };
      patch.winProbability = Math.round(n);
    }
  }
  if (!("cls" in patch) && !("winProbability" in patch)) return { ok: false, error: "There is nothing to change" };
  return { ok: true, patch };
}

/** How a whole pipeline is treated: in use, or not in use (by the owner's rule, or by its name when the owner said nothing). */
export function pipelineTreatment(pipelineName: string | null | undefined, rules: StoredRule[]): { notInUse: boolean; source: "owner" | "name" | "default"; why: string } {
  const pk = ruleKey(pipelineName);
  const rule = rules.find((r) => r.pipelineKey === pk && r.stageKey === "" && r.cls !== null);
  if (rule) return rule.cls === "not_in_use" ? { notInUse: true, source: "owner", why: "You marked this pipeline as not in use." } : { notInUse: false, source: "owner", why: "You marked this pipeline as in use." };
  if (suggestPipelineClass(pipelineName) === "not_in_use") return { notInUse: true, source: "name", why: "The pipeline's name says it is not in use. Change this if it is wrong." };
  return { notInUse: false, source: "default", why: "An ordinary pipeline." };
}
