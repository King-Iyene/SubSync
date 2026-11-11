import { randomUUID } from "node:crypto";
import { sql } from "../db";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { installationHasScope } from "../analytics/cleanup-queries";
import {
  assignedBatch, contactFacts, createSnooze, hiddenPage, hiddenSummary, loadHideSettings, logActions, markNotALead, releaseSnoozes, saveHideSettings, waitingConversationsOf,
  type ActionLogRow,
} from "../analytics/unanswered-actions-queries";
import {
  BATCH_CAPS, claimBlockers, clearConfirmed, dryRunWords, HIDE_REASON_WORDS, isSnoozeDuration, isSnoozeReason, planAssign, planClear, protectionBlockers, snoozeUntil,
  type ClearItem, type HideReason,
} from "../analytics/unanswered-actions";
import { deleteConversation, DELETE_CONVERSATION_SCOPE } from "../ghl/unanswered-gateway";
import { failureText, planAction, runAction, type Action, type RunResult, type Target } from "../ghl/workbench";
import { refreshLead } from "../live/live-route";
import { isLive } from "../live-flags";
import type { Feature } from "../entitlements";
import { accountMembers } from "./workbench-routes";
import { handleUnansweredOutcome } from "./unanswered-routes";
import { json, type AuthContext } from "./auth";

// The Unanswered messages ACTIONS (round 3, slice B), under /api/app/inbox/act/<part> (the one catch-all route, already guarded by the plan and by access.ts):
//   GET  hidden    the "N hidden, show" counts and one page of the hidden people        flag inbox_hide_noise / inbox_snooze
//   PUT  settings  what is hidden by default (administrators)                            inbox_hide_noise
//   GET  team      the account's team, for the owner picker                              inbox_assign / inbox_claim
//   POST snooze | unsnooze   set aside / bring back, SubSync only, no CRM write           inbox_snooze
//   POST claim     a person takes an ownerless lead (CRM write through the gateway)      inbox_claim
//   POST assign    one lead or a batch, one account, up to BATCH_CAPS.assign             inbox_assign
//   POST undo      puts the owners of a batch back                                       inbox_assign
//   POST note      an internal note through the gateway                                  inbox_note
//   POST outcome   replied, booked, not a lead, needs follow-up (SubSync only)           inbox_outcome_ui
//   POST clear     delete chosen conversations: protected people refused, typed count    inbox_clear_junk
// Who is asking and which accounts they may read come from the verified session (`ctx`, `h.allowed`), never from the request. A location id in the body only has to be one of those
// accounts; every conversation and contact is then re-read from SubSync's copy of THAT account. Every CRM write goes through runAction (workbench.ts) or deleteConversation
// (unanswered-gateway.ts): preview first, dry run unless WRITE_GHL_LIVE and the account opt-in, one audit line per write. Nothing here sends a message.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type ActionHelpers = {
  allowed: () => Promise<string[] | null>;
  links: () => Promise<ReturnType<typeof import("../links").deepLinks>>;
  targets: () => Promise<{ slaHours: number; targetMinutes: number }>;
  locationToken: (locationId: string) => Promise<string>;
};

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const int = (v: string | null, d: number) => { const n = Number(v); return v !== null && Number.isFinite(n) ? Math.floor(n) : d; };
const on = (ctx: Ctx, f: Feature) => ctx.entitlements.features[f] === true && !ctx.entitlements.locked.includes(f);
const off = () => json({ error: "This is not switched on for your account" }, 404);
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;
const isAdminSide = (ctx: Ctx) => ctx.kind !== "client" || ctx.session.role === "admin";
const ownerSide = (ctx: Ctx) => ctx.kind !== "client";
/** A client's staff act only on conversations assigned to them (an ownerless one only to claim it); administrators and the agency act on any in their accounts. */
const mayTouch = (ctx: Ctx, assignedTo: string | null, claiming = false) => isAdminSide(ctx) || (claiming ? assignedTo === null : assignedTo === ctx.session.userId);

