import { FIELD_FOR_ITEM, FIELD_LABEL, type FieldItem, type FieldMapping } from "./contact-fields.ts";
import { DESTINATIONS, ITEMS, type Item, type ItemDestination, type PolicyFlags } from "./policy.ts";

// What the "What to save and where" table shows (stage E2b item 2). Pure. Each row offers the same five places; a place the admin did not allow, or one that
// cannot work yet, is shown greyed out WITH the reason in plain words, so a person is never left wondering why a choice is missing.

export const ITEM_LABEL: Record<Item, string> = {
  summary: "Summary", action_items: "Action items", recording_link: "Recording link", attendees_and_date: "Attendees and date", transcript: "Transcript",
};

export const DESTINATION_WORDS: Record<ItemDestination, string> = {
  note: "Contact note", comment: "Conversation comment", field: "Contact field", subsync_only: "SubSync only", off: "Off",
};

export const PRESET_WORDS = [
  { id: "recommended", label: "Recommended", blurb: "Summary, action items, recording link and date go into one contact note. The transcript is not saved." },
  { id: "full_record", label: "Full record", blurb: "Everything in Recommended, plus the transcript as a conversation comment (split in parts if long). Needs your admin's OK for transcripts." },
  { id: "summary_only", label: "Summary only", blurb: "Just the summary, with the date and who was there, in one contact note." },
  { id: "custom", label: "Custom", blurb: "You choose where each item goes and can write your own layout." },
] as const;

export type Option = { value: ItemDestination; label: string; disabled: boolean; why: string | null };

export type OptionContext = {
  policy: PolicyFlags;
  /** The items this account's admin mapped to an enabled contact field. */
  fieldItems: readonly Item[];
  /** Whether the permission for conversation comments is held. */
  canComment: boolean;
};

/** The items an enabled mapping makes available for the "Contact field" place. */
export function itemsWithField(mappings: readonly FieldMapping[]): Item[] {
  const on = new Set<FieldItem>(mappings.filter((m) => m.enabled).map((m) => m.item));
  return ITEMS.filter((item) => FIELD_FOR_ITEM[item].some((f) => on.has(f)));
}

const PLURAL: Record<"note" | "comment" | "field", string> = { note: "Contact notes", comment: "Conversation comments", field: "Contact fields" };

/** Why a place is not available for an item, or null when it is. */
export function whyNot(item: Item, dest: ItemDestination, c: OptionContext): string | null {
  if (dest === "subsync_only" || dest === "off") return null;
  if (!c.policy.allowCrmWrites) return "Saving to the CRM is switched off by your admin.";
  if (!c.policy.destinations.includes(dest)) return `${PLURAL[dest]} are not allowed by your admin.`;
  if (item === "transcript" && !c.policy.allowTranscripts) return "Transcripts in the CRM are not allowed by your admin.";
  if (dest === "field") {
    if (item === "transcript") return "A transcript is too long for a contact field.";
    if (!c.fieldItems.includes(item)) return "Your admin has not set up a contact field for this yet.";
  }
  if (dest === "comment" && !c.canComment) return "Needs permission: reconnect.";
  return null;
}

export function optionsFor(item: Item, c: OptionContext): Option[] {
  const all: ItemDestination[] = [...DESTINATIONS, "subsync_only", "off"];
  return all.map((value) => {
    const why = whyNot(item, value, c);
    return { value, label: DESTINATION_WORDS[value], disabled: why !== null, why };
  });
}

/** The field names an item fills, in words, for the small note under a "Contact field" choice. */
export const fieldWords = (item: Item): string => FIELD_FOR_ITEM[item].map((f) => FIELD_LABEL[f]).join(" and ");
