import { sql } from "../db";
import { teamNames } from "../analytics/inbox-queries";
import { writeEnabledFor } from "../analytics/cleanup-config";
import { isLive } from "../live-flags";
import {
  failureText, fetchThread, fillTemplate, inverseOf, OWNER_ONLY, parseAction, planAction, runAction, TEMPLATES, type Action, type Before, type Target,
} from "../ghl/workbench";
import { isPermissionError } from "../sync/ghl-data";
import { json, type AuthContext } from "./auth";
import { ghlFetch } from "../ghl/http";
import { GHL_API } from "../ghl/client";
import { parseGranted } from "../scope-groups";
import { buildOwnerOptions } from "../ghl/owner-list";
import { installationHasScope } from "../analytics/cleanup-queries";
import { isOurNote } from "../people/writeback";
import { liveRoute, findRoute, refreshLead } from "../live/live-route";
import { bulkRoute, messageRoute, sendStateFor, settingsRoute, templatesRoute } from "./send-routes";
import { crmSource } from "../live/live-read";
import { cacheConversations } from "../live/live-cache";

// The Lead workbench endpoints, under /api/app/workbench/... (the one catch-all route, already guarded by the plan and by access.ts). Every handler derives who is asking from the
// verified session (`ctx`), checks that the account is one the caller may see (`allowed`), re-reads the lead from SubSync's own copy of THAT account (a contact, deal or appointment of
// another account is "not found"), and never takes an installation, a token or a before-value from the browser. Every write goes through runAction (src/lib/ghl/workbench.ts).

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type WorkbenchHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof import("../links").deepLinks>>; locationToken: (locationId: string) => Promise<string> };

const ID = /^[A-Za-z0-9_-]{3,128}$/;
const actorOf = (ctx: Ctx) => ctx.session.userName ?? ctx.session.userId ?? null;

type Loaded = { target: Target; before: Before; conversationId: string | null; locationName: string | null; ownerId: string | null; tags: string[]; fields: { firstName: string; lastName: string; email: string; phone: string } };

/** The lead as SubSync has it, only when the account is one the caller may see. Null (not found) for anything else. */
async function loadLead(ctx: Ctx, allowed: string[] | null, locationId: string, contactId: string): Promise<Loaded | null> {
  if (allowed && !allowed.includes(locationId)) return null;
  const db = sql();
  const [c] = await db`
    select c.first_name, c.last_name, nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') name, c.email, c.phone, c.tags, nullif(c.assigned_to, '') owner, c.dnd,
      l.name location_name, l.timezone
    from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where c.installation_id = ${ctx.installationId} and c.location_id = ${locationId} and c.contact_id = ${contactId}`;
  if (!c) return null;
  const [convo] = await db`select conversation_id from cached_conversations where installation_id = ${ctx.installationId} and location_id = ${locationId} and contact_id = ${contactId} order by last_message_at desc nulls last limit 1`;
  const name = (c.name as string | null) ?? "This person";
  const fields = { firstName: (c.first_name as string | null) ?? "", lastName: (c.last_name as string | null) ?? "", email: (c.email as string | null) ?? "", phone: (c.phone as string | null) ?? "" };
  return {
    target: { locationId, contactId, name, dnd: c.dnd === true, phone: fields.phone || null, email: fields.email || null, timeZone: (c.timezone as string | null) ?? null },
    before: { tags: (c.tags as string[] | null) ?? [], owner: (c.owner as string | null) ?? null, fields },
    conversationId: (convo?.conversation_id as string | undefined) ?? null, locationName: (c.location_name as string | null) ?? null, ownerId: (c.owner as string | null) ?? null, tags: (c.tags as string[] | null) ?? [], fields,
  };
}

type DealRow = { id: string; name: string | null; pipelineId: string | null; pipelineName: string | null; stageId: string | null; stageName: string | null; value: number; status: string; ownerId: string | null };

