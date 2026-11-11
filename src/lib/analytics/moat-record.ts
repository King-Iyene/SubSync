import { sql } from "../db";
import { appointmentOutcome, moatKey, type MoatKind } from "./moat-core";

// D1. Writes the raw, append-only record of what happened to each lead (moat_events). Every writer is idempotent: the event key is unique per account, so a second
// sweep or a retry inserts nothing new. Rows are never updated. Metadata only: no message text, no names. The facts are DERIVED from tables SubSync already keeps
// (lead_touches, touch_events, lead_events, alerts, appointment_events, cached_appointments, deal_events), so a sweep can be repeated safely and a missed run is
// caught up by the next one (`sinceHours`).

export type MoatEventInput = {
  installationId: string; locationId: string; kind: MoatKind; key: string; at: Date;
  contactId?: string | null; conversationId?: string | null; channel?: string | null; userId?: string | null; automated?: boolean | null;
  ownerId?: string | null; value?: number | null; targetMinutes?: number | null; vertical?: string | null; detail?: Record<string, unknown>;
};

/** Writes one fact. Returns true when a new row was written, false when the fact was already recorded. */
export async function recordMoatEvent(e: MoatEventInput): Promise<boolean> {
  const db = sql();
  const rows = await db`
    insert into moat_events (installation_id, location_id, contact_id, conversation_id, kind, event_key, at, channel, user_id, automated, owner_id, value, target_minutes, vertical, detail)
    values (${e.installationId}, ${e.locationId}, ${e.contactId ?? null}, ${e.conversationId ?? null}, ${e.kind}, ${e.key}, ${e.at}, ${e.channel ?? null}, ${e.userId ?? null},
      ${e.automated ?? null}, ${e.ownerId ?? null}, ${e.value ?? null}, ${e.targetMinutes ?? null}, ${e.vertical ?? null}, ${db.json((e.detail ?? {}) as never)})
    on conflict (installation_id, location_id, event_key) do nothing
    returning id`;
  return rows.length > 0;
}

export type SweepReport = Record<string, number>;

/**
 * Copies recent facts into the record. `sinceHours` bounds the work (an hourly run uses 72; a first run may use more). Each statement is one set-based insert that
 * skips what is already there, so it scales with the new facts, not with the history.
 */
