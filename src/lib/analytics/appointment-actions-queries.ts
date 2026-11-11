import { sql } from "../db";
import type { ApptFacts, ApptPlan, OtherBooking } from "./appointment-actions";

// The data behind changing appointments (Appointments module, slice AB). Every query names the installation (from the verified session) AND one location the router already
// proved the caller may read. Ids sent by the browser only ever pick rows INSIDE that pair. No name, note or message is stored by anything here: the action log keeps ids, times and status.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const DAY = 86_400_000;

export async function loadFacts(installationId: string, locationId: string, ids: readonly string[]): Promise<ApptFacts[]> {
  if (ids.length === 0) return [];
  const rows = await sql()`
    select a.appointment_id, a.calendar_id, a.calendar_name, a.contact_id, a.title, a.status, a.start_at, a.end_at, a.assigned_to,
      coalesce(nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), ''), 'Unknown contact') name
    from cached_appointments a
    left join cached_contacts ct on ct.installation_id = a.installation_id and ct.location_id = a.location_id and ct.contact_id = a.contact_id
    where a.installation_id = ${installationId} and a.location_id = ${locationId} and a.appointment_id = any(${[...ids]}::text[])`;
  return rows.map((r) => ({
    appointmentId: r.appointment_id as string, locationId, calendarId: (r.calendar_id as string | null) ?? null, calendarName: (r.calendar_name as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null,
    contactName: r.name as string, title: (r.title as string | null) ?? null, status: (r.status as string | null) ?? null, startAt: iso(r.start_at), endAt: iso(r.end_at), assignedTo: (r.assigned_to as string | null) ?? null,
  }));
}

/** Everything booked within a day either side of [from, to] in this account (for the double-booking check). At most 500 rows. */
export async function othersAround(installationId: string, locationId: string, from: number, to: number): Promise<OtherBooking[]> {
  const rows = await sql()`
    select appointment_id, start_at, end_at, assigned_to, calendar_id, status, title from cached_appointments
    where installation_id = ${installationId} and location_id = ${locationId} and start_at is not null and end_at is not null
      and start_at < ${new Date(to + DAY).toISOString()} and end_at > ${new Date(from - DAY).toISOString()} limit 500`;
  return rows.map((r) => ({ appointmentId: r.appointment_id as string, startAt: iso(r.start_at) as string, endAt: iso(r.end_at) as string, assignedTo: (r.assigned_to as string | null) ?? null, calendarId: (r.calendar_id as string | null) ?? null, status: (r.status as string | null) ?? null, title: (r.title as string | null) ?? null }));
}

export async function calendarsOf(installationId: string, locationId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await sql()`select calendar_id, max(calendar_name) name from cached_appointments where installation_id = ${installationId} and location_id = ${locationId} and calendar_id is not null group by calendar_id order by max(calendar_name) limit 100`;
  return rows.map((r) => ({ id: r.calendar_id as string, name: (r.name as string | null) ?? "Calendar" }));
}

/** The account's time zone name and its offset in minutes from UTC right now (0 when unknown). */
export async function zoneOf(installationId: string, locationId: string): Promise<{ tz: string | null; offsetMinutes: number }> {
  try {
    const [r] = await sql()`select timezone from locations where installation_id = ${installationId} and location_id = ${locationId}`;
    const tz = (r?.timezone as string | null) ?? null;
    if (!tz) return { tz: null, offsetMinutes: 0 };
    const now = new Date();
    const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    return { tz, offsetMinutes: Math.round((local.getTime() - utc.getTime()) / 60_000) };
  } catch { return { tz: null, offsetMinutes: 0 }; }
}

/** Show rate by hour of the account's local day, from marked appointments in the last 180 days. Null until there are at least 40 marked ones: nothing is invented. */
export async function hourShowRates(installationId: string, locationId: string, offsetMinutes: number): Promise<Record<number, number> | null> {
  const rows = await sql()`
    select extract(hour from (start_at + make_interval(mins => ${offsetMinutes})))::int h, count(*)::int n, count(*) filter (where lower(status) = 'showed')::int shown
    from cached_appointments where installation_id = ${installationId} and location_id = ${locationId} and start_at > now() - interval '180 days' and start_at < now() and lower(coalesce(status, '')) in ('showed', 'noshow')
    group by 1`;
  const total = rows.reduce((s, r) => s + Number(r.n), 0);
  if (total < 40) return null;
  const out: Record<number, number> = {};
  for (const r of rows) if (Number(r.n) >= 5) out[Number(r.h)] = Number(r.shown) / Number(r.n);
  return Object.keys(out).length ? out : null;
}

// ---------------- the audit log and undo ----------------

export type ApptLogRow = { locationId: string; batchId: string; action: "status" | "reschedule" | "reassign" | "edit" | "create" | "delete" | "undo"; appointmentId: string | null; contactId: string | null; before: Record<string, unknown>; after: Record<string, unknown>; result: string; actor: string | null };
export async function logAppt(installationId: string, rows: readonly ApptLogRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const db = sql();
    await db`insert into appointment_actions ${db(rows.map((r) => ({ installation_id: installationId, location_id: r.locationId, batch_id: r.batchId, action: r.action, appointment_id: r.appointmentId, contact_id: r.contactId, before_value: db.json(r.before as never), after_value: db.json(r.after as never), result: r.result, actor: r.actor })))}`;
  } catch { /* the table may not be applied yet; the audit_log line from the gateway still exists */ }
}

