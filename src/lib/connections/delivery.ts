import { ASSUMED_LIMITS } from "../ghl/crm-writes.ts";
import { MAX_TRANSCRIPT_PARTS, planTranscript, splitIntoParts, usableChars } from "./content-split.ts";
import {
  buildVars, checkTemplate, DEFAULT_TEMPLATE, fillTemplate, MAX_TRANSCRIPT_CHARS, plain, TRANSCRIPT_LINK_TEMPLATE, TRANSCRIPT_TEMPLATE, type Includes, type NoteInput,
} from "./note-template.ts";
import { requestedFields, type FieldItem } from "./contact-fields.ts";
import type { Item, Matrix } from "./policy.ts";

// What one meeting writes into one contact, as a list of items (stage E2b items 1 to 4). Pure.
// Input: the call, the person's choices after the account's rules (`items`: where each part goes), and the text layout. Output: the contact notes and
// the conversation comments (each already split into "Part i of N" when long), the contact fields that were asked for, and plain remarks that say what
// was left out and why (a transcript saved as a link, for example). The writing itself is in ingest.ts.

export type DeliveryInput = NoteInput & { transcript?: string | null; transcriptUrl?: string | null };

export type Destination2 = "note" | "comment";
export type Message = { kind: Destination2; partNo: number; text: string; what: "meeting" | "transcript" };

export type Composed = {
  messages: Message[];
  /** The contact fields the table asks for. Whether each is written is decided later, per field (mapping, type, newer meeting). */
  fieldItems: FieldItem[];
  /** Plain sentences about what was left out or changed, for the log and the preview. */
  remarks: string[];
};

export type Limits = { note: number; comment: number };
export const DEFAULT_LIMITS: Limits = { note: ASSUMED_LIMITS.noteChars, comment: ASSUMED_LIMITS.commentChars };

/** Which parts of the call go to one destination. The transcript is separate (it has its own items). */
export const includesFor = (items: Record<Item, string>, dest: Destination2): Includes => ({
  summary: items.summary === dest, actionItems: items.action_items === dest, recordingLink: items.recording_link === dest, attendeesAndDate: items.attendees_and_date === dest,
});
const wantsText = (i: Includes) => i.summary || i.actionItems || i.recordingLink || i.attendeesAndDate;

const NO_URL_LINK = TRANSCRIPT_LINK_TEMPLATE.replace("Open it in {tool}: {transcript_url}", "It is in {tool}.");

export function composeDelivery(a: { input: DeliveryInput; items: Matrix; template?: string | null; limits?: Limits; maxTranscriptParts?: number }): Composed {
  const limits = a.limits ?? DEFAULT_LIMITS;
  const maxParts = a.maxTranscriptParts ?? MAX_TRANSCRIPT_PARTS;
  const custom = a.template && checkTemplate(a.template).ok ? a.template : null;
  const template = custom ?? DEFAULT_TEMPLATE;
  const inlineTranscript = /\{transcript\}/.test(template);
  const remarks: string[] = [];
  const messages: Message[] = [];
  const counters: Record<Destination2, number> = { note: 0, comment: 0 };
  const push = (kind: Destination2, what: Message["what"], text: string) => {
    for (const part of splitIntoParts(text, limits[kind])) if (part.trim()) messages.push({ kind, partNo: ++counters[kind], text: part, what });
  };
  const transcriptText = plain(a.input.transcript, MAX_TRANSCRIPT_CHARS);
  const link = a.input.transcriptUrl ?? null;

  for (const dest of ["note", "comment"] as const) {
    const inc = includesFor(a.items, dest);
    const transcriptHere = a.items.transcript === dest && transcriptText.length > 0;
    // The transcript goes inside the layout only when the layout asks for {transcript}; otherwise it is its own item.
    const inline = transcriptHere && inlineTranscript;
    if (wantsText(inc) || inline) {
      let transcript = "";
      if (inline) {
        const plan = planTranscript(transcriptText, limits[dest], maxParts);
        if (plan.kind === "parts") transcript = transcriptText;
        else { transcript = link ? `The full transcript is too long to save here. Open it in ${a.input.tool}: ${link}` : `The full transcript is too long to save here. It is in ${a.input.tool}.`; remarks.push(`The transcript needed ${plan.neededParts} parts, so a link to it was saved instead.`); }
      }
      push(dest, "meeting", fillTemplate(template, buildVars(a.input, inc, { transcript, transcriptUrl: link })));
    }
    if (transcriptHere && !inline) {
      const plan = planTranscript(fillTemplate(TRANSCRIPT_TEMPLATE, buildVars(a.input, { summary: false, actionItems: false, recordingLink: false, attendeesAndDate: true }, { transcript: transcriptText })), limits[dest], maxParts);
      if (plan.kind === "parts") {
        for (const part of plan.parts) messages.push({ kind: dest, partNo: ++counters[dest], text: part, what: "transcript" });
      } else {
        remarks.push(`The transcript needed ${plan.neededParts} parts, so a link to it was saved instead.`);
        push(dest, "transcript", fillTemplate(link ? TRANSCRIPT_LINK_TEMPLATE : NO_URL_LINK, buildVars(a.input, { summary: false, actionItems: false, recordingLink: false, attendeesAndDate: true }, { transcriptUrl: link })));
      }
    }
  }
  return { messages, fieldItems: requestedFields(a.items), remarks };
}

/** The most characters one comment or note takes before it is split, for the preview's "N parts" line. */
export const usableFor = (kind: Destination2, limits: Limits = DEFAULT_LIMITS): number => usableChars(limits[kind]);

export type PreviewSection = { label: string; parts: string[] };

export const DESTINATION_LABEL: Record<Destination2, string> = { note: "Contact note", comment: "Conversation comment (only your team sees it)" };

/** The delivery as a person reads it in a preview: one section per destination, each item in order. Fields are listed by plain name in `fieldLabels`. */
export function previewSections(c: Composed): PreviewSection[] {
  const out: PreviewSection[] = [];
  for (const kind of ["note", "comment"] as const) {
    const parts = c.messages.filter((m) => m.kind === kind).map((m) => m.text);
    if (parts.length) out.push({ label: DESTINATION_LABEL[kind], parts });
  }
  return out;
}

/** One block of text for the older single-box preview: a lone contact note is shown as it is, anything more gets a heading per destination. */
export function previewText(c: Composed): string {
  const sections = previewSections(c);
  if (sections.length === 1 && sections[0].label === DESTINATION_LABEL.note) return sections[0].parts.join("\n\n");
  return sections.map((s) => `${s.label}\n${s.parts.join("\n\n")}`).join("\n\n");
}
