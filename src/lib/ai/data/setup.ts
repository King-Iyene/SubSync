import { coverageFor, STANDARD } from "../../workflows/health";
import { loadItems } from "../../workflows/store";
import { sql } from "../../db";
import { runJob, type Deps, type JobResult, type Refusal } from "../gateway";

// Setup auditor (docs/AI_JOBS_SPEC.md 5). Our code reads the account's setup facts (calendars and who they belong to, pipelines and their stages, the call-queue workflow, the standard workflows,
// permissions) and writes one plain fact line for each. The model only words the issues and the one fix for each; an issue is kept only when its id is one of the lines. Aggregates, no contact
// data. Suggest only: nothing is changed.

export type SetupLine = { id: string; ok: boolean; text: string };
export type SetupIssue = { id: string; title: string; why: string; fix: string; severity: "high" | "medium" | "low" };
export type SetupFacts = { text: string; fields: string[]; lines: SetupLine[] };
export type SetupInput = {
  calendars: number | null; calendarsNoOwner: number; pipelines: number | null; pipelinesFewStages: number; callQueue: "not_set_up" | "tag_only" | "workflow_marked" | null;
  workflowsKnown: boolean; missingStandard: string[]; permissions: Record<string, "ok" | "needs_permission" | "unknown">;
};

const PERM_LABEL: Record<string, string> = { appointments: "calendar and appointments", users: "team member names", speed: "conversations (speed to lead)", calendars: "the full calendar list" };

/** Pure: the fact lines. A line that is fine says so, so the model never has to guess. */
export function setupFacts(i: SetupInput): SetupFacts {
  const L: SetupLine[] = [];
  if (i.calendars === null) L.push({ id: "calendars", ok: false, text: "Calendars: Not available from the platform yet (the list has not loaded)." });
  else L.push({ id: "calendar_owner", ok: i.calendarsNoOwner === 0, text: `Calendars: ${i.calendars} active; ${i.calendarsNoOwner} of them have never had a booking assigned to a team member.` });
  if (i.pipelines === null) L.push({ id: "pipelines", ok: false, text: "Pipelines: Not available from the platform yet (the list has not loaded)." });
  else L.push({ id: "pipeline_stages", ok: i.pipelinesFewStages === 0, text: `Pipelines: ${i.pipelines} found; ${i.pipelinesFewStages} have fewer than two stages.` });
  L.push({ id: "call_queue", ok: i.callQueue === "workflow_marked", text: `Call queue workflow: ${i.callQueue === "workflow_marked" ? "set up and marked as done" : i.callQueue === "tag_only" ? "only the tag route is used, no workflow marked" : i.callQueue === "not_set_up" ? "not set up" : "not known yet"}.` });
  if (!i.workflowsKnown) L.push({ id: "standard_workflows", ok: false, text: "Standard workflows: Needs permission: reconnect (the automation list could not be read)." });
  else L.push({ id: "standard_workflows", ok: i.missingStandard.length === 0, text: `Standard workflows missing (found by name, an estimate): ${i.missingStandard.length ? i.missingStandard.join(", ") : "none"}.` });
  for (const [k, v] of Object.entries(i.permissions)) L.push({ id: `permission_${k}`, ok: v === "ok", text: `Permission for ${PERM_LABEL[k] ?? k}: ${v === "ok" ? "granted" : v === "needs_permission" ? "Needs permission: reconnect" : "not known yet"}.` });
  return { lines: L, text: ["Setup facts, one per line:", ...L.map((l) => `- id: ${l.id}; ${l.ok ? "fine" : "check"}; ${l.text}`)].join("\n"), fields: ["counts of calendars, pipelines and stages", "which standard automations exist", "which permissions are granted (no contact data)"] };
}

