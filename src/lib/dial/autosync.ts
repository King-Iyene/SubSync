// Auto outcome sync (stage SPEED6): the rep calls from the CRM and never re-selects the outcome in SubSync. The CRM writes a call record (status, duration) on the contact and the rep's
// other actions (a tag, an appointment, do-not-disturb); SubSync reads those signals (webhook-fed tables) and infers the outcome. Pure rules, no database, unit tested (autosync.test.ts).
import type { DialOutcome } from "./dial.ts";
import type { Disposition } from "./dial6.ts";

export const SPOKE_SECONDS = 30;
export type CallSignal = { status: string | null; durationSec: number | null; at: number };
export type Signals = { call: CallSignal | null; tags: Array<{ tag: string; kind: "added" | "removed"; at: number }>; stageMoved: boolean; appointment: boolean; dnd: boolean };
export type Inferred = { base: DialOutcome; confidence: "sure" | "ambiguous"; via: "call" | "crm"; durationSec: number | null; label: string };
export type Rules = { bookedTags: string[]; wrongTags: string[]; dncTags: string[] };
export const DEFAULT_RULES: Rules = { bookedTags: ["subsync-booked", "booked", "appointment-booked"], wrongTags: ["wrong-number"], dncTags: ["do-not-call", "dnd"] };

/** The stored word for a call is "status" or "status:seconds" (the duration rides along in the same metadata word; never any content). */
export function splitOutcome(word: string | null): { status: string | null; durationSec: number | null } {
  if (!word) return { status: null, durationSec: null };
  const i = word.lastIndexOf(":"); const n = i > 0 ? Number(word.slice(i + 1)) : NaN;
  return Number.isFinite(n) && n >= 0 ? { status: word.slice(0, i), durationSec: Math.round(n) } : { status: word, durationSec: null };
}
export const joinOutcome = (status: string | null, durationSec: number | null): string | null => (durationSec !== null && Number.isFinite(durationSec) && durationSec >= 0 ? `${status ?? "completed"}:${Math.round(durationSec)}` : status);

/** From the call record. Over 30 s answered = Spoke; no answer, busy, failed, cancelled = No answer; voicemail = Left voicemail. An answered call with no length, or a very short one, is ambiguous (a pickup that hung up, or a voicemail greeting): the rep is asked with the likely chip preselected. */
export function inferFromCall(c: CallSignal): Inferred | null {
  const s = (c.status ?? "").toLowerCase();
  if (/voice.?mail/.test(s)) return { base: "voicemail", confidence: "sure", via: "call", durationSec: c.durationSec, label: "Left voicemail" };
  if (/no.?answer|busy|fail|cancel|missed|unanswered/.test(s)) return { base: "no_answer", confidence: "sure", via: "call", durationSec: c.durationSec, label: "No answer" };
  if (/complet|answer|connect|ended/.test(s) || s === "") {
    if (c.durationSec === null) return { base: "spoke", confidence: "ambiguous", via: "call", durationSec: null, label: "Spoke" };
    if (c.durationSec >= SPOKE_SECONDS) return { base: "spoke", confidence: "sure", via: "call", durationSec: c.durationSec, label: "Spoke" };
    return { base: "voicemail", confidence: "ambiguous", via: "call", durationSec: c.durationSec, label: "Left voicemail" };
  }
  return null;
}
const has = (list: readonly string[], tag: string) => list.some((t) => t.toLowerCase() === tag.toLowerCase());
/** From what the rep did in the CRM after the call: an appointment or a booked tag = Booked, do-not-disturb or a do-not-call tag = Do not call, a wrong-number tag = Wrong number. These win over the call record. */
export function inferFromCrm(s: Signals, rules: Rules): Inferred | null {
  if (s.dnd || s.tags.some((t) => t.kind === "added" && has(rules.dncTags, t.tag))) return { base: "dnc", confidence: "sure", via: "crm", durationSec: null, label: "Do not call" };
  if (s.appointment || s.tags.some((t) => t.kind === "added" && has(rules.bookedTags, t.tag))) return { base: "booked", confidence: "sure", via: "crm", durationSec: null, label: "Booked" };
  if (s.tags.some((t) => t.kind === "added" && has(rules.wrongTags, t.tag))) return { base: "wrong_number", confidence: "sure", via: "crm", durationSec: null, label: "Wrong number" };
  return null;
}
export function inferDetected(s: Signals, rules: Rules): Inferred | null {
  const crm = inferFromCrm(s, rules);
  if (crm) return { ...crm, durationSec: s.call?.durationSec ?? null };
  return s.call ? inferFromCall(s.call) : null;
}
/** The tags that mean Booked, Wrong number and Do not call for one account: its own outcome set plus the standard ones. */
export function rulesFrom(d: readonly Disposition[]): Rules {
  const tagsOf = (b: DialOutcome) => d.filter((x) => x.base === b && x.tag).map((x) => x.tag as string);
  return { bookedTags: [...DEFAULT_RULES.bookedTags, ...tagsOf("booked")], wrongTags: [...DEFAULT_RULES.wrongTags, ...tagsOf("wrong_number")], dncTags: [...DEFAULT_RULES.dncTags, ...tagsOf("dnc")] };
}
/** A detection is recorded once: the same CRM record (or the same signal) seen again on the next poll is ignored. */
export function firstTime(seen: Set<string>, key: string): boolean { if (seen.has(key)) return false; seen.add(key); return true; }
export const detectionKey = (contactKey: string, s: Signals, inf: Inferred) => `${contactKey}:${inf.via}:${inf.base}:${s.call?.at ?? 0}`;
/** SubSync's own CRM note is skipped when the CRM already holds the call record (never two records of one call). */
export const skipOwnNote = (autoDetected: boolean, crmHasCallRecord: boolean) => autoDetected && crmHasCallRecord;
export function toastText(name: string, i: Inferred): string {
  const first = name.trim().split(/\s+/)[0] || name;
  const mins = i.durationSec === null ? "" : i.durationSec < 90 ? `, ${i.durationSec} sec` : `, ${Math.round(i.durationSec / 60)} min`;
  const verb = i.base === "spoke" ? "Spoke with" : i.base === "voicemail" ? "Left a voicemail for" : i.base === "no_answer" ? "No answer from" : i.base === "booked" ? "Booked" : i.base === "wrong_number" ? "Wrong number for" : "Do not call:";
  return `${verb} ${first}${mins}`;
}
/** Polling is for the lead on screen only, every 10 seconds, for at most 2 minutes after the call button was pressed. */
export const POLL_EVERY_MS = 10_000; export const POLL_FOR_MS = 120_000;
export const pollDue = (startedAt: number, now: number) => now - startedAt <= POLL_FOR_MS;
