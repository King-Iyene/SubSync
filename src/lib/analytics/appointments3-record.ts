import { sql } from "../db";

// The Appointments moat writer. Fills the append-only appointment_history and the per-appointment appointment_facts, flag appt_record. Idempotent everywhere: every
// event has a unique event_key per account, so a repeated webhook, a retry or an overlapping hourly sweep inserts nothing twice. Metadata only: no message text.
// Two sources: (a) webhooks (the payload has no previous status, so it is diffed against the stored row; call BEFORE the cache is updated) and (b) the hourly sweep
// (backfill from the cache, the status and time diffs the sync already keeps in appointment_events, reminder facts from outbound touches). A change that matches a
// recent write of our own (a 'subsync' row for the same appointment and value) is recorded with actor_kind = 'subsync' and so is never counted as team activity.

import { diffHistory, isReschedule, OWN_WRITE_WINDOW_MS, type ActorKind, type HistEvent, type HistKind, type Snap } from "./appointments3-diff.ts";
export type { ActorKind, HistEvent, HistKind, Snap };

type Meta = { installationId: string; locationId: string; appointmentId: string; contactId: string | null };

/** Writes events and updates the facts. Returns how many new history rows were written. */
export async function recordHistory(m: Meta, events: HistEvent[]): Promise<number> {
  if (!events.length) return 0;
  const db = sql();
  let written = 0;
  for (const e of events) {
    const r = await db`
      insert into appointment_history (installation_id, location_id, appointment_id, contact_id, kind, event_key, from_value, to_value, actor_id, actor_kind, start_at, at)
      values (${m.installationId}, ${m.locationId}, ${m.appointmentId}, ${m.contactId}, ${e.kind}, ${e.key}, ${e.from}, ${e.to}, ${e.actorId}, ${e.actorKind}, ${e.startAt === null ? null : new Date(e.startAt)}, ${new Date(e.at)})
      on conflict (installation_id, location_id, event_key) do nothing returning 1`;
    if (!r.length) continue;
    written++;
    if (isReschedule(e)) {
      await db`insert into appointment_facts (installation_id, location_id, appointment_id, reschedule_count) values (${m.installationId}, ${m.locationId}, ${m.appointmentId}, 1)
        on conflict (installation_id, location_id, appointment_id) do update set reschedule_count = appointment_facts.reschedule_count + 1, updated_at = now()`;
    }
    if (e.kind === "status" && e.to === "confirmed") {
      await db`insert into appointment_facts (installation_id, location_id, appointment_id, confirmed_at) values (${m.installationId}, ${m.locationId}, ${m.appointmentId}, ${new Date(e.at)})
        on conflict (installation_id, location_id, appointment_id) do update set confirmed_at = coalesce(appointment_facts.confirmed_at, excluded.confirmed_at), updated_at = now()`;
    }
    if (e.kind === "deleted") {
      await db`insert into appointment_facts (installation_id, location_id, appointment_id, deleted_at) values (${m.installationId}, ${m.locationId}, ${m.appointmentId}, ${new Date(e.at)})
        on conflict (installation_id, location_id, appointment_id) do update set deleted_at = coalesce(appointment_facts.deleted_at, excluded.deleted_at), updated_at = now()`;
    }
  }
  return written;
}

const asMs = (v: unknown) => (v instanceof Date ? v.getTime() : null);

