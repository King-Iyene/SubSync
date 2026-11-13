import { randomUUID } from "node:crypto";
import { accountsIn } from "../analytics/clients3-queries";
import { contactFacts, assignedBatch, logActions, type ActionLogRow } from "../analytics/unanswered-actions-queries";
import { BATCH_CAPS, dryRunWords, planAssign } from "../analytics/unanswered-actions";
import { CF_FLAGS, CF_PARTS, type CfPart } from "../analytics/cash-types";
import { RECOVER_KINDS, type RecoverKind } from "../analytics/cash-intel";
import { pipelineParam } from "../analytics/pipeline-pick";
import { cashCache, dealsList, dealsSummary, forgetCash, getSettings, muteAccount, recoverList, recoverRowsByKey, recoverSummary, saveBoard, saveSettings, setRowOwner, snoozeRows, unmuteAccount } from "../analytics/cash-queries";
import type { Scope } from "../analytics/today3-queries";
import { validZone } from "../analytics/today3-intel";
import { sql } from "../db";
import type { Feature } from "../entitlements";
import { resolveEntitlements } from "../flags";
import { isLive } from "../live-flags";
import { json, type AuthContext } from "./auth";
import { viewerOf } from "./people3-routes";
import { ownedLocation } from "./tenant-guard";
import { accountMembers } from "./workbench-routes";
import { mode, readBody, resultWord, runOwner, type ActionHelpers } from "./unanswered-actions-routes";

// GET /api/app/cash?part=save|recover|recover-list|deals|deals-list|settings|options and POST /api/app/cash/act/<name>.
// Who is asking comes from the verified session (`level`: agency owner or admin = all, an account administrator = their account, anyone else = only their own rows); which accounts they may read comes
// from `allowed`. An account id in the address goes through ownedLocation and only NARROWS inside `allowed`; one that does not belong is answered like nothing there and never echoed.
// Row keys sent back by the browser are re-read from SubSync's own tables for the caller's installation and accounts, never trusted. The only CRM change is the owner change in "assign",
// through the safe gateway (preview first, dry run unless the live switch and the account opt-in are both on, one audit line per write). Nothing here ever sends a message to a lead.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type CashHelpers = ActionHelpers;

const PART_FLAG: Record<CfPart, string[]> = {
  save: ["cf_save"], recover: ["cf_recover"], "recover-list": ["cf_recover"], deals: ["cf_deals"], "deals-list": ["cf_deals"], settings: ["cf_save", "cf_email"], team: ["cf_recover"], options: ["cf_save", "cf_recover", "cf_deals"],
};
const KIND_SET = new Set<string>(RECOVER_KINDS);
const int = (v: string | null, d: number) => { const x = Number(v); return v !== null && Number.isFinite(x) ? Math.floor(x) : d; };
const CURSOR = /^[0-9.eE+-]{1,40}\|[A-Za-z0-9_~:.-]{1,160}$/;
const SNOOZE_HOURS: Record<string, number> = { h4: 4, tomorrow: 24, d3: 72, d7: 168 };

