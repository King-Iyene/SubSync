import { outward, type Deps } from "../live-flags.ts";
import { GHL_API } from "./client.ts";
import { ghlFetch } from "./http.ts";

// The ONE client for everything SubSync writes into a customer's CRM: a contact note, an internal comment in the conversation, a custom field.
// Every write goes through `outward` (src/lib/live-flags.ts): with WRITE_GHL_LIVE off (the committed default) the request is built and recorded as
// "WOULD WRITE ..." (ids and field names only) and NOTHING is sent. The request shapes below follow the documented API
// (docs/INTEGRATIONS_SPEC.md section 4) and are NOT VERIFIED LIVE: see docs/features/E0.md for the exact test that proves each one.

export type WriteKind = "note" | "comment" | "field";

/**
 * Conservative size limits, ASSUMED until the morning test (scripts/ghl-write-limits.ts) has measured the real ones. The documentation does not state a
 * limit. Content longer than this is split by the caller; guessing too low only costs an extra part, guessing too high loses a note. NOT VERIFIED LIVE.
 */
export const ASSUMED_LIMITS = { noteChars: 3_000, commentChars: 2_000, textFieldChars: 500 } as const;
export const LIMITS_VERIFIED = false;

const NOTE_VERSION = "2021-07-28";
const CONVERSATION_VERSION = "2021-04-15";

export type NoteRequest = { method: "POST"; path: string; version: string; scope: "contacts.write"; body: { body: string; userId?: string } };
export type CommentRequest = { method: "POST"; path: string; version: string; scope: "conversations/message.write"; body: { type: "InternalComment"; contactId: string; message: string; userId?: string } };
export type FieldRequest = { method: "PUT"; path: string; version: string; scope: "contacts.write"; body: { customFields: Array<{ id: string; field_value: string }> } };
export type CrmRequest = NoteRequest | CommentRequest | FieldRequest;

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
  const kind: WriteKind = a.request.path.startsWith("/conversations") ? "comment" : a.request.method === "PUT" ? "field" : "note";
  const done = await outward(
    { flag: "WRITE_GHL_LIVE", verb: "WRITE", what: `crm.${kind}.${kind === "field" ? "update" : "create"}`, installationId: a.installationId, ids: { locationId: a.locationId, contactId: a.contactId, meetingId: a.meetingId ?? null }, fields: fieldNamesOf(a.request) },
    async (): Promise<WriteResult> => {
      const res = await ghlFetch(`${GHL_API}${a.request.path}`, {
        method: a.request.method,
        headers: { Authorization: `Bearer ${await a.token()}`, Version: a.request.version, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(a.request.body),
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
