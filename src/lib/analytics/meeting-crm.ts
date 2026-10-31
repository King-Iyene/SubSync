import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { sql } from "../db";
import { locationAccessToken } from "../sync/engine";
import { crmNoteBody } from "./meeting-intel";

// Write a saved meeting into the matched contact's notes in the CRM, once. It never throws: a failure is stored as a
// status the Meeting notes page can show, and the meeting stays saved in SubSync either way.
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
    // Claim it first, so two deliveries of the same meeting cannot both write a note.
    const claimed = await db`update meeting_notes set crm_note_status = 'writing' where id = ${meetingId} and crm_note_id is null and (crm_note_status is null or crm_note_status in ('failed', 'needs_permission')) returning id`;
    if (claimed.length === 0) return "skipped";
    const token = await locationAccessToken(m.company_id as string, m.location_id as string);
    const body = crmNoteBody({
      title: m.title as string | null, startedAt: m.started_at instanceof Date ? m.started_at.toISOString() : null,
      attendees: (m.attendees as Array<{ name: string | null; email: string | null }>) ?? [], summary: m.summary as string | null,
      actionItems: (m.action_items as string[]) ?? [], recordingUrl: m.recording_url as string | null,
    });
    const res = await ghlFetch(`${GHL_API}/contacts/${encodeURIComponent(m.contact_id as string)}/notes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      await db`update meeting_notes set crm_note_status = 'needs_permission' where id = ${meetingId}`;
      return "needs_permission";
    }
    if (!res.ok) {
      await db`update meeting_notes set crm_note_status = 'failed' where id = ${meetingId}`;
      return "failed";
    }
    const json = (await res.json().catch(() => ({}))) as { note?: { id?: string }; id?: string };
    await db`update meeting_notes set crm_note_id = ${json.note?.id ?? json.id ?? "saved"}, crm_note_status = 'saved' where id = ${meetingId}`;
    return "saved";
  } catch (error) {
    console.error("Writing a meeting note to the CRM failed", error instanceof Error ? error.message : "unknown");
    await db`update meeting_notes set crm_note_status = 'failed' where id = ${meetingId} and crm_note_id is null`.catch(() => undefined);
    return "failed";
  }
}
