import { sql } from "../db";
import { ownedAccount } from "./pl-guard";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { dryRunWords } from "../analytics/unanswered-actions";
import {
  CUSTOM_VALUE_READ_SCOPE, CUSTOM_VALUE_WRITE_SCOPE, PIPELINE_CREATE_SCOPE, SLA_VALUE_NAME, STANDARD_PIPELINE, TAG_WRITE_SCOPE, TASK_WRITE_SCOPE,
  checkSlaMinutes, checkTagName, completeTask, countPipelines, createPipeline, createTag, deleteTask, findSlaValue, listTagNames, planCustomValue, setCustomValue,
  type SafeWriteResult,
} from "../ghl/safe-writes-gateway";
import { failureText } from "../ghl/workbench";
import { ghlFetch } from "../ghl/http";
import { GHL_API } from "../ghl/client";
import { VERSION } from "../ghl/crm-gateway";
import { isLive } from "../live-flags";
import { parseGranted } from "../scope-groups";
import { json, type AuthContext } from "./auth";

// Four small, previewed changes to a client's CRM, under /api/app/sw/<part> (flag safe_writes; the one gateway is src/lib/ghl/safe-writes-gateway.ts):
//   GET  setup?locationId   what the setup card shows: whether the account has a pipeline, the stages that would be made, the reply target, and the mode (practice or live)
//   POST tag                { locationId, name, step }   create a tag the call queues look for                (step "preview", then "do" with confirmed)
//   POST pipeline           { locationId, step }          create the standard sales pipeline, only when the account has none
//   POST sla                { locationId, step }          store the account's reply target as the custom value subsync_sla_minutes (create or update)
//   POST task               { locationId, contactId, taskId, op: "complete" | "delete", step, confirmText }   mark a task done, or delete one SubSync made (typed task name)
// Who is asking and which accounts they may open come from the verified session (`ctx`, `h.allowed`). An id from the request is a REQUEST: it is used only after ownedAccount, and a contact
// must be one SubSync holds for THAT account. The title of a task, the reply target and what the CRM already holds are read here, never taken from the browser. Nothing here messages a lead.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type SafeWritesHelpers = { allowed: () => Promise<string[] | null>; locationToken: (locationId: string) => Promise<string> };

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;
/** Account administrators and the agency. A client's staff may only mark a task done. */
const isAdminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";
const permissionText = (what: string) => `Needs permission: reconnect SubSync so it may ${what}. Nothing was changed.`;

const mode = async (ctx: Ctx, locationId: string) => {
  const master = !ctx.demo && isLive("WRITE_GHL_LIVE");
  const optedIn = ctx.demo ? false : await writeEnabledFor(ctx.installationId, locationId).catch(() => false);
  return { masterOn: master, optedIn, live: master && optedIn, demo: ctx.demo === true };
};

/** True when the permission is granted, or when SubSync cannot tell (the platform then answers). */
async function granted(ctx: Ctx, scope: string): Promise<boolean> {
  if (ctx.demo) return true;
  try {
    const [r] = await sql()`select scope from installations where id = ${ctx.installationId}`;
    return typeof r?.scope === "string" && r.scope.trim() ? parseGranted(r.scope as string).includes(scope) : true;
  } catch { return true; }
}

async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
}

const doing = (b: Record<string, unknown>) => b.step === "do";

/** One answer shape for every write. */
function answer(r: SafeWriteResult, words: { done: string; already: string; unchanged?: string; permission: string }): Response {
  switch (r.outcome) {
    case "done": return json({ ok: true, done: true, message: words.done });
    case "already": return json({ ok: true, already: true, message: words.already });
    case "unchanged": return json({ ok: true, unchanged: true, message: words.unchanged ?? words.already });
    case "dry_run": return json({ ok: true, dryRun: true, reason: r.reason, message: `${dryRunWords(r.reason)} Here is what would have happened.` });
    case "needs_permission": return json({ ok: false, needsPermission: true, message: words.permission }, 403);
    case "rate_limited": return json({ ok: false, message: `Slow down a little: try again in ${r.retryInSeconds} seconds.`, retryInSeconds: r.retryInSeconds }, 429);
    case "blocked": return json({ ok: false, blocked: true, message: r.text }, 422);
    case "failed": return json({ ok: false, message: r.status === 0 ? "SubSync could not read your CRM just before the change, so it changed nothing. Try again." : failureText(r.status), retry: true }, 502);
  }
}

