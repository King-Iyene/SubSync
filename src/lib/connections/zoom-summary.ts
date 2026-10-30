import type { Attendee, Meeting } from "../analytics/meeting-intel.ts";

// Zoom's own AI meeting summary arrives as a webhook (event "meeting.summary_completed"). It has a
// summary and next steps already written, so SubSync does not need an AI service of its own. It names
// the host but not who joined, so the attendee list is filled in separately when Zoom allows it.

export type ZoomSummary = { hostId: string; hostEmail: string | null; uuid: string; meeting: Meeting };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clean = (v: unknown, max: number) => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
};
const when = (v: unknown) => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const httpsUrl = (v: unknown) => {
  const s = clean(v, 500);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
};

export function parseZoomSummary(body: unknown, attendees: Attendee[] = []): ZoomSummary | null {
  const root = rec(body);
  if (root.event !== "meeting.summary_completed") return null;
  const o = rec(rec(root.payload).object);
  const hostId = clean(o.meeting_host_id, 100);
  const uuid = clean(o.meeting_uuid, 200);
  if (!hostId || !uuid) return null;

  // Prefer the single markdown field; fall back to the older overview and sections.
  let summary = clean(o.summary_content, 6_000);
  if (!summary) {
    const parts: string[] = [];
    const overview = clean(o.summary_overview, 2_000);
    if (overview) parts.push(overview);
    if (Array.isArray(o.summary_details)) {
      for (const d of o.summary_details) {
        const r = rec(d);
        const label = clean(r.label, 100);
        const text = clean(r.summary, 1_500);
        if (text) parts.push(label ? `${label}: ${text}` : text);
      }
    }
    summary = parts.length ? parts.join("\n\n").slice(0, 6_000) : null;
  }
  const actionItems = (Array.isArray(o.next_steps) ? o.next_steps : []).map((s) => clean(s, 300)).filter((s): s is string => !!s).slice(0, 20);
  const title = clean(o.meeting_topic, 200) ?? clean(o.summary_title, 200);
  if (!title && !summary && actionItems.length === 0) return null;

  return {
    hostId, uuid, hostEmail: clean(o.meeting_host_email, 200)?.toLowerCase() ?? null,
    meeting: { source: "zoom", title, startedAt: when(o.meeting_start_time), attendees, summary, actionItems, transcript: null, recordingUrl: httpsUrl(o.summary_doc_url) },
  };
}
