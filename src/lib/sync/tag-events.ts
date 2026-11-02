// What changed in a contact's tags between two syncs. Pure, so it can be unit tested. The platform does not say WHEN a tag was added, so SubSync records
// the change when it first sees it ("since SubSync started watching"): the date is the day it was noticed, never the day it was really tagged.

export type TagEvent = { contactId: string; tag: string; kind: "added" | "removed" };

const norm = (tags: readonly string[] | null | undefined) => [...new Set((tags ?? []).map((t) => t.trim()).filter(Boolean))];

// `known` holds the tags we stored before this page; a contact we have never stored is new, and so is every tag on it, which says nothing about when it was
// tagged. `firstSyncDone` is false while an account is read for the first time, and then nothing is recorded. A new contact after that first read is recorded
// (its tags were put on it after SubSync was watching, or at creation, which is when it was noticed).
export function diffTagEvents(incoming: Array<{ contactId: string; tags: readonly string[] | null }>, known: Map<string, readonly string[] | null>, firstSyncDone: boolean): TagEvent[] {
  if (!firstSyncDone) return [];
  const out: TagEvent[] = [];
  for (const c of incoming) {
    const now = norm(c.tags);
    const before = known.has(c.contactId) ? norm(known.get(c.contactId)) : [];
    const had = new Set(before);
    const has = new Set(now);
    for (const t of now) if (!had.has(t)) out.push({ contactId: c.contactId, tag: t, kind: "added" });
    if (known.has(c.contactId)) for (const t of before) if (!has.has(t)) out.push({ contactId: c.contactId, tag: t, kind: "removed" });
  }
  return out;
}
