import { WAITING_WINDOW_DAYS } from "./waiting.ts";
import { unansweredBusinessElapsedMs } from "./unanswered-advanced.ts";

export const BREACH24_HOURS = 24;
export const BREACH24_DAILY_CAP = 10;
export type BreachClock = { businessHours: boolean; openHour: number; closeHour: number };

export type BreachSource = {
  locationId: string;
  locationName: string | null;
  timeZone?: string | null;
  conversationId: string;
  contactId: string | null;
  personName: string | null;
  lastAt: number;
  unreadCount?: number;
  source?: string | null;
  assignedUserId: string | null;
  assignedUserVerified: boolean;
  accountAdminUserId: string | null;
};

export type BreachCandidate = BreachSource & {
  recipientUserKey: string;
  dedupeKey: string;
};

export function isBreachDue(row: BreachSource, now: number, clock?: BreachClock): boolean {
  if (row.lastAt <= now - WAITING_WINDOW_DAYS * 86_400_000) return false;
  if (clock?.businessHours) {
    return unansweredBusinessElapsedMs(row.lastAt, now, row.timeZone ?? null, clock.openHour, clock.closeHour) >= BREACH24_HOURS * 3_600_000;
  }
  return row.lastAt <= now - BREACH24_HOURS * 3_600_000;
}

export function breachDedupeKey(locationId: string, contactId: string | null, conversationId: string, recipientUserKey: string): string {
  const person = contactId ?? `conversation-${conversationId}`;
  return `breach24:${locationId}:${person}:${recipientUserKey}`;
}

export function breachCandidates(rows: readonly BreachSource[], now: number, clock?: BreachClock): BreachCandidate[] {
  const people = new Map<string, BreachCandidate>();
  for (const row of rows) {
    if (!isBreachDue(row, now, clock)) continue;
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
