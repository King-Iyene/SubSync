import { randomUUID } from "node:crypto";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { installationHasScope } from "../analytics/cleanup-queries";
import {
  DEAL_BATCH_CAPS, LOST_REASONS, LOST_REASON_WORDS, UNDO_MINUTES, beforeOf, bulkDeleteConfirmed, inversePatch, isId, isLostReason, nextStageOf, parseAction, planAction, planBulk, statusWord, unclogSuggestions,
  type BulkKind, type DealAction, type DealFacts, type DealPatch, type DealPlan, type DealStatus, type PipelineRef,
} from "../analytics/pipeline-actions";
import { applyLocal, batchRows, dropLocal, loadDeals, logDeal, panelFacts, pipelinesOf, timeline, zoneOf, type DealLogRow } from "../analytics/pipeline-actions-queries";
import { dryRunWords } from "../analytics/unanswered-actions";
import { DEAL_WRITE_SCOPE, writeDeal, type DealWriteResult } from "../ghl/pipeline-gateway";
import { failureText, runAction, type Action, type Target } from "../ghl/workbench";
import { isLive } from "../live-flags";
import type { Feature } from "../entitlements";
import { accountMembers } from "./workbench-routes";
import { json, type AuthContext } from "./auth";

// The Pipeline ACTIONS endpoints (slice PB), under /api/app/pipeline3/act/<part>:
//   GET  act/caps     what this person may do (so a screen shows only those buttons)                                                                       pl_actions
//   GET  act/meta     the account's team, pipelines with stages and lost reasons (for the bulk bar and the pickers)                                         pl_actions
//   GET  act/panel    one deal's panel: details, owner, source, value, dwell against the stage's own median, linked appointments, the change timeline, one-tap fixes   pl_actions
//   POST act/apply    one change (stage, owner, value, won/lost with a reason, rename, note, task, delete): step "preview" then step "do"                  pl_actions / pl_delete
//   POST act/bulk     move, give, close, task or delete several (one account at a time, capped, a typed count for delete)                                   pl_bulk / pl_delete
//   POST act/undo     put a recent change back (30 minutes)                                                                                                 pl_actions
// Who is asking and which accounts they may read come from the verified session (`ctx`, `h.allowed`), never from the request. A location id in the body only has to be one of those
// accounts; every deal is then re-read from SubSync's copy of THAT account. Every CRM write goes through writeDeal (pipeline-gateway.ts) or runAction (notes and tasks): preview first,
// a practice run unless WRITE_GHL_LIVE and the account opt-in, one audit line per write. Nothing here sends a message to a lead.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type PipelineActionHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof import("../links").deepLinks>>; locationToken: (locationId: string) => Promise<string> };

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;
const isAdminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";
/** A client's staff act only on deals assigned to them; administrators and the agency act on any in their accounts. */
const mayTouch = (ctx: Ctx, assignedTo: string | null) => isAdminSide(ctx) || assignedTo === ctx.session.userId;

const mode = async (ctx: Ctx, locationId: string) => {
  const master = !ctx.demo && isLive("WRITE_GHL_LIVE");
  const optedIn = ctx.demo ? false : await writeEnabledFor(ctx.installationId, locationId);
  return { masterOn: master, optedIn, live: master && optedIn, demo: ctx.demo === true };
};
async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
}
async function accountOf(h: PipelineActionHelpers, v: unknown): Promise<string | null> {
  if (typeof v !== "string" || !ID.test(v)) return null;
  const allowed = await h.allowed();
  return allowed && !allowed.includes(v) ? null : v;
}
const idList = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const out = [...new Set(v.filter(isId))];
  return out.length === v.length ? out : null;
};
const permissionText = "Needs permission: reconnect SubSync so it may change deals. Nothing was changed.";
const notePermissionText = "Needs permission: reconnect SubSync so it may add notes and tasks. Nothing was changed.";

export async function handlePipelineActions(ctx: Ctx, h: PipelineActionHelpers): Promise<Response> {
  const part = ctx.segments[2];
  const m = ctx.request.method;
  if (!on(ctx, "pl_actions")) return off();
  if (m === "GET" && part === "caps") return capsRoute(ctx);
  if (m === "GET" && part === "meta") return metaRoute(ctx, h);
  if (m === "GET" && part === "panel") return panelRoute(ctx, h);
  if (m === "POST" && part === "apply") return applyRoute(ctx, h);
  if (m === "POST" && part === "bulk") return bulkRoute(ctx, h);
  if (m === "POST" && part === "undo") return undoRoute(ctx, h);
  return json({ error: "Unknown action" }, 404);
}

