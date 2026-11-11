// Fetchers and mappers for the GHL data we cache. Mappers are pure and defensive: the spec for
// some endpoints (notably contacts) is incomplete, so every field is optional and checked.
// Never log response bodies: they contain customer data.

import { GHL_API, GhlError } from "../ghl/client.ts";
import { displayName } from "../ghl/owner-list.ts";
import { ghlFetch } from "../ghl/http.ts";
import { isInternalComment } from "../analytics/message-kinds.ts";
import { mapMessage, type Msg } from "../analytics/speed-intel.ts";
import { safePhotoUrl } from "../analytics/people-labels.ts";
import { mapCallMessage, mapMessageEvent, type CrmCall, type CrmMessage } from "../people/helpers.ts";

export function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e11 ? value * 1000 : value; // seconds vs milliseconds
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (/^\d{9,}$/.test(value.trim()) && Number.isFinite(asNumber)) return toIso(asNumber);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export type ContactRow = {
  contactId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  dateAdded: string | null;
  lastActivityAt: string | null;
  updatedAt: string | null;
  source: string | null;
  dnd: boolean;
  /** Calendar date (YYYY-MM-DD) or null. Only month and day matter to us. */
  birthDate: string | null;
  assignedTo: string | null;
};

// A birth date as YYYY-MM-DD, or null when it is not a real date.
export function toDateOnly(value: unknown): string | null {
  const iso = toIso(value);
  return iso ? iso.slice(0, 10) : null;
}

export function mapContact(raw: unknown): ContactRow | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r._id);
  if (!id) return null;
  let first = str(r.firstName);
  let last = str(r.lastName);
  if (!first && !last) {
    const full = str(r.contactName) ?? str(r.name);
    if (full) {
      const parts = full.split(/\s+/);
      first = parts[0] ?? null;
      last = parts.slice(1).join(" ") || null;
    }
  }
  return {
    contactId: id,
    firstName: first,
    lastName: last,
    email: str(r.email)?.toLowerCase() ?? null,
    phone: str(r.phone),
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string" && t.length > 0) : [],
    dateAdded: toIso(r.dateAdded) ?? toIso(r.createdAt),
    lastActivityAt: toIso(r.lastActivity) ?? toIso(r.lastActivityDate),
    updatedAt: toIso(r.dateUpdated) ?? toIso(r.updatedAt),
    source: str(r.source),
    dnd: r.dnd === true,
    birthDate: toDateOnly(r.dateOfBirth),
    assignedTo: str(r.assignedTo),
  };
}

export type OpportunityRow = {
  opportunityId: string;
  name: string | null;
  pipelineId: string | null;
  stageId: string | null;
  contactId: string | null;
  contactName: string | null;
  monetaryValue: number;
  status: string;
  lastStageChangeAt: string | null;
  lastStatusChangeAt: string | null;
  lastActionAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  assignedTo: string | null;
  source: string | null;
  lostReasonId: string | null;
};

export function mapOpportunity(raw: unknown): OpportunityRow | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r._id);
  if (!id) return null;
  const contact = rec(r.contact);
  const value = Number(r.monetaryValue);
  const status = (str(r.status) ?? "open").toLowerCase();
  return {
    opportunityId: id,
    name: str(r.name),
    pipelineId: str(r.pipelineId),
    stageId: str(r.pipelineStageId) ?? str(r.stageId),
    contactId: str(r.contactId) ?? str(contact.id),
    contactName: str(contact.name) ?? str(contact.contactName),
    monetaryValue: Number.isFinite(value) ? value : 0,
    status,
    lastStageChangeAt: toIso(r.lastStageChangeAt),
    lastStatusChangeAt: toIso(r.lastStatusChangeAt),
    lastActionAt: toIso(r.lastActionDate) ?? toIso(r.lastActionAt),
    createdAt: toIso(r.createdAt),
    updatedAt: toIso(r.updatedAt),
    assignedTo: str(r.assignedTo),
    source: str(r.source),
    lostReasonId: str(r.lostReasonId),
  };
}

export type ConversationRow = {
  conversationId: string;
  contactId: string | null;
  contactName: string | null;
  lastMessageType: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageAt: string | null;
  unreadCount: number;
  assignedTo: string | null;
};

