// Fathom: what its "new meeting content ready" delivery looks like, and what we take from it (INTEGRATIONS_SPEC sections 4, 7 and 8).
// Pure (no network, no database). The field names follow Fathom's published webhook schema (read 2 Nov 2026 at developers.fathom.ai, the `Meeting`
// object): recording_id, title, meeting_title, url, share_url, created_at, scheduled_start_time, recording_start_time and recording_end_time,
// calendar_invitees (email, name, is_external), recorded_by (name, email), default_summary.markdown_formatted, action_items (description,
// assignee), transcript. NOT VERIFIED LIVE: nobody has received a real delivery yet.

import type { Attendee, Meeting } from "../analytics/meeting-intel.ts";
import { talkShare } from "../analytics/mn2.ts";

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
  /** The names of the invitees outside the recorder's company (a hint for suggesting a lead when no email matches; never used to decide). */
  outsideNames: string[];
  /** Counts only (never an address): invitees in the delivery, how many had an email, how many were outside the recorder's company. */
  inviteeStats: { invitees: number; withEmail: number; outside: number };
  durationMinutes: number | null;
  /** The share (0 to 100) of the words the recorder spoke, from counts of the transcript turns of this one delivery. Null unless the transcript was read (the words are never kept). */
  talkPct: number | null;
  /**
   * The call's full text, one line per turn ("Name: words"), only when Fathom sent it. It is held in memory for the one delivery and written to the CRM only
   * where the person's table, the account's rules and the person's switch all allow it. It is never stored by SubSync (stage E2b).
   */
  transcriptText: string | null;
  /** The call's own page in Fathom (where the full transcript lives), used when a transcript is too long to save. */
  callUrl: string | null;
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
const MAX_TRANSCRIPT = 200_000;

/** Fathom's transcript is a list of turns, each with a speaker and words. One line per turn. */
function transcriptOf(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  const lines: string[] = [];
  let size = 0;
  for (const raw of v) {
    const o = rec(raw);
    const words = text(o.text, 4_000);
    if (!words) continue;
    const who = text(rec(o.speaker).display_name, 80);
    const line = who ? `${who}: ${words}` : words;
    size += line.length + 1;
    if (size > MAX_TRANSCRIPT) break;
    lines.push(line);
  }
  return lines.length ? lines.join("\n") : null;
}

/** Words per speaker, as counts only: the share of the talking the recorder did. Nothing of the text is returned. */
function talkOf(v: unknown, me: { name: string | null; email: string | null }): number | null {
  if (!Array.isArray(v)) return null;
  const turns = v.slice(0, 20_000).map((raw) => {
    const o = rec(raw), sp = rec(o.speaker);
    return { speaker: text(sp.display_name, 80), email: email(sp.matched_calendar_invitee_email), words: (text(o.text, 4_000) ?? "").split(/\s+/).filter(Boolean).length };
  });
  return talkShare(turns, me);
}

/**
 * Reads one Fathom delivery. The transcript is read ONLY when `options.transcript` says this person's choices could put it in the CRM (data minimisation:
 * otherwise it is never even looked at). Returns null for anything that is not a usable meeting (so the route can acknowledge it and Fathom stops retrying).
 * A delivery needs a recording id: without one there is nothing to dedupe on, and an unidentifiable meeting is never saved.
 */
export function parseFathomDelivery(input: unknown, options: { transcript?: boolean } = {}): FathomDelivery | null {
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
  const outsideNames: string[] = [];
  const stats = { invitees: 0, withEmail: 0, outside: 0 };
  if (Array.isArray(b.calendar_invitees)) {
    for (const raw of b.calendar_invitees.slice(0, 50)) {
      const o = rec(raw);
      const e = email(o.email ?? o.email_address);
      const name = text(o.name, 120);
      stats.invitees++;
      if (e) stats.withEmail++;
      // Fathom says whether an invitee is outside the recorder's company. One that is explicitly NOT external is on the person's own side.
      if (e && o.is_external === false) internal.add(e);
      if (e && e === recordedByEmail) continue;
      const key = e ?? name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (o.is_external !== false) { stats.outside++; if (name) outsideNames.push(name); }
      attendees.push({ name, email: e });
      withNames.push(name ?? e ?? "");
    }
  }
  // A transcript (only present when the person chose to keep it) names who spoke and, when Fathom matched a speaker to an invitee, that invitee's email: another way to know who was there.
  // Only as a fallback, when the invitee list gave no email at all.
  if (stats.withEmail === 0 && Array.isArray(b.transcript)) {
    for (const raw of b.transcript.slice(0, 2_000)) {
      const sp = rec(rec(raw).speaker);
      const e = email(sp.matched_calendar_invitee_email);
      if (e && e !== recordedByEmail && !internal.has(e) && !seen.has(e)) { seen.add(e); attendees.push({ name: text(sp.display_name, 120), email: e }); }
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
    recordingId, meeting, recordedByEmail, recordedByName, internalEmails: [...internal], withNames: withNames.filter(Boolean).slice(0, 12), outsideNames: outsideNames.slice(0, 12), inviteeStats: stats,
    durationMinutes: minutes !== null && minutes > 0 && minutes < 24 * 60 ? minutes : null,
    talkPct: options.transcript === true ? talkOf(b.transcript, { name: recordedByName, email: recordedByEmail }) : null,
    transcriptText: options.transcript === true ? transcriptOf(b.transcript) : null, callUrl: httpsUrl(b.url),
  };
}