function capsRoute(ctx: Ctx): Response {
  return json({
    edit: true, reassign: isAdminSide(ctx), del: on(ctx, "pl_delete") && isAdminSide(ctx), bulk: on(ctx, "pl_bulk"), caps: DEAL_BATCH_CAPS, undoMinutes: UNDO_MINUTES, me: ctx.session.userId ?? null,
    lostReasons: LOST_REASONS.map((id) => ({ id, label: LOST_REASON_WORDS[id] })),
  });
}

/** Everything the planner needs about one account, read once. */
async function account(ctx: Ctx, locationId: string) {
  const [members, pipelines, tz] = await Promise.all([accountMembers(ctx, locationId), pipelinesOf(ctx.installationId, locationId), zoneOf(ctx.installationId, locationId)]);
  return { members, pipelines, tz, teamIds: members.map((x) => x.id) };
}
const scopeOk = (ctx: Ctx, scope: string) => (ctx.demo ? Promise.resolve(true) : installationHasScope(ctx.installationId, scope));

/** The pickers for one account (team, pipelines and stages, lost reasons): only inside an account the caller may read. */
async function metaRoute(ctx: Ctx, h: PipelineActionHelpers): Promise<Response> {
  const locationId = await accountOf(h, ctx.url.searchParams.get("locationId"));
  if (!locationId) return json({ error: "That account is not available" }, 404);
  const ac = await account(ctx, locationId);
  return json({ team: ac.members, pipelines: ac.pipelines, lostReasons: LOST_REASONS.map((r) => ({ id: r, label: LOST_REASON_WORDS[r] })) });
}

// ---------------- the panel ----------------

async function panelRoute(ctx: Ctx, h: PipelineActionHelpers): Promise<Response> {
  const sp = ctx.url.searchParams;
  const locationId = await accountOf(h, sp.get("locationId"));
  const id = sp.get("id");
  if (!locationId || !isId(id)) return json({ error: "That deal is not available" }, 404);
  const p = await panelFacts(ctx.installationId, locationId, id);
  if (!p || !mayTouch(ctx, p.facts.assignedTo)) return json({ error: "That deal is not available" }, 404);
  const [feed, ac, md, links, hasScope, hasNoteScope] = await Promise.all([
    timeline(ctx.installationId, locationId, id, UNDO_MINUTES), account(ctx, locationId), mode(ctx, locationId), h.links(), scopeOk(ctx, DEAL_WRITE_SCOPE), scopeOk(ctx, "contacts.write"),
  ]);
  const f = p.facts;
  const nameOf = (uid: string | null) => (uid ? ac.members.find((x) => x.id === uid)?.name ?? "Team member" : "Nobody yet");
  const open = (f.status ?? "open").toLowerCase() === "open";
  const stale = open && p.dwellDays !== null && p.medianDwellDays !== null && p.dwellDays > Math.max(p.medianDwellDays * 2, p.medianDwellDays + 3);
  const suggestions = stale || (open && !f.assignedTo)
    ? unclogSuggestions(f, { now: Date.now(), me: ctx.session.userId ?? null, nextStage: nextStageOf(ac.pipelines, f.pipelineId, f.stageId), pipelineId: f.pipelineId, staleDays: stale ? p.dwellDays : null })
    : [];
  return json({
    deal: { id: f.opportunityId, locationId, locationName: p.locationName, name: f.name || f.contactName, status: f.status ?? "open", statusWord: statusWord(f.status), value: f.value, pipelineId: f.pipelineId, pipeline: f.pipelineName, stageId: f.stageId, stage: f.stageName, source: p.source, createdAt: p.createdAt, timeZone: ac.tz, lostReason: p.lostReason ? { id: p.lostReason, label: LOST_REASON_WORDS[p.lostReason as keyof typeof LOST_REASON_WORDS] ?? p.lostReason } : null },
    contact: f.contactId ? { contactId: f.contactId, name: f.contactName, phone: p.contact?.phone ?? null, email: p.contact?.email ?? null, dnd: p.contact?.dnd ?? false, url: links.contact(locationId, f.contactId), otherDeals: p.otherDeals } : null,
    owner: { id: f.assignedTo, name: nameOf(f.assignedTo) },
    dwell: { days: p.dwellDays === null ? null : Math.round(p.dwellDays * 10) / 10, medianDays: p.medianDwellDays === null ? null : Math.round(p.medianDwellDays * 10) / 10, stale },
    appointments: p.appointments, timeline: feed, suggestions,
    team: ac.members, pipelines: ac.pipelines, lostReasons: LOST_REASONS.map((r) => ({ id: r, label: LOST_REASON_WORDS[r] })),
    can: { edit: mayTouch(ctx, f.assignedTo), reassign: isAdminSide(ctx), del: on(ctx, "pl_delete") && isAdminSide(ctx) },
    mode: md, needsPermission: !hasScope, needsNotePermission: !hasNoteScope, undoMinutes: UNDO_MINUTES,
  });
}