async function dealsOf(ctx: Ctx, locationId: string, where: { contactId?: string; opportunityId?: string }): Promise<DealRow[]> {
  const db = sql();
  const rows = await db`
    select o.opportunity_id, o.name, o.pipeline_id, o.pipeline_name, o.stage_id, o.stage_name, coalesce(o.monetary_value, 0)::float8 value, coalesce(o.status, 'open') status, nullif(o.assigned_to, '') owner
    from cached_opportunities o
    where o.installation_id = ${ctx.installationId} and o.location_id = ${locationId}
      ${where.contactId ? db`and o.contact_id = ${where.contactId}` : db``} ${where.opportunityId ? db`and o.opportunity_id = ${where.opportunityId}` : db``}
    order by case when o.status = 'open' then 0 else 1 end, o.synced_at desc limit 12`;
  return rows.map((r) => ({ id: r.opportunity_id as string, name: r.name as string | null, pipelineId: r.pipeline_id as string | null, pipelineName: r.pipeline_name as string | null, stageId: r.stage_id as string | null, stageName: r.stage_name as string | null, value: r.value as number, status: r.status as string, ownerId: (r.owner as string | null) ?? null }));
}

type DealExtra = { source: string | null; lostReason: string | null; createdAt: string | null; stageSince: string | null; statusSince: string | null; lastActivityAt: string | null; usualP75Days: number | null; stays: number };

/** Extra, read-only facts for the deals panel, from SubSync's own copy and event store (one query each, scoped to this account and these deals). A failure leaves the facts out, never the panel. */
async function dealExtras(ctx: Ctx, locationId: string, deals: DealRow[]): Promise<Record<string, DealExtra>> {
  const out: Record<string, DealExtra> = {};
  if (!deals.length) return out;
  const db = sql();
  const oppIds = deals.map((d) => d.id);
  const stageIds = [...new Set(deals.map((d) => d.stageId).filter((x): x is string => !!x))];
  try {
    const [base, facts, hist, stats] = await Promise.all([
      db`select opportunity_id, source, last_stage_change_at, last_status_change_at from cached_opportunities where installation_id = ${ctx.installationId} and location_id = ${locationId} and opportunity_id = any(${oppIds}::text[])`,
      db`select opportunity_id, lost_reason from deal_facts where installation_id = ${ctx.installationId} and location_id = ${locationId} and opportunity_id = any(${oppIds}::text[])`.catch(() => []),
      db`select opportunity_id, min(at) filter (where kind = 'created') created_at, max(at) last_at from deal_history where installation_id = ${ctx.installationId} and location_id = ${locationId} and opportunity_id = any(${oppIds}::text[]) group by opportunity_id`.catch(() => []),
      stageIds.length ? db`select stage_id, p75_days::float8 p75, stays from deal_stage_stats where installation_id = ${ctx.installationId} and location_id = ${locationId} and stage_id = any(${stageIds}::text[])`.catch(() => []) : Promise.resolve([]),
    ]);
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
    const f = new Map(facts.map((r) => [r.opportunity_id as string, r.lost_reason as string | null]));
    const h = new Map(hist.map((r) => [r.opportunity_id as string, r]));
    const st = new Map(stats.map((r) => [r.stage_id as string, r]));
    for (const b of base) {
      const id = b.opportunity_id as string;
      const d = deals.find((x) => x.id === id);
      const s = d?.stageId ? st.get(d.stageId) : undefined;
      const hh = h.get(id);
      out[id] = {
        source: (b.source as string | null) ?? null, lostReason: f.get(id) ?? null, createdAt: iso(hh?.created_at), stageSince: iso(b.last_stage_change_at), statusSince: iso(b.last_status_change_at),
        lastActivityAt: iso(hh?.last_at) ?? iso(b.last_stage_change_at), usualP75Days: (s?.p75 as number | null | undefined) ?? null, stays: Number(s?.stays ?? 0),
      };
    }
  } catch { /* the panel shows the facts it has */ }
  return out;
}

/** The last conversation with this person (date, channel, who wrote last), from SubSync's copy. */
async function lastConversationOf(ctx: Ctx, locationId: string, contactId: string) {
  try {
    const [r] = await sql()`select last_message_type, last_message_direction, last_message_at from cached_conversations where installation_id = ${ctx.installationId} and location_id = ${locationId} and contact_id = ${contactId} and last_message_at is not null order by last_message_at desc limit 1`;
    if (!r) return null;
    const dir = String(r.last_message_direction ?? "").toLowerCase();
    return { at: (r.last_message_at as Date).toISOString(), channel: (r.last_message_type as string | null) ?? null, by: dir.startsWith("in") ? "them" : dir.startsWith("out") ? "you" : null };
  } catch { return null; }
}

