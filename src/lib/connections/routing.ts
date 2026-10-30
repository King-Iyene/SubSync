import type { Attendee } from "../analytics/meeting-intel.ts";

// Which client account a meeting belongs to. A Fathom or Zoom connection belongs to a person, not an
// account, so the account is found from who was in the meeting: the account that knows the most of the
// attendees wins. With no match it falls back to the account the person chose, and with neither the
// meeting is not saved (it is only counted), so notes never land in a guessed account.

export type KnownContact = { locationId: string; email: string };
export type Routed = { locationId: string; how: "matched" | "chosen" };

export function chooseAccount(attendees: Attendee[], known: KnownContact[], fallback: string | null, onlyLocationId: string | null = null): Routed | null {
  const wanted = new Set(attendees.map((a) => a.email?.toLowerCase()).filter((e): e is string => !!e));
  const perAccount = new Map<string, Set<string>>();
  for (const k of known) {
    if (onlyLocationId && k.locationId !== onlyLocationId) continue;
    const email = k.email.toLowerCase();
    if (!wanted.has(email)) continue;
    if (!perAccount.has(k.locationId)) perAccount.set(k.locationId, new Set());
    perAccount.get(k.locationId)!.add(email);
  }
  const ranked = [...perAccount.entries()].sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1));
  if (ranked.length > 0) return { locationId: ranked[0][0], how: "matched" };
  if (onlyLocationId) return { locationId: onlyLocationId, how: "chosen" };
  return fallback ? { locationId: fallback, how: "chosen" } : null;
}
