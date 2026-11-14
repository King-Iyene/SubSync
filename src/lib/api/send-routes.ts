import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { failureText, runAction, type Blocker, type RunResult, type Target } from "../ghl/workbench";
import {
  BULK_CAP, TURN_ON_MEANS, composerState, dndFor, dryRunMessage, fillMerge, finalText, guardSend, idemKey, parseDnd, smsSegments, textHash, type DndState, type GuardInput, type SendChannel, type SendSettings, type Who,
} from "../ghl/send-guard";
import { deleteTemplate, checkTemplate, listTemplates, loadSettings, loadUsage, parseSettings, recordSend, saveSettings, saveTemplate } from "../analytics/send-store";
import { installationHasScope } from "../analytics/cleanup-queries";
import { schemaReady, setWriteEnabled, writeEnabledFor } from "../analytics/cleanup-config";
import { isLive } from "../live-flags";
import { json, type AuthContext } from "./auth";

// Sending a text or an email from SubSync (King, 13 Nov 2026), behind the send_messages flag (default off).
// SubSync sends a message only when a person presses Send (or a schedule they set), never on its own. It never sends to a contact who asked not to be contacted.
// Every send, single or bulk, goes through processMessage: the rules (send-guard.ts), a preview of exactly what will go, an explicit confirm, the one CRM write gateway
// (runAction: WRITE_GHL_LIVE, the account's own opt-in, a re-check of the do-not-contact mark just before the request) and the record (audit log, message_sends, crm_writes so
// our own sends never change our own numbers). Nothing here ever turns a live switch on.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type SendLead = { target: Target; locationName: string | null };
export type SendDeps = { allowed: () => Promise<string[] | null>; loadLead: (locationId: string, contactId: string) => Promise<SendLead | null>; locationToken: (locationId: string) => Promise<string> };

export const SCOPE = "conversations/message.write";
export const killed = (env: Record<string, string | undefined> = process.env) => env.SEND_MESSAGES_KILL === "true";
export const sendEnabled = (ctx: AuthContext) => ctx.entitlements.features.send_messages === true && !ctx.entitlements.locked.includes("send_messages");
const ID = /^[A-Za-z0-9_-]{3,128}$/;
const actorOf = (ctx: AuthContext) => ctx.session.userName ?? ctx.session.userId ?? null;

export function whoOf(ctx: AuthContext): Who {
  const r = ctx.session.personRole;
  return { kind: ctx.kind, isOwnerOrAdmin: r === "agency_owner" || r === "agency_admin" || r === "account_admin" || (r === undefined && ctx.session.role === "admin") };
}

/** One audit line for a send: who, when, which channel, which lead, the one-way hash, the result. Never the words. */
async function auditSend(ctx: AuthContext, p: { locationId: string; contactId: string; channel: SendChannel; hash: string; result: string; dryRun: boolean }) {
  try {
    const db = sql();
    await db`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${actorOf(ctx)}, 'message.send', ${db.json({ locationId: p.locationId, contactId: p.contactId, channel: p.channel, textHash: p.hash, result: p.result, dryRun: p.dryRun } as never)})`;
  } catch { /* the message_sends row holds the same facts */ }
}