const mode = async (ctx: Ctx, locationId: string) => {
  const master = !ctx.demo && isLive("WRITE_GHL_LIVE");
  const optedIn = ctx.demo ? false : await writeEnabledFor(ctx.installationId, locationId);
  return { masterOn: master, optedIn, live: master && optedIn, demo: ctx.demo === true };
};

/** Adds the white-label links (the conversation, the contact) to rows that name an account and a conversation. */
function withLinks<T extends { locationId: string; conversationId: string; contactId: string | null }>(rows: T[], links: Awaited<ReturnType<ActionHelpers["links"]>>) {
  return rows.map((r) => ({ ...r, url: links.conversation(r.locationId, r.conversationId), contactUrl: r.contactId ? links.contact(r.locationId, r.contactId) : links.conversation(r.locationId, r.conversationId) }));
}

async function readBody(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const b = await ctx.request.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
}
const idList = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const out = [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))];
  return out.length === v.length ? out : null;
};

/** The account must be one the caller may read. Anything else is "not found", exactly like an account that does not exist. */
async function accountOf(h: ActionHelpers, locationId: unknown): Promise<string | null> {
  if (typeof locationId !== "string" || !ID.test(locationId)) return null;
  const allowed = await h.allowed();
  return allowed && !allowed.includes(locationId) ? null : locationId;
}

const SIZES = { snooze: 50 };

export async function handleUnansweredActions(ctx: Ctx, h: ActionHelpers): Promise<Response> {
  const part = ctx.segments[2];
  const m = ctx.request.method;
  if (m === "GET" && part === "caps") return capsRoute(ctx);
  if (m === "GET" && part === "hidden") return hiddenRoute(ctx, h);
  if (m === "GET" && part === "team") return teamRoute(ctx, h);
  if (m === "PUT" && part === "settings") return settingsRoute(ctx);
  if (m === "POST" && part === "snooze") return snoozeRoute(ctx, h, true);
  if (m === "POST" && part === "unsnooze") return snoozeRoute(ctx, h, false);
  if (m === "POST" && part === "claim") return claimRoute(ctx, h);
  if (m === "POST" && part === "assign") return assignRoute(ctx, h);
  if (m === "POST" && part === "undo") return undoRoute(ctx, h);
  if (m === "POST" && part === "note") return noteRoute(ctx, h);
  if (m === "POST" && part === "outcome") return on(ctx, "inbox_outcome_ui") ? handleUnansweredOutcome(ctx, { allowed: h.allowed }) : off();
  if (m === "POST" && part === "clear") return clearRoute(ctx, h);
  return json({ error: "Unknown action" }, 404);
}

// ---------------- what this person may do (the screen shows only these buttons; the server still checks every request) ----------------

function capsRoute(ctx: Ctx): Response {
  return json({
    openLead: on(ctx, "inbox_open_lead"), claim: on(ctx, "inbox_claim"), assign: on(ctx, "inbox_assign") && isAdminSide(ctx), note: on(ctx, "inbox_note"),
    outcome: on(ctx, "inbox_outcome_ui"), clearJunk: on(ctx, "inbox_clear_junk") && ownerSide(ctx), snooze: on(ctx, "inbox_snooze"), hide: on(ctx, "inbox_hide_noise"),
    canChangeHiding: isAdminSide(ctx), me: ctx.session.userId ?? null, caps: { assign: BATCH_CAPS.assign, clear: BATCH_CAPS.clear },
  });
}

// ---------------- hidden people ----------------