export type FeedRow = { at: string; source: "subsync" | "crm"; text: string; batchId: string | null; undoable: boolean; actor: string | null };

/** The full change timeline of one appointment: the platform's own recorded changes and everything done from SubSync, newest last. Undoable only while open and not undone. */
export async function timeline(installationId: string, locationId: string, appointmentId: string, undoMinutes: number): Promise<FeedRow[]> {
  const db = sql();
  const [ev, act] = await Promise.all([
    db`select kind, from_value, to_value, occurred_at from appointment_events where installation_id = ${installationId} and location_id = ${locationId} and appointment_id = ${appointmentId} order by occurred_at limit 60`,
    db`select action, batch_id, result, actor, created_at, before_value from appointment_actions where installation_id = ${installationId} and location_id = ${locationId} and appointment_id = ${appointmentId} order by created_at limit 60`.catch(() => []),
  ]);
  const undone = new Set(act.filter((r) => r.action === "undo" && r.result === "done").map((r) => (r.before_value as { batchId?: string } | null)?.batchId).filter(Boolean) as string[]);
  const out: FeedRow[] = [];
  const kindWord = (k: string, from: string | null, to: string | null) => k === "created" ? "Booked" : k === "status" ? `Outcome changed${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}` : "Time changed";
  for (const e of ev) out.push({ at: iso(e.occurred_at) as string, source: "crm", text: kindWord(e.kind as string, (e.from_value as string | null) ?? null, (e.to_value as string | null) ?? null), batchId: null, undoable: false, actor: null });
  const WORD: Record<string, string> = { status: "Outcome set from SubSync", reschedule: "Moved from SubSync", reassign: "Owner changed from SubSync", edit: "Edited from SubSync", create: "Booked from SubSync", delete: "Deleted from SubSync", undo: "Change put back from SubSync" };
  for (const r of act) {
    const at = iso(r.created_at) as string;
    const dry = r.result === "dry_run";
    const open = r.result === "done" && !undone.has(r.batch_id as string) && r.action !== "undo" && r.action !== "delete" && r.action !== "create" && Date.now() - Date.parse(at) < undoMinutes * 60_000;
    out.push({ at, source: "subsync", text: `${WORD[r.action as string] ?? "Changed from SubSync"}${dry ? " (practice run, nothing sent)" : r.result === "done" ? "" : ` (${String(r.result).replace(/_/g, " ")})`}`, batchId: r.batch_id as string, undoable: open, actor: (r.actor as string | null) ?? null });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export async function batchRows(installationId: string, locationId: string, batchId: string) {
  const rows = await sql()`select action, appointment_id, contact_id, before_value, created_at, result from appointment_actions where installation_id = ${installationId} and location_id = ${locationId} and batch_id = ${batchId} and result = 'done' and action in ('status', 'reschedule', 'reassign', 'edit')`.catch(() => []);
  const undone = await sql()`select 1 from appointment_actions where installation_id = ${installationId} and action = 'undo' and result = 'done' and before_value->>'batchId' = ${batchId} limit 1`.catch(() => []);
  return undone.length ? [] : rows.map((r) => ({ action: r.action as string, appointmentId: r.appointment_id as string, contactId: (r.contact_id as string | null) ?? null, before: (r.before_value as Record<string, unknown>) ?? {}, at: iso(r.created_at) as string }));
}

/** SubSync's own copy follows a change right away (the next sync would too), so the screen is right at once. Never writes anything to the CRM. */
export async function applyLocal(installationId: string, locationId: string, appointmentId: string, patch: NonNullable<ApptPlan["patch"]>): Promise<void> {
  const db = sql();
  await db`update cached_appointments set
      status = coalesce(${patch.status ?? null}::text, status), start_at = coalesce(${patch.startAt ?? null}::timestamptz, start_at), end_at = coalesce(${patch.endAt ?? null}::timestamptz, end_at),
      title = coalesce(${patch.title ?? null}::text, title), calendar_id = coalesce(${patch.calendarId ?? null}::text, calendar_id), assigned_to = coalesce(${patch.assignedUserId ?? null}::text, assigned_to)
    where installation_id = ${installationId} and location_id = ${locationId} and appointment_id = ${appointmentId}`;
}
export async function dropLocal(installationId: string, locationId: string, appointmentIds: readonly string[]): Promise<void> {
  if (appointmentIds.length === 0) return;
  await sql()`delete from cached_appointments where installation_id = ${installationId} and location_id = ${locationId} and appointment_id = any(${[...appointmentIds]}::text[])`;
}

// ---------------- the details panel ----------------

export type PanelFacts = {
  facts: ApptFacts; locationName: string | null; bookedBy: string | null; channel: string | null; createdAt: string | null; contact: { phone: string | null; email: string | null; dnd: boolean; source: string | null } | null;
  deal: { name: string | null; status: string | null; value: number | null } | null; reminders: { sent: number; lastAt: string | null } | null;
};
/** One appointment's panel: only inside an account the caller may read. The deal is the contact's newest deal; reminder facts come from SubSync's own touch record (no message text). */
export async function panelFacts(installationId: string, locationId: string, appointmentId: string): Promise<PanelFacts | null> {
  const [facts] = await loadFacts(installationId, locationId, [appointmentId]);
  if (!facts) return null;
  const db = sql();
  const [meta] = await db`select a.booked_by_user, a.booking_channel, a.created_remote_at, l.name location_name from cached_appointments a left join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id where a.installation_id = ${installationId} and a.location_id = ${locationId} and a.appointment_id = ${appointmentId}`;
  const [ct] = facts.contactId ? await db`select phone, email, coalesce(dnd, false) dnd, source from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${facts.contactId}` : [];
  const [deal] = facts.contactId ? await db`select name, status, monetary_value from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${facts.contactId} order by coalesce(last_stage_change_at, synced_at) desc limit 1`.catch(() => []) : [];
  const rem = facts.contactId && facts.startAt
    ? await db`select count(*)::int n, max(at) last from touch_events where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${facts.contactId} and direction = 'outbound' and at between ${new Date(Date.parse(facts.startAt) - 3 * DAY).toISOString()} and ${facts.startAt}`.catch(() => [])
    : [];
  return {
    facts, locationName: (meta?.location_name as string | null) ?? null, bookedBy: (meta?.booked_by_user as string | null) ?? null, channel: (meta?.booking_channel as string | null) ?? null, createdAt: iso(meta?.created_remote_at),
    contact: ct ? { phone: (ct.phone as string | null) ?? null, email: (ct.email as string | null) ?? null, dnd: ct.dnd === true, source: (ct.source as string | null) || null } : null,
    deal: deal ? { name: (deal.name as string | null) ?? null, status: (deal.status as string | null) ?? null, value: deal.monetary_value == null ? null : Number(deal.monetary_value) } : null,
    reminders: rem[0] ? { sent: Number(rem[0].n), lastAt: iso(rem[0].last) } : null,
  };
}
