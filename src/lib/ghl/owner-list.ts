// The Owner picker's list. Pure (no database), so it is unit tested. Rules: only people who belong to THAT account; a real display name for each; sorted;
// an unresolved id is never a choice. The one exception is the lead's CURRENT owner, who stays visible so the picker is honest (named if known, else "Unknown user").
export type OwnerOption = { id: string; name: string };
export const UNKNOWN_USER = "Unknown user";

/** First + last name, else the email's local part, else null (never an id). */
export function displayName(u: { name?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null }): string | null {
  const full = (u.name ?? "").trim() || [u.firstName, u.lastName].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  if (full) return full;
  const local = (u.email ?? "").split("@")[0]?.trim();
  return local ? local : null;
}

export function buildOwnerOptions(members: ReadonlyArray<{ id: string; name: string | null }>, currentOwnerId: string | null, knownNames: ReadonlyMap<string, string>): OwnerOption[] {
  const out = new Map<string, OwnerOption>();
  for (const m of members) {
    const name = (m.name ?? "").trim();
    if (m.id && name && !out.has(m.id)) out.set(m.id, { id: m.id, name });
  }
  const options = [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (currentOwnerId && !out.has(currentOwnerId)) {
    options.unshift({ id: currentOwnerId, name: (knownNames.get(currentOwnerId) ?? "").trim() || UNKNOWN_USER });
  }
  return options;
}
