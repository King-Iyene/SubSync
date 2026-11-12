import type { Composed } from "./delivery.ts";
import type { DeliveryInput } from "./delivery.ts";
import { plain } from "./note-template.ts";

// The short meeting note (Automation pass). Pure. A note is ONLY: the meeting title and date, the meeting link, the recording link, and at most one summary
// line. Never a transcript, never a list of action items, never raw markdown, never "Part 1 of 3". The same meeting is written once (the write log holds one
// row per meeting, contact, kind and part 1), and an old long note is never edited: new meetings simply stop making them.

export const ONE_LINE_MAX = 200;

/** Strips markdown and links down to plain words, then keeps the first sentence that fits on one line. */
export function oneLine(summary: string | null | undefined, max = ONE_LINE_MAX): string {
  let s = plain(summary ?? "", 4_000);
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/[*_`#>~]+/g, "").replace(/^\s*[-•\d.)]+\s+/gm, "").replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "");
  s = s.split(/\n+/).map((l) => l.trim()).find((l) => l.length > 3) ?? "";
  s = s.replace(/\s+/g, " ").trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(s)?.[1] ?? s;
  const pick = sentence.length >= 20 ? sentence : s;
  return pick.length > max ? pick.slice(0, max - 1).trimEnd() + "…" : pick;
}

const httpsOnly = (u: string | null | undefined) => (u && /^https:\/\/[^\s]+$/.test(u) ? u : null);

const when = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "date unknown");

/** The whole note text. Lines with nothing to say are left out. */
export function shortNoteText(i: Pick<DeliveryInput, "title" | "startedAt" | "summary" | "recordingUrl" | "transcriptUrl" | "tool">): string {
  const lines = [`Meeting: ${plain(i.title, 120) || "Untitled"} (${when(i.startedAt)})`];
  const call = httpsOnly(i.transcriptUrl);
  const rec = httpsOnly(i.recordingUrl);
  if (call) lines.push(`Meeting link: ${call}`);
  if (rec && rec !== call) lines.push(`Recording: ${rec}`);
  const sum = oneLine(i.summary);
  if (sum) lines.push(`Summary: ${sum}`);
  lines.push(`Added by SubSync from ${i.tool}.`);
  return lines.join("\n");
}

/** Replaces a composed delivery with the short note: one contact note, no comments, no transcript. Contact fields are kept as they were asked for. */
export function toShortNote(c: Composed, input: DeliveryInput): Composed {
  const hadNote = c.messages.some((m) => m.kind === "note");
  const messages = hadNote ? [{ kind: "note" as const, partNo: 1, text: shortNoteText(input), what: "meeting" as const }] : [];
  return { messages, fieldItems: c.fieldItems, remarks: [...c.remarks, "Automatic short note: title, date, links and one line."] };
}

/** The sentence the person is shown once, at connect time, and that they accept to switch automatic notes on. */
export const AUTO_EXPLAIN = "When a meeting ends and one contact matches an attendee's email exactly, SubSync adds a short note (title, date, links) to that contact. You can undo any note.";

/** What the notice says. A match is never guessed: otherwise the call waits for one click. */
export const addedText = (name: string | null) => `Meeting with ${plain(name, 80) || "a contact"} was added to their contact.`;
export const needsMatchText = (title: string | null) => `The meeting "${plain(title, 80) || "Untitled"}" could not be matched to one contact with certainty. Pick the contact in Needs matching.`;
