// Unsent message drafts, one per person, kept in memory for the life of the page (never in storage: a message to a customer is customer data). A panel that closes, reopens or
// refreshes shows the draft again; a message that was really sent clears it. Pure and small so a test can run it without a browser.

export type Draft = { text: string; subject: string; channel: "SMS" | "Email" | "WhatsApp" | null };
const drafts = new Map<string, Draft>();
const MAX = 200;

export const draftKey = (locationId: string, contactId: string) => `${locationId}:${contactId}`;
export function getDraft(key: string): Draft | undefined { return drafts.get(key); }
export function putDraft(key: string, d: Draft) {
  if (!d.text && !d.subject) { drafts.delete(key); return; }
  drafts.delete(key); drafts.set(key, d);
  if (drafts.size > MAX) drafts.delete(drafts.keys().next().value as string);
}
export function clearDraft(key: string) { drafts.delete(key); }
export function draftCount() { return drafts.size; }