export function mapConversation(raw: unknown): ConversationRow | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r._id);
  if (!id) return null;
  const dir = str(r.lastMessageDirection)?.toLowerCase();
  const unread = Number(r.unreadCount);
  return {
    conversationId: id,
    contactId: str(r.contactId),
    contactName: str(r.fullName) ?? str(r.contactName),
    lastMessageType: str(r.lastMessageType),
    // An internal comment is stored as an outbound message but is not a reply to the customer (spec section 10), so it never becomes "outbound" here.
    lastMessageDirection: isInternalComment(str(r.lastMessageType)) ? null : dir === "inbound" || dir === "outbound" ? dir : null,
    lastMessageAt: toIso(r.lastMessageDate) ?? toIso(r.lastMessageAt),
    unreadCount: Number.isFinite(unread) && unread > 0 ? Math.floor(unread) : 0,
    assignedTo: str(r.assignedTo),
  };
}

export type PipelineRow = { pipelineId: string; name: string | null; stages: Array<{ id: string; name: string }> };

export function mapPipeline(raw: unknown): PipelineRow | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r._id);
  if (!id) return null;
  const stages = Array.isArray(r.stages)
    ? r.stages.flatMap((s) => {
        const sr = rec(s);
        const sid = str(sr.id) ?? str(sr._id);
        return sid ? [{ id: sid, name: str(sr.name) ?? "Stage" }] : [];
      })
    : [];
  return { pipelineId: id, name: str(r.name), stages };
}

export type LocationDetails = {
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  timezone: string | null;
  address: string | null;
  /** The account's "allow duplicate contact" setting, when the platform returns it. */
  allowDuplicateContact: boolean | null;
};

export function mapLocationDetails(raw: unknown): LocationDetails {
  const r = rec(rec(raw).location ?? raw);
  const address = [str(r.address), str(r.city), str(r.state), str(r.country)].filter(Boolean).join(", ");
  return {
    name: str(r.name),
    email: str(r.email)?.toLowerCase() ?? null,
    phone: str(r.phone),
    website: str(r.website),
    timezone: str(r.timezone),
    allowDuplicateContact: typeof rec(r.settings).allowDuplicateContact === "boolean" ? (rec(r.settings).allowDuplicateContact as boolean) : null,
    address: address || null,
  };
}

export type AppointmentRow = {
  appointmentId: string;
  calendarId: string | null;
  contactId: string | null;
  title: string | null;
  status: string;
  startAt: string | null;
  endAt: string | null;
  assignedTo: string | null;
  createdAt: string | null;
  /** Who made the booking and how, when the platform says so (F3). Not verified against a live event: both stay null when the fields are absent. */
  bookedByUser: string | null;
  bookingChannel: string | null;
};

// The platform's statuses are new, confirmed, cancelled, showed, noshow and invalid. Spelling and spacing vary between its endpoints
// ("No Show", "no_show", "canceled"), so they are folded to one form; anything else is kept as it is and treated as an active
// appointment with no outcome (docs/METRICS.md).
const STATUS_ALIASES: Record<string, string> = { canceled: "cancelled", booked: "new", scheduled: "new" };
export function normaliseAppointmentStatus(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  return STATUS_ALIASES[s] ?? s;
}

export function mapAppointment(raw: unknown): AppointmentRow | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r._id);
  if (!id) return null;
  return {
    appointmentId: id,
    calendarId: str(r.calendarId),
    contactId: str(r.contactId),
    title: str(r.title),
    status: normaliseAppointmentStatus(str(r.appointmentStatus) ?? str(r.status) ?? "new"),
    startAt: toIso(r.startTime),
    endAt: toIso(r.endTime),
    assignedTo: str(r.assignedUserId),
    createdAt: toIso(r.dateAdded) ?? toIso(r.createdAt),
    bookedByUser: str(rec(r.createdBy).userId),
    bookingChannel: str(rec(r.createdBy).channel) ?? str(rec(r.createdBy).source) ?? str(r.source),
  };
}

export type CalendarRow = { id: string; name: string | null };

export function mapCalendar(raw: unknown): CalendarRow | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r._id);
  return id ? { id, name: str(r.name) } : null;
}

export type UserRow = { id: string; name: string | null; photoUrl: string | null };

export function mapUser(raw: unknown): UserRow | null {
  const r = rec(raw);
  const id = str(r.id) ?? str(r._id);
  if (!id) return null;
  const name = displayName({ name: str(r.name), firstName: str(r.firstName), lastName: str(r.lastName), email: str(r.email) });
  return { id, name: name || null, photoUrl: safePhotoUrl(r.profilePhoto) };
}

// ---- fetchers (location-scoped token required) ----

