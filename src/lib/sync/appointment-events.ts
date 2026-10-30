// Works out what changed for a batch of appointments between two syncs, so SubSync keeps its own history
// (the platform keeps none). Pure, so it can be unit tested.

export type IncomingAppointment = { id: string; status: string | null; startAt: number | null };
export type KnownAppointment = { status: string | null; startAt: number | null };
export type AppointmentEvent = { id: string; kind: "created" | "status" | "time"; from: string | null; to: string | null; startAt: number | null };

// `firstSyncDone` is false while an account is read for the first time: then every appointment looks new,
// which says nothing about when it was booked, so no "created" events are written (changes still are not
// possible either, since nothing is known yet).
export function diffAppointmentEvents(incoming: IncomingAppointment[], known: Map<string, KnownAppointment>, firstSyncDone: boolean): AppointmentEvent[] {
  const events: AppointmentEvent[] = [];
  for (const a of incoming) {
    const was = known.get(a.id);
    if (!was) {
      if (firstSyncDone) events.push({ id: a.id, kind: "created", from: null, to: a.status, startAt: a.startAt });
      continue;
    }
    if ((was.status ?? null) !== (a.status ?? null)) events.push({ id: a.id, kind: "status", from: was.status, to: a.status, startAt: a.startAt });
    // A move of a minute or more counts as rescheduled; smaller differences are rounding.
    if (was.startAt !== null && a.startAt !== null && Math.abs(was.startAt - a.startAt) >= 60_000) {
      events.push({ id: a.id, kind: "time", from: new Date(was.startAt).toISOString(), to: new Date(a.startAt).toISOString(), startAt: a.startAt });
    }
  }
  return events;
}
