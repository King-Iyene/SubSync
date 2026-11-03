import { ASSUMED_LIMITS } from "../ghl/crm-writes.ts";
import { plain } from "./note-template.ts";
import type { Item } from "./policy.ts";

// The contact-field destination (INTEGRATIONS_SPEC section 8.1, stage E2b item 1). Pure.
//
// A contact field holds ONE current value, so it answers "when did we last meet?" and "what is the next step?", while notes keep the history.
//   - A field is written only when the admin MAPPED it to one of the account's own fields and left it ON. Nothing is mapped until the admin does it.
//   - A meeting older than the one that filled the field never overwrites it (newer meeting wins), so a late or retried delivery cannot replace newer data.
//   - The right type goes in: a date into a date field, text into a text field. A value too long for the field is cut at a word, or skipped when it cannot
//     be cut (a link), and the reason is always given in words. Nothing is ever half-written.
//   - Nothing is cleared: a call with nothing to say for a field leaves the field as it is.

export const FIELD_ITEMS = ["last_meeting_date", "last_meeting_summary", "next_steps", "recording_url", "rep"] as const;
export type FieldItem = (typeof FIELD_ITEMS)[number];

/** The names an admin sees (spec 8.1 "standard fields"). */
export const FIELD_LABEL: Record<FieldItem, string> = {
  last_meeting_date: "Last meeting date",
  last_meeting_summary: "Last meeting summary (short)",
  next_steps: "Next steps",
  recording_url: "Recording link",
  rep: "Last meeting with (team member)",
};

/** Which fields a table row fills when its destination is "Contact field". A transcript never goes into a field. */
export const FIELD_FOR_ITEM: Record<Item, readonly FieldItem[]> = {
  summary: ["last_meeting_summary"],
  action_items: ["next_steps"],
  recording_link: ["recording_url"],
  attendees_and_date: ["last_meeting_date", "rep"],
  transcript: [],
};

/** Spec 8.1: when the admin first maps, Last meeting date and Next steps are on; summary and recording link are off. The team member is off too. */
export const FIELD_DEFAULT_ON: Record<FieldItem, boolean> = { last_meeting_date: true, last_meeting_summary: false, next_steps: true, recording_url: false, rep: false };

/** The CRM's own field types, reduced to the ones SubSync can write. Anything else is "other" and is refused. */
export type FieldType = "date" | "text" | "large_text" | "other";

/** The CRM names a field's data type (TEXT, LARGE_TEXT, DATE, NUMERICAL, ...). CHECK the exact names on a real account. */
export function fieldTypeOf(dataType: string | null | undefined): FieldType {
  const t = (dataType ?? "").trim().toUpperCase();
  if (t === "DATE") return "date";
  if (t === "TEXT") return "text";
  if (t === "LARGE_TEXT" || t === "TEXTBOX_LIST_LARGE") return "large_text";
  return "other";
}

export type FieldMapping = { item: FieldItem; customFieldId: string; fieldName: string; fieldType: FieldType; enabled: boolean };

const KIND: Record<FieldItem, "date" | "text" | "url"> = { last_meeting_date: "date", last_meeting_summary: "text", next_steps: "text", recording_url: "url", rep: "text" };

/** Why this kind of field cannot hold this value, in words (shown when the admin maps it). Null when it fits. */
export function typeProblem(item: FieldItem, type: FieldType): string | null {
  const kind = KIND[item];
  const ok = kind === "date" ? type === "date" || type === "text" || type === "large_text" : type === "text" || type === "large_text";
  if (ok) return null;
  return kind === "date"
    ? "This field is not a date or a text field, so it cannot hold a date."
    : `This field is not a text field, so it cannot hold ${kind === "url" ? "a link" : "text"}.`;
}

/** The longest value a field takes. ASSUMED until the real limit has been measured on a test account (docs/features/E0.md section 6). */
export const fieldLimit = (type: FieldType): number => (type === "large_text" ? ASSUMED_LIMITS.largeTextFieldChars : ASSUMED_LIMITS.textFieldChars);

export type FieldSource = { startedAt: string | null; summary: string | null; actionItems: string[]; recordingUrl: string | null; rep: string | null };

