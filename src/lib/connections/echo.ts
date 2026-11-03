// Our own writes must not change our own numbers (INTEGRATIONS_SPEC section 10, CLAUDE.md principle 14). Pure helpers; the database part is write-log.ts.
//
//   1. An internal comment SubSync writes is an outbound message: speed to lead and "waiting" must not count it (message-kinds.ts, speed-intel.ts, waiting.ts).
//   2. A note or a custom field write may move the contact's "last activity" date. Within OUR_WRITE_WINDOW_MS after one of our writes, a new last-activity
//      date is treated as ours and the older date is kept (see keepsOlderActivity and the contact sync).
//   3. When SubSync creates a note or comment, the platform may send a webhook about it. An event whose id is in the write log is dropped.

/** How long after one of our writes a contact's new "last activity" date is assumed to be our own doing. The webhook and the sync both lag, so this is generous. */
export const OUR_WRITE_WINDOW_MS = 30 * 60_000;
/** The platform stamps a write a little before our own record of it. */
export const OUR_WRITE_LEAD_MS = 60_000;

const ID = /^[A-Za-z0-9_-]{6,100}$/;

/** Every id a note or message webhook might carry for the thing that was just created, to look up in the write log. */
export function candidateIds(body: unknown): string[] {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : {}) as Record<string, unknown>;
  const found = new Set<string>();
  for (const source of [root, data]) {
    for (const key of ["messageId", "noteId", "id"]) {
      const v = source[key];
      if (typeof v === "string" && ID.test(v)) found.add(v);
    }
    const note = source.note;
    if (note && typeof note === "object") {
      const v = (note as Record<string, unknown>).id;
      if (typeof v === "string" && ID.test(v)) found.add(v);
    }
  }
  return [...found];
}

/**
 * Is this contact activity date the echo of one of our own writes? `writes` are the times SubSync wrote to this contact (not undone).
 * The date counts as ours when it falls from just before a write to OUR_WRITE_WINDOW_MS after it.
 */
export function isOurActivity(activityAt: number | null, writes: number[]): boolean {
  if (activityAt === null || !Number.isFinite(activityAt)) return false;
  return writes.some((w) => activityAt >= w - OUR_WRITE_LEAD_MS && activityAt <= w + OUR_WRITE_WINDOW_MS);
}

/** The activity date to keep: the previous one when the new one is our own write, otherwise the new one. */
export function keepsOlderActivity(next: number | null, previous: number | null, writes: number[]): number | null {
  return isOurActivity(next, writes) ? previous : next;
}
