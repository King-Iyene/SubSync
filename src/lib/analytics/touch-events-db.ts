import { sql } from "../db";
import { toEvent, type LeadEvent, type RawTouch, type TouchEvent } from "./touch-events.ts";
import { dailyRollup, type DailyRow } from "./speed-v4-more.ts";
import { loadRows } from "./speed-queries";
import { DAY } from "./speed-v3.ts";

// Writes and reads the speed history (stage SPEED4): touch events (messages and calls), lifecycle events, and the nightly daily rollup. Metadata only: the text of a message never
// reaches this file. Idempotent (unique event_key), scoped by installation. Retention: events older than RETENTION_DAYS are removed by the nightly job; an uninstall removes all of it
// (tenant-tables.ts).
export const RETENTION_DAYS = 400;

/** Keeps the events; the same event twice is one row. Never throws (a database without the table simply keeps nothing). */
export async function recordTouchEvents(installationId: string, events: readonly TouchEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  try {
    const db = sql();
    for (let i = 0; i < events.length; i += 200) {
      const rows = events.slice(i, i + 200).map((e) => ({ location_id: e.locationId, contact_id: e.contactId, conversation_id: e.conversationId, event_key: e.key, direction: e.direction, channel: e.channel, kind: e.kind, at: new Date(e.at).toISOString(), user_id: e.userId, automated: e.automated, source: e.source, outcome: e.outcome }));
      await db`
        insert into touch_events (installation_id, location_id, contact_id, conversation_id, event_key, direction, channel, kind, at, user_id, automated, source, outcome)
        select ${installationId}::uuid, x.location_id, x.contact_id, x.conversation_id, x.event_key, x.direction, x.channel, x.kind, x.at, x.user_id, x.automated, x.source, x.outcome
        from jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb)
          as x(location_id text, contact_id text, conversation_id text, event_key text, direction text, channel text, kind text, at timestamptz, user_id text, automated boolean, source text, outcome text)
        on conflict (installation_id, location_id, event_key) do nothing`;
    }
    return events.length;
  } catch { return 0; }
}

export async function recordLeadEvents(installationId: string, events: readonly LeadEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  try {
    const db = sql();
    for (const e of events) {
      await db`
        insert into lead_events (installation_id, location_id, contact_id, kind, event_key, from_value, to_value, user_id, at)
        values (${installationId}, ${e.locationId}, ${e.contactId}, ${e.kind}, ${e.key === "created" ? `created:${e.contactId}` : e.key}, ${e.fromValue}, ${e.toValue}, ${e.userId}, ${new Date(e.at)})
        on conflict (installation_id, location_id, event_key) do nothing`;
    }
    return events.length;
  } catch { return 0; }
}

/** The events of one conversation's messages, ready to keep. */
export function eventsOfMessages(msgs: readonly RawTouch[], ids: { locationId: string; contactId: string; conversationId: string | null }): TouchEvent[] {
  return msgs.map((m) => toEvent(m, ids)).filter((e): e is TouchEvent => e !== null);
}

export async function loadTouchEvents(installationId: string, allowed: string[] | null, fromMs: number, contactId?: string): Promise<TouchEvent[]> {
  const db = sql();
  try {
    const rows = await db`
      select * from (select location_id, contact_id, conversation_id, event_key, direction, channel, kind, at, user_id, automated, source, outcome from touch_events
      where installation_id = ${installationId} and at > ${new Date(fromMs)} ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} ${contactId ? db`and contact_id = ${contactId}` : db``} order by at desc limit 60000) newest order by at`;
    return rows.map((r) => ({ key: r.event_key as string, locationId: r.location_id as string, contactId: r.contact_id as string, conversationId: (r.conversation_id as string | null) ?? null,
      direction: r.direction as "inbound" | "outbound", channel: r.channel as TouchEvent["channel"], kind: r.kind as TouchEvent["kind"], at: new Date(r.at as string).getTime(), userId: (r.user_id as string | null) ?? null,
      automated: r.automated === true, source: (r.source as string | null) ?? null, outcome: (r.outcome as string | null) ?? null }));
  } catch { return []; }
}