async function getJson(path: string, params: Record<string, string>, token: string, version: string): Promise<unknown> {
  const url = `${GHL_API}${path}?${new URLSearchParams(params).toString()}`;
  const response = await ghlFetch(url, {
    headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new GhlError(response.status, `${path} returned ${response.status}`);
  return response.json();
}

// A 401 or 403 on a newer endpoint means the install has not approved that permission yet. It is
// reported as a state to show, not as a failure.
export function isPermissionError(error: unknown): boolean {
  return error instanceof GhlError && (error.status === 401 || error.status === 403);
}

export async function fetchCalendars(token: string, locationId: string): Promise<CalendarRow[]> {
  const body = rec(await getJson("/calendars/", { locationId }, token, "2021-04-15"));
  return (Array.isArray(body.calendars) ? body.calendars : []).map(mapCalendar).filter((c): c is CalendarRow => c !== null);
}

// Appointments in a window (milliseconds since 1970) for one calendar. Needs calendars/events.readonly.
export async function fetchAppointments(token: string, locationId: string, calendarId: string, fromMs: number, toMs: number): Promise<AppointmentRow[]> {
  const body = rec(await getJson("/calendars/events", { locationId, calendarId, startTime: String(fromMs), endTime: String(toMs) }, token, "2021-04-15"));
  return (Array.isArray(body.events) ? body.events : []).map(mapAppointment).filter((a): a is AppointmentRow => a !== null);
}

// The messages in one conversation, newest page only. Needs conversations/message.readonly. Each message
// carries who sent it and from where, which is what tells a person's reply from an automatic one.
export async function fetchConversationMessages(token: string, locationId: string, conversationId: string): Promise<Msg[]> {
  const body = rec(await getJson(`/conversations/${encodeURIComponent(conversationId)}/messages`, { limit: "100", locationId }, token, "2021-04-15"));
  const inner = rec(body.messages);
  const list = Array.isArray(inner.messages) ? inner.messages : Array.isArray(body.messages) ? body.messages : [];
  // A one-off look at what a call message carries (field names only, never content), so call recordings can be built on
  // the real shape rather than a guess. Shows in the server logs.
  const call = list.find((x) => /call/i.test(String(rec(x).messageType ?? rec(x).type ?? "")));
  if (call && !callShapeLogged) {
    callShapeLogged = true;
    const c = rec(call);
    console.log("probe: call message fields", { keys: Object.keys(c).sort(), meta: Object.keys(rec(c.meta)).sort(), callMeta: Object.keys(rec(rec(c.meta).call)).sort(), type: c.messageType ?? c.type });
  }
  return list.map(mapMessage).filter((m): m is Msg => m !== null);
}
let callShapeLogged = false;

// ---- One lead, read live for the lead panel (stage F10). Read only, one contact at a time, nothing stored. NOT VERIFIED LIVE: written from the documented
// shapes and read defensively (every field optional); the machine that built it could not open the real install's tokens.
export type CustomFieldValue = { name: string; value: string };

// The account's custom field names (id to name). Needs locations/customFields.readonly.
export async function fetchCustomFieldNames(token: string, locationId: string): Promise<Map<string, string>> {
  const body = rec(await getJson(`/locations/${encodeURIComponent(locationId)}/customFields`, {}, token, "2021-07-28"));
  const list = Array.isArray(body.customFields) ? body.customFields : [];
  return new Map(list.flatMap((f) => { const o = rec(f); const id = str(o.id); const name = str(o.name); return id && name ? [[id, name.slice(0, 80)] as [string, string]] : []; }));
}

// The values on one contact, with names when the account's field names are known. Empty values are left out.
export async function fetchContactCustomFields(token: string, contactId: string, names: Map<string, string>): Promise<CustomFieldValue[]> {
  const body = rec(await getJson(`/contacts/${encodeURIComponent(contactId)}`, {}, token, "2021-07-28"));
  const list = Array.isArray(rec(body.contact).customFields) ? (rec(body.contact).customFields as unknown[]) : [];
  const out: CustomFieldValue[] = [];
  for (const f of list) {
    const o = rec(f);
    const id = str(o.id);
    const raw = o.value;
    const value = Array.isArray(raw) ? raw.filter((x) => typeof x === "string" || typeof x === "number").join(", ") : typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";
    if (id && value.trim()) out.push({ name: names.get(id) ?? "Custom field", value: value.trim().slice(0, 200) });
  }
  return out.slice(0, 40);
}

// The calls in one conversation (newest page). Needs conversations/message.readonly.
export async function fetchConversationCalls(token: string, locationId: string, conversationId: string): Promise<CrmCall[]> {
  const body = rec(await getJson(`/conversations/${encodeURIComponent(conversationId)}/messages`, { limit: "100", locationId }, token, "2021-04-15"));
  const inner = rec(body.messages);
  const list = Array.isArray(inner.messages) ? inner.messages : Array.isArray(body.messages) ? body.messages : [];
  return list.map(mapCallMessage).filter((c): c is CrmCall => c !== null).slice(0, 30);
}

// The calls AND the messages of one conversation (newest page), from ONE request. Messages are kept as when, direction, channel and sender: never what was written.
// Needs conversations/message.readonly.
export async function fetchConversationActivity(token: string, locationId: string, conversationId: string): Promise<{ calls: CrmCall[]; messages: CrmMessage[] }> {
  const body = rec(await getJson(`/conversations/${encodeURIComponent(conversationId)}/messages`, { limit: "100", locationId }, token, "2021-04-15"));
  const inner = rec(body.messages);
  const list = Array.isArray(inner.messages) ? inner.messages : Array.isArray(body.messages) ? body.messages : [];
  return {
    calls: list.map(mapCallMessage).filter((c): c is CrmCall => c !== null).slice(0, 30),
    messages: list.map(mapMessageEvent).filter((m): m is CrmMessage => m !== null).slice(0, 40),
  };
}

// The people on the account (names only). Needs users.readonly.
export async function fetchUsers(token: string, locationId: string): Promise<UserRow[]> {
  const body = rec(await getJson("/users/", { locationId }, token, "2021-07-28"));
  return (Array.isArray(body.users) ? body.users : []).map(mapUser).filter((u): u is UserRow => u !== null);
}

export type ContactCursor = { startAfter?: number; startAfterId?: string } | null;

export async function fetchContactsPage(token: string, locationId: string, cursor: ContactCursor, limit = 100) {
  const params: Record<string, string> = { locationId, limit: String(limit) };
  if (cursor?.startAfterId) params.startAfterId = cursor.startAfterId;
  if (cursor?.startAfter !== undefined) params.startAfter = String(cursor.startAfter);
  const body = rec(await getJson("/contacts/", params, token, "2021-07-28"));
  const contacts = (Array.isArray(body.contacts) ? body.contacts : []).map(mapContact).filter((c): c is ContactRow => c !== null);
  const meta = rec(body.meta);
  const nextId = str(meta.startAfterId);
  const nextAfter = Number(meta.startAfter);
  const more = contacts.length >= limit && nextId !== null;
  const next: ContactCursor = more ? { startAfterId: nextId!, ...(Number.isFinite(nextAfter) ? { startAfter: nextAfter } : {}) } : null;
  return { contacts, next };
}

export async function fetchOpportunitiesPage(token: string, locationId: string, page: number, limit = 100) {
  const body = rec(await getJson(
    "/opportunities/search",
    { location_id: locationId, status: "all", limit: String(limit), page: String(page) },
    token,
    "2021-07-28",
  ));
  const opportunities = (Array.isArray(body.opportunities) ? body.opportunities : [])
    .map(mapOpportunity)
    .filter((o): o is OpportunityRow => o !== null);
  const meta = rec(body.meta);
  const nextPage = Number(meta.nextPage);
  const more = opportunities.length >= limit && Number.isFinite(nextPage) && nextPage > page;
  return { opportunities, nextPage: more ? nextPage : null };
}

export async function fetchPipelines(token: string, locationId: string): Promise<PipelineRow[]> {
  const body = rec(await getJson("/opportunities/pipelines", { locationId }, token, "2021-07-28"));
  return (Array.isArray(body.pipelines) ? body.pipelines : []).map(mapPipeline).filter((p): p is PipelineRow => p !== null);
}

export async function fetchCalendarCount(token: string, locationId: string): Promise<number> {
  const body = rec(await getJson("/calendars/", { locationId }, token, "2021-04-15"));
  return Array.isArray(body.calendars) ? body.calendars.length : 0;
}

export async function fetchLocationDetails(token: string, locationId: string): Promise<LocationDetails> {
  return mapLocationDetails(await getJson(`/locations/${encodeURIComponent(locationId)}`, {}, token, "2021-07-28"));
}

export type ConversationCursor = { startAfterDate?: number } | null;

export async function fetchConversationsPage(token: string, locationId: string, cursor: ConversationCursor, limit = 100) {
  const params: Record<string, string> = {
    locationId, limit: String(limit), sortBy: "last_message_date", sort: "desc", status: "all",
  };
  if (cursor?.startAfterDate !== undefined) params.startAfterDate = String(cursor.startAfterDate);
  const body = rec(await getJson("/conversations/search", params, token, "2021-04-15"));
  const raw = Array.isArray(body.conversations) ? body.conversations : [];
  const conversations = raw.map(mapConversation).filter((c): c is ConversationRow => c !== null);
  const last = conversations[conversations.length - 1];
  const lastMs = last?.lastMessageAt ? Date.parse(last.lastMessageAt) : NaN;
  const more = conversations.length >= limit && Number.isFinite(lastMs);
  return { conversations, next: more ? ({ startAfterDate: lastMs } as ConversationCursor) : null };
}
