import type { LeadSeed } from "../../ds";
import type { ApRow } from "./types";

// "Open contact" for an appointment: the person behind it opens in the shared lead panel (name, phone, email, tags, deals, notes, the conversation and the message box), so nobody has
// to leave SubSync to look at them or write to them. This file only builds what the panel needs from the row; the panel fetches the rest through the server, which checks that the
// account belongs to the signed-in user (nothing here is trusted as proof). Sending still goes through the panel's own preview-and-confirm step and the write gateway.

/** What the lead panel opens with. Null when the appointment has no contact on file (the button then says why instead of doing nothing). */
export function contactSeed(r: ApRow, note?: string): LeadSeed | null {
  if (!r.contactId || !r.locationId) return null;
  return {
    contactId: r.contactId, locationId: r.locationId, name: r.contactName, locationName: r.accountName || null, phone: r.phone ?? null, owner: r.ownerName,
    unassigned: r.ownerId === null, url: r.url ?? undefined, dnd: r.dnd === true, tab: "conversation", ...(note ? { note } : {}),
  };
}

/** One plain line about why messaging may not be possible, or null when nothing stands in the way that we know of up front (the panel and the server still check). */
export function contactReason(r: ApRow): string | null {
  if (!r.contactId) return "No contact is linked to this appointment, so there is nobody to open.";
  if (r.dnd) return "Asked not to be contacted. You can look at them here, but SubSync will not send them anything.";
  return null;
}