async function snapOf(installationId: string, locationId: string, id: string): Promise<Snap | null> {
  const [r] = await sql()`select status, start_at, assigned_to, calendar_id, booked_by_user, contact_id from cached_appointments where installation_id = ${installationId} and location_id = ${locationId} and appointment_id = ${id}`;
  return r ? { status: (r.status as string | null) ?? null, startAt: asMs(r.start_at), ownerId: (r.assigned_to as string | null) ?? null, calendarId: (r.calendar_id as string | null) ?? null, bookerId: (r.booked_by_user as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null } : null;
}

/** Webhook hook: call BEFORE the cache row is updated or deleted. Never throws (the webhook must still apply). */
export async function recordFromWebhook(i: { installationId: string; locationId: string; appointmentId: string; type: "AppointmentCreate" | "AppointmentUpdate" | "AppointmentDelete"; next?: Partial<Snap>; actorId?: string | null; at?: number }): Promise<number> {
  try {
    const at = i.at ?? Date.now();
    const prev = await snapOf(i.installationId, i.locationId, i.appointmentId);
    const meta: Meta = { installationId: i.installationId, locationId: i.locationId, appointmentId: i.appointmentId, contactId: prev?.contactId ?? i.next?.contactId ?? null };
    if (i.type === "AppointmentDelete") {
      return recordHistory(meta, [{ kind: "deleted", key: `deleted|${i.appointmentId}`, from: prev?.status ?? null, to: null, at, actorId: i.actorId ?? null, actorKind: i.actorId ? "person" : "unknown", startAt: prev?.startAt ?? null }]);
    }
    const next: Snap = {
      status: i.next?.status ?? prev?.status ?? null, startAt: i.next?.startAt ?? prev?.startAt ?? null, ownerId: i.next?.ownerId ?? prev?.ownerId ?? null,
      calendarId: i.next?.calendarId ?? prev?.calendarId ?? null, bookerId: i.next?.bookerId ?? prev?.bookerId ?? null, contactId: meta.contactId,
    };
    const own = await sql()`select kind, to_value, at from appointment_history where installation_id = ${i.installationId} and location_id = ${i.locationId} and appointment_id = ${i.appointmentId}
      and actor_kind = 'subsync' and at > ${new Date(at - OWN_WRITE_WINDOW_MS)}`;
    return recordHistory(meta, diffHistory(i.appointmentId, prev, next, { at, actorId: i.actorId ?? null, own: own.map((r) => ({ kind: r.kind as HistKind, to: (r.to_value as string | null) ?? null, at: asMs(r.at) ?? at })) }));
  } catch (e) {
    console.error("appointment history not recorded", { message: e instanceof Error ? e.message : "error" });
    return 0;
  }
}

/** Hourly sweep, set-based and idempotent: first-seen rows, the status and time moves the sync already kept, reminder facts and reschedule links. */
export async function sweepAppointmentHistory(installationId: string, sinceHours = 72): Promise<Record<string, number>> {
  const db = sql(), since = new Date(Date.now() - sinceHours * 3_600_000), rep: Record<string, number> = {};
  rep.created = (await db`
    insert into appointment_history (installation_id, location_id, appointment_id, contact_id, kind, event_key, to_value, actor_id, actor_kind, start_at, at)
    select a.installation_id, a.location_id, a.appointment_id, a.contact_id, 'created', 'created|' || a.appointment_id, a.status, a.booked_by_user,
      case when a.booked_by_user is null then 'system' else 'person' end, a.start_at, coalesce(a.created_remote_at, a.synced_at)
    from cached_appointments a where a.installation_id = ${installationId} and a.synced_at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;
  // The sync's own status and time diffs, copied with the sync's row id as the key. A change matching a recent write of ours is marked 'subsync'.
  rep.moves = (await db`
    insert into appointment_history (installation_id, location_id, appointment_id, contact_id, kind, event_key, from_value, to_value, actor_kind, start_at, at)
    select e.installation_id, e.location_id, e.appointment_id, a.contact_id, e.kind, 'ev|' || e.id, e.from_value, e.to_value,
      case when exists (select 1 from appointment_history h where h.installation_id = e.installation_id and h.location_id = e.location_id and h.appointment_id = e.appointment_id
        and h.actor_kind = 'subsync' and h.kind = e.kind and h.to_value is not distinct from e.to_value and abs(extract(epoch from (h.at - e.occurred_at))) <= 600) then 'subsync' else 'unknown' end,
      e.start_at, e.occurred_at
    from appointment_events e left join cached_appointments a on a.installation_id = e.installation_id and a.location_id = e.location_id and a.appointment_id = e.appointment_id
    where e.installation_id = ${installationId} and e.occurred_at > ${since} and e.kind in ('status', 'time')
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;
  // Facts: a row for every recent appointment, then reminders (outbound automated messages to the contact in the 3 days before the start).
  await db`insert into appointment_facts (installation_id, location_id, appointment_id) select installation_id, location_id, appointment_id from cached_appointments
    where installation_id = ${installationId} and synced_at > ${since} on conflict do nothing`;
  rep.reminders = (await db`
    update appointment_facts f set reminders_sent = r.n, last_reminder_at = r.last_at, updated_at = now()
    from (select a.location_id, a.appointment_id, count(*)::int n, max(t.at) last_at from cached_appointments a
      join touch_events t on t.installation_id = a.installation_id and t.location_id = a.location_id and t.contact_id = a.contact_id and t.direction = 'outbound' and t.automated
        and t.kind = 'message' and t.at < a.start_at and t.at > a.start_at - interval '3 days'
      where a.installation_id = ${installationId} and a.start_at > ${since} and a.contact_id is not null group by 1, 2) r
    where f.installation_id = ${installationId} and f.location_id = r.location_id and f.appointment_id = r.appointment_id and f.reminders_sent is distinct from r.n returning 1`).length;
  rep.reschedules = (await db`
    update appointment_facts f set rescheduled_from = x.prev_id, updated_at = now()
    from (select a.location_id, a.appointment_id, (select b.appointment_id from cached_appointments b where b.installation_id = a.installation_id and b.location_id = a.location_id and b.contact_id = a.contact_id
        and b.status = 'cancelled' and b.appointment_id <> a.appointment_id and b.start_at < a.start_at and coalesce(a.created_remote_at, a.synced_at) between b.start_at - interval '1 day' and b.start_at + interval '1 day'
        order by b.start_at desc limit 1) prev_id
      from cached_appointments a where a.installation_id = ${installationId} and a.synced_at > ${since} and a.contact_id is not null and a.status <> 'cancelled') x
    where x.prev_id is not null and f.installation_id = ${installationId} and f.location_id = x.location_id and f.appointment_id = x.appointment_id and f.rescheduled_from is null returning 1`).length;
  return rep;
}
