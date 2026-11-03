import type { FieldMapping } from "@/lib/connections/contact-fields";
import type { FieldReport, FieldState, PartRef } from "@/lib/connections/ingest";
import type { SeenMeeting } from "@/lib/connections/source-priority";
import { memStore } from "./e2a-support";

// Support for the stage E2b tests: the E2a in-memory stand-in for the database, plus the parts this stage added to the store: the admin's field mapping,
// the field lock and what filled each field last, the per-part claim in the write log, the same-meeting lookup, and the comment permission. The rules are
// the same as the real tables (one claim per part, a lock per contact), so a test of ordering or of two simultaneous runs means something.
// No network, no database, no token. Every CRM call in these tests goes through the fake transport of `crm()` in e2a-support.

export type E2bOver = Parameters<typeof memStore>[0] & {
  mappings?: Record<string, FieldMapping[]>;
  /** Does the install hold the permission for conversation comments? Default yes. */
  commentScope?: boolean;
  /** Meetings from another tool that exist already (the same-meeting rule). */
  seen?: SeenMeeting[];
};

export function memStoreE2b(over: E2bOver = {}) {
  const mem = memStore(over);
  const fieldState = new Map<string, { startedAt: number; meetingId: string }>();
  const parts = new Map<string, { ghlId: string | null }>();
  const locks = new Map<string, Promise<unknown>>();
  const log = { fieldWrites: [] as Array<Record<string, unknown>>, deliveries: [] as FieldReport[][], duplicates: [] as string[][], claimed: [] as string[], released: [] as string[] };
  const seen: SeenMeeting[] = [...(over.seen ?? [])];

  const keyOf = (r: Pick<PartRef, "meetingId" | "contactId" | "kind" | "partNo">) => `${r.meetingId}|${r.contactId}|${r.kind}|${r.partNo}`;

  const store: typeof mem.store = {
    ...mem.store,
    fieldMappings: async (_inst, ids) => Object.fromEntries(Object.entries(over.mappings ?? {}).filter(([id]) => ids.includes(id))),
    hasScope: async () => over.commentScope !== false,
    // A lock per contact: one run at a time, like the database's advisory lock.
    fieldLock: async <T>(_inst: string, locationId: string, contactId: string, fn: (state: FieldState) => Promise<T>): Promise<T> => {
      const key = `${locationId}|${contactId}`;
      const before = locks.get(key) ?? Promise.resolve();
      const run = before.then(async () => {
        const state: FieldState = {
          previous: async (items) => Object.fromEntries(items.flatMap((i) => (fieldState.has(`${key}|${i}`) ? [[i, fieldState.get(`${key}|${i}`)!.startedAt]] : []))),
          record: async (r) => {
            if (r.meetingStartedAt !== null) {
              const cur = fieldState.get(`${key}|${r.item}`);
              if (!cur || cur.startedAt < r.meetingStartedAt) fieldState.set(`${key}|${r.item}`, { startedAt: r.meetingStartedAt, meetingId: r.meetingId });
            }
            log.fieldWrites.push({ locationId, contactId, item: r.item, partNo: r.partNo, meetingId: r.meetingId });
          },
        };
        return fn(state);
      });
      locks.set(key, run.catch(() => undefined));
      return run;
    },
    recentMeetings: async () => [...seen, ...[...mem.meetings.values()].map((m): SeenMeeting => ({ id: m.id, provider: m.provider, startedAt: m.startedAt, attendeeEmails: m.attendeeEmails, title: m.title, status: m.status }))],
    markDuplicates: async (_inst, _user, ids) => {
      log.duplicates.push(ids);
      for (const s of seen) if (ids.includes(s.id)) s.status = "duplicate";
      for (const id of ids) { const m = mem.meetings.get(id); if (m) m.status = "duplicate"; }
    },
    claimPart: async (r) => { const k = keyOf(r); if (parts.has(k)) return false; parts.set(k, { ghlId: null }); log.claimed.push(k); return true; },
    finishPart: async (r, ghlId) => { const p = parts.get(keyOf(r)); if (p) p.ghlId = ghlId; mem.log.writes.push({ installationId: r.installationId, meetingId: r.meetingId, locationId: r.locationId, contactId: r.contactId, kind: r.kind, partNo: r.partNo, ghlId, authoredBy: r.authoredBy }); },
    releasePart: async (r) => { parts.delete(keyOf(r)); log.released.push(keyOf(r)); },
    logDelivery: async (_i, _u, _m, fields) => { log.deliveries.push(fields); },
  };
  return { ...mem, store, e2b: { log, fieldState, parts, seen } };
}