/** The life story of one lead: lifecycle events, stage and tag and appointment history already kept elsewhere, newest last. Reasons and ids only, no message text. */
export async function leadStory(installationId: string, locationId: string, contactId: string): Promise<Array<{ at: number; kind: string; text: string }>> {
  const db = sql();
  const out: Array<{ at: number; kind: string; text: string }> = [];
  const add = (at: unknown, kind: string, text: string) => { const t = new Date(at as string).getTime(); if (Number.isFinite(t)) out.push({ at: t, kind, text }); };
  try {
    for (const r of await db`select kind, at, to_value from lead_events where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by at limit 50`)
      add(r.at, r.kind as string, r.kind === "created" ? "Lead arrived" : r.kind === "owner_changed" ? "Owner changed" : r.kind === "stage_changed" ? "Deal moved stage" : String(r.kind).replace("_", " "));
    for (const r of await db`select direction, channel, kind, at, automated, outcome from touch_events where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by at limit 80`) {
      const who = r.direction === "inbound" ? "Lead" : r.automated ? "Automatic" : "Your team";
      add(r.at, "touch", r.kind === "missed_call" ? "Missed call from the lead" : `${who}: ${r.channel === "call" ? "call" : r.channel}${r.direction === "inbound" ? " received" : " sent"}${r.kind === "failed" ? " (did not deliver)" : ""}`);
    }
    for (const r of await db`select e.kind, e.to_value, e.occurred_at from appointment_events e join cached_appointments a on a.installation_id = e.installation_id and a.location_id = e.location_id and a.appointment_id = e.appointment_id where e.installation_id = ${installationId} and e.location_id = ${locationId} and a.contact_id = ${contactId} order by e.occurred_at limit 30`)
      add(r.occurred_at, "appointment", r.kind === "created" ? "Appointment booked" : r.kind === "status" ? `Appointment marked ${String(r.to_value ?? "").replace(/_/g, " ")}` : "Appointment time changed");
    for (const r of await db`select tag, kind, at from contact_tag_events where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by at limit 30`) add(r.at, "tag", `Tag ${r.kind}: ${r.tag}`);
  } catch { /* an older database: the story shows what it has */ }
  return out.sort((a, b) => a.at - b.at).slice(-100);
}

/** Rebuilds the last `days` days of the daily rollup for one installation from the lead records and events. Idempotent (replaces the day), called by the nightly job; also removes events past retention. */
export async function rebuildSpeedDaily(installationId: string, targetMinutes: number, days = 35, now = Date.now()): Promise<number> {
  const db = sql();
  try {
    const rows = await loadRows(db, installationId, null, now - days * DAY, now + DAY);
    const events = await loadTouchEvents(installationId, null, now - days * DAY);
    const tz = new Map<string, string | null>((await db`select location_id, timezone from locations where installation_id = ${installationId}`).map((l) => [l.location_id as string, (l.timezone as string | null) ?? null]));
    const daily = dailyRollup(rows, events, (l) => tz.get(l) ?? null, targetMinutes, now);
    // A day with no leads any more (or one keyed by the old UTC day for an account without a zone) must not survive: the window is replaced whole.
    const cut = new Date(now - days * DAY - DAY);
    await db`delete from speed_daily where installation_id = ${installationId} and day >= ${cut.toISOString().slice(0, 10)}::date`;
    for (const d of daily) await writeDay(installationId, d);
    await db`delete from touch_events where installation_id = ${installationId} and at < ${new Date(now - RETENTION_DAYS * DAY)}`;
    return daily.length;
  } catch { return 0; }
}

async function writeDay(installationId: string, d: DailyRow) {
  await sql()`
    insert into speed_daily (installation_id, location_id, day, leads, answered, within_target, median_seconds, buckets, by_channel, by_source, by_owner, by_hour, missed_calls, missed_followed, texted_back_60, failed_sends, rebuilt_at)
    values (${installationId}, ${d.locationId}, ${d.day}, ${d.leads}, ${d.answered}, ${d.within}, ${d.medianSeconds}, ${JSON.stringify(d.buckets)}::jsonb, ${JSON.stringify(d.byChannel)}::jsonb, ${JSON.stringify(d.bySource)}::jsonb, ${JSON.stringify(d.byOwner)}::jsonb, ${JSON.stringify(d.byHour)}::jsonb, ${d.missedCalls}, ${d.missedFollowed}, ${d.textedBack60}, ${d.failedSends}, now())
    on conflict (installation_id, location_id, day) do update set leads = excluded.leads, answered = excluded.answered, within_target = excluded.within_target, median_seconds = excluded.median_seconds, buckets = excluded.buckets,
      by_channel = excluded.by_channel, by_source = excluded.by_source, by_owner = excluded.by_owner, by_hour = excluded.by_hour, missed_calls = excluded.missed_calls, missed_followed = excluded.missed_followed,
      texted_back_60 = excluded.texted_back_60, failed_sends = excluded.failed_sends, rebuilt_at = now()`;
}