async function hiddenRoute(ctx: Ctx, h: ActionHelpers): Promise<Response> {
  if (!on(ctx, "inbox_hide_noise") && !on(ctx, "inbox_snooze")) return off();
  const sp = ctx.url.searchParams;
  const reasonP = sp.get("reason");
  const reasons: HideReason[] = ["snoozed", "not_a_lead", "internal", "automatic"];
  if (reasonP && !(reasons as string[]).includes(reasonP)) return json({ error: "Unknown reason" }, 400);
  const account = sp.get("account");
  let allowed = await h.allowed();
  if (account) {
    if (!ID.test(account) || (allowed && !allowed.includes(account))) return json({ error: "That account is not available" }, 404);
    allowed = [account];
  }
  const { slaHours } = await h.targets();
  const settings = await loadHideSettings(ctx.installationId);
  // Snoozes are always a reason to hide; the three default hides follow the saved choice, and only while hiding is switched on.
  const eff = on(ctx, "inbox_hide_noise") ? settings : { notALead: false, internal: false, automatic: false };
  const base = { installationId: ctx.installationId, allowed, now: Date.now(), slaHours };
  const summary = await hiddenSummary(base, eff);
  const wantRows = sp.get("rows") !== "0";
  const links = await h.links();
  const page = wantRows ? await hiddenPage({ ...base, reason: (reasonP as HideReason | null) ?? null, page: int(sp.get("page"), 0), size: int(sp.get("size"), 25) }, eff) : null;
  // A client's staff never see other people's customers: they get the counts only.
  const seeRows = ctx.kind !== "client" || ctx.session.role === "admin";
  return json({
    settings: eff, summary, words: HIDE_REASON_WORDS, canChange: isAdminSide(ctx),
    page: page && seeRows ? { ...page, rows: withLinks(page.rows, links) } : null,
  });
}

async function settingsRoute(ctx: Ctx): Promise<Response> {
  if (!on(ctx, "inbox_hide_noise")) return off();
  if (!isAdminSide(ctx)) return json({ error: "Ask your administrator to change this" }, 403);
  const b = await readBody(ctx);
  if (!b || typeof b.notALead !== "boolean" || typeof b.internal !== "boolean" || typeof b.automatic !== "boolean") return json({ error: "Choose on or off for each" }, 400);
  await saveHideSettings(ctx.installationId, { notALead: b.notALead, internal: b.internal, automatic: b.automatic }, ctx.session.userId ?? null);
  return json({ ok: true, settings: { notALead: b.notALead, internal: b.internal, automatic: b.automatic } });
}

async function teamRoute(ctx: Ctx, h: ActionHelpers): Promise<Response> {
  if (!on(ctx, "inbox_assign") && !on(ctx, "inbox_claim")) return off();
  const locationId = await accountOf(h, ctx.url.searchParams.get("locationId"));
  if (!locationId) return json({ error: "That account is not available" }, 404);
  const members = await accountMembers(ctx, locationId);
  const needsPermission = members.length === 0 && !(await installationHasScope(ctx.installationId, "users.readonly"));
  return json({ members, needsPermission, me: ctx.session.userId ?? null });
}

// ---------------- snooze ----------------

async function snoozeRoute(ctx: Ctx, h: ActionHelpers, set: boolean): Promise<Response> {
  if (!on(ctx, "inbox_snooze")) return off();
  const b = await readBody(ctx);
  const locationId = await accountOf(h, b?.locationId);
  const convIds = idList(b?.conversationIds, SIZES.snooze);
  if (!b || !locationId || !convIds) return json({ error: "Choose the conversations to set aside" }, 400);
  const by = ctx.session.userId;
  if (!by) return json({ error: "Sign in again first" }, 401);
  const convs = (await waitingConversationsOf(ctx.installationId, locationId, convIds)).filter((c) => mayTouch(ctx, c.assignedTo));
  if (convs.length === 0) return json({ error: "Those conversations are not available in your account view" }, 404);
  if (!set) {
    const n = await releaseSnoozes({ installationId: ctx.installationId, locationId, conversationIds: convs.map((c) => c.conversationId), by });
    return json({ ok: true, released: n });
  }
  if (!isSnoozeReason(b.reason) || !isSnoozeDuration(b.duration)) return json({ error: "Choose a reason and how long" }, 400);
  const now = Date.now();
  for (const c of convs) await createSnooze({ installationId: ctx.installationId, locationId, conversationId: c.conversationId, contactId: c.contactId, reason: b.reason, until: snoozeUntil(b.duration, now, c.timeZone), by });
  return json({ ok: true, snoozed: convs.length, until: snoozeUntil(b.duration, now, convs[0].timeZone), message: "Set aside in SubSync. Nothing changed in your CRM." });
}

// ---------------- shared: run one workbench action and say what happened ----------------

type Item = { conversationId: string | null; contactId: string; name: string };

function targetOf(locationId: string, contactId: string, name: string): Target {
  return { locationId, contactId, name, dnd: false, phone: null, email: null, timeZone: null };
}

