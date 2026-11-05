import { outward, type Deps } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { ghlFetch } from "./http.ts";

// The ONE client for everything SubSync writes into a customer's CRM: a contact note, an internal comment in the conversation, a custom field.
// Every write goes through `outward` (src/lib/live-flags.ts): with WRITE_GHL_LIVE off (the committed default) the request is built and recorded as
// "WOULD WRITE ..." (ids and field names only) and NOTHING is sent. The request shapes below follow the documented API
// (docs/INTEGRATIONS_SPEC.md section 4) and are NOT VERIFIED LIVE: see docs/features/E0.md for the exact test that proves each one.

export type WriteKind = "note" | "comment" | "field" | "task" | "tag";

/**
 * Conservative size limits, ASSUMED until the morning test (scripts/ghl-write-limits.ts) has measured the real ones. The documentation does not state a
 * limit. Content longer than this is split by the caller; guessing too low only costs an extra part, guessing too high loses a note. NOT VERIFIED LIVE.
 * `largeTextFieldChars` (a multi-line text field) was added in stage E2b on the same footing: assumed, not measured, and cut with a visible reason.
 */
export const ASSUMED_LIMITS = { noteChars: 3_000, commentChars: 2_000, textFieldChars: 500, largeTextFieldChars: 2_000 } as const;
export const LIMITS_VERIFIED = false;

const NOTE_VERSION = "2021-07-28";
const CONVERSATION_VERSION = "2021-04-15";

export type NoteRequest = { method: "POST"; path: string; version: string; scope: "contacts.write"; body: { body: string; userId?: string } };
export type CommentRequest = { method: "POST"; path: string; version: string; scope: "conversations/message.write"; body: { type: "InternalComment"; contactId: string; message: string; userId?: string } };
export type FieldRequest = { method: "PUT"; path: string; version: string; scope: "contacts.write"; body: { customFields: Array<{ id: string; field_value: string }> } };
export type TaskRequest = { method: "POST"; path: string; version: string; scope: "contacts.write"; body: { title: string; body?: string; dueDate: string; completed: false } };
export type TagRequest = { method: "POST" | "DELETE"; path: string; version: string; scope: "contacts.write"; body: { tags: string[] } };
export type DeleteRequest = { method: "DELETE"; path: string; version: string; scope: "contacts.write"; body: Record<string, never> };
export type CrmRequest = NoteRequest | CommentRequest | FieldRequest | TaskRequest | TagRequest | DeleteRequest;

const seg = (v: string) => encodeURIComponent(v);

/** POST /contacts/{contactId}/notes. `userId` makes the note appear as written by that person. */
export const buildNote = (a: { contactId: string; body: string; userId?: string | null }): NoteRequest => ({
  method: "POST", path: `/contacts/${seg(a.contactId)}/notes`, version: NOTE_VERSION, scope: "contacts.write",
  body: { body: a.body, ...(a.userId ? { userId: a.userId } : {}) },
});

/** POST /conversations/messages with type InternalComment: visible only to the team, never sent to the contact. */
export const buildComment = (a: { contactId: string; message: string; userId?: string | null }): CommentRequest => ({
  method: "POST", path: "/conversations/messages", version: CONVERSATION_VERSION, scope: "conversations/message.write",
  body: { type: "InternalComment", contactId: a.contactId, message: a.message, ...(a.userId ? { userId: a.userId } : {}) },
});

/** PUT /contacts/{contactId} with the custom field id and its one current value. */
export const buildFieldUpdate = (a: { contactId: string; fields: Array<{ id: string; value: string }> }): FieldRequest => ({
  method: "PUT", path: `/contacts/${seg(a.contactId)}`, version: NOTE_VERSION, scope: "contacts.write",
  body: { customFields: a.fields.map((f) => ({ id: f.id, field_value: f.value })) },
});

