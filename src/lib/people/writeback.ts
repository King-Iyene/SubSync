import { createHash } from "node:crypto";

// Pure rules for writing a note or a call result to the lead in the customer's CRM (CLAUDE.md principles 11 and 14). No database, no network.
//   - every note SubSync writes starts with MARKER, so our own writes are recognizable and never counted as activity, a reply or engagement;
//   - a tag SubSync adds starts with a configurable prefix (default "subsync-call-"), for the same reason;
//   - the idempotency key is per contact + outcome (or note text) + minute, so a double click or a retry never writes twice;
//   - at most CAP_PER_HOUR writes per company per hour.

export const MARKER = "[SubSync]";
export const DEFAULT_TAG_PREFIX = "subsync-call-";
export const CAP_PER_HOUR = 200;
export const NOTE_MAX = 2000;

export const OUTCOME_WORDS: Record<string, string> = {
  answered: "Answered", voicemail: "Voicemail", no_answer: "No answer", wrong_number: "Wrong number", booked: "Booked", not_interested: "Not interested", follow_up: "Follow up in 3 days",
};

export const isOurNote = (body: string | null | undefined): boolean => typeof body === "string" && body.trimStart().startsWith(MARKER);

export function tagPrefix(env: Record<string, string | undefined> = process.env): string {
  const v = (env.SUBSYNC_TAG_PREFIX ?? "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,30}$/.test(v) ? v : DEFAULT_TAG_PREFIX;
}
export const tagFor = (outcome: string, prefix = DEFAULT_TAG_PREFIX): string => `${prefix}${outcome.replace(/_/g, "-")}`;
export const isOurTag = (tag: string | null | undefined, prefix = DEFAULT_TAG_PREFIX): boolean => typeof tag === "string" && tag.toLowerCase().startsWith(prefix);

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A note the person typed: marker, their words, and who/when. */
export function noteBody(text: string, a: { who: string | null; now: Date }): string {
  return `${MARKER} ${text.trim().slice(0, NOTE_MAX)}\n(Added in SubSync by ${a.who || "a team member"}, ${day(a.now)})`;
}
export function outcomeNoteBody(outcome: string, a: { who: string | null; now: Date; note?: string | null }): string {
  const base = `${MARKER} Call outcome: ${OUTCOME_WORDS[outcome] ?? outcome}, logged in SubSync by ${a.who || "a team member"}, ${day(a.now)}`;
  return a.note ? `${base}\n${a.note.trim().slice(0, 500)}` : base;
}

/** One key per contact + what + minute. */
export function idemKey(a: { contactId: string; kind: "note" | "outcome"; outcome?: string | null; text?: string | null; now: number }): string {
  const what = a.kind === "outcome" ? a.outcome ?? "" : createHash("sha256").update((a.text ?? "").trim()).digest("hex").slice(0, 16);
  return `${a.kind}:${what}:${a.contactId}:${Math.floor(a.now / 60_000)}`;
}

export const capReached = (writesInLastHour: number, cap = CAP_PER_HOUR): boolean => writesInLastHour >= cap;
export const CAP_MESSAGE = (cap = CAP_PER_HOUR) => `You have reached the limit of ${cap} saves to your CRM this hour. Try again later.`;

export type SaveStatus = "saved" | "dry_run" | "needs_permission" | "failed";
/** The plain sentence for the screen. */
export function saveMessage(status: SaveStatus, what: "note" | "outcome", httpStatus?: number): string {
  if (status === "saved") return "Saved to the contact in your CRM";
  if (status === "dry_run") return "Writing to your CRM is switched off for now. Nothing was sent to your CRM" + (what === "outcome" ? ", but SubSync kept the result and moved the person off the call lists for 12 hours." : ". Your note is still here: use Copy note.");
  if (status === "needs_permission") return "Needs permission: reconnect. SubSync is not allowed to change contacts in your CRM yet.";
  return `Your CRM did not accept it${httpStatus ? ` (error ${httpStatus})` : ""}. Nothing was saved there. Try again.`;
}

export const TAG_MAX = 60;
export const cleanTag = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t.length >= 1 && t.length <= TAG_MAX && !/[,\n\r]/.test(t) ? t : null;
};

