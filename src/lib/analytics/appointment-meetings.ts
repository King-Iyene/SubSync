// Matching a recorded call (Fathom) to an appointment (Appointments module, slice AB). Pure. Principle 13: a call is tied to an appointment only when it is certain; anything else
// waits in the person's own private list ("Needs matching") and the person picks. A suggestion of an outcome is only ever a suggestion: one tap, never automatic.

export const MATCH_WINDOW_MIN = 90;
export type MeetingFacts = { id: string; startedAt: string | null; attendeeEmails: readonly string[] };
export type Candidate = { appointmentId: string; locationId: string; contactEmail: string | null; startAt: string; endAt: string | null; status: string | null };

const norm = (e: string) => e.trim().toLowerCase();

/** Candidates whose contact's email is among the attendees and whose slot is within the window of the call's start. */
export function plausible(m: MeetingFacts, cands: readonly Candidate[], windowMin = MATCH_WINDOW_MIN): Candidate[] {
  const t = m.startedAt ? Date.parse(m.startedAt) : NaN;
  if (!Number.isFinite(t)) return [];
  const emails = new Set(m.attendeeEmails.map(norm).filter(Boolean));
  const w = windowMin * 60_000;
  return cands.filter((c) => {
    if (!c.contactEmail || !emails.has(norm(c.contactEmail))) return false;
    const s = Date.parse(c.startAt); const e = c.endAt ? Date.parse(c.endAt) : s + 30 * 60_000;
    return Number.isFinite(s) && t >= s - w && t <= e + w;
  });
}

export type MatchResult = { kind: "certain"; appointmentId: string; locationId: string } | { kind: "several"; ids: string[] } | { kind: "none" };

/** Certain only when exactly ONE appointment fits (one contact, one slot). Two fits, or none, is never guessed. */
export function matchMeeting(m: MeetingFacts, cands: readonly Candidate[], windowMin = MATCH_WINDOW_MIN): MatchResult {
  const hits = plausible(m, cands, windowMin);
  if (hits.length === 1) return { kind: "certain", appointmentId: hits[0].appointmentId, locationId: hits[0].locationId };
  return hits.length > 1 ? { kind: "several", ids: hits.map((h) => h.appointmentId) } : { kind: "none" };
}

export type Suggestion = { outcome: "showed" | "noshow"; confidence: "high" | "low"; why: string };

/**
 * Suggested outcome. A linked call on a past appointment with no outcome set: "showed" (high). A past appointment with no outcome and NO call, for a person whose tool is connected:
 * "no-show" (low: the call may simply not have been recorded). Nothing once an outcome exists or while the slot is still open.
 */
export function suggestOutcome(a: { status: string | null; startAt: string | null; endAt: string | null }, linked: boolean, connected: boolean, now: number): Suggestion | null {
  const st = (a.status ?? "new").toLowerCase();
  if (st !== "new" && st !== "confirmed" && st !== "booked") return null;
  const end = a.endAt ? Date.parse(a.endAt) : a.startAt ? Date.parse(a.startAt) + 30 * 60_000 : NaN;
  if (!Number.isFinite(end) || end > now) return null;
  if (linked) return { outcome: "showed", confidence: "high", why: "A recorded call took place at this time." };
  if (connected && now - end > 60 * 60_000) return { outcome: "noshow", confidence: "low", why: "No recorded call was found for this time. The call may not have been recorded." };
  return null;
}

/** Next step from the call's own action items: the first one, trimmed. Null when there are none (the "no next step set" list). */
export const nextStepOf = (items: readonly string[]): string | null => { const f = items.map((s) => s.trim()).find(Boolean); return f ? f.slice(0, 200) : null; };

/** The internal note text for the person's own review before it is written (they see it in the preview). */
export function followUpNote(m: { title: string | null; summary: string | null; actionItems: readonly string[] }): string {
  const lines = ["Meeting follow-up (from SubSync)"];
  if (m.title) lines.push(m.title.slice(0, 120));
  if (m.summary) lines.push("", m.summary.slice(0, 1500));
  const items = m.actionItems.map((s) => s.trim()).filter(Boolean).slice(0, 10);
  if (items.length) lines.push("", "Action items:", ...items.map((s) => `- ${s.slice(0, 200)}`));
  return lines.join("\n").slice(0, 4000);
}