async function apptsOf(ctx: Ctx, locationId: string, contactId: string) {
  const rows = await sql()`select appointment_id, title, status, start_at, calendar_name, nullif(assigned_to, '') assigned_to from cached_appointments where installation_id = ${ctx.installationId} and location_id = ${locationId} and contact_id = ${contactId} order by start_at desc nulls last limit 40`;
  return rows.map((r) => ({ id: r.appointment_id as string, title: (r.title as string | null) ?? "Appointment", status: (r.status as string | null) ?? null, at: r.start_at instanceof Date ? r.start_at.toISOString() : null, calendar: (r.calendar_name as string | null) ?? null, assignedTo: (r.assigned_to as string | null) ?? null }));
}

/** The people who belong to THIS account (from the CRM users list for that account, never every user of the company), with real names. The lead's current owner stays visible. */
export async function accountMembers(ctx: Ctx, locationId: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const rows = await sql()`select user_id, name from location_users where installation_id = ${ctx.installationId} and location_id = ${locationId} limit 500`;
    return rows.map((r) => ({ id: r.user_id as string, name: r.name as string }));
  } catch { return []; } // table not applied yet: nobody can be proven to belong, so nobody is offered
}
async function usersOf(ctx: Ctx, locationId: string, currentOwnerId: string | null) {
  const [members, names] = await Promise.all([accountMembers(ctx, locationId), currentOwnerId ? teamNames(ctx.installationId) : Promise.resolve(new Map<string, string>())]);
  return buildOwnerOptions(members, currentOwnerId, names);
}

async function stagesOf(ctx: Ctx, locationId: string, pipelineIds: string[]) {
  if (!pipelineIds.length) return [];
  const rows = await sql()`select pipeline_id, name, stages from pipelines where installation_id = ${ctx.installationId} and location_id = ${locationId} and pipeline_id = any(${pipelineIds}::text[])`;
  return rows.map((r) => ({ id: r.pipeline_id as string, name: (r.name as string | null) ?? "Pipeline", stages: ((r.stages as Array<{ id: string; name: string }> | null) ?? []).slice(0, 40) }));
}

const modeOf = async (ctx: Ctx, locationId: string) => {
  const master = !ctx.demo && isLive("WRITE_GHL_LIVE");
  const optedIn = ctx.demo ? false : await writeEnabledFor(ctx.installationId, locationId);
  return { masterOn: master, optedIn, live: master && optedIn, demo: ctx.demo === true };
};

function ids(ctx: Ctx, src: URLSearchParams | Record<string, unknown>) {
  const get = (k: string) => { const v = src instanceof URLSearchParams ? src.get(k) : src[k]; return typeof v === "string" ? v : null; };
  const locationId = get("locationId"), contactId = get("contactId");
  void ctx;
  return { locationId: locationId && ID.test(locationId) ? locationId : null, contactId: contactId && ID.test(contactId) ? contactId : null };
}

export async function handleWorkbench(ctx: Ctx, h: WorkbenchHelpers): Promise<Response> {
  const [, b] = ctx.segments;
  const m = ctx.request.method;
  if (m === "GET" && b === "context") return contextRoute(ctx, h);
  if (m === "GET" && b === "thread") return threadRoute(ctx, h);
  if (m === "GET" && b === "deal-history") return dealHistoryRoute(ctx, h);
  if (m === "GET" && b === "record") return recordRoute(ctx, h);
  if (m === "GET" && b === "live") return liveRoute(ctx, h);
  if (m === "GET" && b === "find") return findRoute(ctx, h);
  if (m === "POST" && (b === "preview" || b === "do")) return actRoute(ctx, h, b === "do");
  const sd = { allowed: () => h.allowed(), locationToken: h.locationToken, loadLead: async (loc: string, cid: string) => { const l = await loadLead(ctx, await h.allowed(), loc, cid); return l ? { target: l.target, locationName: l.locationName } : null; } };
  if (m === "POST" && (b === "send-bulk-preview" || b === "send-bulk")) return bulkRoute(ctx, sd, ((await ctx.request.json().catch(() => null)) as Record<string, unknown> | null) ?? {}, b === "send-bulk");
  if (b === "send-settings" && (m === "GET" || m === "POST")) return settingsRoute(ctx, sd);
  if (b === "send-templates" && (m === "GET" || m === "POST")) return templatesRoute(ctx, sd);
  return json({ error: "Not found" }, 404);
}

