import { isLive, outward, type Deps } from "../live-flags.ts";
import type { Found, WfClient, Fail } from "./client.ts";
import { hasVendorWord } from "./naming.ts";
import { resolveSteps } from "./steps.ts";
import type { Assign, Template } from "./templates.ts";

// The workflow provisioner: for one client account, make sure one template exists as a published workflow in one folder, without ever creating it twice and without ever touching a
// workflow a person has changed. Every write goes through the write gateway (WRITE_GHL_LIVE and the account's own opt-in): with either off, the answer is "Would create folder X and
// workflow Y" and nothing is sent. One audit line per write. The client is injected, so every rule here is tested with a stub and no network.
export const SPACING_MS = 2_000;

export type RowStatus = "active" | "created_draft" | "unavailable" | "inactive";
export type Row = { templateKey: string; folderId: string | null; workflowId: string | null; templateVersion: number; status: RowStatus; lastError: string | null };
export interface Store { get(templateKey: string): Promise<Row | null>; save(row: Row): Promise<void> }

export type Code = "not_enabled" | "missing_scope" | "step_missing" | "rejected" | "failed" | "bad_setting";
export type State = "ready" | "created" | "update_available" | "missing" | "would_create" | "unavailable";
export type Result = { state: State; code?: Code; message: string; workflowId?: string | null; lines: string[] };

export type Ctx = {
  client: WfClient;
  store: Store;
  installationId: string | null;
  locationId: string;
  /** The account's own write opt-in (Settings). Off means a dry run, always. */
  optedIn: boolean;
  settings: { folderName: string; tag: string; assign: Assign };
  /** True when a person pressed "Set up". An automatic run never re-creates a workflow that was deleted. */
  manual: boolean;
  env?: Record<string, string | undefined>;
  audit?: Deps["audit"];
  log?: Deps["log"];
  sleep?: (ms: number) => Promise<void>;
  spacingMs?: number;
};

const FAIL_TEXT: Record<Fail["kind"], { code: Code; message: string }> = {
  not_enabled: { code: "not_enabled", message: "Your CRM has not turned on automatic workflow setup for this account yet. The steps below take about five minutes." },
  missing_scope: { code: "missing_scope", message: "SubSync does not have permission to create workflows in this account (the optional workflow permissions were not granted). The steps below take about five minutes." },
  rejected: { code: "rejected", message: "Your CRM did not accept the workflow SubSync prepared. The steps below take about five minutes." },
  failed: { code: "failed", message: "Your CRM could not be reached just now. Try again in a minute, or use the steps below." },
};
const unavailable = (f: Fail, lines: string[]): Result => ({ state: "unavailable", ...FAIL_TEXT[f.kind], lines });

export async function provision(t: Template, c: Ctx): Promise<Result> {
  const lines: string[] = [];
  const sleep = c.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const gap = () => sleep(c.spacingMs ?? SPACING_MS);
  const env = c.env ?? process.env;
  const save = (r: Partial<Row> & { status: RowStatus }) => c.store.save({ templateKey: t.key, folderId: null, workflowId: null, templateVersion: t.version, lastError: null, ...r });

  if (hasVendorWord(c.settings.folderName) || hasVendorWord(t.name) || hasVendorWord(c.settings.tag)) return { state: "unavailable", code: "bad_setting", message: "Choose a plain name for the folder and the tag.", lines };
  if (c.settings.assign.mode === "user" && !c.settings.assign.userId) return { state: "unavailable", code: "bad_setting", message: "Choose which person gets the calls, or switch to round robin.", lines };

  // 1. What exists already: the stored id first, then the exact name in the folder.
  const row = await c.store.get(t.key);
  const list = await c.client.list();
  if (!list.ok) { if (row) await save({ ...row, status: "unavailable", lastError: list.kind }); return unavailable(list, lines); }
  const byId: Found | undefined = row?.workflowId ? list.value.find((w) => w.id === row.workflowId) : undefined;
  const byName = !byId ? list.value.find((w) => w.name === t.name && (!row?.folderId || w.folderId === null || w.folderId === row.folderId)) : undefined;
  const existing = byId ?? byName;

  if (existing) {
    // Never edited, never re-created. A newer template only produces a notice.
    const version = byId && row ? row.templateVersion : t.version;
    const mine = !!row && row.status === "created_draft" && existing.id === row.workflowId;
    if (mine && !/publish|active/i.test(existing.status)) {
      const pub = await publishGated(c, existing.id, lines);
      if (pub === "failed") return { state: "ready", message: "The workflow exists but could not be published. Publish it in your CRM.", workflowId: existing.id, lines };
      if (pub === "would") return { state: "would_create", message: `Would publish the workflow "${t.name}".`, workflowId: existing.id, lines };
    }
    await save({ templateVersion: version, status: "active", workflowId: existing.id, folderId: existing.folderId ?? row?.folderId ?? null });
    return version < t.version
      ? { state: "update_available", message: "Update available. Your workflow was left exactly as it is.", workflowId: existing.id, lines }
      : { state: "ready", message: `Your "${t.name}" workflow is set up.`, workflowId: existing.id, lines };
  }
  if (row?.workflowId && !c.manual) { await save({ ...row, status: "inactive", lastError: "missing" }); return { state: "missing", message: `The "${t.name}" workflow was removed from your CRM. Press Set up to create it again.`, lines }; }

  // 2. Step types, resolved now. A step that does not exist is a clear message, never a guess.
  const types = await c.client.stepTypes();
  if (!types.ok) { await save({ status: "unavailable", lastError: types.kind }); return unavailable(types, lines); }
  const steps = resolveSteps(types.value);
  if (!steps.ok) { await save({ status: "unavailable", lastError: "step_missing" }); return { state: "unavailable", code: "step_missing", message: `Your CRM does not offer these workflow steps yet: ${steps.missing.join(", ")}. The steps below take about five minutes.`, lines }; }
  const def = t.build({ folderName: c.settings.folderName, tag: c.settings.tag, assign: c.settings.assign, steps });

  // 3. Create (folder and workflow in one call), then publish. Both gated, 2 seconds apart.
  const live = isLive("WRITE_GHL_LIVE", env) && c.optedIn;
  if (live) {
    const v = await c.client.validate(def);
    if (!v.ok) { await save({ status: "unavailable", lastError: v.kind }); return unavailable(v, lines); }
    await gap();
  }
  const made = await outward({ flag: "WRITE_GHL_LIVE", verb: "CREATE", what: "workflow.create", installationId: c.installationId, ids: { locationId: c.locationId, template: t.key } }, () => c.client.create(def), gate(c, live));
  if (!made.live) { lines.push(made.line); return { state: "would_create", message: `Would create folder "${c.settings.folderName}" and workflow "${t.name}".${live ? "" : " Nothing was sent: automatic setup is switched off for this account."}`, lines }; }
  if (!made.result.ok) { await save({ status: "unavailable", lastError: made.result.kind }); return unavailable(made.result, lines); }
  const id = made.result.value.id;
  await auditLive(c, "workflow.create", { locationId: c.locationId, workflowId: id });
  await save({ status: "created_draft", workflowId: id, folderId: made.result.value.folderId });
  await gap();
  const pub = await publishGated(c, id, lines);
  if (pub === "ok") { await save({ status: "active", workflowId: id, folderId: made.result.value.folderId }); return { state: "created", message: `Created "${t.name}" in the "${c.settings.folderName}" folder and published it.`, workflowId: id, lines }; }
  return { state: "created", message: `Created "${t.name}" but it could not be published. Publish it in your CRM.`, workflowId: id, lines };
}