export async function handleCash(ctx: Ctx, h: CashHelpers): Promise<Response> {
  const sp = ctx.url.searchParams, part = sp.get("part") as CfPart | null;
  if (!part || !(CF_PARTS as readonly string[]).includes(part)) return json({ error: "Not found" }, 404);
  const [allowed, dl, ent] = await Promise.all([h.allowed(), h.links(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const flags = Object.fromEntries(CF_FLAGS.map((f) => [f, ent.features[f as Feature] === true]));
  if (!PART_FLAG[part].some((f) => flags[f])) return json({ error: "This is not switched on for your account yet." }, 404);
  const { level, selfId } = viewerOf(ctx);
  const scope: Scope = { inst: ctx.installationId, allowed, level, selfId };
  const wrap = (body: object, cached = false) => json({ ...body, generatedAt: new Date().toISOString(), cached, level, flags, problem: null, timezone: "UTC" });

  const asked = sp.get("account");
  const one = asked ? await ownedLocation(ctx.installationId, allowed, asked) : null;
  if (asked && !one) return wrap({ rows: [], total: 0, next: null, accounts: [] });
  const links = { account: (l: string) => dl.account(l), contact: (l: string, c: string) => dl.contact(l, c) };
  const cursorRaw = sp.get("cursor");
  const cursor = cursorRaw && CURSOR.test(cursorRaw) ? cursorRaw : null;
  const size = Math.min(100, Math.max(5, int(sp.get("size"), 25)));
  const key = JSON.stringify([ctx.installationId, allowed, level, selfId, part, sp.toString()]);
  const hit = cashCache.get(key);
  if (hit) return wrap(hit, true);
  const done = (body: object) => { cashCache.set(key, body); return wrap(body); };
  const now = Date.now();

  switch (part) {
    case "save": {
      // The save list is for owners and managers: it compares client accounts. A team member never sees it.
      if (level === "self" || !flags.cf_save) return wrap({ accounts: [], more: 0, checked: 0, muted: [], formula: "", historyStarts: null, headline: "" });
      return done(await saveBoard(scope, now));
    }
    case "recover": return done(await recoverSummary(scope, one, now));
    case "recover-list": {
      const kindP = sp.get("kind") ?? "all";
      if (kindP !== "all" && !KIND_SET.has(kindP)) return json({ error: "Not found" }, 404);
      return done(await recoverList(scope, one, { kind: kindP as RecoverKind | "all", cursor, size, snoozed: sp.get("snoozed") === "1" }, links, now));
    }
    case "deals": return done(await dealsSummary(scope, one, now, 30, pipelineParam(sp)));
    case "deals-list": {
      const k = sp.get("kind") ?? "slipping";
      if (!["slipping", "stale", "soon", "lost"].includes(k)) return json({ error: "Not found" }, 404);
      return done(await dealsList(scope, one, { kind: k as "slipping" | "stale" | "soon" | "lost", cursor, size, pipeline: pipelineParam(sp) }, links));
    }
    case "settings": {
      if (level === "self") return json({ error: "Ask your administrator." }, 403);
      const accts = await accountsIn({ inst: scope.inst, allowed }, {});
      const [lz] = await sql()`select timezone from locations where installation_id = ${scope.inst} and location_id = any(${accts.map((a) => a.id)}::text[]) and coalesce(timezone, '') <> '' order by name limit 1`.catch(() => []);
      const note = isLive("SEND_EMAIL_LIVE") ? "Emails are switched on for your business." : "Emails are shown here but only sent once sending is switched on for your business.";
      return done(await getSettings(scope.inst, validZone((lz?.timezone as string | null) ?? "UTC"), level === "all" || level === "account", note));
    }
    case "team": {
      // The people of ONE account, to pick an owner. A team member only ever gets themselves.
      if (!one) return wrap({ members: [], me: selfId, canAssign: false });
      const members = await accountMembers(ctx, one);
      return done({ members: level === "self" ? members.filter((m) => m.id === selfId) : members, me: selfId, canAssign: true });
    }
    case "options": {
      const accts = await accountsIn({ inst: scope.inst, allowed }, {});
      return done({ accounts: accts.map((a) => ({ locationId: a.id, name: a.name })) });
    }
  }
  return json({ error: "Not found" }, 404);
}

/** POST /api/app/cash/act/<name>: snooze, unsnooze, assign, undo, mute, unmute, settings. SubSync-only notes except assign and undo (owner change through the gateway). */
export async function handleCashAct(ctx: Ctx, h: CashHelpers): Promise<Response> {
  const name = ctx.segments[2];
  if (ctx.request.method !== "POST") return json({ error: "Not found" }, 404);
  const [allowed, ent] = await Promise.all([h.allowed(), resolveEntitlements(ctx.plan, ctx.installationId, ctx.demo)]);
  const on = (f: string) => ent.features[f as Feature] === true;
  if (!on("cf_recover") && !on("cf_save") && !on("cf_deals")) return json({ error: "This is not switched on for your account" }, 404);
  if (ctx.demo) return json({ error: "The sample data cannot be changed." }, 403);
  const { level, selfId } = viewerOf(ctx);
  const scope: Scope = { inst: ctx.installationId, allowed, level, selfId };
  const b = (await readBody(ctx)) ?? {};
  const actor = ctx.session.userName ?? ctx.session.userId ?? null;
  const keys = Array.isArray(b.keys) ? b.keys.filter((k): k is string => typeof k === "string" && k.length <= 260).slice(0, 200) : [];

  switch (name) {
    case "snooze": {
      if (!on("cf_recover")) return json({ error: "Not found" }, 404);
      const hours = SNOOZE_HOURS[String(b.for ?? "")];
      if (!hours || !keys.length) return json({ error: "Choose the people and how long." }, 400);
      const n = await snoozeRows(scope, keys, new Date(Date.now() + hours * 3_600_000), actor);
      return n ? json({ ok: true, changed: n }) : json({ error: "Not found" }, 404);
    }
    case "unsnooze": {
      if (!on("cf_recover")) return json({ error: "Not found" }, 404);
      const n = await snoozeRows(scope, keys, null, actor);
      return n ? json({ ok: true, changed: n }) : json({ error: "Not found" }, 404);
    }
    case "assign": {
      if (!on("cf_recover")) return json({ error: "Not found" }, 404);
      return assignRoute(ctx, h, scope, b, keys);
    }
    case "undo": {
      if (!on("cf_recover")) return json({ error: "Not found" }, 404);
      if (level === "self") return json({ error: "Ask your administrator to put the owners back" }, 403);
      return undoRoute(ctx, h, allowed, b);
    }
    case "mute": case "unmute": {
      if (!on("cf_save")) return json({ error: "Not found" }, 404);
      if (level === "self") return json({ error: "Ask your administrator to do this." }, 403);
      if (name === "unmute") return (await unmuteAccount(ctx.installationId, allowed, String(b.id ?? ""))) ? json({ ok: true }) : json({ error: "Not found" }, 404);
      const loc = typeof b.location === "string" ? await ownedLocation(ctx.installationId, allowed, b.location) : null;
      if (!loc) return json({ error: "Not found" }, 404);
      const id = await muteAccount(ctx.installationId, allowed, loc, Number(b.days ?? 7), actor);
      return id ? json({ ok: true, id }) : json({ error: "Not found" }, 404);
    }
    case "settings": {
      if (!on("cf_save") && !on("cf_email")) return json({ error: "Not found" }, 404);
      if (level === "self") return json({ error: "Ask your administrator to do this." }, 403);
      if (!on("cf_email") && b.saveOn === true) return json({ error: "The morning email is not switched on for your account yet." }, 404);
      const r = await saveSettings(ctx.installationId, actor, b);
      if (!r.ok) return json({ error: r.error }, 400);
      forgetCash(ctx.installationId);
      return json({ ok: true });
    }
  }
  return json({ error: "Not found" }, 404);
}

async function assignRoute(ctx: Ctx, h: CashHelpers, scope: Scope, b: Record<string, unknown>, keys: string[]): Promise<Response> {
  const rows = await recoverRowsByKey(scope, keys);
  if (!rows.length) return json({ error: "Not found" }, 404);
  const locs = [...new Set(rows.map((r) => r.locationId))];
  if (locs.length > 1) return json({ error: "Choose people from one client account at a time, because each account has its own team." }, 400);
  const loc = locs[0];
  const admin = scope.level !== "self";
  const me = ctx.session.userId ?? null;
  const ownerId = b.ownerId === "me" ? me : typeof b.ownerId === "string" && /^[A-Za-z0-9_-]{3,128}$/.test(b.ownerId) ? b.ownerId : null;
  if (!ownerId) return json({ error: "Choose who should own them." }, 400);
  if (!admin && ownerId !== me) return json({ error: "Ask your administrator to give leads to someone else." }, 403);
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const [facts, members] = await Promise.all([contactFacts(ctx.installationId, loc, contactIds), accountMembers(ctx, loc)]);
  // A team member may only take leads nobody owns; an administrator may change any owner in the account.
  const eligible = rows.filter((r) => admin || (facts.get(r.contactId)?.owner ?? r.ownerId) === null);
  const plan = planAssign(eligible.map((r) => ({ contactId: r.contactId, name: facts.get(r.contactId)?.name ?? r.name, currentOwner: facts.get(r.contactId)?.owner ?? r.ownerId })), ownerId, members);
  const md = await mode(ctx, loc);
  const ownerName = members.find((x) => x.id === ownerId)?.name ?? null;
  const skipped = rows.length - eligible.length;
  if (b.step !== "do") {
    return json({
      ok: true, mode: md, owner: ownerName, cap: BATCH_CAPS.assign,
      plan: { blockers: plan.blockers, change: plan.change.map((i) => ({ name: i.name, from: members.find((x) => x.id === i.currentOwner)?.name ?? (i.currentOwner ? "Someone else" : "Nobody") })), same: plan.same.length, overCap: plan.overCap, skipped,
        reversible: true, undoNote: "SubSync remembers the owner before, so this can be put back right after." },
    });
  }
  if (plan.blockers.length) return json({ ok: false, blocked: true, blockers: plan.blockers }, 422);
  const batchId = randomUUID();
  const log: ActionLogRow[] = [];
  let done = 0, dry = 0, failed = 0, permission = false;
  const changed: string[] = [];
  for (const it of plan.change) {
    const res = await runOwner(ctx, h, loc, { conversationId: null, contactId: it.contactId, name: it.name }, ownerId, md.optedIn);
    log.push({ locationId: loc, batchId, action: "assign", conversationId: null, contactId: it.contactId, beforeOwner: it.currentOwner, afterOwner: ownerId, result: resultWord(res), actor: me });
    if (res.outcome === "done") { done++; changed.push(it.contactId); } else if (res.outcome === "dry_run") dry++; else failed++;
    if (res.outcome === "needs_permission") { permission = true; break; }
    if (res.outcome === "rate_limited") break;
  }
  await logActions(ctx.installationId, log);
  if (changed.length) await setRowOwner(ctx.installationId, loc, changed, ownerId);
  const message = permission ? "Needs permission: reconnect SubSync so it may change owners. Nothing was changed."
    : dry ? `${dryRunWords(md.optedIn ? "switch" : "account")} ${dry} change${dry === 1 ? "" : "s"} checked.` : `${done} lead${done === 1 ? "" : "s"} now belong${done === 1 ? "s" : ""} to ${ownerName ?? "that person"}.`;
  return json({ ok: !permission && failed === 0, batchId, done, dryRun: dry, failed, needsPermission: permission, message, undoable: done > 0 }, permission ? 403 : 200);
}

async function undoRoute(ctx: Ctx, h: CashHelpers, allowed: string[] | null, b: Record<string, unknown>): Promise<Response> {
  if (typeof b.batchId !== "string" || !/^[0-9a-f-]{36}$/i.test(b.batchId)) return json({ error: "Unknown batch" }, 400);
  const rows = (await assignedBatch(ctx.installationId, b.batchId)).filter((r) => !allowed || allowed.includes(r.locationId));
  if (!rows.length) return json({ error: "Nothing to put back" }, 404);
  const batchId = randomUUID();
  const log: ActionLogRow[] = [];
  let done = 0, dry = 0, failed = 0;
  for (const r of rows) {
    const md = await mode(ctx, r.locationId);
    const f = (await contactFacts(ctx.installationId, r.locationId, [r.contactId])).get(r.contactId);
    const res = await runOwner(ctx, h, r.locationId, { conversationId: null, contactId: r.contactId, name: f?.name ?? "This person" }, r.before, md.optedIn);
    log.push({ locationId: r.locationId, batchId, action: "undo_assign", conversationId: null, contactId: r.contactId, beforeOwner: r.after, afterOwner: r.before, result: resultWord(res), actor: ctx.session.userId ?? null });
    if (res.outcome === "done") { done++; await setRowOwner(ctx.installationId, r.locationId, [r.contactId], r.before); } else if (res.outcome === "dry_run") dry++; else failed++;
    if (res.outcome === "needs_permission" || res.outcome === "rate_limited") break;
  }
  await logActions(ctx.installationId, log);
  return json({ ok: failed === 0, done, dryRun: dry, failed, message: dry ? "Changes from SubSync are switched off, so nothing was sent." : `${done} lead${done === 1 ? "" : "s"} put back.` });
}