export async function handleSafeWrites(ctx: Ctx, h: SafeWritesHelpers): Promise<Response> {
  const part = ctx.segments[1], m = ctx.request.method;
  if (ctx.entitlements.features.safe_writes !== true || ctx.entitlements.locked.includes("safe_writes")) return json({ error: "This is not switched on for your account" }, 404);
  if (m === "GET" && part === "setup") return setupRoute(ctx, h);
  if (m !== "POST") return json({ error: "Unknown action" }, 404);
  const b = await readBody(ctx);
  if (!b) return json({ error: "Send the details" }, 400);
  const locationId = await ownedAccount(ctx.installationId, await h.allowed(), b.locationId);
  if (!locationId) return json({ error: "That account is not available" }, 404);
  if (part === "task") return taskRoute(ctx, h, locationId, b);
  if (!isAdminSide(ctx)) return json({ error: "Ask your administrator to make this change." }, 403);
  if (part === "tag") return tagRoute(ctx, h, locationId, b);
  if (part === "pipeline") return pipelineRoute(ctx, h, locationId, b);
  if (part === "sla") return slaRoute(ctx, h, locationId, b);
  return json({ error: "Unknown action" }, 404);
}

// ---------------- the setup card (SubSync's own copy only; no call to the CRM) ----------------

async function pipelineCount(ctx: Ctx, locationId: string): Promise<number> {
  const [r] = await sql()`select count(*)::int n from pipelines where installation_id = ${ctx.installationId} and location_id = ${locationId}`;
  return Number(r?.n ?? 0);
}
/** The account's own reply target (minutes): its own setting, else the company's, else 15. */
async function replyTarget(ctx: Ctx, locationId: string): Promise<number> {
  const [r] = await sql()`select coalesce(l.speed_target_minutes, s.speed_target_minutes, 15)::int m from locations l left join settings s on s.installation_id = l.installation_id where l.installation_id = ${ctx.installationId} and l.location_id = ${locationId}`;
  return Number(r?.m ?? 15);
}

async function setupRoute(ctx: Ctx, h: SafeWritesHelpers): Promise<Response> {
  const locationId = await ownedAccount(ctx.installationId, await h.allowed(), ctx.url.searchParams.get("locationId"));
  if (!locationId) return json({ error: "That account is not available" }, 404);
  const [md, count, minutes, pOk, vOk] = await Promise.all([mode(ctx, locationId), pipelineCount(ctx, locationId).catch(() => -1), replyTarget(ctx, locationId).catch(() => 15), granted(ctx, PIPELINE_CREATE_SCOPE), granted(ctx, CUSTOM_VALUE_WRITE_SCOPE)]);
  return json({
    canEdit: isAdminSide(ctx), mode: md,
    // -1: SubSync could not count (the table is not there yet); nothing is offered then.
    pipeline: { show: count === 0, known: count >= 0, name: STANDARD_PIPELINE.name, stages: STANDARD_PIPELINE.stages, needsPermission: !pOk },
    sla: { minutes, name: SLA_VALUE_NAME, needsPermission: !vOk },
  });
}

// ---------------- 1. tag ----------------