const DATE_TEXT = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** The value for one field before the length rule: the right type for the field, plain text only. Null when there is nothing to say. */
export function valueFor(item: FieldItem, s: FieldSource, type: FieldType): string | null {
  switch (item) {
    case "last_meeting_date": {
      if (!s.startedAt || Number.isNaN(Date.parse(s.startedAt))) return null;
      return type === "date" ? new Date(s.startedAt).toISOString().slice(0, 10) : DATE_TEXT(s.startedAt);
    }
    case "last_meeting_summary": {
      const t = plain(s.summary, 6_000);
      return t ? (type === "large_text" ? t : t.replace(/\s*\n+\s*/g, " ")) : null;
    }
    case "next_steps": {
      const items = s.actionItems.map((a) => plain(a, 300)).filter(Boolean);
      if (items.length === 0) return null;
      return type === "large_text" ? items.map((a) => `- ${a}`).join("\n") : items.join("; ");
    }
    case "recording_url": {
      const u = (s.recordingUrl ?? "").trim();
      return /^https:\/\/\S+$/.test(u) ? u : null;
    }
    case "rep": {
      const t = plain(s.rep, 120).replace(/\s*\n+\s*/g, " ");
      return t || null;
    }
  }
}

/** Cuts text at a word boundary so it fits, ending in an ellipsis. */
export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = Math.max(max - 1, 1);
  const slice = text.slice(0, room);
  const space = slice.lastIndexOf(" ");
  return (space > room * 0.6 ? slice.slice(0, space) : slice).trimEnd() + "…";
}

export type SkipCode = "not_mapped" | "disabled" | "empty" | "no_meeting_date" | "older_meeting" | "type_mismatch" | "too_long";
export type FieldSkip = { item: FieldItem; code: SkipCode; message: string };
export type FieldWrite = { item: FieldItem; fieldId: string; fieldName: string; value: string; cut: { kept: number; of: number } | null };
export type FieldPlan = { writes: FieldWrite[]; skipped: FieldSkip[] };

/** The fields the person's choices ask for: every field the "Contact field" rows of the (clipped) table fill. */
export function requestedFields(items: Record<Item, string>): FieldItem[] {
  const want = new Set<FieldItem>();
  for (const [item, dest] of Object.entries(items)) if (dest === "field") for (const f of FIELD_FOR_ITEM[item as Item] ?? []) want.add(f);
  return FIELD_ITEMS.filter((f) => want.has(f));
}

/**
 * Decides what one meeting writes into one contact's fields. `previous` is the start time (ms) of the meeting that filled each field last. The decision
 * is made for every requested field on its own: one field being skipped never stops the others.
 */
export function planFieldWrites(a: { requested: readonly FieldItem[]; mappings: readonly FieldMapping[]; source: FieldSource; previous: Partial<Record<FieldItem, number>> }): FieldPlan {
  const out: FieldPlan = { writes: [], skipped: [] };
  const startedAt = a.source.startedAt && !Number.isNaN(Date.parse(a.source.startedAt)) ? Date.parse(a.source.startedAt) : null;
  const skip = (item: FieldItem, code: SkipCode, message: string) => out.skipped.push({ item, code, message: `${FIELD_LABEL[item]}: ${message}` });
  for (const item of a.requested) {
    const m = a.mappings.find((x) => x.item === item);
    if (!m) { skip(item, "not_mapped", "your admin has not set up a field for this, so nothing was written."); continue; }
    if (!m.enabled) { skip(item, "disabled", "your admin turned this field off, so nothing was written."); continue; }
    const problem = typeProblem(item, m.fieldType);
    if (problem) { skip(item, "type_mismatch", `the field "${m.fieldName}" cannot hold this. ${problem}`); continue; }
    // Newer meeting wins. Without a date for this call there is no way to tell, so a field that already has a value is left alone.
    const before = a.previous[item];
    if (before !== undefined && startedAt === null) { skip(item, "no_meeting_date", "this call has no date, so SubSync cannot tell if it is newer than what is there. Nothing was changed."); continue; }
    if (before !== undefined && startedAt !== null && startedAt <= before) { skip(item, "older_meeting", "a newer call already filled this field, so it was left as it is."); continue; }
    const raw = valueFor(item, a.source, m.fieldType);
    if (raw === null) { skip(item, "empty", "this call had nothing to put here, so the field was left as it is."); continue; }
    const limit = fieldLimit(m.fieldType);
    if (raw.length <= limit) { out.writes.push({ item, fieldId: m.customFieldId, fieldName: m.fieldName, value: raw, cut: null }); continue; }
    // A date and a link cannot be shortened. Text is cut at a word, and the cut is reported.
    if (KIND[item] !== "text") { skip(item, "too_long", `the value is longer than the field "${m.fieldName}" takes (${limit} characters), so nothing was written.`); continue; }
    const value = cutAtWord(raw, limit);
    out.writes.push({ item, fieldId: m.customFieldId, fieldName: m.fieldName, value, cut: { kept: value.length, of: raw.length } });
  }
  return out;
}

/** The two warnings an admin reads, in plain words, before turning contact fields on (spec 8.1). */
export const FIELD_WARNINGS = [
  "A field value can be merged into emails and texts you send to the contact. Do not map a call summary into a field your messages use.",
  "Changing a field can start your own automations that watch that field.",
] as const;