// ---------------- one change ----------------

const logKind = (k: DealAction["kind"]): DealLogRow["action"] => (k === "delete" ? "remove" : k);
const resultWord = (r: DealWriteResult) => r.outcome;

async function writeOne(ctx: Ctx, h: PipelineActionHelpers, md: Awaited<ReturnType<typeof mode>>, f: DealFacts, plan: DealPlan) {
  const common = { installationId: ctx.installationId, locationId: f.locationId, actor: actorOf(ctx), contactId: f.contactId, opportunityId: f.opportunityId, optedIn: md.optedIn, token: () => h.locationToken(f.locationId) };
  const deps = ctx.demo ? { env: {} } : {};
  if (plan.kind === "delete") return writeDeal({ ...common, op: "delete" }, deps);
  return writeDeal({ ...common, op: "update", patch: plan.patch as DealPatch }, deps);
}

/** A note or a task on the deal's contact, through the existing workbench gateway (its own preview rules, audit line and write log). */
async function writeContactItem(ctx: Ctx, h: PipelineActionHelpers, md: Awaited<ReturnType<typeof mode>>, f: DealFacts, action: Extract<DealAction, { kind: "note" | "task" }>, tz: string | null) {
  const target: Target = { locationId: f.locationId, contactId: f.contactId as string, name: f.contactName, dnd: f.contactDnd === true, phone: null, email: null, timeZone: tz };
  const wb: Action = action.kind === "note" ? { kind: "note", text: action.text } : { kind: "task", title: action.title, dueDate: action.dueDate };
  return runAction({ installationId: ctx.installationId, actor: actorOf(ctx), target, action: wb, optedIn: md.optedIn, confirmed: true, ack: [], token: () => h.locationToken(f.locationId) }, ctx.demo ? { env: {} } : {});
}

type Outcome = { outcome: "done" | "dry_run" | "needs_permission" | "rate_limited" | "failed" | "blocked"; retryInSeconds?: number; status?: number; reason?: "switch" | "account" };
const fromWrite = (r: DealWriteResult): Outcome => ({ outcome: r.outcome, ...("retryInSeconds" in r ? { retryInSeconds: r.retryInSeconds } : {}), ...("status" in r ? { status: r.status } : {}), ...("reason" in r ? { reason: r.reason } : {}) });

function answer(r: Outcome, batchId: string, n: number, optedIn: boolean, permission = permissionText): Response {
  switch (r.outcome) {
    case "done": return json({ ok: true, done: true, batchId, undoMinutes: UNDO_MINUTES, message: n === 1 ? "Done." : `${n} changed.` });
    case "dry_run": return json({ ok: true, dryRun: true, batchId, message: `${dryRunWords(r.reason ?? (optedIn ? "switch" : "account"))} Here is what would have happened.` });
    case "needs_permission": return json({ ok: false, needsPermission: true, message: permission }, 403);
    case "rate_limited": return json({ ok: false, message: `Slow down a little: try again in ${r.retryInSeconds ?? 30} seconds.`, retryInSeconds: r.retryInSeconds }, 429);
    case "blocked": return json({ ok: false, message: "That was refused. Check the preview and try again." }, 422);
    case "failed": return json({ ok: false, message: failureText(r.status ?? 500), retry: true, optedIn }, 502);
  }
}

