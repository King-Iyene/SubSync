import { GHL_API, GhlError } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { mapContact, mapConversation, mapOpportunity, mapAppointment, fetchConversationActivity, type ContactRow, type ConversationRow, type OpportunityRow, type AppointmentRow } from "../sync/ghl-data";
import type { CrmCall } from "../people/helpers";

// The live read-through for ONE lead: what the CRM says right now, fetched with the account's own token when the lead panel opens (and on a timer while it stays open).
// The functions take a `LiveSource`, so tests pass a stub and never touch the network. Message text is never returned; only the short notes the team wrote on the lead.
// Every request is scoped to the one location the caller was allowed to see; a contact that belongs to another location is refused (ForeignContact).

export class ForeignContact extends Error { constructor() { super("Contact not found"); } }

export type LiveNote = { id: string; at: string | null; by: string | null; text: string };
export type LiveTask = { id: string; title: string; due: string | null; done: boolean };
export type LiveSource = {
  contact: (contactId: string) => Promise<{ locationId: string | null; contact: ContactRow } | null>;
  conversation: (contactId: string) => Promise<ConversationRow | null>;
  calls: (conversationId: string) => Promise<CrmCall[]>;
  notes: (contactId: string) => Promise<LiveNote[]>;
  tasks: (contactId: string) => Promise<LiveTask[]>;
  appointments: (contactId: string) => Promise<AppointmentRow[]>;
  deals: (contactId: string) => Promise<OpportunityRow[]>;
};

export type LiveRead = {
  contact: ContactRow; conversation: ConversationRow | null; calls: CrmCall[];
  /** Only filled on a full read. */
  notes: LiveNote[]; tasks: LiveTask[]; appointments: AppointmentRow[]; deals: OpportunityRow[];
  /** Parts the CRM would not give (no permission, or no answer): the panel says so rather than showing nothing. */
  missing: Array<"notes" | "tasks" | "appointments" | "deals" | "calls" | "conversation">;
  readAt: number;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

async function get(token: string, path: string, params: Record<string, string>, version: string): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const res = await ghlFetch(`${GHL_API}${path}${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new GhlError(res.status, `${path} returned ${res.status}`);
  return res.json();
}

/** The real source: the CRM API with one account's token. */
export function crmSource(token: string, locationId: string): LiveSource {
  const id = encodeURIComponent;
  return {
    contact: async (contactId) => {
      try {
        const body = rec(await get(token, `/contacts/${id(contactId)}`, {}, "2021-07-28"));
        const raw = rec(body.contact);
        const c = mapContact(raw);
        return c ? { locationId: str(raw.locationId), contact: c } : null;
      } catch (e) { if (e instanceof GhlError && (e.status === 404 || e.status === 422)) return null; throw e; }
    },
    conversation: async (contactId) => {
      const body = rec(await get(token, "/conversations/search", { locationId, contactId, limit: "5", sortBy: "last_message_date", sort: "desc" }, "2021-04-15"));
      const list = (Array.isArray(body.conversations) ? body.conversations : []).map(mapConversation).filter((c): c is ConversationRow => c !== null);
      return list.find((c) => c.contactId === contactId) ?? null;
    },
    calls: async (conversationId) => (await fetchConversationActivity(token, locationId, conversationId)).calls,
    notes: async (contactId) => {
      const body = rec(await get(token, `/contacts/${id(contactId)}/notes`, {}, "2021-07-28"));
      return (Array.isArray(body.notes) ? body.notes : []).slice(0, 10).map((n) => { const r = rec(n); return { id: str(r.id) ?? "", at: str(r.dateAdded), by: str(r.userId), text: (str(r.body) ?? "").slice(0, 400) }; }).filter((n) => n.id);
    },
    tasks: async (contactId) => {
      const body = rec(await get(token, `/contacts/${id(contactId)}/tasks`, {}, "2021-07-28"));
      return (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 15).map((t) => { const r = rec(t); return { id: str(r.id) ?? "", title: (str(r.title) ?? "Task").slice(0, 200), due: str(r.dueDate), done: r.completed === true }; }).filter((t) => t.id);
    },
    appointments: async (contactId) => {
      const body = rec(await get(token, `/contacts/${id(contactId)}/appointments`, {}, "2021-07-28"));
      return (Array.isArray(body.events) ? body.events : []).map(mapAppointment).filter((a): a is AppointmentRow => a !== null).slice(0, 20);
    },
    deals: async (contactId) => {
      const body = rec(await get(token, "/opportunities/search", { location_id: locationId, contact_id: contactId, limit: "10" }, "2021-07-28"));
      return (Array.isArray(body.opportunities) ? body.opportunities : []).map(mapOpportunity).filter((o): o is OpportunityRow => o !== null);
    },
  };
}

/**
 * One live read. `full` also reads notes, tasks, appointments and deals (the first read and every few polls); a light read is the contact and its conversation and calls (2 to 3 requests).
 * Throws ForeignContact when the contact is not in `locationId`; a permission error from the contact itself is rethrown (the panel then says "needs permission").
 */
export async function liveRead(src: LiveSource, locationId: string, contactId: string, full: boolean, now = Date.now()): Promise<LiveRead> {
  const found = await src.contact(contactId);
  if (!found) throw new ForeignContact();
  // The CRM names the location a contact belongs to: anything else is another account's person.
  if (found.locationId && found.locationId !== locationId) throw new ForeignContact();
  const missing: LiveRead["missing"] = [];
  const part = async <T,>(name: LiveRead["missing"][number], run: () => Promise<T>, empty: T): Promise<T> => {
    try { return await run(); } catch { missing.push(name); return empty; }
  };
  const conversation = await part("conversation", () => src.conversation(contactId), null);
  const [calls, notes, tasks, appointments, deals] = await Promise.all([
    conversation ? part("calls", () => src.calls(conversation.conversationId), [] as CrmCall[]) : Promise.resolve([] as CrmCall[]),
    full ? part("notes", () => src.notes(contactId), [] as LiveNote[]) : Promise.resolve([] as LiveNote[]),
    full ? part("tasks", () => src.tasks(contactId), [] as LiveTask[]) : Promise.resolve([] as LiveTask[]),
    full ? part("appointments", () => src.appointments(contactId), [] as AppointmentRow[]) : Promise.resolve([] as AppointmentRow[]),
    full ? part("deals", () => src.deals(contactId), [] as OpportunityRow[]) : Promise.resolve([] as OpportunityRow[]),
  ]);
  return { contact: found.contact, conversation, calls, notes, tasks, appointments, deals, missing, readAt: now };
}