async function contextRoute(ctx: Ctx, h: WorkbenchHelpers): Promise<Response> {
  const { locationId, contactId } = ids(ctx, ctx.url.searchParams);
  if (!locationId || !contactId) return json({ error: "Send the account and the person" }, 400);
  const lead = await loadLead(ctx, await h.allowed(), locationId, contactId);
  if (!lead) return json({ error: "Contact not found" }, 404);
  const links = await h.links();
  const [tzRow] = await sql()`select timezone from locations where installation_id = ${ctx.installationId} and location_id = ${locationId}`;
  const [mode, deals, appts, users, lastConversation] = await Promise.all([modeOf(ctx, locationId), dealsOf(ctx, locationId, { contactId }), apptsOf(ctx, locationId, contactId), usersOf(ctx, locationId, lead.ownerId), lastConversationOf(ctx, locationId, contactId)]);
  const dealExtra = await dealExtras(ctx, locationId, deals);
  const allPipelineIds = (await sql()`select pipeline_id from pipelines where installation_id = ${ctx.installationId} and location_id = ${locationId} limit 20`).map((r) => r.pipeline_id as string);
  const pipelines = await stagesOf(ctx, locationId, [...new Set([...allPipelineIds, ...deals.map((d) => d.pipelineId).filter((x): x is string => !!x)])]);
  const ownerName = users.find((u) => u.id === lead.ownerId)?.name ?? null;
  const pipelineUse: Record<string, number> = {};
  for (const r of await sql()`select pipeline_id, count(*)::int n from cached_opportunities where installation_id = ${ctx.installationId} and location_id = ${locationId} group by pipeline_id`) if (r.pipeline_id) pipelineUse[r.pipeline_id as string] = Number(r.n);
  return json({
    mode, canDelete: ctx.kind !== "client", name: lead.target.name, dnd: lead.target.dnd, phone: lead.target.phone, email: lead.target.email, hasConversation: !!lead.conversationId, dealsUrl: links.opportunities(locationId), timeZone: (tzRow?.timezone as string | null) ?? null,
    // The link that opens this conversation in the customer's CRM (through the white-label domain helper); the contact when there is no conversation yet.
    crmUrl: lead.conversationId ? links.conversation(locationId, lead.conversationId) : links.contact(locationId, contactId),
    usersNeedPermission: users.every((u) => u.id === lead.ownerId) && !(await installationHasScope(ctx.installationId, "users.readonly")), tags: lead.tags, fields: lead.fields, ownerId: lead.ownerId, ownerName, locationName: lead.locationName, users, deals, dealExtra, lastConversation, appointments: appts, pipelines, pipelineUse,
    me: actorOf(ctx),
    send: await sendStateFor(ctx, locationId),
    templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label, channel: t.channel, subject: t.subject ? fillTemplate(t.subject, { name: lead.target.name, owner: ctx.session.userName ?? ownerName, business: lead.locationName }) : null, text: fillTemplate(t.text, { name: lead.target.name, owner: ctx.session.userName ?? ownerName, business: lead.locationName }) })),
  });
}

