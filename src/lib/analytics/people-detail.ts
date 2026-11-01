import { sql } from "../db";
import { tagDatesFor, watchingSince } from "./people-list-queries";

// What the lead panel shows beyond the contact's own row (stage F10): the owner, the days SubSync first saw each tag, the calls logged from SubSync's call lists,
// the appointments, and the account's time zone for the dialing warning. Read only and limited to the accounts the caller may see (the account is checked first).
// The live read of custom fields and the CRM's own call history is done by the route (it needs the account's token) and is NOT stored.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export type LeadExtras = {
  owner: string | null; timeZone: string | null; dnd: boolean;
  tagDates: Record<string, string>; watchingSince: string | null;
  loggedCalls: Array<{ at: string; outcome: string }>;
  appointments: Array<{ at: string; status: string | null }>;
  /** The conversation to read call history from, if there is one (used by the live read, never sent to the browser). */
  conversationId: string | null;
};

export async function leadExtras(installationId: string, allowed: string[] | null, locationId: string, contactId: string): Promise<LeadExtras | null> {
  if (allowed && !allowed.includes(locationId)) return null;
  const db = sql();
  const [[c], calls, appts, [convo]] = await Promise.all([
    db`select nullif(c.assigned_to, '') owner, c.dnd, l.timezone from cached_contacts c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
       where c.installation_id = ${installationId} and c.location_id = ${locationId} and c.contact_id = ${contactId}`,
    db`select created_at, outcome from call_outcomes where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by created_at desc limit 20`,
    db`select start_at, status from cached_appointments where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by start_at desc nulls last limit 10`,
    db`select conversation_id from cached_conversations where installation_id = ${installationId} and location_id = ${locationId} and contact_id = ${contactId} order by last_message_at desc nulls last limit 1`,
  ]);
  if (!c) return null;
  const [tagDates, since] = await Promise.all([tagDatesFor(installationId, locationId, contactId), watchingSince(installationId, allowed)]);
  return {
    owner: (c.owner as string | null) ?? null, timeZone: (c.timezone as string | null) ?? null, dnd: c.dnd === true,
    tagDates, watchingSince: since,
    loggedCalls: calls.map((r) => ({ at: iso(r.created_at) as string, outcome: r.outcome as string })),
    appointments: appts.filter((r) => r.start_at).map((r) => ({ at: iso(r.start_at) as string, status: (r.status as string | null) ?? null })),
    conversationId: (convo?.conversation_id as string | undefined) ?? null,
  };
}
