import { createHmac } from "node:crypto";
import { writeToCrm, type CrmRequest, type WriteResult } from "@/lib/ghl/crm-writes";
import type { DeliveryStore, HookConnection } from "@/lib/connections/fathom-hook";
import type { ContactHit, InboxStore, StoredMeeting } from "@/lib/connections/inbox";
import type { MeetingRow, PersonalConnection, PersonSettings, Writer } from "@/lib/connections/ingest";
import type { Candidate } from "@/lib/connections/meeting-plan";
import type { Person } from "@/lib/connections/person";
import type { Role } from "@/lib/identity";

// Support for the stage E2a tests: an in-memory stand-in for the database (the same rules as the real one: one meeting per person, tool and meeting id,
// one claim per delivery id, every read scoped to the person), a signer that follows Fathom's webhook signature scheme with a TEST secret, a sample
// payload that follows Fathom's published `Meeting` shape, and a CRM write client over a fake transport. No network, no database, no real secret.

export const NOW = Date.parse("2026-11-02T10:00:00Z");
export const TEST_SECRET = "whsec_" + Buffer.from("e2a-test-secret-not-a-real-one-0123456789").toString("base64");

/** Signs a body the way Fathom does (Standard Webhooks): HMAC-SHA256 over "<id>.<timestamp>.<body>", key = the base64 part of the secret. */
export function sign(body: string, id: string, timestampSeconds: number, secret = TEST_SECRET): { id: string; timestamp: string; signature: string } {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestampSeconds}.${body}`).digest("base64");
  return { id, timestamp: String(timestampSeconds), signature: `v1,${sig}` };
}

export const nowSeconds = () => Math.floor(NOW / 1000);

type Invitee = { name?: string | null; email?: string | null; is_external?: boolean };
/** A delivery in the shape of Fathom's published `Meeting` object (recording_id, title, calendar_invitees, recorded_by, default_summary, action_items...). */
export function fathomPayload(over: Record<string, unknown> = {}, invitees: Invitee[] = [{ name: "Lee Client", email: "lee@client.test", is_external: true }]) {
  return {
    recording_id: 123456789, title: "Kitchen quote call", meeting_title: "Kitchen quote", url: "https://fathom.video/calls/123456789", share_url: "https://fathom.video/share/abc123",
    created_at: "2026-11-02T09:45:00Z", scheduled_start_time: "2026-11-02T09:00:00Z", scheduled_end_time: "2026-11-02T09:30:00Z",
    recording_start_time: "2026-11-02T09:01:00Z", recording_end_time: "2026-11-02T09:31:00Z",
    calendar_invitees: [{ name: "Rep Seller", email: "rep@agency.test", is_external: false }, ...invitees.map((i) => ({ email_domain: i.email?.split("@")[1] ?? null, ...i }))],
    recorded_by: { name: "Rep Seller", email: "rep@agency.test", email_domain: "agency.test", team: null },
    default_summary: { template_name: "General", markdown_formatted: "They want a quote by Friday.\n\nBudget is flexible." },
    action_items: [{ description: "Send the quote", user_generated: false, completed: false, recording_timestamp: "00:12:00", recording_playback_url: "https://fathom.video/x", assignee: { name: "Rep Seller", email: "rep@agency.test", team: null } }],
    transcript: [{ speaker: { display_name: "Lee Client", matched_calendar_invitee_email: "lee@client.test" }, text: "FULL TRANSCRIPT WORDS", timestamp: "00:00:05" }],
    crm_matches: null, ...over,
  };
}

export const personOf = (role: Role, over: Partial<Person> = {}): Person => ({ companyKey: "CO1", userId: `U-${role}`, name: "Rep Seller", role, kind: role.startsWith("agency") ? "agency" : "client", homeLocationId: role.startsWith("agency") ? null : "LA", ...over });
export const connOf = (person: Person): PersonalConnection => ({ id: `CONN-${person.userId}`, installationId: "INST1", provider: "fathom", person, accountEmail: null });
export const hookConnOf = (person: Person): HookConnection => ({ ...connOf(person), webhookSecret: TEST_SECRET });

export const CONFIRMED: PersonSettings = { masterSwitch: true, unmatchedMode: "inbox", preset: "recommended", custom: null, previewConfirmedAt: NOW - 1000 };

type Contact = Candidate & { name?: string | null; phone?: string | null };

export type Mem = ReturnType<typeof memStore>;

export function memStore(over: {
  contacts?: Contact[]; settings?: PersonSettings; accountPolicies?: Record<string, unknown>; agencyPolicy?: unknown; ignored?: string[]; writeScope?: boolean; failInsertOnce?: boolean; writesTodayUser?: number;
} = {}) {
  const contacts = over.contacts ?? [];
  const meetings = new Map<string, MeetingRow & { id: string; createdAt: number }>();
  const claims = new Set<string>();
  const ignored = new Set<string>(over.ignored ?? []);
  let settings: PersonSettings = over.settings ?? CONFIRMED;
  let failOnce = over.failInsertOnce === true;
  const connection = { conn: null as PersonalConnection | null };
  const log = { candidateAsks: [] as string[][], writes: [] as Array<Record<string, unknown>>, bumps: [] as string[], searches: [] as string[][] };

  const asStored = (m: MeetingRow & { id: string; createdAt: number }): StoredMeeting => ({
    id: m.id, ownerUserId: m.ownerUserId, connectionId: m.connectionId, installationId: m.installationId, provider: m.provider as StoredMeeting["provider"], title: m.title, startedAt: m.startedAt,
    attendeeEmails: m.attendeeEmails, summary: m.summary, actionItems: m.actionItems, recordingUrl: m.recordingUrl, status: m.status, reason: m.reason, expiresAt: m.expiresAt, createdAt: m.createdAt,
  });
  const hit = (c: Contact): ContactHit => ({ locationId: c.locationId, contactId: c.contactId, name: c.name ?? null, email: c.email, phone: c.phone ?? null });

  const store: InboxStore = {
    now: () => NOW,
    installed: async () => [{ locationId: "LA" }, { locationId: "LB" }],
    provenAccess: async () => null,
    // Like the real query: only the accounts it is given are looked at, and what it was asked is recorded.
    candidates: async (_i, ids, emails) => { log.candidateAsks.push([...ids]); return contacts.filter((c) => ids.includes(c.locationId) && emails.includes(c.email)); },
    policies: async () => ({ agency: over.agencyPolicy ?? null, accounts: over.accountPolicies ?? {} }),
    settings: async () => settings,
    writesToday: async () => ({ user: over.writesTodayUser ?? 0, byAccount: {} }),
    insertMeeting: async (row) => {
      if (failOnce) { failOnce = false; throw new Error("database is down"); }
      if ([...meetings.values()].some((m) => m.ownerUserId === row.ownerUserId && m.provider === row.provider && m.providerMeetingId === row.providerMeetingId)) return null;
      const id = `M${meetings.size + 1}`;
      meetings.set(id, { ...row, id, createdAt: NOW });
      return id;
    },
    updateMeeting: async (id, status, reason, expiresAt) => { const m = meetings.get(id); if (m) { m.status = status; m.reason = reason; if (expiresAt !== undefined) m.expiresAt = expiresAt; } },
    recordWrite: async (r) => { log.writes.push(r); return true; },
    bump: async (_id, field) => { log.bumps.push(field); },
    ignoredEmails: async () => [...ignored],
    hasWriteScope: async () => over.writeScope !== false,

    getMeeting: async (inst, user, id) => { const m = meetings.get(id); return m && m.installationId === inst && m.ownerUserId === user ? asStored(m) : null; },
    listWaiting: async (inst, user) => [...meetings.values()].filter((m) => m.installationId === inst && m.ownerUserId === user && m.status === "needs_contact").map(asStored),
    contactIn: async (_inst, loc, id) => { const c = contacts.find((x) => x.locationId === loc && x.contactId === id); return c ? hit(c) : null; },
    searchContacts: async (_inst, ids, q) => { log.searches.push([...ids]); const t = q.toLowerCase(); return contacts.filter((c) => ids.includes(c.locationId) && `${c.name ?? ""} ${c.email}`.toLowerCase().includes(t)).map(hit); },
    scrub: async (inst, user, id, reason) => {
      const m = meetings.get(id);
      if (!m || m.installationId !== inst || m.ownerUserId !== user || m.status !== "needs_contact") return false;
      Object.assign(m, { status: "skipped", reason, title: null, startedAt: null, attendeeEmails: [], summary: null, actionItems: [], recordingUrl: null, expiresAt: null });
      return true;
    },
    addIgnored: async (_inst, _user, email) => { ignored.add(email); },
    claimHeld: async (inst, user, id) => {
      const m = meetings.get(id);
      if (!m || m.installationId !== inst || m.ownerUserId !== user || m.status !== "needs_contact" || m.reason !== "preview_needed") return false;
      m.reason = "releasing";
      return true;
    },
    confirmPreview: async () => { settings = { ...settings, previewConfirmedAt: NOW }; },
    getConnection: async () => connection.conn,
  };
  const deliveries: DeliveryStore & { claimed: Set<string> } = {
    claimed: claims,
    claim: async (_i, connId, webhookId) => { const k = `${connId}|${webhookId}`; if (claims.has(k)) return false; claims.add(k); return true; },
    release: async (connId, webhookId) => { claims.delete(`${connId}|${webhookId}`); },
  };
  return { store, deliveries, meetings, claims, ignored, log, connection, settings: () => settings };
}

/** A real CRM write client over a fake transport and a recording audit. `fetched` is what would have reached the CRM. */
export function crm(opts: { respond?: (n: number) => Response } = {}) {
  const fetched: Array<{ url: string; body: Record<string, unknown> }> = [];
  const audit: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const lines: string[] = [];
  const writer: Writer = (a) => writeToCrm(
    {
      installationId: a.installationId, locationId: a.locationId, contactId: a.contactId, meetingId: a.meetingId, request: a.request as CrmRequest, token: async () => "tok",
      fetchImpl: (async (url: string, init: RequestInit) => { fetched.push({ url, body: JSON.parse(String(init.body)) }); return opts.respond ? opts.respond(fetched.length) : new Response(JSON.stringify({ note: { id: `NOTE${fetched.length}abc` } }), { status: 201 }); }) as typeof fetch,
    },
    { audit: async (r) => { audit.push({ action: r.action, detail: r.detail }); }, log: (l: unknown) => { lines.push(String(l)); } },
  ) as Promise<WriteResult>;
  return { writer, fetched, audit, lines };
}