async function tagRoute(ctx: Ctx, h: SafeWritesHelpers, locationId: string, b: Record<string, unknown>): Promise<Response> {
  const c = checkTagName(b.name);
  if (!c.ok) return json({ ok: false, blocked: true, message: c.text }, 422);
  const [md, perm] = await Promise.all([mode(ctx, locationId), granted(ctx, TAG_WRITE_SCOPE)]);
  const token = () => h.locationToken(locationId);
  const words = { done: "Created. Your call queue can now find this tag.", already: "That tag is already in your CRM. Nothing was added twice.", permission: permissionText("create tags") };
  if (ctx.demo) return doing(b) ? answer({ outcome: "dry_run", line: "", reason: "account" }, words) : json({ ok: true, preview: tagPreview(c.name, false), mode: md, needsPermission: false });
  // The tags the account has now, read live (permission to read tags is already held). If they cannot be read, nothing is offered.
  const t = await token().catch(() => null);
  if (!t) return json({ ok: false, message: "SubSync could not reach this account just now. Try again in a minute." }, 502);
  const list = await listTagNames({ locationId, token: t });
  if (!list.ok) return list.reason === "needs_permission" ? json({ ok: false, needsPermission: true, message: permissionText("read your tags") }, 403) : json({ ok: false, message: "SubSync could not read your tags just now. Try again in a minute." }, 502);
  if (!doing(b)) return json({ ok: true, preview: tagPreview(c.name, list.value.some((x) => x.trim().toLowerCase() === c.name.toLowerCase())), mode: md, needsPermission: !perm });
  if (b.confirmed !== true) return json({ ok: false, message: "Confirm to continue." }, 409);
  if (md.live && !perm) return json({ ok: false, needsPermission: true, message: words.permission }, 403);
  const r = await createTag({
    installationId: ctx.installationId, locationId, actor: actorOf(ctx), optedIn: md.optedIn, token, name: c.name, existing: list.value,
    recheck: async () => { const x = await listTagNames({ locationId, token: await token() }); return x.ok ? x.value : null; },
  }, {});
  return answer(r, words);
}
const tagPreview = (name: string, exists: boolean) => ({
  title: exists ? "This tag already exists" : "Create this tag in your CRM",
  lines: exists ? [`The tag "${name}" is already in your CRM. Nothing will be created.`] : [`New tag: "${name}"`, "It is added to your list of tags. No contact is tagged and nothing else changes."],
  exists, canConfirm: !exists,
});

// ---------------- 2. pipeline ----------------

async function pipelineRoute(ctx: Ctx, h: SafeWritesHelpers, locationId: string, b: Record<string, unknown>): Promise<Response> {
  const [md, perm, count] = await Promise.all([mode(ctx, locationId), granted(ctx, PIPELINE_CREATE_SCOPE), pipelineCount(ctx, locationId).catch(() => -1)]);
  const words = { done: "Created. The new pipeline shows up in your CRM, and in SubSync after the next sync.", already: "This account already has a pipeline. Nothing was added.", permission: permissionText("create pipelines") };
  if (count !== 0) return json({ ok: false, blocked: true, message: count > 0 ? words.already : "SubSync cannot see this account's pipelines yet, so it will not create one." }, 422);
  const preview = { title: `Create the pipeline "${STANDARD_PIPELINE.name}"`, lines: [`Stages, in order: ${STANDARD_PIPELINE.stages.join(", ")}.`, "This account has no pipeline yet. No deal is created and no contact is touched."], canConfirm: true };
  if (!doing(b)) return json({ ok: true, preview, mode: md, needsPermission: !perm });
  if (b.confirmed !== true) return json({ ok: false, message: "Confirm to continue." }, 409);
  if (md.live && !perm) return json({ ok: false, needsPermission: true, message: words.permission }, 403);
  const token = () => h.locationToken(locationId);
  const r = await createPipeline({
    installationId: ctx.installationId, locationId, actor: actorOf(ctx), optedIn: md.optedIn, token, existingCount: count,
    recheck: async () => { const x = await countPipelines({ locationId, token: await token() }); return x.ok ? x.value : null; },
  }, ctx.demo ? { env: {} } : {});
  return answer(r, words);
}

// ---------------- 3. reply target as a custom value ----------------

