import { sql } from "../db";
import { safeError } from "../safe-log";
import { diffTagEvents } from "../sync/tag-events";
import { isOurTag, tagPrefix } from "../people/writeback";
import { recordTouchEvents } from "../analytics/touch-events-db";
import { eventsOfMessages } from "../analytics/touch-events-db";
import type { ContactRow, ConversationRow } from "../sync/ghl-data";
import type { CrmCall } from "../people/helpers";

// Write-through: whatever a live read, a webhook, the search fallback or the delta sync learns about a lead goes into SubSync's own copy (cached_contacts, cached_conversations)
// and the event store. Always scoped by installation AND location. Idempotent: the same contact twice changes nothing and records no second tag event.

/**
 * Store contacts (new or changed). A tag that differs from what the copy held is recorded in contact_tag_events with the real time (now: the platform does not say when, and this
 * runs within seconds of the change). A contact the copy did not hold records no tag events (every tag would look new). Tags SubSync itself added are kept out (principle 14).
 * Returns how many tag changes were recorded.
 */
export async function cacheContacts(installationId: string, locationId: string, contacts: readonly ContactRow[]): Promise<number> {
  const unique = [...new Map(contacts.map((c) => [c.contactId, c])).values()];
  if (unique.length === 0) return 0;
  const db = sql();
  let recorded = 0;
  await db.begin(async (tx) => {
    const ids = unique.map((c) => c.contactId);
    const before = await tx`select contact_id, tags from cached_contacts where installation_id = ${installationId} and location_id = ${locationId} and contact_id = any(${ids}) for update`;
    const known = new Map(before.map((r) => [r.contact_id as string, r.tags as string[] | null]));
    const events = diffTagEvents(unique.filter((c) => known.has(c.contactId)).map((c) => ({ contactId: c.contactId, tags: c.tags })), known, true).filter((e) => !isOurTag(e.tag, tagPrefix()));
    if (events.length) {
      await tx`insert into contact_tag_events ${tx(events.map((e) => ({ installation_id: installationId, location_id: locationId, contact_id: e.contactId, tag: e.tag, kind: e.kind })) as never)}`;
      recorded = events.length;
    }
    const rows = unique.map((c) => ({
      installation_id: installationId, location_id: locationId, contact_id: c.contactId, first_name: c.firstName, last_name: c.lastName, email: c.email, phone: c.phone, tags: c.tags,
      date_added: c.dateAdded, last_activity_at: c.lastActivityAt, updated_remote_at: c.updatedAt, synced_at: new Date(), source: c.source, dnd: c.dnd, birth_date: c.birthDate, assigned_to: c.assignedTo,
    }));
    await tx`
      insert into cached_contacts ${tx(rows as never)}
      on conflict (installation_id, location_id, contact_id) do update set
        first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email, phone = excluded.phone, tags = excluded.tags, date_added = excluded.date_added,
        last_activity_at = excluded.last_activity_at, updated_remote_at = excluded.updated_remote_at, synced_at = excluded.synced_at,
        source = excluded.source, dnd = excluded.dnd, birth_date = excluded.birth_date, assigned_to = excluded.assigned_to`;
  });
  return recorded;
}

export async function cacheConversations(installationId: string, locationId: string, convs: readonly ConversationRow[]): Promise<void> {
  const unique = [...new Map(convs.map((c) => [c.conversationId, c])).values()];
  if (unique.length === 0) return;
  const db = sql();
  const rows = unique.map((c) => ({
    installation_id: installationId, location_id: locationId, conversation_id: c.conversationId, contact_id: c.contactId, contact_name: c.contactName, last_message_type: c.lastMessageType,
    last_message_direction: c.lastMessageDirection, last_message_at: c.lastMessageAt, unread_count: c.unreadCount, synced_at: new Date(),
  }));
  await db`
    insert into cached_conversations ${db(rows as never)}
    on conflict (installation_id, location_id, conversation_id) do update set
      contact_id = excluded.contact_id, contact_name = excluded.contact_name, last_message_type = excluded.last_message_type, last_message_direction = excluded.last_message_direction,
      last_message_at = excluded.last_message_at, unread_count = excluded.unread_count, synced_at = excluded.synced_at`;
}

/** Calls seen live go into the touch history (who, when, which way, result word; never content). A call the webhook already recorded (same contact, within a minute) is not added twice. */
export async function recordLiveCalls(installationId: string, ids: { locationId: string; contactId: string; conversationId: string }, calls: readonly CrmCall[]): Promise<number> {
  if (calls.length === 0) return 0;
  try {
    const db = sql();
    const fresh: CrmCall[] = [];
    for (const c of calls) {
      const [hit] = await db`select 1 from touch_events where installation_id = ${installationId} and location_id = ${ids.locationId} and contact_id = ${ids.contactId} and channel = 'call'
        and at between ${new Date(c.at - 60_000)} and ${new Date(c.at + 60_000)} limit 1`;
      if (!hit) fresh.push(c);
    }
    const events = eventsOfMessages(fresh.map((c) => ({ at: c.at, direction: c.direction, userId: c.userId, source: null, type: "TYPE_CALL", status: c.durationSeconds != null ? `${c.status ?? "completed"}:${Math.round(c.durationSeconds)}` : c.status })), ids);
    return await recordTouchEvents(installationId, events);
  } catch (e) { console.error("live calls not recorded", { message: safeError(e) }); return 0; }
}