/** One deal's recorded history (our own event store), loaded when the person expands it. The deal must belong to a contact of an account the caller may see. */
async function dealHistoryRoute(ctx: Ctx, h: WorkbenchHelpers): Promise<Response> {
  const { locationId, contactId } = ids(ctx, ctx.url.searchParams);
  const oppId = ctx.url.searchParams.get("opportunityId");
  if (!locationId || !contactId || !oppId || !ID.test(oppId)) return json({ error: "Send the account, the person and the deal" }, 400);
  const lead = await loadLead(ctx, await h.allowed(), locationId, contactId);
  if (!lead) return json({ error: "Contact not found" }, 404);
  const [deal] = await dealsOf(ctx, locationId, { contactId, opportunityId: oppId });
  if (!deal) return json({ error: "Deal not found" }, 404);
  try {
    const [rows, names] = await Promise.all([
      sql()`select id, kind, at, from_value, to_value, from_name, to_name, value::float8 value, actor_id, actor_kind from deal_history where installation_id = ${ctx.installationId} and location_id = ${locationId} and opportunity_id = ${oppId} order by at desc, id desc limit 200`,
      teamNames(ctx.installationId),
    ]);
    return json({ state: rows.length ? "ok" : "empty", rows: rows.map((r) => ({ id: String(r.id), kind: r.kind as string, at: (r.at as Date).toISOString(), from: (r.from_value as string | null) ?? null, to: (r.to_value as string | null) ?? null, fromName: (r.from_name as string | null) ?? null, toName: (r.to_name as string | null) ?? null, value: (r.value as number | null) ?? null, actor: r.actor_id ? names.get(r.actor_id as string) ?? null : null, byUs: r.actor_kind === "subsync" })) });
  } catch { return json({ state: "unavailable", rows: [] }); }
}

/** The live conversation. Fetched when the panel opens, held in this answer only, never stored. */
async function threadRoute(ctx: Ctx, h: WorkbenchHelpers): Promise<Response> {
  const { locationId, contactId } = ids(ctx, ctx.url.searchParams);
  if (!locationId || !contactId) return json({ error: "Send the account and the person" }, 400);
  const lead = await loadLead(ctx, await h.allowed(), locationId, contactId);
  if (!lead) return json({ error: "Contact not found" }, 404);
  if (ctx.demo) return json({ state: "off", note: "The demo does not read a CRM.", messages: [] });
  try {
    // The copy only knows conversations a sync has pulled: ask the CRM itself before saying there is none (and keep what it says).
    if (!lead.conversationId) {
      const found = await crmSource(await h.locationToken(locationId), locationId).conversation(contactId).catch(() => null);
      if (found) { await cacheConversations(ctx.installationId, locationId, [found]).catch(() => undefined); lead.conversationId = found.conversationId; }
    }
    if (!lead.conversationId) return json({ state: "empty", note: "No conversation with this person yet.", messages: [] });
    const messages = await fetchThread(await h.locationToken(locationId), lead.conversationId);
    const names = await teamNames(ctx.installationId);
    return json({ state: "ok", note: null, messages: messages.map((x) => ({ ...x, by: x.by ? names.get(x.by) ?? null : null })) });
  } catch (e) {
    if (isPermissionError(e) || (e as { status?: number }).status === 403 || (e as { status?: number }).status === 401) return json({ state: "needs_permission", note: "Needs permission: reconnect SubSync to let it read messages.", messages: [] });
    return json({ state: "unavailable", note: "Your CRM did not answer. Try again in a moment.", messages: [] });
  }
}