async function slaRoute(ctx: Ctx, h: SafeWritesHelpers, locationId: string, b: Record<string, unknown>): Promise<Response> {
  const [md, writeOk, readOk, target] = await Promise.all([mode(ctx, locationId), granted(ctx, CUSTOM_VALUE_WRITE_SCOPE), granted(ctx, CUSTOM_VALUE_READ_SCOPE), replyTarget(ctx, locationId).catch(() => 15)]);
  const c = checkSlaMinutes(target);
  if (!c.ok) return json({ ok: false, blocked: true, message: c.text }, 422);
  const words = { done: "Saved. Your own workflows can now read this reply target.", already: "Your CRM already holds this reply target.", unchanged: "Your CRM already holds this reply target. Nothing was changed.", permission: permissionText("save a value in your CRM") };
  const token = () => h.locationToken(locationId);
  if (ctx.demo) return doing(b) ? answer({ outcome: "dry_run", line: "", reason: "account" }, words) : json({ ok: true, preview: slaPreview(c.minutes, null, "create"), mode: md, needsPermission: false });
  // What the CRM holds now. To tell "create" from "update" SubSync must read the account's custom values; without that permission it will not guess.
  if (!readOk) return json({ ok: false, needsPermission: true, message: permissionText("read your custom values") }, 403);
  const t = await token().catch(() => null);
  if (!t) return json({ ok: false, message: "SubSync could not reach this account just now. Try again in a minute." }, 502);
  const cur = await findSlaValue({ locationId, token: t });
  if (!cur.ok) return cur.reason === "needs_permission" ? json({ ok: false, needsPermission: true, message: permissionText("read your custom values") }, 403) : json({ ok: false, message: "SubSync could not read your CRM just now. Try again in a minute." }, 502);
  const plan = planCustomValue(cur.value, c.minutes);
  if (!doing(b)) return json({ ok: true, preview: slaPreview(c.minutes, cur.value?.value ?? null, plan), mode: md, needsPermission: !writeOk });
  if (b.confirmed !== true) return json({ ok: false, message: "Confirm to continue." }, 409);
  if (md.live && !writeOk) return json({ ok: false, needsPermission: true, message: words.permission }, 403);
  const r = await setCustomValue({
    installationId: ctx.installationId, locationId, actor: actorOf(ctx), optedIn: md.optedIn, token, minutes: c.minutes, existing: cur.value,
    recheck: async () => { const x = await findSlaValue({ locationId, token: await token() }); return x.ok ? x.value : undefined; },
  }, {});
  return answer(r, words);
}
const slaPreview = (minutes: number, was: string | null, plan: "create" | "update" | "unchanged") => ({
  title: plan === "unchanged" ? "Nothing to change" : plan === "create" ? "Save your reply target in your CRM" : "Update your reply target in your CRM",
  lines: plan === "unchanged"
    ? [`The custom value ${SLA_VALUE_NAME} already says ${minutes} minutes.`]
    : [`Custom value: ${SLA_VALUE_NAME}`, plan === "update" && was ? `Now ${was}, will be ${minutes} (minutes).` : `Will be ${minutes} (minutes), the reply target SubSync uses for this account.`, "Your own workflows can read it. Nothing else in your CRM changes."],
  canConfirm: plan !== "unchanged",
});

// ---------------- 4. tasks ----------------

type LiveTask = { title: string; completed: boolean };
async function readTask(token: string, contactId: string, taskId: string): Promise<{ ok: true; task: LiveTask } | { ok: false; status: number }> {
  const res = await ghlFetch(`${GHL_API}/contacts/${encodeURIComponent(contactId)}/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${token}`, Version: VERSION, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) return { ok: false, status: res.status };
  const j = (await res.json().catch(() => ({}))) as { task?: { title?: unknown; completed?: unknown }; title?: unknown; completed?: unknown };
  const t = j.task ?? j;
  return { ok: true, task: { title: typeof t.title === "string" ? t.title.slice(0, 200) : "Task", completed: t.completed === true } };
}