async function applyRoute(ctx: Ctx, h: PipelineActionHelpers): Promise<Response> {
  const b = await readBody(ctx);
  const locationId = await accountOf(h, b?.locationId);
  if (!b || !locationId || !isId(b.opportunityId)) return json({ error: "Choose the deal" }, 400);
  const parsed = parseAction(b.action);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const a = parsed.action;
  if (a.kind === "delete" && (!on(ctx, "pl_delete") || !isAdminSide(ctx))) return on(ctx, "pl_delete") ? json({ error: "Ask your administrator to delete deals." }, 403) : off();
  if (a.kind === "owner" && !isAdminSide(ctx)) return json({ error: "Ask your administrator to change the owner." }, 403);
  const [f] = await loadDeals(ctx.installationId, locationId, [b.opportunityId]);
  if (!f || !mayTouch(ctx, f.assignedTo)) return json({ error: "That deal is not available" }, 404);
  const ac = await account(ctx, locationId);
  const plan = planAction(a, f, { now: Date.now(), pipelines: ac.pipelines, teamIds: ac.teamIds.length ? ac.teamIds : null });
  const md = await mode(ctx, locationId);
  const itemKind = a.kind === "note" || a.kind === "task";
  const hasScope = await scopeOk(ctx, itemKind ? "contacts.write" : DEAL_WRITE_SCOPE);
  if (b.step !== "do") return json({ ok: true, mode: md, needsPermission: !hasScope, plan });
  if (plan.blockers.length > 0) return json({ ok: false, blocked: true, blockers: plan.blockers }, 422);
  if (!itemKind && a.kind !== "delete" && !plan.patch) return json({ ok: false, blocked: true, blockers: [{ id: "nochange", text: "Nothing would change." }] }, 422);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: itemKind ? notePermissionText : permissionText }, 403);
  const batchId = randomUUID();
  const before = a.kind === "delete" || itemKind ? {} : beforeOf(f, plan.patch as DealPatch);
  const after: Record<string, unknown> = itemKind ? { kind: a.kind } : { ...(plan.patch ?? {}) };
  let r: Outcome;
  if (a.kind === "note" || a.kind === "task") {
    const x = await writeContactItem(ctx, h, md, f, a, ac.tz);
    r = x.outcome === "done" ? { outcome: "done" } : x.outcome === "dry_run" ? { outcome: "dry_run", reason: x.reason } : x.outcome === "needs_permission" ? { outcome: "needs_permission" } : x.outcome === "rate_limited" ? { outcome: "rate_limited", retryInSeconds: x.retryInSeconds } : x.outcome === "failed" ? { outcome: "failed", status: x.status } : { outcome: "blocked" };
  } else r = fromWrite(await writeOne(ctx, h, md, f, plan));
  await logDeal(ctx.installationId, [{ locationId, batchId, action: logKind(a.kind), opportunityId: f.opportunityId, contactId: f.contactId, before, after, lostReason: plan.reason, result: r.outcome, actor: ctx.session.userId ?? null }]);
  if (r.outcome === "done" && !itemKind) {
    if (a.kind === "delete") await dropLocal(ctx.installationId, locationId, [f.opportunityId]);
    else await applyLocal(ctx.installationId, locationId, f.opportunityId, plan.patch as DealPatch, ac.pipelines);
  }
  return answer(r, batchId, 1, md.optedIn, itemKind ? notePermissionText : permissionText);
}

// ---------------- bulk ----------------