/** Pure: keeps issues whose id is a line that was not fine. */
export function keepIssues(raw: unknown, lines: readonly SetupLine[]): SetupIssue[] {
  const out: SetupIssue[] = [];
  if (!Array.isArray(raw)) return out;
  for (const x of raw as Array<Record<string, unknown>>) {
    const line = lines.find((l) => l.id === x?.id);
    if (!line || line.ok || typeof x.title !== "string" || typeof x.why !== "string" || typeof x.fix !== "string" || out.some((o) => o.id === line.id)) continue;
    out.push({ id: line.id, title: x.title, why: x.why, fix: x.fix, severity: x.severity === "high" || x.severity === "medium" ? x.severity : "low" });
  }
  return out;
}

export async function loadSetupInput(inst: string, loc: string): Promise<SetupInput> {
  const db = sql();
  const [l] = await db`select appointments_access, users_access, speed_access, calendars_access from locations where installation_id = ${inst} and location_id = ${loc} and not ignored`.catch(() => [undefined]);
  const acc = (v: unknown): "ok" | "needs_permission" | "unknown" => (v === "ok" ? "ok" : v === "needs_permission" ? "needs_permission" : "unknown");
  const cal = await db`select count(*)::int total, count(*) filter (where not exists (select 1 from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.calendar_id = c.calendar_id and a.assigned_to is not null))::int noown
    from cached_calendars c where c.installation_id = ${inst} and c.location_id = ${loc} and c.is_active`.catch(() => null);
  const pl = await db`select count(*)::int total, count(*) filter (where jsonb_array_length(coalesce(stages, '[]'::jsonb)) < 2)::int few from pipelines where installation_id = ${inst} and location_id = ${loc}`.catch(() => null);
  const [q] = await db`select route, workflow_id, workflow_marked_at from call_queue_settings where installation_id = ${inst} and location_id = ${loc}`.catch(() => [undefined]);
  const { items, available } = await loadItems(inst, [loc]);
  const known = available && items.some((w) => w.locationId === loc);
  const calendarsKnown = l?.calendars_access === "ok" || Number(cal?.[0]?.total ?? 0) > 0;
  return {
    calendars: cal && calendarsKnown ? Number(cal[0].total) : null, calendarsNoOwner: Number(cal?.[0]?.noown ?? 0),
    pipelines: pl && Number(pl[0].total) > 0 ? Number(pl[0].total) : null, pipelinesFewStages: Number(pl?.[0]?.few ?? 0),
    callQueue: !q ? "not_set_up" : q.workflow_marked_at ? "workflow_marked" : "tag_only", workflowsKnown: known,
    missingStandard: known ? coverageFor(loc, items).missing.map((id) => STANDARD.find((s) => s.id === id)?.label ?? id) : [],
    permissions: { appointments: acc(l?.appointments_access), users: acc(l?.users_access), speed: acc(l?.speed_access), calendars: acc(l?.calendars_access) },
  };
}

export type SetupResult = { ok: true; runId: string; cached: boolean; issues: SetupIssue[]; allFine: boolean; costUsd: number } | { ok: false; code: Refusal | "unverified"; message: string };

export async function runSetupAudit(a: { installationId: string; locationId: string; userKey: string | null; deps: Deps; facts: SetupFacts; fresh?: boolean }): Promise<SetupResult> {
  if (a.facts.lines.every((l) => l.ok)) return { ok: true, runId: "", cached: false, issues: [], allFine: true, costUsd: 0 };
  const r: JobResult = await runJob(a.deps, { installationId: a.installationId, locationId: a.locationId, userKey: a.userKey, job: "setup_audit", trigger: "view", fresh: a.fresh, input: { text: a.facts.text, fields: a.facts.fields, includesNames: false } });
  if (!r.ok) return { ok: false, code: r.code, message: r.message };
  const issues = keepIssues((r.json as { issues?: unknown } | null)?.issues, a.facts.lines);
  if (!issues.length) return { ok: false, code: "unverified", message: "The answer did not match the facts, so it was not shown." };
  return { ok: true, runId: r.runId, cached: r.cached, issues, allFine: false, costUsd: r.costUsd };
}
