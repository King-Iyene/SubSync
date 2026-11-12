import { ingestPersonalMeeting, type IngestResult, type IngestStore, type PersonalConnection, type Writer } from "./ingest.ts";
import { parseFathomDelivery } from "./fathom.ts";
import { verifyFathom } from "./signatures.ts";

// One delivery from Fathom, from the raw request to the answer (INTEGRATIONS_SPEC sections 7 and 11.1 item 4, roadmap E2a item 2). Pure: the lookup of
// the connection, the secret, the database and the CRM write are passed in, so the whole thing is tested with signed sample payloads and no network.
//
// Order, and why:
//   1. An address nobody owns (wrong, disconnected, revoked) answers 404, the same for all of them.
//   2. The signature is checked on the RAW body before anything is parsed or saved (HMAC-SHA256, 5 minute freshness window).
//   3. The delivery's own id (the `webhook-id` header) is claimed in the database. A second delivery of the same id, even at the same moment, answers
//      "duplicate" and does nothing, so a retry never double counts.
//   4. The call is stored for that one person and, when it matches exactly one contact, the note is written as them (a dry run while WRITE_GHL_LIVE is off).
//   5. Only after that is it acknowledged. If saving fails the claim is released and the answer is an error, so Fathom retries and nothing is lost.

export const MAX_BYTES = 400_000;
export const KEY = /^[A-Za-z0-9_-]{20,64}$/;

export type HookConnection = PersonalConnection & { webhookSecret: string | null };

export type DeliveryStore = {
  /** True when this delivery id is new for this connection (and is now claimed); false when it was already claimed. */
  claim: (installationId: string, connectionId: string, webhookId: string) => Promise<boolean>;
  /** Gives a claim back (saving failed), so the provider's retry is accepted. */
  release: (connectionId: string, webhookId: string) => Promise<void>;
};

export type HookDeps = {
  enabled: () => Promise<boolean>;
  find: (key: string) => Promise<HookConnection | null>;
  store: IngestStore;
  deliveries: DeliveryStore;
  write: (conn: HookConnection) => Writer;
  now?: () => number;
  /** Logs a code and an id only, never any content. */
  logError?: (code: string, error: unknown) => void;
  /** Could this person's choices put a transcript in the CRM? Only then is the transcript read from the delivery. Left out: never read. */
  wantTranscript?: (conn: HookConnection) => Promise<boolean>;
};

export type HookInput = { key: string; headers: { id: string | null; timestamp: string | null; signature: string | null }; body: string };
export type HookAnswer = { status: number; body: Record<string, unknown> };

const NOT_FOUND: HookAnswer = { status: 404, body: { error: "Not found" } };

export async function handleFathomDelivery(input: HookInput, deps: HookDeps): Promise<HookAnswer> {
  if (!(await deps.enabled())) return NOT_FOUND;
  const conn = KEY.test(input.key) ? await deps.find(input.key).catch(() => null) : null;
  if (!conn || !conn.webhookSecret) return NOT_FOUND;
  if (input.body.length > MAX_BYTES) return { status: 413, body: { error: "That is too large" } };

  const signed = verifyFathom({ secret: conn.webhookSecret, id: input.headers.id, timestamp: input.headers.timestamp, signature: input.headers.signature, body: input.body, now: deps.now?.() });
  if (!signed) return { status: 401, body: { error: "Bad signature" } };

  let json: unknown;
  try {
    json = JSON.parse(input.body);
  } catch {
    return { status: 400, body: { error: "Send JSON" } };
  }
  // Anything that is not a usable meeting is acknowledged, so Fathom does not keep retrying it.
  const wantTranscript = deps.wantTranscript ? await deps.wantTranscript(conn).catch(() => false) : false;
  const parsed = parseFathomDelivery(json, { transcript: wantTranscript });
  if (!parsed) return { status: 200, body: { ok: true, ignored: true } };

  const webhookId = (input.headers.id ?? "").slice(0, 100);
  const first = await deps.deliveries.claim(conn.installationId, conn.id, webhookId);
  if (!first) return { status: 200, body: { ok: true, result: "duplicate" } };

  try {
    const done: IngestResult = await ingestPersonalMeeting(conn, parsed.meeting, parsed.recordingId, deps.store, deps.write(conn), {
      internalEmails: parsed.internalEmails, rep: parsed.recordedByName ?? conn.person.name, withNames: parsed.withNames, durationMinutes: parsed.durationMinutes,
      transcript: parsed.transcriptText, callUrl: parsed.callUrl, talkPct: parsed.talkPct,
    });
    return { status: 200, body: { ok: true, result: done.kind } };
  } catch (error) {
    await deps.deliveries.release(conn.id, webhookId).catch(() => undefined);
    deps.logError?.("E2A-SAVE", error);
    return { status: 500, body: { error: "Could not save that. Try again." } };
  }
}
