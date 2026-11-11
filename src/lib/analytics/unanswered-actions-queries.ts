import { sql } from "../db";
import { properCase } from "./people-labels";
import { WAITING_WINDOW_DAYS } from "./waiting";
import { DEFAULT_HIDE, NOISE_TAGS, type HideReason, type HideSettings, type SnoozeReason } from "./unanswered-actions";

// The data behind the Unanswered actions (round 3, slice B). Every query is bound to an installation id that comes from the verified session and, for anything about a client
// account, to `allowed` (the accounts the router decided the caller may read) or to one location the caller already passed through that check. No message text is read or
// stored: hiding uses who sent the last message and how (direction and the message's own automated flag), tags, and the marks people made in SubSync.

type Db = ReturnType<typeof sql>;
const DAY = 86_400_000;

// ---------------- the one rule for "why is this person hidden" (the SQL twin of hideReason in unanswered-actions.ts) ----------------

/**
 * A SQL expression naming why a waiting conversation is hidden by default, or null. Aliases it needs: c = cached_conversations, ct = cached_contacts (left joined), l = locations.
 * One reason each, in the same order as hideReason(): set aside, not a lead, your own team or spam, automatic messages.
 */
export function reasonSql(db: Db, s: HideSettings = DEFAULT_HIDE) {
  return db`case
    when exists (select 1 from unanswered_snoozes z where z.installation_id = c.installation_id and z.location_id = c.location_id and z.conversation_id = c.conversation_id and z.released_at is null and z.until_at > now()) then 'snoozed'
    ${s.notALead ? db`when (select o.outcome from unanswered_outcomes o where o.installation_id = c.installation_id and o.location_id = c.location_id and (o.conversation_id = c.conversation_id or (c.contact_id is not null and o.contact_id = c.contact_id)) order by o.created_at desc limit 1) = 'not_a_lead' then 'not_a_lead'` : db``}
    ${s.internal ? db`when (ct.contact_id is not null and exists (select 1 from unnest(ct.tags) t where lower(btrim(t)) = any(${[...NOISE_TAGS]}::text[])))
      or (nullif(btrim(ct.email), '') is not null and lower(btrim(ct.email)) = lower(btrim(l.email)))
      or (length(regexp_replace(coalesce(ct.phone, ''), '\\D', '', 'g')) >= 7 and right(regexp_replace(coalesce(ct.phone, ''), '\\D', '', 'g'), 10) = right(regexp_replace(coalesce(l.phone, ''), '\\D', '', 'g'), 10)) then 'internal'` : db``}
    ${s.automatic ? db`when c.contact_id is not null and exists (select 1 from touch_events te where te.installation_id = c.installation_id and te.location_id = c.location_id and te.contact_id = c.contact_id and te.direction = 'inbound' and te.automated and te.at between c.last_message_at - interval '1 minute' and c.last_message_at + interval '1 minute') then 'automatic'` : db``}
    else null end`;
}

/** "and the person is not hidden": the line the waiting list's own query adds when the hide flag is on. */
export const notHidden = (db: Db, s: HideSettings = DEFAULT_HIDE) => db`and (${reasonSql(db, s)}) is null`;

// ---------------- settings ----------------

export async function loadHideSettings(installationId: string): Promise<HideSettings> {
  try {
    const [r] = await sql()`select hide_not_a_lead, hide_internal, hide_automatic from unanswered_hide_settings where installation_id = ${installationId}`;
    return r ? { notALead: r.hide_not_a_lead === true, internal: r.hide_internal === true, automatic: r.hide_automatic === true } : DEFAULT_HIDE;
  } catch { return DEFAULT_HIDE; } // table not applied yet: the defaults
}

