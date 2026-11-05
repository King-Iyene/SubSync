import { sql } from "../db";
import { candidateIds } from "./echo";

// The write log (table crm_writes): everything SubSync itself put into a customer's CRM, with the id the CRM gave it. No content is kept here, only
// ids and times, so it can outlive the meeting it came from. It has two jobs: keep our own writes out of our own numbers, and drop the webhook
// the platform sends about a note or comment we just made (no loops).

export type WriteRecord = {
  installationId: string;
  meetingId: string | null;
  locationId: string;
  contactId: string;
  kind: "note" | "comment" | "field";
  ghlId: string | null;
  partNo?: number;
  authoredBy?: string | null;
};

/** Records one write. Returns false when this exact part was already recorded (a retry), so a retry can never double count or double write. */
export async function recordCrmWrite(r: WriteRecord): Promise<boolean> {
  const db = sql();
  const rows = await db`
    insert into crm_writes (installation_id, meeting_id, location_id, contact_id, kind, ghl_id, part_no, authored_by)
    values (${r.installationId}, ${r.meetingId}, ${r.locationId}, ${r.contactId}, ${r.kind}, ${r.ghlId}, ${r.partNo ?? 1}, ${r.authoredBy ?? null})
    on conflict do nothing returning id`;
  return rows.length === 1;
}

/** Is any id in this webhook body the id of something we wrote? Then it is our own echo and is dropped. */
export async function isEchoOfOurWrite(installationId: string, body: unknown): Promise<boolean> {
  const ids = candidateIds(body);
  if (ids.length === 0) return false;
  const rows = await sql()`select 1 from crm_writes where installation_id = ${installationId} and ghl_id = any(${ids}::text[]) limit 1`;
  if (rows.length > 0) return true;
  // Notes and tasks made from the contact panel (contact_writes). A missing table (not updated yet) simply means no echo.
  const ours = await sql()`select 1 from contact_writes where installation_id = ${installationId} and (note_id = any(${ids}::text[]) or task_id = any(${ids}::text[])) limit 1`.catch(() => []);
  return ours.length > 0;
}

/** Marks a write as undone (the note was removed), so it stops hiding activity. */
export async function markUndone(installationId: string, ghlId: string): Promise<void> {
  await sql()`update crm_writes set undone_at = now() where installation_id = ${installationId} and ghl_id = ${ghlId} and undone_at is null`;
}