async function bulkRoute(ctx: Ctx, h: PipelineActionHelpers): Promise<Response> {
  if (!on(ctx, "pl_bulk")) return off();
  const b = await readBody(ctx);
  const locationId = await accountOf(h, b?.locationId);
  const kind = b?.kind;
  if (kind !== "stage" && kind !== "owner" && kind !== "status" && kind !== "task" && kind !== "delete") return json({ error: "Choose what to do" }, 400);
  const bk: BulkKind = kind;
  const ids = idList(b?.ids, 300);
  if (!b || !locationId || !ids) return json({ error: "Choose the deals" }, 400);
  if (bk === "delete" && !on(ctx, "pl_delete")) return off();
  if ((bk === "delete" || bk === "owner") && !isAdminSide(ctx)) return json({ error: "Ask your administrator to do this." }, 403);
  const status = (["open", "won", "lost", "abandoned"] as const).find((s) => s === b.status) as DealStatus | undefined;
  const reason = isLostReason(b.reason) ? b.reason : null;
  if (bk === "status" && !status) return json({ error: "Choose a status" }, 400);
  if (bk === "status" && (status === "lost" || status === "abandoned") && !reason) return json({ ok: false, blocked: true, blockers: [{ id: "reason", text: "Choose why they were lost." }] }, 422);
  const userId = typeof b.userId === "string" && isId(b.userId) ? b.userId : null;
  if (bk === "owner" && !userId) return json({ error: "Choose a team member" }, 400);
  const stageId = typeof b.stageId === "string" && isId(b.stageId) ? b.stageId : null, pipelineId = typeof b.pipelineId === "string" && isId(b.pipelineId) ? b.pipelineId : null;
  if (bk === "stage" && (!stageId || !pipelineId)) return json({ error: "Choose the stage" }, 400);
  const taskTitle = typeof b.title === "string" ? b.title.trim().slice(0, 200) : "";
  const due = typeof b.dueDate === "string" && Number.isFinite(Date.parse(b.dueDate)) ? new Date(Date.parse(b.dueDate)).toISOString() : null;
  if (bk === "task" && (!taskTitle || !due)) return json({ error: "Give the task a title and a due date" }, 400);
  if (bk === "task" && Date.parse(due as string) < Date.now() - 86_400_000) return json({ ok: false, blocked: true, blockers: [{ id: "past", text: "Choose a due date that is not in the past." }] }, 422);

  const facts = (await loadDeals(ctx.installationId, locationId, ids)).filter((f) => mayTouch(ctx, f.assignedTo));
  if (facts.length === 0) return json({ error: "Those deals are not available" }, 404);
  const ac = await account(ctx, locationId);
  if (bk === "owner" && !ac.teamIds.includes(userId as string)) return json({ ok: false, blocked: true, blockers: [{ id: "owner", text: "That person is not on this account's team." }] }, 422);
  if (bk === "stage" && !ac.pipelines.find((p) => p.id === pipelineId)?.stages.some((s) => s.id === stageId)) return json({ ok: false, blocked: true, blockers: [{ id: "stage", text: "That pipeline or stage is not in this account." }] }, 422);
  const plan = planBulk(bk, facts, { ...(stageId ? { stageId } : {}), ...(pipelineId ? { pipelineId } : {}), ...(userId ? { userId } : {}), ...(status ? { status } : {}) });
  const md = await mode(ctx, locationId);
  const hasScope = await scopeOk(ctx, bk === "task" ? "contacts.write" : DEAL_WRITE_SCOPE);
  if (b.step !== "do") {
    return json({
      ok: true, mode: md, needsPermission: !hasScope,
      plan: { allowed: plan.allowed.map((f) => ({ opportunityId: f.opportunityId, name: f.name || f.contactName, value: f.value, stage: f.stageName })), skipped: plan.skipped, overCap: plan.overCap, phrase: plan.phrase, reversible: bk !== "delete" && bk !== "task", cap: DEAL_BATCH_CAPS[bk], totalValue: plan.totalValue },
    });
  }
  if (plan.allowed.length === 0) return json({ ok: false, blocked: true, blockers: [{ id: "none", text: "Nothing here can be changed." }] }, 422);
  if (bk === "delete" && !bulkDeleteConfirmed(typeof b.typed === "string" ? b.typed : "", plan.allowed.length)) return json({ ok: false, blocked: true, blockers: [{ id: "confirm", text: `Type "${plan.phrase}" exactly to confirm.` }] }, 422);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: bk === "task" ? notePermissionText : permissionText }, 403);
  const batchId = randomUUID();
  const log: DealLogRow[] = []; const dropped: string[] = [];
  let done = 0, dry = 0, failed = 0, permission = false;
  for (const f of plan.allowed) {
    const patch: DealPatch | null = bk === "stage" ? { ...(pipelineId !== f.pipelineId ? { pipelineId: pipelineId as string } : {}), stageId: stageId as string } : bk === "owner" ? { assignedTo: userId as string } : bk === "status" ? { status: status as DealStatus } : null;
    let r: Outcome;
    if (bk === "task") {
      const x = await writeContactItem(ctx, h, md, f, { kind: "task", title: taskTitle, dueDate: due as string }, ac.tz);
      r = x.outcome === "done" ? { outcome: "done" } : x.outcome === "dry_run" ? { outcome: "dry_run", reason: x.reason } : x.outcome === "needs_permission" ? { outcome: "needs_permission" } : x.outcome === "rate_limited" ? { outcome: "rate_limited", retryInSeconds: x.retryInSeconds } : { outcome: "failed" };
    } else r = fromWrite(await writeOne(ctx, h, md, f, { kind: bk === "delete" ? "delete" : "status", patch } as DealPlan));
    log.push({ locationId, batchId, action: bk === "delete" ? "remove" : bk, opportunityId: f.opportunityId, contactId: f.contactId, before: patch ? beforeOf(f, patch) : {}, after: patch ?? (bk === "task" ? { kind: "task" } : {}), lostReason: bk === "status" && (status === "lost" || status === "abandoned") ? reason : null, result: r.outcome, actor: ctx.session.userId ?? null });
    if (r.outcome === "done") { done++; if (bk === "delete") dropped.push(f.opportunityId); else if (patch) await applyLocal(ctx.installationId, locationId, f.opportunityId, patch, ac.pipelines); } else if (r.outcome === "dry_run") dry++; else failed++;
    if (r.outcome === "needs_permission") { permission = true; break; }
    if (r.outcome === "rate_limited") break;
  }
  await logDeal(ctx.installationId, log);
  if (dropped.length) await dropLocal(ctx.installationId, locationId, dropped);
  const message = permission ? permissionText : dry ? `${dryRunWords(md.optedIn ? "switch" : "account")} ${dry} deal${dry === 1 ? "" : "s"} checked.` : `${done} deal${done === 1 ? "" : "s"} changed.`;
  return json({ ok: !permission && failed === 0, batchId, done, dryRun: dry, failed, needsPermission: permission, undoable: bk !== "delete" && bk !== "task" && done > 0, undoMinutes: UNDO_MINUTES, message }, permission ? 403 : 200);
}