export async function saveHideSettings(installationId: string, s: HideSettings, by: string | null): Promise<void> {
  await sql()`
    insert into unanswered_hide_settings (installation_id, hide_not_a_lead, hide_internal, hide_automatic, updated_by, updated_at)
    values (${installationId}, ${s.notALead}, ${s.internal}, ${s.automatic}, ${by}, now())
    on conflict (installation_id) do update set hide_not_a_lead = excluded.hide_not_a_lead, hide_internal = excluded.hide_internal, hide_automatic = excluded.hide_automatic, updated_by = excluded.updated_by, updated_at = now()`;
}

// ---------------- counts and pages of the hidden people ----------------

export type HiddenSummary = { total: number } & Record<HideReason, number>;
const emptySummary = (): HiddenSummary => ({ total: 0, snoozed: 0, not_a_lead: 0, internal: 0, automatic: 0 });

/** The waiting conversations (same window and reply target as the list) that are hidden, counted by reason in SQL. The "N hidden, show" line reads this. */
function hiddenBase(db: Db, i: { installationId: string; allowed: string[] | null; now: number; slaHours: number }, s: HideSettings) {
  return db`
    from cached_conversations c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
    where c.installation_id = ${i.installationId} and c.last_message_direction = 'inbound'
      and c.last_message_at > ${new Date(i.now - WAITING_WINDOW_DAYS * DAY)}
      and c.last_message_at < ${new Date(i.now)} - (case when l.speed_target_minutes > 0 then (l.speed_target_minutes + 59) / 60 else ${i.slaHours} end) * interval '1 hour'
      ${i.allowed ? db`and c.location_id = any(${i.allowed}::text[])` : db``}
      and (${reasonSql(db, s)}) is not null`;
}

export async function hiddenSummary(i: { installationId: string; allowed: string[] | null; now: number; slaHours: number }, s: HideSettings): Promise<HiddenSummary> {
  if (i.allowed && i.allowed.length === 0) return emptySummary();
  const db = sql();
  const rows = await db`select r.reason, count(*)::int n from (select ${reasonSql(db, s)} as reason ${hiddenBase(db, i, s)}) r group by r.reason`;
  const out = emptySummary();
  for (const r of rows) { const k = r.reason as HideReason; if (k in out) { out[k] = Number(r.n); out.total += Number(r.n); } }
  return out;
}

export type HiddenRow = {
  key: string; locationId: string; locationName: string; contactId: string | null; conversationId: string; name: string; channel: string | null; hours: number;
  reason: HideReason; until: string | null; snoozeReason: SnoozeReason | null;
};

/** One page of the hidden people, oldest wait first, with the reason. Server paged (never more than 100). */
export async function hiddenPage(i: { installationId: string; allowed: string[] | null; now: number; slaHours: number; reason: HideReason | null; page: number; size: number }, s: HideSettings): Promise<{ total: number; page: number; pages: number; rows: HiddenRow[] }> {
  if (i.allowed && i.allowed.length === 0) return { total: 0, page: 0, pages: 1, rows: [] };
  const db = sql();
  const size = Math.min(100, Math.max(1, Math.floor(i.size) || 25));
  const page = Math.max(0, Math.floor(i.page) || 0);
  const rows = await db`
    select * from (
      select c.conversation_id, c.location_id, l.name location_name, c.contact_id, c.last_message_type, c.last_message_at,
        coalesce(nullif(btrim(c.contact_name), ''), nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), '')) name,
        ${reasonSql(db, s)} as reason,
        (select z.until_at from unanswered_snoozes z where z.installation_id = c.installation_id and z.location_id = c.location_id and z.conversation_id = c.conversation_id and z.released_at is null and z.until_at > now() order by z.created_at desc limit 1) snooze_until,
        (select z.reason from unanswered_snoozes z where z.installation_id = c.installation_id and z.location_id = c.location_id and z.conversation_id = c.conversation_id and z.released_at is null and z.until_at > now() order by z.created_at desc limit 1) snooze_reason
      ${hiddenBase(db, i, s)}
    ) r
    ${i.reason ? db`where r.reason = ${i.reason}` : db``}
    order by r.last_message_at asc, r.conversation_id
    limit ${size} offset ${page * size}`;
  const [{ n }] = await db`select count(*)::int n from (select ${reasonSql(db, s)} as reason ${hiddenBase(db, i, s)}) r ${i.reason ? db`where r.reason = ${i.reason}` : db``}`;
  const total = Number(n);
  return {
    total, page, pages: Math.max(1, Math.ceil(total / size)),
    rows: rows.map((r) => ({
      key: `${r.location_id}:${r.conversation_id}`, locationId: r.location_id as string, locationName: (r.location_name as string | null) ?? "Client account", contactId: (r.contact_id as string | null) ?? null,
      conversationId: r.conversation_id as string, name: r.name ? properCase(r.name as string) : "Unknown contact", channel: (r.last_message_type as string | null) ?? null,
      hours: Math.max(0, Math.round(((i.now - (r.last_message_at as Date).getTime()) / 3_600_000) * 10) / 10), reason: r.reason as HideReason,
      until: r.snooze_until ? (r.snooze_until as Date).toISOString() : null, snoozeReason: (r.snooze_reason as SnoozeReason | null) ?? null,
    })),
  };
}