async function actRoute(ctx: Ctx, h: WorkbenchHelpers, doIt: boolean): Promise<Response> {
  const body = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Send the action" }, 400);
  // A text or an email goes through its own path (send-routes.ts): the flag, the rules, the live do-not-contact check, the preview and the record.
  if ((body.action as { kind?: unknown } | null)?.kind === "message") {
    return messageRoute(ctx, { allowed: () => h.allowed(), locationToken: h.locationToken, loadLead: async (loc, cid) => { const l = await loadLead(ctx, await h.allowed(), loc, cid); return l ? { target: l.target, locationName: l.locationName } : null; } }, body, doIt);
  }
  const parsed = parseAction(body.action);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const action: Action = parsed.action;
  // A client's staff may message and note on their own account. They never delete.
  if (ctx.kind === "client" && OWNER_ONLY.has(action.kind)) return json({ error: "Ask your administrator to do this in your CRM." }, 403);
  const { locationId, contactId } = ids(ctx, body);
  if (!locationId) return json({ error: "Send the account" }, 400);
  const allowed = await h.allowed();
  if (allowed && !allowed.includes(locationId)) return json({ error: "Contact not found" }, 404);

  let lead: Loaded | null = null;
  let dealBefore: Before["deal"];
  let apptBefore: string | null | undefined;
  if (contactId) {
    lead = await loadLead(ctx, allowed, locationId, contactId);
    if (!lead) return json({ error: "Contact not found" }, 404);
  }
  if (action.kind === "deal") {
    const [d] = await dealsOf(ctx, locationId, { opportunityId: action.opportunityId });
    if (!d) return json({ error: "Deal not found" }, 404);
    // A deal belongs to the person it was opened from: another person's deal id is "not found".
    if (contactId) {
      const mine = await dealsOf(ctx, locationId, { contactId });
      if (!mine.some((x) => x.id === action.opportunityId)) return json({ error: "Deal not found" }, 404);
    }
    dealBefore = { pipelineId: d.pipelineId, stageId: d.stageId, status: d.status, value: d.value, ownerId: d.ownerId };
    if (!lead) lead = { target: { locationId, contactId: "-", name: d.name ?? "This deal", dnd: false, phone: null, email: null, timeZone: null }, before: {}, conversationId: null, locationName: null, ownerId: null, tags: [], fields: { firstName: "", lastName: "", email: "", phone: "" } };
  } else if (!lead) return json({ error: "Send the person" }, 400);
  if (action.kind === "owner") {
    // Server-side: the new owner must belong to THIS account (another account's person, or an unknown id, is refused).
    const members = await accountMembers(ctx, locationId);
    if (!members.some((m) => m.id === action.userId)) return json({ error: "That person is not on this account's team" }, 404);
  }
  if (action.kind === "deal_create") {
    // The pipeline and stage must be ones this account really has.
    const [pl] = await sql()`select stages from pipelines where installation_id = ${ctx.installationId} and location_id = ${locationId} and pipeline_id = ${action.pipelineId}`;
    if (!pl || !((pl.stages as Array<{ id: string }> | null) ?? []).some((st) => st.id === action.stageId)) return json({ error: "That pipeline or stage is not in this account" }, 404);
  }
  if (action.kind === "appointment" && contactId) {
    const appts = await apptsOf(ctx, locationId, contactId);
    const a = appts.find((x) => x.id === action.appointmentId);
    if (!a) return json({ error: "Appointment not found" }, 404);
    apptBefore = a.status;
  }
  const before: Before = { ...lead.before, ...(dealBefore ? { deal: dealBefore } : {}), ...(apptBefore !== undefined ? { appointmentStatus: apptBefore } : {}) };
  const mode = await modeOf(ctx, locationId);

  if (!doIt) {
    const plan = planAction(action, lead.target);
    return json({ ok: true, mode, plan: { summary: plan.summary, blockers: plan.blockers, warnings: plan.warnings, reversible: plan.reversible, fields: plan.fields } });
  }
  const ack = Array.isArray(body.ack) ? body.ack.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  const res = await runAction(
    {
      installationId: ctx.installationId, actor: actorOf(ctx), target: lead.target, action, optedIn: !ctx.demo && mode.optedIn, confirmed: body.confirm === true, ack,
      token: () => h.locationToken(locationId),
    },
    // The demo company is made up: it can never write, whatever the switch says.
    ctx.demo ? { env: {} } : {},
  );
  switch (res.outcome) {
    case "blocked": return json({ ok: false, blocked: true, blockers: res.blockers }, 422);
    case "needs_ack": return json({ ok: false, needsAck: true, warnings: res.warnings }, 409);
    case "needs_confirm": return json({ ok: false, message: "Confirm to continue." }, 409);
    case "rate_limited": return json({ ok: false, message: `Slow down a little: try again in ${res.retryInSeconds} seconds.`, retryInSeconds: res.retryInSeconds }, 429);
    case "needs_permission": return json({ ok: false, needsPermission: true, message: "Needs permission: reconnect SubSync so it may make this change. Nothing was changed." }, 403);
    case "failed": return json({ ok: false, message: failureText(res.status), retry: true }, 502);
    case "dry_run": return json({ ok: true, dryRun: true, reason: res.reason, summary: res.summary, message: res.reason === "account" ? "Not allowed for this account yet, so nothing was sent. Here is what would have happened." : "Changes from SubSync are switched off, so nothing was sent. Here is what would have happened." });
    case "done": { if (contactId && !ctx.demo) await refreshLead(ctx.installationId, await h.locationToken(locationId), locationId, contactId); const undo = inverseOf(action, before, res.id); return json({ ok: true, done: true, summary: res.summary, undo }); }
  }
}