/** The words and the status for one RunResult. Mirrors the Lead panel's own answers so both screens say the same thing. */
export function describeRun(res: RunResult): { status: number; body: Record<string, unknown> } {
  switch (res.outcome) {
    case "blocked": return { status: 422, body: { ok: false, blocked: true, blockers: res.blockers } };
    case "needs_ack": return { status: 409, body: { ok: false, needsAck: true, warnings: res.warnings } };
    case "needs_confirm": return { status: 409, body: { ok: false, message: "Confirm to continue." } };
    case "rate_limited": return { status: 429, body: { ok: false, message: `Slow down a little: try again in ${res.retryInSeconds} seconds.`, retryInSeconds: res.retryInSeconds } };
    case "needs_permission": return { status: 403, body: { ok: false, needsPermission: true, message: "Needs permission: reconnect SubSync so it may make this change. Nothing was changed." } };
    case "failed": return { status: 502, body: { ok: false, message: failureText(res.status), retry: true } };
    case "dry_run": return { status: 200, body: { ok: true, dryRun: true, reason: res.reason, summary: res.summary, message: `${dryRunWords(res.reason)} Here is what would have happened.` } };
    case "done": return { status: 200, body: { ok: true, done: true, summary: res.summary } };
  }
}

async function runOwner(ctx: Ctx, h: ActionHelpers, locationId: string, it: Item, ownerId: string, optedIn: boolean): Promise<RunResult> {
  const action: Action = { kind: "owner", userId: ownerId };
  const res = await runAction(
    { installationId: ctx.installationId, actor: actorOf(ctx), target: targetOf(locationId, it.contactId, it.name), action, optedIn, confirmed: true, ack: [], token: () => h.locationToken(locationId) },
    ctx.demo ? { env: {} } : {},
  );
  if (res.outcome === "done" && !ctx.demo) await refreshLead(ctx.installationId, await h.locationToken(locationId), locationId, it.contactId).catch(() => false);
  return res;
}

const resultWord = (r: RunResult) => (r.outcome === "dry_run" ? "dry_run" : r.outcome === "done" ? "done" : r.outcome);

// ---------------- claim ----------------

async function claimRoute(ctx: Ctx, h: ActionHelpers): Promise<Response> {
  if (!on(ctx, "inbox_claim")) return off();
  const b = await readBody(ctx);
  const locationId = await accountOf(h, b?.locationId);
  const convIds = idList(b?.conversationId ? [b.conversationId] : null, 1);
  if (!b || !locationId || !convIds) return json({ error: "Choose a conversation" }, 400);
  const me = ctx.session.userId ?? null;
  const [conv] = await waitingConversationsOf(ctx.installationId, locationId, convIds);
  if (!conv || !conv.contactId) return json({ error: "That lead is not available in your account view" }, 404);
  const members = await accountMembers(ctx, locationId);
  const blockers = claimBlockers({ currentOwner: conv.assignedTo, me, members });
  const md = await mode(ctx, locationId);
  if (b.step !== "do") return json({ ok: true, mode: md, plan: { summary: `Make ${conv.name} yours`, blockers, warnings: [], reversible: true, fields: ["assignedTo"] } });
  if (blockers.length) return json({ ok: false, blocked: true, blockers }, 422);
  const batchId = randomUUID();
  const res = await runOwner(ctx, h, locationId, { conversationId: conv.conversationId, contactId: conv.contactId, name: conv.name }, me as string, md.optedIn);
  await logActions(ctx.installationId, [{ locationId, batchId, action: "claim", conversationId: conv.conversationId, contactId: conv.contactId, beforeOwner: conv.assignedTo, afterOwner: me, result: resultWord(res), actor: me }]);
  const d = describeRun(res);
  return json({ ...d.body, batchId }, d.status);
}

// ---------------- assign (one or a batch) ----------------

