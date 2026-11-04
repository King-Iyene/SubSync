import type { Deps } from "../live-flags.ts";
import { createWorkflow, deleteWorkflow, putDefinition, renamedDefinition, setStatus, validateDefinition, workflowDefinition, type WriteOutcome } from "./ghl.ts";
import { missingScopes, type WriteKind } from "./guards.ts";
import type { WfItem } from "./model.ts";

// Runs ONE confirmed change on ONE workflow. The server has already checked the person, the token, the caps and the typed confirmation; this is the part that
// talks to the CRM in the right order and says in plain words what happened. Every call is a dry run unless WORKFLOWS_WRITE_LIVE is on (see ghl.ts).

export type Outcome = "done" | "dry_run" | "skipped" | "needs_permission" | "conflict" | "failed";
export type Result = { workflowId: string; locationId: string; name: string; outcome: Outcome; message: string; newWorkflowId?: string; newName?: string; snapshot?: unknown };

export type RunDeps = {
  installationId: string | null;
  granted: string[] | null;
  token: (locationId: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  outward?: Deps;
  /** The demo has no CRM: a change is applied to SubSync's own copy only. */
  demo: boolean;
  idem: string;
};

const NEEDS = (miss: string[]) => `Needs permission: reconnect. Missing: ${miss.join(", ")}.`;
const fromWrite = (w: WriteOutcome): { outcome: Outcome; message: string } => {
  switch (w.outcome) {
    case "done": return { outcome: "done", message: "Done." };
    case "dry_run": return { outcome: "dry_run", message: "Dry run: nothing was sent to your CRM because live changes are switched off." };
    case "needs_permission": return { outcome: "needs_permission", message: "Your CRM refused this. Needs permission: reconnect." };
    case "conflict": return { outcome: "conflict", message: "Your CRM did not accept it (the workflow is locked, changed meanwhile, or no longer valid). Nothing was changed." };
    default: return { outcome: "failed", message: `Your CRM answered with an error (${w.status}). Try again later.` };
  }
};

export async function runOne(kind: WriteKind, w: Pick<WfItem, "workflowId" | "locationId" | "name" | "status">, arg: { newName?: string; targetLocationId?: string; snapshot?: Record<string, unknown> | null }, d: RunDeps): Promise<Result> {
  const base = { workflowId: w.workflowId, locationId: w.locationId, name: w.name };
  const miss = missingScopes(kind, d.granted);
  if (miss) return { ...base, outcome: "needs_permission", message: NEEDS(miss) };
  if (d.demo) return { ...base, outcome: "done", message: "Done (demo: only SubSync's copy changed).", newName: arg.newName, newWorkflowId: kind === "clone" ? `demo-${Date.now().toString(36)}` : undefined };
  let token: string;
  try { token = await d.token(w.locationId); } catch { return { ...base, outcome: "failed", message: "SubSync could not open this client account. Reconnect it and try again." }; }
  const c = { token, fetchImpl: d.fetchImpl, installationId: d.installationId, locationId: w.locationId, workflowId: w.workflowId, idem: d.idem };
  const o = d.outward ?? {};

  if (kind === "publish" || kind === "unpublish") {
    const r = fromWrite(await setStatus(c, kind === "publish" ? "published" : "draft", o));
    return { ...base, ...r, message: r.outcome === "done" ? (kind === "publish" ? "Published." : "Set back to draft. New contacts no longer enter it.") : r.message };
  }

  if (kind === "delete") {
    const def = await workflowDefinition({ token, fetchImpl: d.fetchImpl }, w.workflowId);
    // A copy first. If it cannot be read, the delete does not happen: a delete that cannot be undone is not worth the risk.
    if (!def.ok) return { ...base, outcome: def.reason === "needs_permission" ? "needs_permission" : "skipped", message: def.reason === "needs_permission" ? NEEDS(["workflows.readonly"]) : "SubSync could not save a copy first, so nothing was deleted." };
    const r = fromWrite(await deleteWorkflow(c, o));
    return { ...base, ...r, snapshot: def.value, message: r.outcome === "done" ? "Deleted. A copy is saved so it can be recreated as a draft." : r.message };
  }

  if (kind === "rename") {
    if (!arg.newName) return { ...base, outcome: "skipped", message: "No new name." };
    const def = await workflowDefinition({ token, fetchImpl: d.fetchImpl }, w.workflowId);
    if (!def.ok) return { ...base, outcome: def.reason === "needs_permission" ? "needs_permission" : "failed", message: def.reason === "needs_permission" ? NEEDS(["workflows.readonly"]) : "SubSync could not read the workflow, so nothing was changed." };
    const next = renamedDefinition(def.value, arg.newName);
    if (!next) return { ...base, outcome: "skipped", message: "The workflow came back in a shape SubSync does not recognise, so it was left alone.", snapshot: def.value };
    const published = w.status === "published";
    if (published) {
      const down = fromWrite(await setStatus(c, "draft", o));
      if (down.outcome !== "done") return { ...base, ...down, snapshot: def.value };
      // The platform advances its version counter when the status changes, so the definition is read again after the pause (docs/features/WORKFLOWS.md).
      const again = await workflowDefinition({ token, fetchImpl: d.fetchImpl }, w.workflowId);
      const fresh = again.ok ? renamedDefinition(again.value, arg.newName) : null;
      if (!fresh) { await setStatus(c, "published", o); return { ...base, outcome: "failed", message: "The workflow was set back to published and not renamed because it could not be read again.", snapshot: def.value }; }
      const put = fromWrite(await putDefinition(c, fresh, o));
      const up = fromWrite(await setStatus(c, "published", o));
      if (put.outcome !== "done") return { ...base, ...put, message: `${put.message} The workflow is ${up.outcome === "done" ? "published again" : "still a draft: publish it from your CRM"}.`, snapshot: def.value };
      return { ...base, outcome: up.outcome === "done" ? "done" : "failed", message: up.outcome === "done" ? "Renamed. It was set to draft for a moment and is published again." : "Renamed, but it could not be published again. Publish it from your CRM.", newName: arg.newName, snapshot: def.value };
    }
    const put = fromWrite(await putDefinition(c, next, o));
    return { ...base, ...put, message: put.outcome === "done" ? "Renamed." : put.message, newName: arg.newName, snapshot: def.value };
  }

  // clone: read here, check it in the other client account, create it there as a draft.
  if (!arg.targetLocationId) return { ...base, outcome: "skipped", message: "No target client account." };
  const def = await workflowDefinition({ token, fetchImpl: d.fetchImpl }, w.workflowId);
  if (!def.ok) return { ...base, outcome: "failed", message: "SubSync could not read the workflow, so nothing was copied." };
  const src = (def.value && typeof def.value === "object" ? (def.value as Record<string, unknown>) : {}) as Record<string, unknown>;
  const inner = (typeof src.definition === "object" && src.definition ? src.definition : src) as Record<string, unknown>;
  const { version: _v, ...rest } = inner;
  const copy = { ...rest, name: arg.newName ?? `${w.name} (copy)`, source: { system: "api" } };
  let tt: string;
  try { tt = await d.token(arg.targetLocationId); } catch { return { ...base, outcome: "failed", message: "SubSync could not open the other client account." }; }
  const tc = { ...c, token: tt, locationId: arg.targetLocationId };
  const check = await validateDefinition(tc, copy, o);
  if (check.outcome === "done") {
    const body = (check.body && typeof check.body === "object" ? check.body : {}) as Record<string, unknown>;
    if (body.valid === false) return { ...base, outcome: "skipped", message: "The other client account cannot accept this workflow as it is (a form, tag, calendar or template it uses does not exist there). Nothing was created." };
  }
  const made = await createWorkflow(tc, copy, o);
  const r = fromWrite(made);
  const id = made.outcome === "done" && made.body && typeof made.body === "object" ? String((made.body as Record<string, unknown>).workflowId ?? (made.body as Record<string, unknown>).id ?? "") : "";
  return { ...base, ...r, message: r.outcome === "done" ? "Copied as a draft. Check it in the other client account before you publish it." : r.message, newWorkflowId: id || undefined, newName: String(copy.name) };
}

/** Recreates a deleted workflow as a draft from the copy SubSync saved. The new workflow gets a new id. */
export async function recreate(w: { workflowId: string; locationId: string; name: string }, snapshot: Record<string, unknown>, d: RunDeps): Promise<Result> {
  const base = { workflowId: w.workflowId, locationId: w.locationId, name: w.name };
  const miss = missingScopes("clone", d.granted);
  if (miss) return { ...base, outcome: "needs_permission", message: NEEDS(miss) };
  if (d.demo) return { ...base, outcome: "done", message: "Recreated (demo: only SubSync's copy changed)." };
  let token: string;
  try { token = await d.token(w.locationId); } catch { return { ...base, outcome: "failed", message: "SubSync could not open this client account." }; }
  const inner = (typeof snapshot.definition === "object" && snapshot.definition ? snapshot.definition : snapshot) as Record<string, unknown>;
  const { version: _v, ...rest } = inner;
  const made = await createWorkflow({ token, fetchImpl: d.fetchImpl, installationId: d.installationId, locationId: w.locationId, workflowId: w.workflowId, idem: d.idem }, { ...rest, name: w.name, source: { system: "api" } }, d.outward ?? {});
  const r = fromWrite(made);
  const id = made.outcome === "done" && made.body && typeof made.body === "object" ? String((made.body as Record<string, unknown>).workflowId ?? (made.body as Record<string, unknown>).id ?? "") : "";
  return { ...base, ...r, message: r.outcome === "done" ? "Recreated as a draft with a new id. Check it, then publish." : r.message, newWorkflowId: id || undefined };
}
