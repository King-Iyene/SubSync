// Pure rules for the lead panel (N49, N50): the words under each tag, the next steps, and what the CRM does not give us. No database, so it is unit tested.
// The CRM does not say when a tag was added. SubSync notes the day it SAW a tag added. A tag with no such record is older than SubSync's watching.

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export type TagDateInput = { addedAt: string | null; firstSeenAt: string | null };
export type TagDate = { known: boolean; text: string };

/** One tag's date line. Known: "Added 3 Nov 2026". Unknown: "Before SubSync started watching (first seen 1 Oct 2026)". */
export function tagDateLabel({ addedAt, firstSeenAt }: TagDateInput): TagDate {
  if (addedAt) return { known: true, text: `Added ${day(addedAt)}` };
  if (firstSeenAt) return { known: false, text: `Before SubSync started watching (first seen ${day(firstSeenAt)})` };
  return { known: false, text: "Before SubSync started watching" };
}

/** Tags newest first; tags with no date last, in their own order. */
export function sortTags<T extends { addedAt: string | null }>(tags: readonly T[]): T[] {
  return [...tags].sort((a, b) => (a.addedAt && b.addedAt ? b.addedAt.localeCompare(a.addedAt) : a.addedAt ? -1 : b.addedAt ? 1 : 0));
}

/** Rows a section shows before "Show all". */
export const SECTION_ROWS = 6;

export type NextActionInput = {
  unread: number; owner: string | null; unassigned?: boolean; dnd: boolean;
  appointments: Array<{ at: string; status: string | null }>; now?: number;
};

/** One or two plain next steps from rules the app already uses: unanswered, no owner, an appointment past its time with no outcome. Never for people who asked not to be contacted. */
export function nextActions(i: NextActionInput): string[] {
  const out: string[] = [];
  const now = i.now ?? Date.now();
  const unmarked = i.appointments.filter((a) => new Date(a.at).getTime() < now && !a.status).length;
  if (i.dnd) return ["This person asked not to be contacted. Do not call or message."];
  if (i.unread > 0) out.push(`Reply. ${i.unread} ${i.unread === 1 ? "message is" : "messages are"} waiting.`);
  if (unmarked > 0) out.push(`Mark what happened at ${unmarked === 1 ? "the past appointment" : `${unmarked} past appointments`}.`);
  if (!i.owner || i.unassigned) out.push("Give this lead an owner.");
  return out.slice(0, 2);
}

/** What the CRM data does not give us today, named one by one (never a blank). */
export const NOT_AVAILABLE = [
  { id: "notes", label: "Notes" },
  { id: "tasks", label: "Tasks" },
  { id: "message_text", label: "What each message said" },
] as const;
export const NOT_AVAILABLE_LINE = "Not available from the platform yet";