async function assignRoute(ctx: Ctx, h: ActionHelpers): Promise<Response> {
  if (!on(ctx, "inbox_assign")) return off();
  if (!isAdminSide(ctx)) return json({ error: "Ask your administrator to change who owns a lead" }, 403);
  const b = await readBody(ctx);
  const locationId = await accountOf(h, b?.locationId);
  const convIds = idList(b?.conversationIds, BATCH_CAPS.assign * 3);
  if (!b || !locationId || !convIds || typeof b.ownerId !== "string" || !ID.test(b.ownerId)) return json({ error: "Choose the people and the owner" }, 400);
  const convs = (await waitingConversationsOf(ctx.installationId, locationId, convIds)).filter((c) => c.contactId);
  const facts = await contactFacts(ctx.installationId, locationId, convs.map((c) => c.contactId as string));
  const members = await accountMembers(ctx, locationId);
  const plan = planAssign(convs.map((c) => ({ contactId: c.contactId as string, name: facts.get(c.contactId as string)?.name ?? c.name, currentOwner: facts.get(c.contactId as string)?.owner ?? c.assignedTo })), b.ownerId, members);
  const md = await mode(ctx, locationId);
  const ownerName = members.find((x) => x.id === b.ownerId)?.name ?? null;
  if (b.step !== "do") {
    // The same checks the Lead panel runs for one owner change, run here for the first person so a refusal shows before anything is sent.
    const check = plan.change[0] ? planAction({ kind: "owner", userId: b.ownerId }, targetOf(locationId, plan.change[0].contactId, plan.change[0].name)) : null;
    return json({
      ok: true, mode: md, owner: ownerName, cap: BATCH_CAPS.assign,
      plan: { blockers: [...plan.blockers, ...(check?.blockers ?? [])], change: plan.change.map((i) => ({ name: i.name, from: members.find((x) => x.id === i.currentOwner)?.name ?? (i.currentOwner ? "Someone else" : "Nobody") })), same: plan.same.length, overCap: plan.overCap, reversible: true,
        undoNote: "SubSync remembers the owner before, so this batch can be put back from the next screen." },
    });
  }
  if (plan.blockers.length) return json({ ok: false, blocked: true, blockers: plan.blockers }, 422);
  const batchId = randomUUID();
  const log: ActionLogRow[] = [];
  let done = 0, dry = 0, failed = 0, permission = false;
  for (const it of plan.change) {
    const res = await runOwner(ctx, h, locationId, { conversationId: convs.find((c) => c.contactId === it.contactId)?.conversationId ?? null, contactId: it.contactId, name: it.name }, b.ownerId, md.optedIn);
    log.push({ locationId, batchId, action: "assign", conversationId: convs.find((c) => c.contactId === it.contactId)?.conversationId ?? null, contactId: it.contactId, beforeOwner: it.currentOwner, afterOwner: b.ownerId, result: resultWord(res), actor: ctx.session.userId ?? null });
    if (res.outcome === "done") done++; else if (res.outcome === "dry_run") dry++; else failed++;
    if (res.outcome === "needs_permission") { permission = true; break; }
    if (res.outcome === "rate_limited") break;
  }
  await logActions(ctx.installationId, log);
  const message = permission ? "Needs permission: reconnect SubSync so it may change owners. Nothing was changed." : dry ? `${dryRunWords(md.optedIn ? "switch" : "account")} ${dry} change${dry === 1 ? "" : "s"} checked.` : `${done} lead${done === 1 ? "" : "s"} now belong${done === 1 ? "s" : ""} to ${ownerName ?? "that person"}.`;
  return json({ ok: !permission && failed === 0, batchId, done, dryRun: dry, failed, needsPermission: permission, message, undoable: done > 0 }, permission ? 403 : 200);
}

