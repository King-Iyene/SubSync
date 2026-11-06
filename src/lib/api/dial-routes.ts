import { callQueueAll, listCallLists, logOutcome } from "../analytics/call-queries";
import { parseFilters, type Filters } from "../analytics/call-intel";
import { teamNames } from "../analytics/inbox-queries";
import { recordTouchEvents } from "../analytics/touch-events-db";
import { sql } from "../db";
import { DEFAULT_SCRIPT, DIAL_LISTS, followUpDays, isDialOutcome, isListId, outcomeOf, rankQueue, SCRIPT_MAX, statsByUser, type QueueItem } from "../dial/dial";
import type { deepLinks } from "../links";
import { json, type AuthContext } from "./auth";

// Call mode's endpoints, under /api/app/dial/* (the one catch-all route, already guarded). SubSync places no call: these routes order the queue, keep the per-account script and
// record how a call went. Who is asking comes from the verified session; the accounts they may read come from `allowed` (derived by the router), never from the request. A client's
// staff (kind "client") only ever get the leads assigned to them.

type Ctx = AuthContext & { request: Request; url: URL; segments: string[] };
export type DialHelpers = { allowed: () => Promise<string[] | null>; links: () => Promise<ReturnType<typeof deepLinks>> };

const ID = /^[A-Za-z0-9_-]{3,128}$/;
export const SESSION_CAP = 150;
const HOUR = 3_600_000;

/** The queue rows of a source list, with Do Not Disturb and owner read from SubSync's own copy of the contacts. */
async function sourceRows(ctx: Ctx, allowed: string[] | null, list: string): Promise<Array<Omit<QueueItem, "url" | "dnd"> & { ownerId: string | null; dnd: boolean }>> {
  const db = sql();
  const accountFilter = allowed ? db`and c.location_id = any(${allowed}::text[])` : db``;
  if (list === "missed") {
    const rows = await db`
      select m.location_id, m.contact_id, m.missed_at, nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '') name, c.phone, c.dnd, nullif(c.assigned_to, '') owner,
        l.name location_name, l.timezone, coalesce(d.open_value, 0)::float8 open_value
      from (
        select e.location_id, e.contact_id, max(e.at) missed_at from touch_events e
        where e.installation_id = ${ctx.installationId} and e.kind = 'missed_call' and e.at > now() - interval '7 days'
          and not exists (select 1 from touch_events o where o.installation_id = e.installation_id and o.location_id = e.location_id and o.contact_id = e.contact_id and o.direction = 'outbound' and o.at > e.at)
          and not exists (select 1 from call_outcomes co where co.installation_id = e.installation_id and co.location_id = e.location_id and co.contact_id = e.contact_id and co.created_at > e.at)
        group by e.location_id, e.contact_id limit 400
      ) m
      join cached_contacts c on c.installation_id = ${ctx.installationId} and c.location_id = m.location_id and c.contact_id = m.contact_id ${accountFilter}
      join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
      left join deals d on d.installation_id = c.installation_id and d.location_id = c.location_id and d.contact_id = c.contact_id`;
    return rows.map((r) => ({
      contactId: r.contact_id as string, locationId: r.location_id as string, locationName: (r.location_name as string | null) ?? null, name: (r.name as string | null) ?? "Unknown caller", phone: (r.phone as string | null) ?? null,
      dnd: r.dnd === true, timeZone: (r.timezone as string | null) ?? null, openValue: r.open_value as number, ageHours: Math.max(0, (Date.now() - new Date(r.missed_at as string).getTime()) / HOUR),
      priority: 50, reasons: ["Missed call, no callback yet"], ownerId: (r.owner as string | null) ?? null,
    }));
  }
  let filters: Filters;
  if (list.startsWith("saved:")) {
    const saved = (await listCallLists(ctx.installationId)).find((l) => l.id === list.slice(6));
    if (!saved) return [];
    const p = parseFilters(saved.filters);
    if (!p.ok) return [];
    filters = p.filters;
  } else {
    const p = parseFilters({ preset: list });
    if (!p.ok) return [];
    filters = p.filters;
  }
  const q = await callQueueAll(ctx.installationId, allowed, filters);
  const rows = q.rows.slice(0, 400);
  if (rows.length === 0) return [];
  const meta = await db`select location_id, contact_id, dnd, nullif(assigned_to, '') owner from cached_contacts where installation_id = ${ctx.installationId} and contact_id = any(${rows.map((r) => r.contactId)}::text[])`;
  const by = new Map(meta.map((m) => [`${m.location_id}:${m.contact_id}`, m]));
  return rows.map((r) => {
    const m = by.get(`${r.locationId}:${r.contactId}`);
    return { contactId: r.contactId, locationId: r.locationId, locationName: r.locationName, name: r.name || "Unknown", phone: r.phone, dnd: m?.dnd === true, timeZone: r.timeZone, openValue: r.openValue, ageHours: r.idleDays === null ? null : r.idleDays * 24, priority: r.priority, reasons: r.reasons, ownerId: (m?.owner as string | null) ?? null };
  });
}