// ---------------- the rest of the contact record, read live when a part is opened (nothing here is stored) ----------------
//   notes  GET /contacts/{id}/notes   scope contacts.readonly (required scope: granted)
//   tasks  GET /contacts/{id}/tasks   scope contacts.readonly
//   money  GET /payments/orders?contactId   scope payments/orders.readonly (NOT in SubSync's scope list today: always "Needs permission: reconnect" until it is added as an optional scope)
// The lead is re-read from SubSync's own copy of THAT account first (tenancy), and the answers carry only what the screen shows.
const NOTE_BODY = 4000;
async function recordRoute(ctx: Ctx, h: WorkbenchHelpers): Promise<Response> {
  const { locationId, contactId } = ids(ctx, ctx.url.searchParams);
  const part = ctx.url.searchParams.get("part");
  if (!locationId || !contactId || (part !== "notes" && part !== "tasks" && part !== "money")) return json({ error: "Send the account, the person and the part" }, 400);
  const lead = await loadLead(ctx, await h.allowed(), locationId, contactId);
  if (!lead) return json({ error: "Contact not found" }, 404);
  if (ctx.demo) return json({ state: "off", note: "The demo does not read your CRM.", items: [] });
  if (part === "money") {
    const [inst] = await sql()`select scope from installations where id = ${ctx.installationId}`;
    const g = typeof inst?.scope === "string" && inst.scope.trim() ? parseGranted(inst.scope as string) : [];
    if (!g.includes("payments/orders.readonly")) return json({ state: "needs_permission", note: "Needs permission: reconnect to let SubSync read this person's orders and payments.", items: [] });
  }
  try {
    const token = await h.locationToken(locationId);
    const path = part === "notes" ? `/contacts/${encodeURIComponent(contactId)}/notes` : part === "tasks" ? `/contacts/${encodeURIComponent(contactId)}/tasks` : `/payments/orders?altId=${encodeURIComponent(locationId)}&altType=location&contactId=${encodeURIComponent(contactId)}&limit=20`;
    const res = await ghlFetch(`${GHL_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) return json({ state: "needs_permission", note: "Needs permission: reconnect SubSync to let it read this.", items: [] });
    if (!res.ok) return json({ state: "unavailable", note: "Your CRM did not answer. Try again later.", items: [] });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const names = await teamNames(ctx.installationId);
    const who = (id: unknown) => (typeof id === "string" && id ? names.get(id) ?? null : null);
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    if (part === "notes") {
      const list = (Array.isArray(j.notes) ? j.notes : []) as Array<Record<string, unknown>>;
      return json({ state: "ok", note: null, items: list.slice(0, 100).map((n) => ({ id: str(n.id), text: (str(n.body) ?? "").slice(0, NOTE_BODY), by: isOurNote(str(n.body)) ? "SubSync" : who(n.userId), at: str(n.dateAdded) ?? str(n.createdAt), ours: isOurNote(str(n.body)) })) });
    }
    if (part === "tasks") {
      const list = (Array.isArray(j.tasks) ? j.tasks : []) as Array<Record<string, unknown>>;
      return json({ state: "ok", note: null, items: list.slice(0, 100).map((t) => ({ id: str(t.id), title: str(t.title) ?? "Task", due: str(t.dueDate), done: t.completed === true, by: who(t.assignedTo) })) });
    }
    const orders = (Array.isArray(j.data) ? j.data : []) as Array<Record<string, unknown>>;
    return json({ state: "ok", note: null, items: orders.slice(0, 20).map((o) => ({ id: str(o._id) ?? str(o.id), title: str(o.name) ?? str(o.sourceName) ?? "Order", amount: typeof o.amount === "number" ? o.amount : null, currency: str(o.currency), status: str(o.status) ?? str(o.paymentStatus), at: str(o.createdAt) })) });
  } catch {
    return json({ state: "unavailable", note: "Your CRM did not answer. Try again later.", items: [] });
  }
}
