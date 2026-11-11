// Pure part of the Appointments moat writer (no database imports, unit tested): the diff of a stored snapshot against a new one.

export type Snap = { status: string | null; startAt: number | null; ownerId: string | null; calendarId: string | null; bookerId: string | null; contactId: string | null };
export type HistKind = "created" | "status" | "time" | "owner" | "calendar" | "booker" | "reminder" | "confirmed" | "deal_linked" | "rescheduled_from" | "deleted" | "note";
export type ActorKind = "person" | "subsync" | "system" | "unknown";
export type HistEvent = { kind: HistKind; key: string; from: string | null; to: string | null; at: number; actorId: string | null; actorKind: ActorKind; startAt: number | null };

const minute = (t: number) => Math.floor(t / 60_000);
export const OWN_WRITE_WINDOW_MS = 10 * 60_000;

/** The events a webhook (or any new read) implies, by comparing the stored snapshot with the new one. `prev` null = first sight. `own` = values SubSync itself wrote recently. */
export function diffHistory(id: string, prev: Snap | null, next: Snap, o: { at: number; actorId?: string | null; own?: Array<{ kind: HistKind; to: string | null; at: number }>; createdAt?: number | null }): HistEvent[] {
  const out: HistEvent[] = [];
  const own = (kind: HistKind, to: string | null) => (o.own ?? []).some((w) => w.kind === kind && w.to === to && Math.abs(o.at - w.at) <= OWN_WRITE_WINDOW_MS);
  const push = (kind: HistKind, from: string | null, to: string | null, startAt: number | null, key = `${kind}|${id}|${from ?? ""}>${to ?? ""}|${minute(o.at)}`) => {
    const mine = own(kind, to);
    out.push({ kind, key, from, to, at: o.at, actorId: mine ? null : o.actorId ?? null, actorKind: mine ? "subsync" : o.actorId ? "person" : "unknown", startAt });
  };
  if (!prev) {
    const at = o.createdAt ?? o.at;
    out.push({ kind: "created", key: `created|${id}`, from: null, to: next.status, at, actorId: next.bookerId, actorKind: next.bookerId ? "person" : "system", startAt: next.startAt });
    if (next.bookerId) out.push({ kind: "booker", key: `booker|${id}|first`, from: null, to: next.bookerId, at, actorId: next.bookerId, actorKind: "person", startAt: next.startAt });
    if (next.ownerId) out.push({ kind: "owner", key: `owner|${id}|first`, from: null, to: next.ownerId, at, actorId: null, actorKind: "system", startAt: next.startAt });
    return out;
  }
  if (next.status && prev.status !== next.status) push("status", prev.status, next.status, next.startAt);
  if (next.startAt !== null && prev.startAt !== null && next.startAt !== prev.startAt) push("time", new Date(prev.startAt).toISOString(), new Date(next.startAt).toISOString(), next.startAt);
  if (next.ownerId !== prev.ownerId && (next.ownerId || prev.ownerId)) push("owner", prev.ownerId, next.ownerId, next.startAt);
  if (next.calendarId !== prev.calendarId && next.calendarId) push("calendar", prev.calendarId, next.calendarId, next.startAt);
  if (!prev.bookerId && next.bookerId) push("booker", null, next.bookerId, next.startAt, `booker|${id}|first`);
  return out;
}

/** Whether a time change moves the appointment (a reschedule) rather than a correction of a few minutes. */
export const isReschedule = (e: HistEvent) => e.kind === "time" && !!e.from && !!e.to && Math.abs(Date.parse(e.to) - Date.parse(e.from)) >= 15 * 60_000;