/** POST /contacts/{contactId}/tasks (VERIFIED in the API description, 5 Nov 2026: title, dueDate and completed are required; scope contacts.write). */
export const buildTask = (a: { contactId: string; title: string; body?: string; dueDate: Date }): TaskRequest => ({
  method: "POST", path: `/contacts/${seg(a.contactId)}/tasks`, version: NOTE_VERSION, scope: "contacts.write",
  body: { title: a.title, ...(a.body ? { body: a.body } : {}), dueDate: a.dueDate.toISOString(), completed: false },
});
/** POST or DELETE /contacts/{contactId}/tags (scope contacts.write): add or remove tags on one contact. */
export const buildTags = (a: { contactId: string; tags: string[]; remove?: boolean }): TagRequest => ({
  method: a.remove ? "DELETE" : "POST", path: `/contacts/${seg(a.contactId)}/tags`, version: NOTE_VERSION, scope: "contacts.write", body: { tags: a.tags },
});
/** DELETE /contacts/{contactId}/notes/{id} or /tasks/{id}: removes one thing SubSync itself created (Undo). */
export const buildDeleteOwn = (a: { contactId: string; kind: "notes" | "tasks"; id: string }): DeleteRequest => ({
  method: "DELETE", path: `/contacts/${seg(a.contactId)}/${a.kind}/${seg(a.id)}`, version: NOTE_VERSION, scope: "contacts.write", body: {},
});

/** Field names a request would write, for the dry-run line (names only, never values). */
export const fieldNamesOf = (r: CrmRequest): string[] => Object.keys(r.body);

export type WriteArgs = {
  installationId: string | null;
  locationId: string;
  contactId: string;
  meetingId?: string | null;
  request: CrmRequest;
  /** Gets a token for the account. Only called when the switch is on. */
  token: () => Promise<string>;
  /** Replaces fetch (tests). */
  fetchImpl?: typeof fetch;
};

export type WriteResult =
  | { outcome: "dry_run"; line: string }
  | { outcome: "written"; id: string | null }
  | { outcome: "needs_permission" }
  | { outcome: "failed"; status: number };

/** The id the CRM gave a new note or comment, from the places its answers put it. */
export function idFromAnswer(json: unknown): string | null {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const nested = (o.note ?? o.message ?? o.contact) as Record<string, unknown> | undefined;
  for (const v of [nested?.id, o.id, o.messageId, o.noteId]) if (typeof v === "string" && v) return v;
  return null;
}

export async function writeToCrm(a: WriteArgs, deps: Deps = {}): Promise<WriteResult> {
  const p = a.request.path;
  const kind: WriteKind = p.startsWith("/conversations") ? "comment" : a.request.method === "PUT" ? "field" : p.endsWith("/tags") ? "tag" : /\/tasks(\/|$)/.test(p) ? "task" : "note";
  const del = a.request.method === "DELETE" && kind !== "tag";
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: "WRITE", what: `crm.${kind}.${del ? "delete" : a.request.method === "DELETE" ? "remove" : kind === "field" ? "update" : "create"}`, installationId: a.installationId, ids: { locationId: a.locationId, contactId: a.contactId, meetingId: a.meetingId ?? null }, fields: fieldNamesOf(a.request) },
    async (): Promise<WriteResult> => {
      const res = await ghlFetch(`${GHL_API}${a.request.path}`, {
        method: a.request.method,
        headers: { Authorization: `Bearer ${await a.token()}`, Version: a.request.version, Accept: "application/json", "Content-Type": "application/json" },
        ...(a.request.method === "DELETE" && Object.keys(a.request.body).length === 0 ? {} : { body: JSON.stringify(a.request.body) }),
        cache: "no-store",
      }, a.fetchImpl ? { fetchImpl: a.fetchImpl } : {});
      if (res.status === 401 || res.status === 403) return { outcome: "needs_permission" };
      if (!res.ok) return { outcome: "failed", status: res.status };
      return { outcome: "written", id: idFromAnswer(await res.json().catch(() => ({}))) };
    },
    deps,
  );
  return done.live ? done.result : { outcome: "dry_run", line: done.line };
}