// ---------------- snoozes ----------------

export type WaitingConv = { conversationId: string; contactId: string | null; assignedTo: string | null; timeZone: string | null; name: string };

/** The conversations the caller named, only when they are waiting (customer wrote last) in the one account, as SubSync has them. Anything else is not returned. */
export async function waitingConversationsOf(installationId: string, locationId: string, conversationIds: readonly string[]): Promise<WaitingConv[]> {
  if (conversationIds.length === 0) return [];
  const rows = await sql()`
    select c.conversation_id, c.contact_id, nullif(ct.assigned_to, '') assigned_to, l.timezone,
      coalesce(nullif(btrim(c.contact_name), ''), nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), ''), 'This person') name
    from cached_conversations c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
    where c.installation_id = ${installationId} and c.location_id = ${locationId} and c.conversation_id = any(${[...conversationIds]}::text[])`;
  return rows.map((r) => ({ conversationId: r.conversation_id as string, contactId: (r.contact_id as string | null) ?? null, assignedTo: (r.assigned_to as string | null) ?? null, timeZone: (r.timezone as string | null) ?? null, name: properCase(r.name as string) }));
}

/** Sets one conversation aside. Any earlier active snooze on it is released first, so there is only ever one. */
export async function createSnooze(i: { installationId: string; locationId: string; conversationId: string; contactId: string | null; reason: SnoozeReason; until: number; by: string }): Promise<void> {
  const db = sql();
  await db.begin(async (tx) => {
    await tx`update unanswered_snoozes set released_at = now(), released_by = ${i.by} where installation_id = ${i.installationId} and location_id = ${i.locationId} and conversation_id = ${i.conversationId} and released_at is null`;
    await tx`insert into unanswered_snoozes (installation_id, location_id, conversation_id, contact_id, reason, until_at, created_by) values (${i.installationId}, ${i.locationId}, ${i.conversationId}, ${i.contactId}, ${i.reason}, ${new Date(i.until)}, ${i.by})`;
  });
}

/** Brings a set-aside conversation back. Returns how many were released. */
export async function releaseSnoozes(i: { installationId: string; locationId: string; conversationIds: readonly string[]; by: string }): Promise<number> {
  if (i.conversationIds.length === 0) return 0;
  const rows = await sql()`update unanswered_snoozes set released_at = now(), released_by = ${i.by} where installation_id = ${i.installationId} and location_id = ${i.locationId} and conversation_id = any(${[...i.conversationIds]}::text[]) and released_at is null returning id`;
  return rows.length;
}

// ---------------- contacts: protection facts, owner, action log ----------------

