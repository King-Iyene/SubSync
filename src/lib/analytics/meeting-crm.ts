import { safeError } from "../safe-log";
import { buildNote, writeToCrm } from "../ghl/crm-writes";
import { recordCrmWrite } from "../connections/write-log";
import { isLive } from "../live-flags";
import { sql } from "../db";
import { locationAccessToken } from "../sync/engine";
import { crmNoteBody } from "./meeting-intel";

// Write a saved meeting into the matched contact's notes in the CRM, once. It never throws: a failure is stored as a
// status the Meeting notes page can show, and the meeting stays saved in SubSync either way.
// Every write goes through the one CRM write client (src/lib/ghl/crm-writes.ts): while WRITE_GHL_LIVE is off it only records "WOULD WRITE" (ids and
// field names) and leaves the meeting unclaimed, so the note is written the first time the switch is on. A write that really happens is logged in crm_writes.
export async function pushMeetingToCrm(meetingId: string): Promise<"saved" | "skipped" | "needs_permission" | "failed"> {
  const db = sql();
  try {
    const [m] = await db`
      select n.id, n.installation_id, n.location_id, n.contact_id, n.title, n.started_at, n.attendees, n.summary, n.action_items, n.recording_url, n.crm_note_id,
        s.push_notes_to_crm, i.company_id
      from meeting_notes n
      join installations i on i.id = n.installation_id and i.uninstalled_at is null and not i.is_demo
      left join settings s on s.installation_id = n.installation_id
      where n.id = ${meetingId}`;
    if (!m || !m.contact_id || m.crm_note_id || m.push_notes_to_crm === false) return "skipped";
    const body = crmNoteBody({
      title: m.title as string | null, startedAt: m.started_at instanceof Date ? m.started_at.toISOString() : null,
      attendees: (m.attendees as Array<{ name: string | null; email: string | null }>) ?? [], summary: m.summary as string | null,
      actionItems: (m.action_items as string[]) ?? [], recordingUrl: m.recording_url as string | null,
    });
    const request = buildNote({ contactId: m.contact_id as string, body });
    if (!isLive("WRITE_GHL_LIVE")) {
      await writeToCrm({ installationId: m.installation_id as string, locationId: m.location_id as string, contactId: m.contact_id as string, meetingId: meetingId, request, token: async () => "" });
      return "skipped";
    }
    // Claim it first, so two deliveries of the same meeting cannot both write a note.
    const claimed = await db`update meeting_notes set crm_note_status = 'writing' where id = ${meetingId} and crm_note_id is null and (crm_note_status is null or crm_note_status in ('failed', 'needs_permission')) returning id`;
    if (claimed.length === 0) return "skipped";
    const done = await writeToCrm({ installationId: m.installation_id as string, locationId: m.location_id as string, contactId: m.contact_id as string, meetingId: null, request, token: () => locationAccessToken(m.company_id as string, m.location_id as string) });
    if (done.outcome === "needs_permission") {
      await db`update meeting_notes set crm_note_status = 'needs_permission' where id = ${meetingId}`;
      return "needs_permission";
    }
    if (done.outcome !== "written") {
      await db`update meeting_notes set crm_note_status = 'failed' where id = ${meetingId}`;
      return "failed";
    }
    await db`update meeting_notes set crm_note_id = ${done.id ?? "saved"}, crm_note_status = 'saved' where id = ${meetingId}`;
    // The write log keeps the id the CRM gave the note, so our own note is never counted as activity and its webhook is dropped.
    await recordCrmWrite({ installationId: m.installation_id as string, meetingId: null, locationId: m.location_id as string, contactId: m.contact_id as string, kind: "note", ghlId: done.id }).catch(() => undefined);
    return "saved";
  } catch (error) {
    console.error("Writing a meeting note to the CRM failed", safeError(error));
    await db`update meeting_notes set crm_note_status = 'failed' where id = ${meetingId} and crm_note_id is null`.catch(() => undefined);
    return "failed";
  }
}
