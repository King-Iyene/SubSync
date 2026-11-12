import { sql } from "../db";
import { addedText, needsMatchText } from "./auto-note";
import type { IngestStore } from "./ingest";

// The database side of the automatic short notes: the person's own notice ("Meeting with X was added" or "waiting for you") and the "Added today" row.
// Every statement is scoped by the installation and the person. Ids and the meeting title only; the call's words are never copied here.

export const amNotify: NonNullable<IngestStore["notify"]> = async (n) => {
  const db = sql();
  let name = n.contactName;
  if (n.kind === "added" && n.locationId && n.contactId) {
    const [c] = await db`select nullif(btrim(full_name), '') name from cached_contacts where installation_id = ${n.installationId} and location_id = ${n.locationId} and contact_id = ${n.contactId}`;
    name = (c?.name as string | undefined) ?? name;
    await db`insert into am_auto_adds (installation_id, owner_ghl_user_id, meeting_id, location_id, contact_id, status)
      values (${n.installationId}, ${n.userId}, ${n.meetingId}, ${n.locationId}, ${n.contactId}, 'added') on conflict (meeting_id, contact_id) do nothing`;
  }
  const text = n.kind === "added" ? addedText(name) : needsMatchText(n.title);
  await db`insert into am_notices (installation_id, owner_ghl_user_id, meeting_id, kind, text, location_id, contact_id)
    values (${n.installationId}, ${n.userId}, ${n.meetingId}, ${n.kind}, ${text}, ${n.locationId}, ${n.contactId}) on conflict (meeting_id, kind) do nothing`;
};
