// Works out what changed for a page of deals between two syncs. Pure, so it can be unit tested.

export type Incoming = { id: string; stageId: string | null; status: string; value: number };
export type Known = { stageId: string | null; status: string | null };
export type DealEvent = { id: string; kind: "created" | "stage" | "status"; from: string | null; to: string | null; value: number };

// `firstSyncDone` is false while an account is syncing for the first time: then every deal looks
// new, which tells us nothing, so no "created" events are written.
export function diffDealEvents(incoming: Incoming[], known: Map<string, Known>, firstSyncDone: boolean): DealEvent[] {
  const events: DealEvent[] = [];
  for (const o of incoming) {
    const was = known.get(o.id);
    if (!was) {
      if (firstSyncDone) events.push({ id: o.id, kind: "created", from: null, to: o.stageId, value: o.value });
      continue;
    }
    if (was.stageId !== o.stageId) events.push({ id: o.id, kind: "stage", from: was.stageId, to: o.stageId, value: o.value });
    if (was.status !== null && was.status !== o.status) events.push({ id: o.id, kind: "status", from: was.status, to: o.status, value: o.value });
  }
  return events;
}