/** The contact's do-not-contact marks as the CRM holds them right now. Null when they cannot be read (the guard then stops). */
export async function liveDnd(token: string, contactId: string, fetchImpl?: typeof fetch): Promise<DndState | null> {
  try {
    const res = await ghlFetch(`${GHL_API}/contacts/${encodeURIComponent(contactId)}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" }, fetchImpl ? { fetchImpl } : {});
    if (!res.ok) return null;
    return parseDnd(await res.json().catch(() => null));
  } catch { return null; }
}

export type Prepared = { channel: SendChannel; subject: string | null; text: string; to: string; from: string; segments: number; footerAdded: boolean };

export type MessageInput = {
  locationId: string; channel: SendChannel; subject?: string; text: string; aiDraft?: boolean;
  lead: SendLead; mode: { optedIn: boolean }; settings: SendSettings; scopeGranted: boolean; now?: Date;
  /** Reads the do-not-contact marks (live). Tests pass a stub. */
  readDnd: () => Promise<DndState | null>;
};

/** Everything that can stop this send, and what would be sent. Reads the CRM's do-not-contact mark and the counts fresh every time it is called. */
export async function evaluate(ctx: AuthContext, m: MessageInput): Promise<{ blockers: Blocker[]; prepared: Prepared; idem: string; hash: string }> {
  const now = m.now ?? new Date();
  const t = m.lead.target;
  const first = t.name.trim().split(/\s+/)[0] ?? "";
  const words = fillMerge(m.text, { first_name: first, my_name: ctx.session.userName ?? "", business: m.lead.locationName ?? "" }).trim();
  const text = finalText(m.channel, words, m.settings);
  const idem = idemKey(t.contactId, m.channel, text, now, m.settings.dupMinutes);
  const dnd = await m.readDnd();
  const usage = ctx.demo ? { personHour: 0, personDay: 0, accountDay: 0, duplicateRecent: false } : await loadUsage(ctx.installationId, m.locationId, t.contactId, idem, m.settings.dupMinutes);
  const input: GuardInput = {
    enabled: sendEnabled(ctx), killed: killed(), settings: m.settings, who: whoOf(ctx), scopeGranted: m.scopeGranted, channel: m.channel, subject: m.subject, text: words,
    dnd, hasPhone: !!t.phone, hasEmail: !!t.email, timeZone: t.timeZone, now, usage,
  };
  const blockers = guardSend(input);
  if (ctx.demo && !blockers.length) { /* the demo may preview; the gateway makes the send a dry run */ }
  return {
    blockers, idem, hash: textHash(text),
    prepared: { channel: m.channel, subject: m.channel === "Email" ? (m.subject ?? "").trim() : null, text, to: m.channel === "Email" ? t.email ?? "" : t.phone ?? "", from: m.channel === "Email" ? "your account's default sending email address" : "your account's default text number", segments: m.channel === "SMS" ? smsSegments(text).parts : 0, footerAdded: text !== words },
  };
}

export type OneResult =
  | { kind: "blocked"; blockers: Blocker[]; prepared: Prepared }
  | { kind: "preview"; prepared: Prepared; aiDraft: boolean }
  | { kind: "ran"; res: RunResult; prepared: Prepared };

/** The one path for one message: preview, or (only when the person confirmed) the gateway. */
export async function processMessage(ctx: AuthContext, deps: Pick<SendDeps, "locationToken">, m: MessageInput, p: { doIt: boolean; confirmed: boolean; sendId: () => Promise<string> | string; fetchImpl?: typeof fetch }): Promise<OneResult> {
  const t = m.lead.target;
  const ev = await evaluate(ctx, m);
  if (ev.blockers.length) return { kind: "blocked", blockers: ev.blockers, prepared: ev.prepared };
  if (!p.doIt) return { kind: "preview", prepared: ev.prepared, aiDraft: m.aiDraft === true };
  const channel = m.channel;
  const res = await runAction({
    installationId: ctx.installationId, actor: actorOf(ctx), target: { ...t, dnd: false },
    action: { kind: "message", channel, text: ev.prepared.text, ...(channel === "Email" ? { subject: ev.prepared.subject ?? "" } : {}) },
    optedIn: !ctx.demo && m.mode.optedIn, confirmed: p.confirmed, ack: ["quiet_hours"], token: () => deps.locationToken(m.locationId),
    // Just before the request goes out: ask the CRM again, and run every rule again with fresh counts. Fail closed.
    preSend: async () => (await evaluate(ctx, { ...m, now: new Date() })).blockers,
  }, ctx.demo ? { env: {} } : {});
  if (!ctx.demo && (res.outcome === "done" || res.outcome === "dry_run" || res.outcome === "failed" || res.outcome === "needs_permission")) {
    const dry = res.outcome === "dry_run";
    await recordSend({ installationId: ctx.installationId, locationId: m.locationId, contactId: t.contactId, channel, actor: ctx.session.userId ?? null, actorName: actorOf(ctx), textHash: ev.hash, segments: ev.prepared.segments, result: res.outcome, dryRun: dry, idemKey: ev.idem, ghlMessageId: res.outcome === "done" ? res.id : null });
    await auditSend(ctx, { locationId: m.locationId, contactId: t.contactId, channel, hash: ev.hash, result: res.outcome, dryRun: dry });
  }
  return { kind: "ran", res, prepared: ev.prepared };
}

export async function modeFor(ctx: AuthContext, locationId: string) {
  const master = !ctx.demo && isLive("WRITE_GHL_LIVE");
  const optedIn = ctx.demo ? false : await writeEnabledFor(ctx.installationId, locationId);
  return { masterOn: master, optedIn, live: master && optedIn && !killed(), demo: ctx.demo === true };
}

const planOf = (r: OneResult) => ({ summary: `Send this ${r.prepared.channel === "Email" ? "email" : "text"}`, blockers: r.kind === "blocked" ? r.blockers : [], warnings: [] as Blocker[], reversible: false, fields: r.prepared.channel === "Email" ? ["type", "subject", "message"] : ["type", "message"], send: r.prepared });

const resultJson = (r: Extract<OneResult, { kind: "ran" }>, name: string) => {
  const res = r.res;
  switch (res.outcome) {
    case "blocked": return json({ ok: false, blocked: true, blockers: res.blockers }, 422);
    case "needs_ack": return json({ ok: false, needsAck: true, warnings: res.warnings }, 409);
    case "needs_confirm": return json({ ok: false, message: "Confirm to continue." }, 409);
    case "rate_limited": return json({ ok: false, message: `Slow down a little: try again in ${res.retryInSeconds} seconds.`, retryInSeconds: res.retryInSeconds }, 429);
    case "needs_permission": return json({ ok: false, needsPermission: true, message: "Needs permission: reconnect to allow sending. Nothing was sent." }, 403);
    case "failed": return json({ ok: false, message: `${failureText(res.status)} Nothing was recorded as sent. Press Send again to retry.`, retry: true }, 502);
    case "dry_run": return json({ ok: true, dryRun: true, reason: res.reason, summary: res.summary, message: dryRunMessage(res.reason) });
    case "done": return json({ ok: true, done: true, summary: `Sent to ${name}. This cannot be taken back.`, undo: null });
  }
};

/** A single message from the composer: /api/app/workbench/preview and /do route here when the action is a message. */
export async function messageRoute(ctx: Ctx, deps: SendDeps, body: Record<string, unknown>, doIt: boolean): Promise<Response> {
  if (!sendEnabled(ctx)) return json({ error: "Texting and emailing from SubSync is not available in this version yet." }, 403);
  const a = (body.action && typeof body.action === "object" ? body.action : {}) as Record<string, unknown>;
  const locationId = typeof body.locationId === "string" && ID.test(body.locationId) ? body.locationId : null;
  const contactId = typeof body.contactId === "string" && ID.test(body.contactId) ? body.contactId : null;
  if (!locationId || !contactId) return json({ error: "Send the account and the person" }, 400);
  const channel = a.channel === "SMS" || a.channel === "Email" ? (a.channel as SendChannel) : null;
  if (!channel) return json({ error: "Choose text or email" }, 400);
  const allowed = await deps.allowed();
  if (allowed && !allowed.includes(locationId)) return json({ error: "Contact not found" }, 404);
  const lead = await deps.loadLead(locationId, contactId);
  if (!lead) return json({ error: "Contact not found" }, 404);
  const [settings, scopeGranted, mode] = await Promise.all([loadSettings(ctx.installationId, locationId), ctx.demo ? Promise.resolve(true) : installationHasScope(ctx.installationId, SCOPE), modeFor(ctx, locationId)]);
  const readDnd = async () => (ctx.demo ? { all: lead.target.dnd, sms: false, email: false } : liveDnd(await deps.locationToken(locationId), contactId));
  const r = await processMessage(ctx, deps, { locationId, channel, subject: typeof a.subject === "string" ? a.subject : undefined, text: typeof a.text === "string" ? a.text : "", aiDraft: body.aiDraft === true, lead, mode, settings, scopeGranted, readDnd }, { doIt, confirmed: body.confirm === true, sendId: () => "" });
  if (r.kind === "blocked") return doIt ? json({ ok: false, blocked: true, blockers: r.blockers }, 422) : json({ ok: true, mode, plan: planOf(r) });
  if (r.kind === "preview") return json({ ok: true, mode, plan: planOf(r) });
  return resultJson(r, lead.target.name);
}

// ---------------- bulk: "Send to selected", a hard cap, one typed confirmation ----------------

export async function bulkRoute(ctx: Ctx, deps: SendDeps, body: Record<string, unknown>, doIt: boolean): Promise<Response> {
  if (!sendEnabled(ctx)) return json({ error: "Texting and emailing from SubSync is not available in this version yet." }, 403);
  const locationId = typeof body.locationId === "string" && ID.test(body.locationId) ? body.locationId : null;
  const channel = body.channel === "SMS" || body.channel === "Email" ? (body.channel as SendChannel) : null;
  const ids = Array.isArray(body.contactIds) ? [...new Set((body.contactIds as unknown[]).filter((x): x is string => typeof x === "string" && ID.test(x)))] : [];
  if (!locationId || !channel) return json({ error: "Send the account and how to send" }, 400);
  if (!ids.length) return json({ error: "Choose at least one person" }, 400);
  if (ids.length > BULK_CAP) return json({ error: `You can send to at most ${BULK_CAP} people at once. Choose fewer.` }, 400);
  const allowed = await deps.allowed();
  if (allowed && !allowed.includes(locationId)) return json({ error: "Contact not found" }, 404);
  const [settings, scopeGranted, mode] = await Promise.all([loadSettings(ctx.installationId, locationId), ctx.demo ? Promise.resolve(true) : installationHasScope(ctx.installationId, SCOPE), modeFor(ctx, locationId)]);
  const text = typeof body.text === "string" ? body.text : "";
  const subject = typeof body.subject === "string" ? body.subject : undefined;
  const rows: Array<{ contactId: string; name: string; status: "ok" | "blocked" | "sent" | "dry_run" | "failed"; reason: string | null; prepared?: Prepared }> = [];
  // Preview first: every person is checked on their own. The confirmation names how many will really get it.
  const checks: Array<{ id: string; lead: SendLead; r: OneResult }> = [];
  for (const id of ids) {
    const lead = await deps.loadLead(locationId, id);
    if (!lead) { rows.push({ contactId: id, name: "Not found", status: "blocked", reason: "Not found in this account." }); continue; }
    const readDnd = async () => (ctx.demo ? { all: lead.target.dnd, sms: false, email: false } : liveDnd(await deps.locationToken(locationId), id));
    const r = await processMessage(ctx, deps, { locationId, channel, subject, text, lead, mode, settings, scopeGranted, readDnd }, { doIt: false, confirmed: false, sendId: () => "" });
    checks.push({ id, lead, r });
  }
  const eligible = checks.filter((c) => c.r.kind === "preview");
  if (!doIt) {
    for (const c of checks) rows.push({ contactId: c.id, name: c.lead.target.name, status: c.r.kind === "blocked" ? "blocked" : "ok", reason: c.r.kind === "blocked" ? c.r.blockers[0]?.text ?? null : null, prepared: c.r.prepared });
    return json({ ok: true, mode, cap: BULK_CAP, willSend: eligible.length, skipped: ids.length - eligible.length, confirmWord: `SEND ${eligible.length}`, irreversible: true, rows });
  }
  if (!eligible.length) return json({ ok: false, message: "Nobody on the list can be sent to right now.", rows: [] }, 422);
  if (body.confirm !== true || String(body.confirmText ?? "").trim().toUpperCase() !== `SEND ${eligible.length}`) return json({ ok: false, message: `Type SEND ${eligible.length} to confirm. Messages cannot be taken back.` }, 409);
  for (const c of eligible) {
    const readDnd = async () => (ctx.demo ? { all: c.lead.target.dnd, sms: false, email: false } : liveDnd(await deps.locationToken(locationId), c.id));
    const r = await processMessage(ctx, deps, { locationId, channel, subject, text, lead: c.lead, mode, settings, scopeGranted, readDnd }, { doIt: true, confirmed: true, sendId: () => "" });
    if (r.kind === "ran") rows.push({ contactId: c.id, name: c.lead.target.name, status: r.res.outcome === "done" ? "sent" : r.res.outcome === "dry_run" ? "dry_run" : "failed", reason: r.res.outcome === "done" || r.res.outcome === "dry_run" ? null : r.res.outcome === "blocked" ? r.res.blockers[0]?.text ?? null : r.res.outcome === "needs_permission" ? "Needs permission: reconnect." : "Did not go. Press Send again to retry this person.", prepared: r.prepared });
    else rows.push({ contactId: c.id, name: c.lead.target.name, status: "blocked", reason: r.kind === "blocked" ? r.blockers[0]?.text ?? null : null });
  }
  for (const c of checks) if (c.r.kind === "blocked") rows.push({ contactId: c.id, name: c.lead.target.name, status: "blocked", reason: c.r.blockers[0]?.text ?? null });
  return json({ ok: true, done: true, sent: rows.filter((r) => r.status === "sent").length, dryRun: rows.filter((r) => r.status === "dry_run").length, rows });
}

// ---------------- settings and templates ----------------

const mayConfigure = (ctx: AuthContext) => ctx.kind !== "client" && whoOf(ctx).isOwnerOrAdmin;

/** What the composer needs to know about sending for one account (read-only). */
export async function sendStateFor(ctx: AuthContext, locationId: string) {
  const [settings, scope, templates, mode] = await Promise.all([loadSettings(ctx.installationId, locationId), ctx.demo ? Promise.resolve(false) : installationHasScope(ctx.installationId, SCOPE), listTemplates(ctx.installationId, locationId), modeFor(ctx, locationId)]);
  const who = whoOf(ctx);
  const roleOk = who.kind !== "agency" || (who.isOwnerOrAdmin && settings.allowAgencySend);
  const facts = { enabled: sendEnabled(ctx), killed: killed(), paused: settings.paused, needsPermission: !ctx.demo && !scope, roleOk, agencyOff: who.kind === "agency" && who.isOwnerOrAdmin && !settings.allowAgencySend, optedIn: mode.optedIn, masterOn: mode.masterOn };
  return {
    ...facts,
    /** The one plain state the message box shows: why it is locked, or that it works up to the preview only. */
    state: composerState(facts), canTurnOn: mayConfigure(ctx) && !ctx.demo, footerEnabled: settings.footerEnabled, footerText: settings.footerText,
    quiet: { start: settings.quietStartHour, end: settings.quietEndHour }, caps: { personHour: settings.perPersonHour, personDay: settings.perPersonDay, accountDay: settings.accountDay }, bulkCap: BULK_CAP,
    templates: templates.map((t) => ({ id: `u:${t.id}`, label: t.name, channel: t.channel, subject: t.subject, text: t.body, mine: true })),
  };
}

export async function settingsRoute(ctx: Ctx, deps: Pick<SendDeps, "allowed">): Promise<Response> {
  const locationId = ctx.url.searchParams.get("locationId") ?? "";
  const body = ctx.request.method === "POST" ? ((await ctx.request.json().catch(() => null)) as Record<string, unknown> | null) : null;
  const loc = ctx.request.method === "POST" ? String(body?.locationId ?? "") : locationId;
  if (!ID.test(loc)) return json({ error: "Send the account" }, 400);
  const allowed = await deps.allowed();
  if (allowed && !allowed.includes(loc)) return json({ error: "Account not found" }, 404);
  if (!sendEnabled(ctx)) return json({ error: "Texting and emailing from SubSync is not available in this version yet." }, 403);
  if (ctx.request.method === "GET") {
    const db = sql();
    const [settings, mode, [row]] = await Promise.all([loadSettings(ctx.installationId, loc), modeFor(ctx, loc), db`select name from locations where installation_id = ${ctx.installationId} and location_id = ${loc} limit 1`]);
    return json({ settings, canEdit: mayConfigure(ctx), killed: killed(), optedIn: mode.optedIn, masterOn: mode.masterOn, accountName: (row?.name as string | null) ?? "Unnamed account" });
  }
  if (!mayConfigure(ctx)) return json({ error: "Only an owner or administrator can change these rules." }, 403);
  const s = parseSettings(body?.settings);
  await saveSettings(ctx.installationId, loc, s, actorOf(ctx));
  try { const db = sql(); await db`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${actorOf(ctx)}, 'message.settings', ${db.json({ locationId: loc, paused: s.paused } as never)})`; } catch { /* the settings row holds who and when */ }
  return json({ ok: true, settings: s });
}


const nameOfAccount = async (ctx: AuthContext, loc: string): Promise<string | null> => {
  const [row] = await sql()`select name from locations where installation_id = ${ctx.installationId} and location_id = ${loc} and not ignored limit 1`;
  return row ? ((row.name as string | null) ?? "Unnamed account") : null;
};

/** The accounts and whether sending is turned on for each (owners and administrators). One page of 8, searchable. */
export async function sendAccountsRoute(ctx: Ctx, deps: Pick<SendDeps, "allowed">): Promise<Response> {
  if (!sendEnabled(ctx)) return json({ error: "Texting and emailing from SubSync is not available in this version yet." }, 403);
  const allowed = await deps.allowed();
  const db = sql();
  const ready = (await schemaReady()).rules;
  const q = (ctx.url.searchParams.get("aq") ?? "").trim().toLowerCase().slice(0, 60);
  const page = Math.max(0, Math.min(1000, Number.parseInt(ctx.url.searchParams.get("ap") ?? "0", 10) || 0));
  const rows = ready
    ? await db`select location_id, name, cleanup_write_enabled from locations where installation_id = ${ctx.installationId} and not ignored ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} ${q ? db`and lower(coalesce(name, '')) like ${`%${q.replace(/[%_\\]/g, "")}%`}` : db``} order by name nulls last, location_id limit 9 offset ${page * 8}`
    : [];
  return json({ ready, canEdit: mayConfigure(ctx) && !ctx.demo, masterOn: !ctx.demo && isLive("WRITE_GHL_LIVE"), killed: killed(), means: TURN_ON_MEANS, page, hasMore: rows.length > 8, accounts: rows.slice(0, 8).map((r) => ({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Unnamed account", optedIn: r.cleanup_write_enabled === true })) });
}

/** Turn sending on or off for one account. Turning on needs the account's name typed exactly; turning off needs nothing (the safe direction). Owners and administrators only; every change is in the audit log. Reuses the account's own opt-in (the same switch as other changes). */
export async function sendOptinRoute(ctx: Ctx, deps: Pick<SendDeps, "allowed">): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!sendEnabled(ctx)) return json({ error: "Texting and emailing from SubSync is not available in this version yet." }, 403);
  const loc = typeof body?.locationId === "string" && ID.test(body.locationId) ? body.locationId : null;
  if (!loc || typeof body?.enabled !== "boolean") return json({ error: "Choose a client account and on or off" }, 400);
  if (ctx.demo) return json({ error: "This is the demo: nothing can be turned on here." }, 403);
  if (!mayConfigure(ctx)) return json({ error: "Only an account owner or administrator can turn sending on or off." }, 403);
  const allowed = await deps.allowed();
  if (allowed && !allowed.includes(loc)) return json({ error: "Account not found" }, 404);
  const name = await nameOfAccount(ctx, loc);
  if (name === null) return json({ error: "Account not found" }, 404);
  if (body.enabled && String(body.confirmName ?? "").trim().toLowerCase() !== name.trim().toLowerCase()) return json({ error: `Type the account name "${name}" exactly to turn sending on.` }, 409);
  const r = await setWriteEnabled(ctx.installationId, allowed, actorOf(ctx), loc, body.enabled);
  if (r === "unavailable") return json({ error: "This switch is not available yet. SubSync is finishing an update, so try again later.", unavailable: true }, 503);
  if (r === "not_found") return json({ error: "Account not found" }, 404);
  try { const db = sql(); await db`insert into audit_log (installation_id, actor, action, detail) values (${ctx.installationId}, ${actorOf(ctx)}, ${body.enabled ? "message.sending_on" : "message.sending_off"}, ${db.json({ locationId: loc } as never)})`; } catch { /* the opt-in audit line from the switch holds the same facts */ }
  return json({ ok: true, enabled: body.enabled, masterOn: isLive("WRITE_GHL_LIVE") });
}

export async function templatesRoute(ctx: Ctx, deps: Pick<SendDeps, "allowed">): Promise<Response> {
  const body = ctx.request.method === "POST" ? ((await ctx.request.json().catch(() => null)) as Record<string, unknown> | null) : null;
  const loc = ctx.request.method === "POST" ? String(body?.locationId ?? "") : ctx.url.searchParams.get("locationId") ?? "";
  if (!ID.test(loc)) return json({ error: "Send the account" }, 400);
  const allowed = await deps.allowed();
  if (allowed && !allowed.includes(loc)) return json({ error: "Account not found" }, 404);
  if (!sendEnabled(ctx)) return json({ error: "Texting and emailing from SubSync is not available in this version yet." }, 403);
  if (ctx.request.method === "GET") return json({ templates: await listTemplates(ctx.installationId, loc), canEdit: mayConfigure(ctx) });
  if (!mayConfigure(ctx)) return json({ error: "Only an owner or administrator can change templates." }, 403);
  if (body?.delete === true) {
    const id = String(body.id ?? "");
    const mine = (await listTemplates(ctx.installationId, loc)).find((t) => t.id === id);
    if (!mine) return json({ error: "Template not found" }, 404);
    if (String(body.confirmName ?? "").trim().toLowerCase() !== mine.name.toLowerCase()) return json({ error: `Type the template name "${mine.name}" to delete it.` }, 409);
    await deleteTemplate(ctx.installationId, loc, id);
    return json({ ok: true });
  }
  const t = checkTemplate({ name: body?.name, channel: body?.channel, subject: body?.subject, body: body?.body });
  if (!t.ok) return json({ error: t.error }, 422);
  const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
  const saved = await saveTemplate(ctx.installationId, loc, id, t.value, actorOf(ctx));
  return saved ? json({ ok: true, id: saved }) : json({ error: "Template not found" }, 404);
}

export { dndFor };
