// Touch events (stage SPEED4): ONE row per message or call, metadata only (who, which way, which channel, what kind, when, by a person or automatically).
// The text of a message is never read into these types. Pure (no database, no network), so it is unit tested. Idempotent by `key`.
import { isInternalComment } from "./message-kinds.ts";

export type Channel = "sms" | "email" | "whatsapp" | "call" | "chat" | "other";
export type EventKind = "message" | "call" | "missed_call" | "failed";
export type TouchEvent = {
  key: string; locationId: string; contactId: string; conversationId: string | null;
  direction: "inbound" | "outbound"; channel: Channel; kind: EventKind; at: number; userId: string | null; automated: boolean; source: string | null;
  /** What the platform reported (delivered, failed, no-answer...): one word, never content. */
  outcome: string | null;
};
/** The fields we read from a stored message or a webhook payload. Never the body. */
export type RawTouch = { id?: string | null; at: number; direction: "inbound" | "outbound" | null; userId: string | null; source: string | null; type: string | null; status?: string | null };

export function channelOf(type: string | null): Channel {
  const t = (type ?? "").toLowerCase();
  if (/call|voicemail/.test(t)) return "call";
  if (/email/.test(t)) return "email";
  if (/whatsapp/.test(t)) return "whatsapp";
  if (/sms|text/.test(t)) return "sms";
  if (/chat|fb|facebook|instagram|\big\b|gmb|google|webchat|live/.test(t)) return "chat";
  return "other";
}
const MISSED = /no[-_ ]?answer|missed|voicemail|busy|cancel|unanswered/i;
const FAILED = /fail|undeliver|error|bounce|reject/i;
export const isMissedCall = (r: Pick<RawTouch, "type" | "direction" | "status">) => channelOf(r.type) === "call" && r.direction === "inbound" && MISSED.test(r.status ?? "");
export const isFailedSend = (r: Pick<RawTouch, "direction" | "status">) => r.direction === "outbound" && FAILED.test(r.status ?? "");

/** One event, or null when it is not a touch (an internal comment, no direction, no time). */
export function toEvent(r: RawTouch, ids: { locationId: string; contactId: string; conversationId: string | null }): TouchEvent | null {
  if (!r.direction || !Number.isFinite(r.at) || isInternalComment(r.type)) return null;
  const channel = channelOf(r.type);
  const kind: EventKind = isMissedCall(r) ? "missed_call" : isFailedSend(r) ? "failed" : channel === "call" ? "call" : "message";
  const automated = r.direction === "outbound" && !(r.userId && (r.source === "app" || channel === "call"));
  const key = r.id ? `m:${r.id}` : `x:${ids.conversationId ?? ""}:${r.at}:${r.direction}:${channel}`;
  return { key, ...ids, direction: r.direction, channel, kind, at: r.at, userId: r.direction === "outbound" ? r.userId : null, automated, source: r.source, outcome: r.status ?? null };
}

const str = (v: unknown, max = 100) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
/** From an InboundMessage or OutboundMessage webhook. Reads only ids, type, direction, status, user, source and time; the body is never touched. */
export function eventFromWebhook(body: unknown, type: string | null): TouchEvent | null {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : {}) as Record<string, unknown>;
  const pick = (k: string) => root[k] ?? data[k];
  const locationId = str(pick("locationId")), contactId = str(pick("contactId"));
  if (!locationId || !contactId || (type !== "InboundMessage" && type !== "OutboundMessage")) return null;
  const t = pick("dateAdded") ?? pick("createdAt") ?? pick("timestamp");
  const at = typeof t === "number" ? (t < 1e11 ? t * 1000 : t) : typeof t === "string" ? Date.parse(t) : Date.now();
  return toEvent({
    id: str(pick("messageId"), 80) ?? str(pick("id"), 80), at, direction: type === "InboundMessage" ? "inbound" : "outbound", userId: str(pick("userId")),
    source: str(pick("source"))?.toLowerCase() ?? null, type: str(pick("messageType")), status: str(pick("status")),
  }, { locationId, contactId, conversationId: str(pick("conversationId")) });
}

export type LeadEventKind = "created" | "first_touch" | "owner_changed" | "stage_changed" | "tag_added" | "tag_removed";
export type LeadEvent = { key: string; locationId: string; contactId: string; kind: LeadEventKind; fromValue: string | null; toValue: string | null; userId: string | null; at: number };
/** Lifecycle events from a webhook: a contact created, an owner changed on a deal, a stage changed. Ids and names of stages only; nothing the customer wrote. */
export function leadEventFromWebhook(body: unknown, type: string | null): LeadEvent | null {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : {}) as Record<string, unknown>;
  const pick = (k: string) => root[k] ?? data[k];
  const locationId = str(pick("locationId"));
  const contactId = str(pick("contactId")) ?? (type === "ContactCreate" ? str(pick("id")) : null);
  if (!locationId || !contactId) return null;
  const t = pick("dateAdded") ?? pick("timestamp") ?? pick("dateUpdated");
  const at = typeof t === "number" ? (t < 1e11 ? t * 1000 : t) : typeof t === "string" && Number.isFinite(Date.parse(t)) ? Date.parse(t) : Date.now();
  const id = str(pick("webhookId"), 80) ?? str(pick("id"), 80);
  const base = { locationId, contactId, userId: str(pick("userId")), at };
  if (type === "ContactCreate") return { ...base, key: "created", kind: "created", fromValue: null, toValue: null };
  if (type === "OpportunityAssignedToUpdate") return { ...base, key: `owner:${id ?? at}`, kind: "owner_changed", fromValue: null, toValue: str(pick("assignedTo")) };
  if (type === "OpportunityStageUpdate") return { ...base, key: `stage:${id ?? at}`, kind: "stage_changed", fromValue: null, toValue: str(pick("pipelineStageId")) };
  return null;
}