export type ContactFacts = { contactId: string; name: string; dnd: boolean; owner: string | null; openDeals: number; wonDeals: number; upcomingAppointments: number };

/** Owner, do-not-disturb, deals and appointments for the contacts named, in one query (never one query per person). */
export async function contactFacts(installationId: string, locationId: string, contactIds: readonly string[]): Promise<Map<string, ContactFacts>> {
  const out = new Map<string, ContactFacts>();
  if (contactIds.length === 0) return out;
  const ids = [...contactIds];
  const rows = await sql()`
    select ct.contact_id, coalesce(nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), ''), 'This person') name, coalesce(ct.dnd, false) dnd, nullif(ct.assigned_to, '') owner,
      (select count(*)::int from cached_opportunities o where o.installation_id = ct.installation_id and o.location_id = ct.location_id and o.contact_id = ct.contact_id and coalesce(o.status, 'open') = 'open') open_deals,
      (select count(*)::int from cached_opportunities o where o.installation_id = ct.installation_id and o.location_id = ct.location_id and o.contact_id = ct.contact_id and o.status = 'won') won_deals,
      (select count(*)::int from cached_appointments a where a.installation_id = ct.installation_id and a.location_id = ct.location_id and a.contact_id = ct.contact_id and a.start_at > now() and coalesce(lower(a.status), '') not in ('cancelled', 'canceled', 'invalid')) upcoming
    from cached_contacts ct where ct.installation_id = ${installationId} and ct.location_id = ${locationId} and ct.contact_id = any(${ids}::text[])`;
  for (const r of rows) out.set(r.contact_id as string, { contactId: r.contact_id as string, name: properCase(r.name as string), dnd: r.dnd === true, owner: (r.owner as string | null) ?? null, openDeals: Number(r.open_deals), wonDeals: Number(r.won_deals), upcomingAppointments: Number(r.upcoming) });
  return out;
}

export type ActionLogRow = { locationId: string; batchId: string; action: "claim" | "assign" | "clear_junk" | "note" | "undo_assign"; conversationId: string | null; contactId: string | null; beforeOwner: string | null; afterOwner: string | null; result: string; actor: string | null };

/** One row per item. Ids and owner ids only. A log that cannot be written never turns a finished change into an error (the gateway audit line still holds it). */
export async function logActions(installationId: string, rows: readonly ActionLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const db = sql();
    await db`insert into unanswered_actions ${db(rows.map((r) => ({ installation_id: installationId, location_id: r.locationId, batch_id: r.batchId, action: r.action, conversation_id: r.conversationId, contact_id: r.contactId, before_owner: r.beforeOwner, after_owner: r.afterOwner, result: r.result, actor: r.actor })))}`;
  } catch { /* see above */ }
}

/** What an assignment batch changed, so it can be put back. Only items that really changed and had an owner before. */
export async function assignedBatch(installationId: string, batchId: string): Promise<Array<{ locationId: string; contactId: string; before: string; after: string }>> {
  const rows = await sql()`select location_id, contact_id, before_owner, after_owner from unanswered_actions where installation_id = ${installationId} and batch_id = ${batchId} and action in ('assign', 'claim') and result = 'done' and contact_id is not null and before_owner is not null`;
  return rows.map((r) => ({ locationId: r.location_id as string, contactId: r.contact_id as string, before: r.before_owner as string, after: r.after_owner as string }));
}

/** Records a "not a lead" mark on the person (the same table the outcome buttons write), so the person leaves the list by default. */
export async function markNotALead(installationId: string, rows: ReadonlyArray<{ locationId: string; conversationId: string; contactId: string | null }>, by: string): Promise<void> {
  if (rows.length === 0) return;
  const db = sql();
  await db`insert into unanswered_outcomes ${db(rows.map((r) => ({ installation_id: installationId, location_id: r.locationId, conversation_id: r.conversationId, contact_id: r.contactId, outcome: "not_a_lead", recorded_by: by })))}`;
}
