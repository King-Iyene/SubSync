import type { PendingQuery, Row } from "postgres";
import type { Sql } from "../db";
import { NOISE_TAGS } from "./unanswered-actions";
import { loadHideSettings } from "./unanswered-actions-queries";

// The one place the list asks "is this person snoozed or hidden?". Snooze and hide are written by the actions slice (B, tables unanswered_snoozes, unanswered_outcomes and
// unanswered_hide_settings); the list only READS them for the Snoozed and Hidden filters and for the default view (which leaves both out).
// The fragments are written for the alias `p` (people: p.location_id, p.contact_id, p.conversation_id, p.email, p.phone) and bound to the installation. Which of them exist
// follows the two flags the caller passes (inbox_snooze, inbox_hide_noise); with both off the filters are not offered.

type Db = Sql;
type Fragment = PendingQuery<Row[]>;
export type SnoozeHook = { available: false } | { available: true; snoozed: Fragment; hidden: Fragment };
export type SnoozeFlags = { snooze: boolean; hide: boolean };

export async function snoozeHook(db: Db, installationId: string, flags: SnoozeFlags = { snooze: false, hide: false }): Promise<SnoozeHook> {
  if (!flags.snooze && !flags.hide) return { available: false };
  const snoozed = flags.snooze
    ? db`exists (select 1 from unanswered_snoozes z where z.installation_id = ${installationId} and z.location_id = p.location_id and z.released_at is null and z.until_at > now()
        and (z.conversation_id = p.conversation_id or (p.contact_id is not null and z.contact_id = p.contact_id)))`
    : db`false`;
  if (!flags.hide) return { available: true, snoozed, hidden: db`false` };
  const s = await loadHideSettings(installationId);
  const parts: Fragment[] = [];
  if (s.notALead) {
    parts.push(db`(select o.outcome from unanswered_outcomes o where o.installation_id = ${installationId} and o.location_id = p.location_id and (o.conversation_id = p.conversation_id or (p.contact_id is not null and o.contact_id = p.contact_id)) order by o.created_at desc limit 1) = 'not_a_lead'`);
  }
  if (s.internal) {
    parts.push(db`(p.contact_id is not null and exists (select 1 from cached_contacts ct where ct.installation_id = ${installationId} and ct.location_id = p.location_id and ct.contact_id = p.contact_id and exists (select 1 from unnest(ct.tags) t where lower(btrim(t)) = any(${[...NOISE_TAGS]}::text[]))))`);
    parts.push(db`exists (select 1 from locations lx where lx.installation_id = ${installationId} and lx.location_id = p.location_id and ((p.email is not null and lower(btrim(p.email)) = lower(btrim(lx.email)))
      or (length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) >= 7 and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(coalesce(lx.phone, ''), '\D', '', 'g'), 10))))`);
  }
  if (s.automatic) {
    parts.push(db`(p.contact_id is not null and exists (select 1 from touch_events te where te.installation_id = ${installationId} and te.location_id = p.location_id and te.contact_id = p.contact_id and te.direction = 'inbound' and te.automated and te.at between p.last_message_at - interval '1 minute' and p.last_message_at + interval '1 minute'))`);
  }
  const hidden = parts.length ? parts.reduce<Fragment>((acc, x, i) => (i === 0 ? db`(${x})` : db`${acc} or (${x})`), db`false`) : db`false`;
  return { available: true, snoozed, hidden };
}