// ---------------- undo ----------------

async function undoRoute(ctx: Ctx, h: PipelineActionHelpers): Promise<Response> {
  const b = await readBody(ctx);
  const locationId = await accountOf(h, b?.locationId);
  if (!b || !locationId || typeof b.batchId !== "string" || !/^[0-9a-f-]{36}$/.test(b.batchId)) return json({ error: "Choose the change" }, 400);
  const rows = await batchRows(ctx.installationId, locationId, b.batchId);
  const fresh = rows.filter((r) => Date.now() - Date.parse(r.at) < UNDO_MINUTES * 60_000);
  if (fresh.length === 0) return json({ ok: false, message: `This change can be put back for ${UNDO_MINUTES} minutes after it is made. That time has passed, or it was already put back.` }, 410);
  const facts = new Map((await loadDeals(ctx.installationId, locationId, fresh.map((r) => r.opportunityId))).map((f) => [f.opportunityId, f]));
  const md = await mode(ctx, locationId);
  const hasScope = await scopeOk(ctx, DEAL_WRITE_SCOPE);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: permissionText }, 403);
  const pipelines: PipelineRef[] = await pipelinesOf(ctx.installationId, locationId);
  const undoBatch = randomUUID(); const log: DealLogRow[] = [];
  let done = 0, dry = 0, failed = 0;
  for (const r of fresh) {
    const f = facts.get(r.opportunityId); const patch = inversePatch(r.action, r.before);
    if (!f || !patch || !mayTouch(ctx, f.assignedTo) || (patch.assignedTo && !isAdminSide(ctx))) { failed++; continue; }
    const res = await writeOne(ctx, h, md, f, { kind: "status", patch } as DealPlan);
    log.push({ locationId, batchId: undoBatch, action: "undo", opportunityId: f.opportunityId, contactId: f.contactId, before: { batchId: b.batchId }, after: patch, result: resultWord(res), actor: ctx.session.userId ?? null });
    if (res.outcome === "done") { done++; await applyLocal(ctx.installationId, locationId, f.opportunityId, patch, pipelines); } else if (res.outcome === "dry_run") dry++; else failed++;
  }
  await logDeal(ctx.installationId, log);
  return json({ ok: failed === 0, done, dryRun: dry, failed, message: dry ? `${dryRunWords(md.optedIn ? "switch" : "account")} Nothing was sent.` : `${done} change${done === 1 ? "" : "s"} put back.` });
}
