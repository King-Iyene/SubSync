// Pure part of the Pipeline moat writer (no database imports, unit tested): the diff of a stored deal snapshot against a new one.
// Webhook payloads carry no previous values, so every event is found by comparing the new payload with the stored row. Event keys use the platform's own change
// time when it is given (lastStageChangeAt / lastStatusChangeAt), so a webhook, a sync page and the hourly sweep that see the same change write the same key.

export type DealSnap = {
  stageId: string | null; pipelineId: string | null; status: string | null; value: number | null; ownerId: string | null; source: string | null; lostReasonId: string | null;
  contactId: string | null; lastStageChangeAt: number | null; lastStatusChangeAt: number | null; createdAt: number | null;
};
export type DealKind = "created" | "stage" | "status" | "value" | "owner" | "lost_reason" | "source" | "appointment_linked" | "deleted" | "note";
export type DealActor = "person" | "automation" | "subsync" | "system" | "unknown";
export type DealEvent = {
  kind: DealKind; key: string; from: string | null; to: string | null; at: number; actorId: string | null; actorKind: DealActor; value: number | null; dwellSeconds: number | null; pipelineId: string | null;
};

const minute = (t: number) => Math.floor(t / 60_000);
export const OWN_WRITE_WINDOW_MS = 10 * 60_000;
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[\s_-]/g, "") || null;
/** Statuses we keep: open, won, lost, abandoned. */
export const normStatus = (s: string | null | undefined): string | null => { const n = norm(s); return n === "abandoned" ? "abandoned" : n === "won" || n === "lost" || n === "open" ? n : n; };

/** The events a webhook, a sync page or any new read implies. `prev` null = first sight. `own` = values SubSync itself wrote recently (never counted as team activity). */
export function diffDeal(id: string, prev: DealSnap | null, next: DealSnap, o: { at: number; actorId?: string | null; own?: Array<{ kind: DealKind; to: string | null; at: number }> }): DealEvent[] {
  const out: DealEvent[] = [];
  const own = (kind: DealKind, to: string | null) => (o.own ?? []).some((w) => w.kind === kind && w.to === to && Math.abs(o.at - w.at) <= OWN_WRITE_WINDOW_MS);
  const push = (kind: DealKind, from: string | null, to: string | null, key: string, at = o.at, dwellSeconds: number | null = null) => {
    const mine = own(kind, to);
    out.push({ kind, key, from, to, at, actorId: mine ? null : o.actorId ?? null, actorKind: mine ? "subsync" : o.actorId ? "person" : "unknown", value: next.value, dwellSeconds, pipelineId: next.pipelineId });
  };
  if (!prev) {
    const at = next.createdAt ?? o.at;
    // The first stage is known only when the deal has not moved since it was made; otherwise the entry into the CURRENT stage is the fact we hold (at the platform's time).
    const unmoved = next.lastStageChangeAt === null || next.lastStageChangeAt <= at + 60_000;
    out.push({ kind: "created", key: `created|${id}`, from: null, to: unmoved ? next.stageId : null, at, actorId: null, actorKind: "system", value: next.value, dwellSeconds: null, pipelineId: next.pipelineId });
    if (!unmoved && next.stageId && next.lastStageChangeAt !== null) out.push({ kind: "stage", key: `stage|${id}|${next.stageId}|${next.lastStageChangeAt}`, from: null, to: next.stageId, at: next.lastStageChangeAt, actorId: null, actorKind: "unknown", value: next.value, dwellSeconds: null, pipelineId: next.pipelineId });
    if (next.ownerId) out.push({ kind: "owner", key: `owner|${id}|first`, from: null, to: next.ownerId, at, actorId: null, actorKind: "system", value: next.value, dwellSeconds: null, pipelineId: next.pipelineId });
    if (next.source) out.push({ kind: "source", key: `source|${id}|first`, from: null, to: next.source, at, actorId: null, actorKind: "system", value: next.value, dwellSeconds: null, pipelineId: next.pipelineId });
    const st = normStatus(next.status);
    if (st && st !== "open") out.push({ kind: "status", key: `status|${id}|${st}|${next.lastStatusChangeAt ?? minute(o.at)}`, from: "open", to: st, at: next.lastStatusChangeAt ?? o.at, actorId: null, actorKind: "unknown", value: next.value, dwellSeconds: null, pipelineId: next.pipelineId });
    if (next.lostReasonId) out.push({ kind: "lost_reason", key: `lost_reason|${id}|${next.lostReasonId}`, from: null, to: next.lostReasonId, at: next.lastStatusChangeAt ?? o.at, actorId: null, actorKind: "unknown", value: next.value, dwellSeconds: null, pipelineId: next.pipelineId });
    return out;
  }
  if (next.stageId && prev.stageId !== next.stageId) {
    const at = next.lastStageChangeAt ?? o.at;
    const since = prev.lastStageChangeAt ?? prev.createdAt;
    const dwell = since !== null && at >= since ? Math.round((at - since) / 1000) : null;
    push("stage", prev.stageId, next.stageId, `stage|${id}|${next.stageId}|${next.lastStageChangeAt ?? minute(o.at)}`, at, dwell);
  }
  const ps = normStatus(prev.status), ns = normStatus(next.status);
  if (ns && ps !== ns) push("status", ps, ns, `status|${id}|${ns}|${next.lastStatusChangeAt ?? minute(o.at)}`, next.lastStatusChangeAt ?? o.at);
  if (next.value !== null && prev.value !== null && next.value !== prev.value) push("value", String(prev.value), String(next.value), `value|${id}|${prev.value}>${next.value}|${minute(o.at)}`);
  if (next.ownerId !== prev.ownerId && (next.ownerId || prev.ownerId)) push("owner", prev.ownerId, next.ownerId, `owner|${id}|${prev.ownerId ?? ""}>${next.ownerId ?? ""}|${minute(o.at)}`);
  if (next.lostReasonId && next.lostReasonId !== prev.lostReasonId) push("lost_reason", prev.lostReasonId, next.lostReasonId, `lost_reason|${id}|${next.lostReasonId}`);
  if (next.source && next.source !== prev.source) push("source", prev.source, next.source, `source|${id}|${next.source}`);
  return out;
}

/** Whether a stage move went backward: from a later stage to an earlier one (by the pipeline's own order). */
export const isBackward = (fromOrder: number | null, toOrder: number | null) => fromOrder !== null && toOrder !== null && toOrder < fromOrder;