/** SubSync made this task: it is in SubSync's own record of tasks it created (call results, call action items). Scoped to this installation and this account. */
export async function ourTaskIds(installationId: string, locationId: string, taskIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (taskIds.length === 0) return out;
  const db = sql();
  const a = await db`select task_id from contact_writes where installation_id = ${installationId} and location_id = ${locationId} and task_id = any(${taskIds}::text[]) and status <> 'undone'`.catch(() => []);
  for (const r of a) out.add(r.task_id as string);
  const b = await db`select ghl_task_id from mn_tasks where installation_id = ${installationId} and location_id = ${locationId} and ghl_task_id = any(${taskIds}::text[]) and status <> 'undone'`.catch(() => []);
  for (const r of b) out.add(r.ghl_task_id as string);
  return out;
}
export async function taskIsOurs(installationId: string, locationId: string, taskId: string): Promise<boolean> {
  return (await ourTaskIds(installationId, locationId, [taskId])).has(taskId);
}

async function taskRoute(ctx: Ctx, h: SafeWritesHelpers, locationId: string, b: Record<string, unknown>): Promise<Response> {
  const contactId = typeof b.contactId === "string" && ID.test(b.contactId) ? b.contactId : null;
  const taskId = typeof b.taskId === "string" && ID.test(b.taskId) ? b.taskId : null;
  const op = b.op === "complete" || b.op === "delete" ? b.op : null;
  if (!contactId || !taskId || !op) return json({ error: "Choose the task" }, 400);
  if (op === "delete" && !isAdminSide(ctx)) return json({ error: "Ask your administrator to delete tasks." }, 403);
  // The contact must be one SubSync holds for THIS account (a contact of another account is "not found").
  const [c] = await sql()`select 1 ok from cached_contacts where installation_id = ${ctx.installationId} and location_id = ${locationId} and contact_id = ${contactId} limit 1`;
  if (!c) return json({ error: "That task is not available" }, 404);
  const [md, perm] = await Promise.all([mode(ctx, locationId), granted(ctx, TASK_WRITE_SCOPE)]);
  const words = { done: op === "complete" ? "Marked done." : "Task deleted.", already: "That task was already done.", permission: permissionText("change tasks") };
  if (ctx.demo) return doing(b) ? answer({ outcome: "dry_run", line: "", reason: "account" }, words) : json({ ok: true, preview: taskPreview(op, "this task", false), mode: md, needsPermission: false });
  const token = () => h.locationToken(locationId);
  const t = await token().catch(() => null);
  if (!t) return json({ ok: false, message: "SubSync could not reach this account just now. Try again in a minute." }, 502);
  const live = await readTask(t, contactId, taskId);
  if (!live.ok) return live.status === 401 || live.status === 403 ? json({ ok: false, needsPermission: true, message: permissionText("read tasks") }, 403) : live.status === 404 ? json({ ok: false, message: "That task is not in your CRM any more." }, 404) : json({ ok: false, message: failureText(live.status), retry: true }, 502);
  const ours = op === "delete" ? await taskIsOurs(ctx.installationId, locationId, taskId) : false;
  if (op === "complete" && live.task.completed) return json({ ok: true, unchanged: true, message: words.already });
  if (!doing(b)) return json({ ok: true, preview: taskPreview(op, live.task.title, ours), mode: md, needsPermission: !perm });
  if (b.confirmed !== true) return json({ ok: false, message: "Confirm to continue." }, 409);
  if (md.live && !perm) return json({ ok: false, needsPermission: true, message: words.permission }, 403);
  const base = { installationId: ctx.installationId, locationId, actor: actorOf(ctx), optedIn: md.optedIn, token, contactId, taskId };
  const r = op === "complete"
    ? await completeTask(base, {})
    : await deleteTask({ ...base, title: live.task.title, confirmText: typeof b.confirmText === "string" ? b.confirmText : "", ours }, {});
  return answer(r, words);
}
const taskPreview = (op: "complete" | "delete", title: string, ours: boolean) => op === "complete"
  ? { title: "Mark this task done", lines: [`Task: "${title}"`, "It is marked done in your CRM. Nothing else changes."], canConfirm: true, typeToConfirm: null as string | null }
  : { title: "Delete this task", lines: ours ? [`Task: "${title}"`, "SubSync created this task. Deleting it cannot be undone."] : [`Task: "${title}"`, "SubSync did not create this task, so it will not delete it. Delete it in your CRM."], canConfirm: ours, typeToConfirm: ours ? title : null };
