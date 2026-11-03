import type { Attendee } from "../analytics/meeting-intel.ts";

// Which client account a meeting belongs to. A Fathom or Zoom connection belongs to a person, not an account, so the account is found
// from who was in the meeting, by exact email, and only when that is certain (CLAUDE.md principle 13). There is no "default account":
// a meeting nobody can be matched to is not saved, only counted, so notes never land in a guessed account.
//
//   - An email that more than one contact record has (two clients, or two records in one account) decides nothing.
//   - A meeting whose matches sit in more than one client account decides nothing, even when one account has more of them.
//   - A connection that belongs to a single business only ever looks inside that business's own account.

export type KnownContact = { locationId: string; email: string; contactId?: string };
export type Routed = { locationId: string; how: "matched" };

export function chooseAccount(attendees: Attendee[], known: KnownContact[], onlyLocationId: string | null = null): Routed | null {
  const wanted = new Set(attendees.map((a) => a.email?.toLowerCase()).filter((e): e is string => !!e));
  // email -> the distinct contact records that have it (a record is "account:contact id", or just the account when the id is not given)
  const owners = new Map<string, Set<string>>();
  for (const k of known) {
    if (onlyLocationId && k.locationId !== onlyLocationId) continue;
    const email = k.email.toLowerCase();
    if (!wanted.has(email)) continue;
    if (!owners.has(email)) owners.set(email, new Set());
    owners.get(email)!.add(k.locationId + ":" + (k.contactId ?? ""));
  }
  const accounts = new Set<string>();
  for (const records of owners.values()) {
    if (records.size !== 1) continue; // two records have this email: not certain, so it decides nothing
    accounts.add([...records][0].split(":")[0]);
  }
  return accounts.size === 1 ? { locationId: [...accounts][0], how: "matched" } : null;
}