export async function sweepMoatEvents(installationId: string, sinceHours = 72): Promise<SweepReport> {
  const db = sql();
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const rep: SweepReport = {};
  const vert = db`(select p.vertical from account_profiles p where p.installation_id = x.installation_id and p.location_id = x.location_id)`;

  // A lead arrived, with its channel (the first inbound event) and the account's reply target at that time.
  rep.lead_created = (await db`
    insert into moat_events (installation_id, location_id, contact_id, conversation_id, kind, event_key, at, channel, target_minutes, vertical, detail)
    select x.installation_id, x.location_id, x.contact_id, x.conversation_id, 'lead_created',
      'lead_created|' || x.location_id || '|' || x.conversation_id, coalesce(x.clock_start, x.lead_at),
      (select te.channel from touch_events te where te.installation_id = x.installation_id and te.location_id = x.location_id and te.contact_id = x.contact_id
        and te.conversation_id = x.conversation_id and te.direction = 'inbound' order by te.at asc limit 1),
      coalesce(l.speed_target_minutes, s.speed_target_minutes), ${vert}, jsonb_build_object('excluded', x.excluded, 'leadAt', x.lead_at)
    from lead_touches x
    join locations l on l.installation_id = x.installation_id and l.location_id = x.location_id
    left join settings s on s.installation_id = x.installation_id
    where x.installation_id = ${installationId} and x.lead_at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;

  // The first person's touch (and the first automatic one), who did it, and who owned the contact then.
  rep.first_human_touch = (await db`
    insert into moat_events (installation_id, location_id, contact_id, conversation_id, kind, event_key, at, user_id, automated, owner_id, vertical, detail)
    select x.installation_id, x.location_id, x.contact_id, x.conversation_id, 'first_human_touch',
      'first_human_touch|' || x.location_id || '|' || x.conversation_id, x.human_touch_at, x.touch_user_id, false,
      (select c.assigned_to from cached_contacts c where c.installation_id = x.installation_id and c.location_id = x.location_id and c.contact_id = x.contact_id),
      ${vert}, jsonb_build_object('leadAt', x.lead_at, 'seconds', extract(epoch from (x.human_touch_at - coalesce(x.clock_start, x.lead_at)))::int)
    from lead_touches x
    where x.installation_id = ${installationId} and x.human_touch_at is not null and x.human_touch_at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;

  rep.first_auto_touch = (await db`
    insert into moat_events (installation_id, location_id, contact_id, conversation_id, kind, event_key, at, automated, vertical)
    select x.installation_id, x.location_id, x.contact_id, x.conversation_id, 'first_auto_touch',
      'first_auto_touch|' || x.location_id || '|' || x.conversation_id, x.auto_touch_at, true, ${vert}
    from lead_touches x
    where x.installation_id = ${installationId} and x.auto_touch_at is not null and x.auto_touch_at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;

  // Owner at each change (mirrors lead_events).
  rep.owner_changed = (await db`
    insert into moat_events (installation_id, location_id, contact_id, kind, event_key, at, user_id, owner_id, vertical, detail)
    select x.installation_id, x.location_id, x.contact_id, 'owner_changed', 'owner_changed|' || x.location_id || '|' || x.event_key, x.at, x.user_id, x.to_value, ${vert},
      jsonb_build_object('from', x.from_value)
    from lead_events x
    where x.installation_id = ${installationId} and x.kind = 'owner_changed' and x.at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;

  // An alert fired (with the target at the time), and what happened next once it was resolved.
  rep.alert_fired = (await db`
    insert into moat_events (installation_id, location_id, contact_id, conversation_id, kind, event_key, at, target_minutes, vertical, detail)
    select x.installation_id, x.location_id, x.detail->>'contactId', x.detail->>'conversationId', 'alert_fired', 'alert_fired|' || x.location_id || '|' || x.id::text, x.created_at,
      (select l.speed_target_minutes from locations l where l.installation_id = x.installation_id and l.location_id = x.location_id), ${vert},
      jsonb_build_object('alertId', x.id, 'alertKind', x.kind, 'ownerId', x.detail->>'ownerId')
    from alerts x
    where x.installation_id = ${installationId} and x.kind in ('breach24', 'breach24_escalation') and x.created_at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;

  rep.alert_outcome = (await db`
    insert into moat_events (installation_id, location_id, contact_id, conversation_id, kind, event_key, at, user_id, vertical, detail)
    select x.installation_id, x.location_id, x.detail->>'contactId', x.detail->>'conversationId', 'alert_outcome', 'alert_outcome|' || x.location_id || '|' || x.id::text, x.resolved_at,
      x.detail->>'replyUserId', ${vert},
      jsonb_build_object('alertId', x.id, 'status', coalesce(x.detail->>'recoveryStatus', 'resolved'),
        'minutes', case when x.detail->>'replyObservedAt' is not null then round(extract(epoch from ((x.detail->>'replyObservedAt')::timestamptz - x.created_at)) / 60)::int end)
    from alerts x
    where x.installation_id = ${installationId} and x.kind = 'breach24' and x.resolved_at is not null and x.resolved_at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;

  // Appointments: booked (when created), showed / no-show (when SubSync first saw the status).
  rep.appointment_booked = (await db`
    insert into moat_events (installation_id, location_id, contact_id, kind, event_key, at, user_id, vertical, detail)
    select x.installation_id, x.location_id, x.contact_id, 'appointment_booked', 'appointment_booked|' || x.location_id || '|' || x.appointment_id,
      coalesce(x.created_remote_at, x.synced_at), x.assigned_to, ${vert}, jsonb_build_object('startAt', x.start_at)
    from cached_appointments x
    where x.installation_id = ${installationId} and coalesce(x.created_remote_at, x.synced_at) > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;

  const outcomes = await db`
    select e.location_id, e.appointment_id, e.to_value, e.occurred_at, a.contact_id, a.assigned_to,
      (select p.vertical from account_profiles p where p.installation_id = e.installation_id and p.location_id = e.location_id) vertical
    from appointment_events e
    left join cached_appointments a on a.installation_id = e.installation_id and a.location_id = e.location_id and a.appointment_id = e.appointment_id
    where e.installation_id = ${installationId} and e.kind = 'status' and e.occurred_at > ${since}`;
  let n = 0;
  for (const r of outcomes) {
    const out = appointmentOutcome(r.to_value as string | null);
    if (!out) continue;
    const kind: MoatKind = out === "showed" ? "appointment_showed" : "appointment_no_show";
    const ok = await recordMoatEvent({
      installationId, locationId: r.location_id as string, kind, key: moatKey(kind, r.location_id as string, r.appointment_id as string),
      at: r.occurred_at as Date, contactId: (r.contact_id as string | null) ?? null, userId: (r.assigned_to as string | null) ?? null, vertical: (r.vertical as string | null) ?? null,
    });
    if (ok) n++;
  }
  rep.appointment_outcome = n;

  // A deal was won or lost, with its value and date.
  rep.deal_result = (await db`
    insert into moat_events (installation_id, location_id, contact_id, kind, event_key, at, value, vertical, detail)
    select x.installation_id, x.location_id, o.contact_id, case when lower(x.to_value) = 'won' then 'deal_won' else 'deal_lost' end,
      (case when lower(x.to_value) = 'won' then 'deal_won' else 'deal_lost' end) || '|' || x.location_id || '|' || x.opportunity_id || '|' || x.id::text, x.at, x.value, ${vert},
      jsonb_build_object('opportunityId', x.opportunity_id)
    from deal_events x
    left join cached_opportunities o on o.installation_id = x.installation_id and o.location_id = x.location_id and o.opportunity_id = x.opportunity_id
    where x.installation_id = ${installationId} and x.kind = 'status' and lower(x.to_value) in ('won', 'lost') and x.at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;

  return rep;
}

/** A reply target was changed on a client account (the target at the time of each alert is also kept on the alert's own row). */
export function recordTargetChange(i: { installationId: string; locationId: string; minutes: number | null; by: string | null; at?: Date }) {
  const at = i.at ?? new Date();
  return recordMoatEvent({
    installationId: i.installationId, locationId: i.locationId, kind: "reply_target_set", key: moatKey("reply_target_set", i.locationId, at.getTime()),
    at, userId: i.by, targetMinutes: i.minutes,
  });
}

/** One person's yes or no on an alert ("was this useful?"). It feeds the precision of alerts and is never shown with a name. */
export function recordAlertFeedback(i: { installationId: string; locationId: string; alertId: string; useful: boolean; by: string }) {
  return recordMoatEvent({
    installationId: i.installationId, locationId: i.locationId, kind: "alert_feedback", key: moatKey("alert_feedback", i.alertId, i.by),
    at: new Date(), userId: i.by, detail: { alertId: i.alertId, useful: i.useful },
  });
}
