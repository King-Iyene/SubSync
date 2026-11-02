// Fathom: what its "new meeting content ready" delivery looks like, and what we take from it (INTEGRATIONS_SPEC sections 4, 7 and 8).
// Pure (no network, no database). The field names follow Fathom's published webhook schema (read 2 Nov 2026 at developers.fathom.ai, the `Meeting`
// object): recording_id, title, meeting_title, url, share_url, created_at, scheduled_start_time, recording_start_time and recording_end_time,
// calendar_invitees (email, name, is_external), recorded_by (name, email), default_summary.markdown_formatted, action_items (description,
// assignee), transcript. NOT VERIFIED LIVE: nobody has received a real delivery yet.

import type { Attendee, Meeting } from "../analytics/meeting-intel.ts";

/**
 * Which recordings a person's delivery address is created for. `my_recordings` works for everybody. On a Team plan it does NOT include the person's own
 * recordings that they shared with a team, so those need `my_shared_with_team_recordings`, which only Team plans accept. So we ask for both first and, when
 * Fathom refuses the second (a solo plan), fall back to the first alone (`createFathomWebhook` in oauth.ts). `shared_team_recordings` (other people's
 * calls) is never requested: a person's connection is for that person's own calls.
 */
export const TRIGGERS_FIRST = ["my_recordings", "my_shared_with_team_recordings"] as const;
export const TRIGGERS_SOLO = ["my_recordings"] as const;

/** What we ask Fathom to put in the delivery: only what the person chose to save. The transcript is never requested unless it is chosen (E2b). */
export type WantedContent = { summary: boolean; actionItems: boolean; transcript: boolean };
export const DEFAULT_WANTED: WantedContent = { summary: true, actionItems: true, transcript: false };

export type FathomDelivery = {
  /** Fathom's id of the recording: the meeting's identity for dedupe. */
  recordingId: string;
  meeting: Meeting;
  /** The person who recorded it (the connecting person). Never matched as a contact. */
  recordedByEmail: string | null;
  recordedByName: string | null;
  /** Attendees Fathom itself says are on the recorder's own side. Never matched as a contact. */
  internalEmails: string[];
  /** Attendees for the note's "With:" line: everybody invited except the recorder. */
  withNames: string[];
  durationMinutes: number | null;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : null;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const email = (v: unknown): string | null => {
  const s = text(v, 200)?.toLowerCase() ?? null;
  return s && EMAIL.test(s) ? s : null;
};
const iso = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const httpsUrl = (v: unknown): string | null => {
  const s = text(v, 500);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};

const MAX_SUMMARY = 6_000;
const MAX_ITEMS = 20;

/**
 * Reads one Fathom delivery. Returns null for anything that is not a usable meeting (so the route can acknowledge it and Fathom stops retrying).
 * A delivery needs a recording id: without one there is nothing to dedupe on, and an unidentifiable meeting is never saved.
 */
export function parseFathomDelivery(input: unknown): FathomDelivery | null {
  const b = rec(input);
  const idRaw = b.recording_id;
  const recordingId = typeof idRaw === "number" && Number.isFinite(idRaw) ? String(Math.trunc(idRaw)) : typeof idRaw === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(idRaw) ? idRaw : null;
  if (!recordingId) return null;

  const title = text(b.meeting_title, 200) ?? text(b.title, 200);
  const summary = text(rec(b.default_summary).markdown_formatted, MAX_SUMMARY);
  const items: string[] = [];
  if (Array.isArray(b.action_items)) {
    for (const raw of b.action_items) {
      const d = text(rec(raw).description, 300);
      if (d) items.push(d);
      if (items.length >= MAX_ITEMS) break;
    }
  }
  if (!title && !summary && items.length === 0) return null;

  const by = rec(b.recorded_by);
  const recordedByEmail = email(by.email);
  const recordedByName = text(by.name, 120);

  const attendees: Attendee[] = [];
  const internal = new Set<string>();
  const withNames: string[] = [];
  const seen = new Set<string>();
  if (recordedByEmail) internal.add(recordedByEmail);
  if (Array.isArray(b.calendar_invitees)) {
    for (const raw of b.calendar_invitees.slice(0, 50)) {
      const o = rec(raw);
      const e = email(o.email);
      const name = text(o.name, 120);
      // Fathom says whether an invitee is outside the recorder's company. One that is explicitly NOT external is on the person's own side.
      if (e && o.is_external === false) internal.add(e);
      if (e && e === recordedByEmail) continue;
      const key = e ?? name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      attendees.push({ name, email: e });
      withNames.push(name ?? e ?? "");
    }
  }

  const startedAt = iso(b.recording_start_time) ?? iso(b.scheduled_start_time) ?? iso(b.created_at);
  const end = iso(b.recording_end_time);
  const minutes = startedAt && end ? Math.round((Date.parse(end) - Date.parse(startedAt)) / 60_000) : null;

  const meeting: Meeting = {
    source: "fathom", title, startedAt, attendees, summary, actionItems: items, transcript: null,
    recordingUrl: httpsUrl(b.share_url) ?? httpsUrl(b.url),
  };
  return {
    recordingId, meeting, recordedByEmail, recordedByName, internalEmails: [...internal], withNames: withNames.filter(Boolean).slice(0, 12),
    durationMinutes: minutes !== null && minutes > 0 && minutes < 24 * 60 ? minutes : null,
  };
}