/** A live write is audited here (the gateway records dry runs only): what, which ids, never a name or a value. */
async function auditLive(c: Ctx, what: string, ids: Record<string, string>): Promise<void> {
  if (!c.installationId) return;
  const detail = { what, verb: what === "workflow.create" ? "CREATE" : "WRITE", flag: "WRITE_GHL_LIVE", ids, fields: [] as string[] };
  try {
    if (c.audit) await c.audit({ installationId: c.installationId, action: "live.write", detail });
    else { const { sql } = await import("../db"); const db = sql(); await db`insert into audit_log (installation_id, actor, action, detail) values (${c.installationId}, null, 'live.write', ${db.json(detail as never)})`; }
  } catch { /* best effort, like the dry-run line */ }
}

const gate = (c: Ctx, live: boolean): Deps => ({ env: live ? c.env ?? process.env : { ...(c.env ?? process.env), WRITE_GHL_LIVE: "false" }, audit: c.audit, log: c.log });

async function publishGated(c: Ctx, id: string, lines: string[]): Promise<"ok" | "failed" | "would"> {
  const live = isLive("WRITE_GHL_LIVE", c.env ?? process.env) && c.optedIn;
  const p = await outward({ flag: "WRITE_GHL_LIVE", verb: "WRITE", what: "workflow.publish", installationId: c.installationId, ids: { locationId: c.locationId, workflowId: id } }, () => c.client.publish(id), gate(c, live));
  if (!p.live) { lines.push(p.line); return "would"; }
  if (p.result.ok) await auditLive(c, "workflow.publish", { locationId: c.locationId, workflowId: id });
  return p.result.ok ? "ok" : "failed";
}

/** Read-only check: is the stored (or same-named) workflow there, and is it published? No write, no row change. */
export async function checkOnly(t: Template, c: Pick<Ctx, "client" | "store">): Promise<{ state: "ready" | "draft" | "not_found" | "unverified"; code?: Code; message: string }> {
  const [row, list] = [await c.store.get(t.key), await c.client.list()];
  if (!list.ok) return { state: "unverified", code: FAIL_TEXT[list.kind].code, message: "SubSync cannot read your workflow list, so it cannot confirm the workflow. Add a test lead to the call tag: if the lead is called and the tag disappears within a minute, it works." };
  const w = list.value.find((x) => (row?.workflowId && x.id === row.workflowId) || x.name === t.name);
  if (!w) return { state: "not_found", message: `No workflow named "${t.name}" was found in this account yet.` };
  return /publish|active/i.test(w.status) ? { state: "ready", message: `Found "${w.name}" and it is published.` } : { state: "draft", message: `Found "${w.name}" but it is not published. Publish it in your CRM.` };
}