async function queueRoute(ctx: Ctx, h: DialHelpers): Promise<Response> {
  const list = ctx.url.searchParams.get("list") ?? "missed";
  if (!isListId(list)) return json({ error: "Unknown list" }, 400);
  const [allowed, links, saved] = await Promise.all([h.allowed(), h.links(), listCallLists(ctx.installationId)]);
  let rows = await sourceRows(ctx, allowed, list);
  // A client's staff only ever work their own leads (decided here, from the session, never from the address).
  if (ctx.kind === "client") rows = ctx.session.userId ? rows.filter((r) => r.ownerId === ctx.session.userId) : [];
  const ranked = rankQueue(rows).slice(0, SESSION_CAP);
  return json({
    list, lists: [...DIAL_LISTS, ...saved.map((s) => ({ id: `saved:${s.id}`, label: s.name, help: "Your saved filter." }))], total: rows.length, ownOnly: ctx.kind === "client",
    me: ctx.session.userName ?? null,
    items: ranked.map((r) => ({ contactId: r.contactId, locationId: r.locationId, locationName: r.locationName, name: r.name, phone: r.phone, dnd: r.dnd, timeZone: r.timeZone, openValue: r.openValue, ageHours: r.ageHours, priority: r.priority, reasons: r.reasons, url: links.contact(r.locationId, r.contactId) })),
  });
}

/** One tap after a call: SubSync's own record (the person leaves the call lists) and a touch event (metadata only). The CRM note and task go through the workbench gateway from the browser. */
async function outcomeRoute(ctx: Ctx, h: DialHelpers): Promise<Response> {
  const b = (await ctx.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b.locationId !== "string" || !ID.test(b.locationId) || typeof b.contactId !== "string" || !ID.test(b.contactId) || !isDialOutcome(b.outcome)) return json({ error: "Choose the person and the outcome." }, 400);
  const callbackAt = typeof b.callbackAt === "string" && !Number.isNaN(Date.parse(b.callbackAt)) ? b.callbackAt : null;
  const o = outcomeOf(b.outcome);
  const now = new Date();
  const ok = await logOutcome(ctx.installationId, await h.allowed(), { locationId: b.locationId, contactId: b.contactId, outcome: o.local, note: null, followUpInDays: o.key === "call_back" ? followUpDays(callbackAt, now) : null });
  if (!ok) return json({ error: "Contact not found" }, 404);
  await recordTouchEvents(ctx.installationId, [{
    key: `dial:${b.contactId}:${now.getTime()}`, locationId: b.locationId, contactId: b.contactId, conversationId: null, direction: "outbound", channel: "call", kind: "call", at: now.getTime(),
    userId: ctx.session.userId ?? null, automated: false, source: "subsync_call", outcome: o.key,
  }]);
  return json({ ok: true });
}

/** Calls per hour and outcomes per person for the last 12 hours. Managers see everyone; a client's staff see only themselves. */
async function statsRoute(ctx: Ctx, h: DialHelpers): Promise<Response> {
  const allowed = await h.allowed();
  const db = sql();
  const rows = await db`
    select user_id, outcome, at from touch_events where installation_id = ${ctx.installationId} and source = 'subsync_call' and at > now() - interval '12 hours'
      ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} ${ctx.kind === "client" ? db`and user_id = ${ctx.session.userId ?? "-"}` : db``} limit 5000`;
  const names = await teamNames(ctx.installationId);
  const people = statsByUser(rows.map((r) => ({ userId: (r.user_id as string | null) ?? null, outcome: (r.outcome as string | null) ?? null, at: new Date(r.at as string).getTime() })));
  return json({ people: people.map((p) => ({ ...p, name: p.userId === ctx.session.userId ? "You" : names.get(p.userId) ?? "A team member" })), own: ctx.kind === "client" });
}

async function scriptRoute(ctx: Ctx, h: DialHelpers): Promise<Response> {
  const allowed = await h.allowed();
  const put = ctx.request.method === "PUT";
  const body = put ? ((await ctx.request.json().catch(() => null)) as Record<string, unknown> | null) : null;
  const locationId = put ? body?.locationId : ctx.url.searchParams.get("locationId");
  if (typeof locationId !== "string" || !ID.test(locationId) || (allowed && !allowed.includes(locationId))) return json({ error: "Client account not found." }, 404);
  const db = sql();
  const [own] = await db`select 1 from locations where installation_id = ${ctx.installationId} and location_id = ${locationId}`;
  if (!own) return json({ error: "Client account not found." }, 404);
  if (put) {
    if (ctx.kind === "client") return json({ error: "Ask your administrator to change the script." }, 403);
    const raw = body?.script;
    const script = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (script && script.length > SCRIPT_MAX) return json({ error: `Keep the script under ${SCRIPT_MAX} characters.` }, 400);
    try { await db`update locations set call_script = ${script} where installation_id = ${ctx.installationId} and location_id = ${locationId}`; }
    catch { return json({ error: "Saving a script for one client needs the latest database update, which has not run yet. Your script is kept in this browser meanwhile." }, 503); }
    return json({ ok: true });
  }
  let script: string | null = null;
  try { const [r] = await db`select call_script from locations where installation_id = ${ctx.installationId} and location_id = ${locationId}`; script = (r?.call_script as string | null) ?? null; } catch { script = null; }
  return json({ script, default: DEFAULT_SCRIPT, canEdit: ctx.kind !== "client" });
}

export async function handleDial(ctx: Ctx, h: DialHelpers): Promise<Response> {
  const what = ctx.segments[1];
  const m = ctx.request.method;
  if (what === "queue" && m === "GET") return queueRoute(ctx, h);
  if (what === "outcome" && m === "POST") return outcomeRoute(ctx, h);
  if (what === "stats" && m === "GET") return statsRoute(ctx, h);
  if (what === "script" && (m === "GET" || m === "PUT")) return scriptRoute(ctx, h);
  return json({ error: "Not found" }, 404);
}
