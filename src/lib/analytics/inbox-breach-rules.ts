import { WAITING_WINDOW_DAYS } from "./waiting.ts";

export const BREACH24_HOURS = 24;
export const BREACH24_DAILY_CAP = 10;

export type BreachSource = {
  locationId: string;
  locationName: string | null;
  conversationId: string;
  contactId: string | null;
  personName: string | null;
  lastAt: number;
  assignedUserId: string | null;
  assignedUserVerified: boolean;
  accountAdminUserId: string | null;
};

export type BreachCandidate = BreachSource & {
  recipientUserKey: string;
  dedupeKey: string;
};

export function breachDedupeKey(locationId: string, contactId: string | null, conversationId: string, recipientUserKey: string): string {
  const person = contactId ?? `conversation-${conversationId}`;
  return `breach24:${locationId}:${person}:${recipientUserKey}`;
}

export function breachCandidates(rows: readonly BreachSource[], now: number): BreachCandidate[] {
  const oldest = now - WAITING_WINDOW_DAYS * 86_400_000;
  const people = new Map<string, BreachCandidate>();
  for (const row of rows) {
    if (row.lastAt > now - BREACH24_HOURS * 3_600_000 || row.lastAt <= oldest) continue;
    const recipientUserKey = row.assignedUserVerified && row.assignedUserId ? row.assignedUserId : row.accountAdminUserId;
    if (!recipientUserKey) continue;
    const personKey = `${row.locationId}:${row.contactId ?? `conversation-${row.conversationId}`}`;
    const prior = people.get(personKey);
    if (!prior || row.lastAt < prior.lastAt) {
      people.set(personKey, {
        ...row,
        recipientUserKey,
        dedupeKey: breachDedupeKey(row.locationId, row.contactId, row.conversationId, recipientUserKey),
      });
    }
  }
  return [...people.values()];
}