async function undoRoute(ctx: Ctx, h: ActionHelpers): Promise<Response> {
  if (!on(ctx, "inbox_assign") && !on(ctx, "inbox_claim")) return off();
  if (!isAdminSide(ctx)) return json({ error: "Ask your administrator to put the owners back" }, 403);
  const b = await readBody(ctx);
  if (!b || typeof b.batchId !== "string" || !/^[0-9a-f-]{36}$/i.test(b.batchId)) return json({ error: "Unknown batch" }, 400);
  const allowed = await h.allowed();
  const rows = (await assignedBatch(ctx.installationId, b.batchId)).filter((r) => !allowed || allowed.includes(r.locationId));
  if (rows.length === 0) return json({ error: "Nothing to put back" }, 404);
  if (b.step !== "do") return json({ ok: true, plan: { count: rows.length, summary: `Put ${rows.length} lead${rows.length === 1 ? "" : "s"} back with the owner they had before` } });
  const batchId = randomUUID();
  const log: ActionLogRow[] = [];
  let done = 0, dry = 0, failed = 0;
  for (const r of rows) {
    const md = await mode(ctx, r.locationId);
    const f = (await contactFacts(ctx.installationId, r.locationId, [r.contactId])).get(r.contactId);
    const res = await runOwner(ctx, h, r.locationId, { conversationId: null, contactId: r.contactId, name: f?.name ?? "This person" }, r.before, md.optedIn);
    log.push({ locationId: r.locationId, batchId, action: "undo_assign", conversationId: null, contactId: r.contactId, beforeOwner: r.after, afterOwner: r.before, result: resultWord(res), actor: ctx.session.userId ?? null });
    if (res.outcome === "done") done++; else if (res.outcome === "dry_run") dry++; else failed++;
    if (res.outcome === "needs_permission" || res.outcome === "rate_limited") break;
  }
  await logActions(ctx.installationId, log);
  return json({ ok: failed === 0, done, dryRun: dry, failed, message: dry ? "Changes from SubSync are switched off, so nothing was sent." : `${done} lead${done === 1 ? "" : "s"} put back.` });
}

// ---------------- internal note ----------------

async function noteRoute(ctx: Ctx, h: ActionHelpers): Promise<Response> {
  if (!on(ctx, "inbox_note")) return off();
  const b = await readBody(ctx);
  const locationId = await accountOf(h, b?.locationId);
  if (!b || !locationId || typeof b.contactId !== "string" || !ID.test(b.contactId) || typeof b.text !== "string") return json({ error: "Choose the person and write the note" }, 400);
  const facts = (await contactFacts(ctx.installationId, locationId, [b.contactId])).get(b.contactId);
  if (!facts) return json({ error: "Contact not found" }, 404);
  if (!mayTouch(ctx, facts.owner, true)) return json({ error: "You can only add a note to a lead that is yours or has no owner" }, 403);
  const action: Action = { kind: "note", text: b.text };
  const md = await mode(ctx, locationId);
  if (b.step !== "do") {
    const plan = planAction(action, targetOf(locationId, b.contactId, facts.name));
    return json({ ok: true, mode: md, plan: { summary: plan.summary, blockers: plan.blockers, warnings: plan.warnings, reversible: plan.reversible, fields: plan.fields } });
  }
  // runAction records the note's id in the shared write log (crm_writes) when it is live, so the sync, the reply measures and the webhook echo all skip it (principle 14).
  const res = await runAction(
    { installationId: ctx.installationId, actor: actorOf(ctx), target: targetOf(locationId, b.contactId, facts.name), action, optedIn: md.optedIn, confirmed: b.confirm === true, ack: [], token: () => h.locationToken(locationId) },
    ctx.demo ? { env: {} } : {},
  );
  await logActions(ctx.installationId, [{ locationId, batchId: randomUUID(), action: "note", conversationId: null, contactId: b.contactId, beforeOwner: null, afterOwner: null, result: resultWord(res), actor: ctx.session.userId ?? null }]);
  const d = describeRun(res);
  return json(d.body, d.status);
}

// ---------------- clear junk (narrow delete) ----------------

async function clearRoute(ctx: Ctx, h: ActionHelpers): Promise<Response> {
  if (!on(ctx, "inbox_clear_junk")) return off();
  if (!ownerSide(ctx)) return json({ error: "Ask your administrator to clear this in your CRM." }, 403);
  const b = await readBody(ctx);
  const locationId = await accountOf(h, b?.locationId);
  const convIds = idList(b?.conversationIds, BATCH_CAPS.clear * 3);
  if (!b || !locationId || !convIds) return json({ error: "Choose the conversations to clear" }, 400);
  const convs = await waitingConversationsOf(ctx.installationId, locationId, convIds);
  if (convs.length === 0) return json({ error: "Those conversations are not available in your account view" }, 404);
  const facts = await contactFacts(ctx.installationId, locationId, convs.map((c) => c.contactId).filter((x): x is string => !!x));
  const items: ClearItem[] = convs.map((c) => {
    const f = c.contactId ? facts.get(c.contactId) : undefined;
    // A conversation whose contact SubSync does not have cannot be proven safe, so it is refused.
    const blockers = f ? protectionBlockers(f) : [{ id: "unknown", text: `${c.name} is not in SubSync's copy of this account, so SubSync cannot check whether it is safe to clear.` }];
    return { conversationId: c.conversationId, contactId: c.contactId, name: f?.name ?? c.name, blockers };
  });
  const plan = planClear(items);
  const md = await mode(ctx, locationId);
  const hasScope = ctx.demo ? true : await installationHasScope(ctx.installationId, DELETE_CONVERSATION_SCOPE);
  if (b.step !== "do") {
    return json({
      ok: true, mode: md, cap: BATCH_CAPS.clear, needsPermission: !hasScope,
      plan: {
        allowed: plan.allowed.map((i) => ({ conversationId: i.conversationId, name: i.name })), blocked: plan.blocked.map((i) => ({ conversationId: i.conversationId, name: i.name, reasons: i.blockers.map((x) => x.text) })),
        overCap: plan.overCap, phrase: plan.phrase, reversible: false,
        summary: "Delete these conversations in your CRM. The people stay in your CRM. This cannot be undone.",
      },
    });
  }
  if (plan.allowed.length === 0) return json({ ok: false, blocked: true, blockers: [{ id: "none", text: "Nothing here can be cleared." }] }, 422);
  if (!clearConfirmed(typeof b.typed === "string" ? b.typed : "", plan.allowed.length)) return json({ ok: false, blocked: true, blockers: [{ id: "confirm", text: `Type "${plan.phrase}" exactly to confirm.` }] }, 422);
  if (md.live && !hasScope) return json({ ok: false, needsPermission: true, message: "Needs permission: reconnect SubSync so it may clear conversations. Nothing was changed." }, 403);
  const batchId = randomUUID();
  const log: ActionLogRow[] = [];
  const cleared: ClearItem[] = [];
  let done = 0, dry = 0, failed = 0, permission = false;
  for (const it of plan.allowed) {
    const r = await deleteConversation({ installationId: ctx.installationId, locationId, conversationId: it.conversationId, contactId: it.contactId, actor: actorOf(ctx), optedIn: md.optedIn, token: () => h.locationToken(locationId) }, ctx.demo ? { env: {} } : {});
    log.push({ locationId, batchId, action: "clear_junk", conversationId: it.conversationId, contactId: it.contactId, beforeOwner: null, afterOwner: null, result: r.outcome, actor: ctx.session.userId ?? null });
    if (r.outcome === "done") { done++; cleared.push(it); } else if (r.outcome === "dry_run") dry++; else failed++;
    if (r.outcome === "needs_permission") { permission = true; break; }
    if (r.outcome === "rate_limited") break;
  }
  await logActions(ctx.installationId, log);
  if (cleared.length) {
    // SubSync's own copy drops the conversations now (the next sync would too), and the people are marked "not a lead" so they do not come back in the list.
    await sql()`delete from cached_conversations where installation_id = ${ctx.installationId} and location_id = ${locationId} and conversation_id = any(${cleared.map((c) => c.conversationId)}::text[])`;
    await markNotALead(ctx.installationId, cleared.map((c) => ({ locationId, conversationId: c.conversationId, contactId: c.contactId })), ctx.session.userId ?? "subsync").catch(() => undefined);
  }
  const message = permission ? "Needs permission: reconnect SubSync so it may clear conversations. Nothing was changed." : dry ? `${dryRunWords(md.optedIn ? "switch" : "account")} ${dry} conversation${dry === 1 ? "" : "s"} checked.` : `${done} conversation${done === 1 ? "" : "s"} cleared.`;
  return json({ ok: !permission && failed === 0, batchId, done, dryRun: dry, failed, needsPermission: permission, message }, permission ? 403 : 200);
}
