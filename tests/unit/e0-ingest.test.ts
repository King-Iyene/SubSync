import { afterEach, describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/lib/analytics/meeting-intel";
import { writeToCrm, type CrmRequest, type WriteResult } from "@/lib/ghl/crm-writes";
import { ingestPersonalMeeting, type IngestStore, type MeetingRow, type PersonalConnection, type PersonSettings, type Writer } from "@/lib/connections/ingest";
import type { Candidate } from "@/lib/connections/meeting-plan";
import type { Role } from "@/lib/identity";
import type { Person } from "@/lib/connections/person";
import { effectivePolicy } from "@/lib/connections/policy";

// The whole path of a meeting that arrives through one person's connection, against an in-memory store and a fake CRM transport: no database, no
// network, no real tool. The same path against the real database is tests/unit/e0-connections-db.test.ts (written, run by the lead after merge).

afterEach(() => vi.unstubAllEnvs());

const NOW = Date.parse("2026-11-02T10:00:00Z");
const meeting = (over: Partial<Meeting> = {}): Meeting => ({
  source: "fathom", title: "Kitchen quote", startedAt: "2026-11-02T09:00:00.000Z", attendees: [{ name: "Lee", email: "lee@client.test" }, { name: "Me", email: "me@agency.test" }],
  summary: "Summary: they want a quote by Friday.", actionItems: ["Send quote"], transcript: "FULL TRANSCRIPT WORDS", recordingUrl: "https://fathom.video/share/x", ...over,
});

const personOf = (role: Role, over: Partial<Person> = {}): Person => ({ companyKey: "CO1", userId: `U-${role}`, name: role, role, kind: role.startsWith("agency") ? "agency" : "client", homeLocationId: role.startsWith("agency") ? null : "LA", ...over });
const connOf = (person: Person): PersonalConnection => ({ id: "CONN1", installationId: "INST1", provider: "fathom", person, accountEmail: "me@agency.test" });

const CONFIRMED: PersonSettings = { masterSwitch: true, unmatchedMode: "inbox", preset: "recommended", custom: null, previewConfirmedAt: NOW - 1000 };

function memStore(over: { contacts?: Candidate[]; settings?: PersonSettings; accountPolicies?: Record<string, unknown>; agencyPolicy?: unknown; provenAccess?: string[] | null } = {}) {
  const contacts = over.contacts ?? [];
  const meetings = new Map<string, MeetingRow & { id: string }>();
  const log = { candidateAsks: [] as string[][], writes: [] as Array<Record<string, unknown>>, bumps: [] as string[], updates: [] as Array<[string, string, string | null]> };
  const store: IngestStore = {
    now: () => NOW,
    installed: async () => [{ locationId: "LA" }, { locationId: "LB" }],
    provenAccess: async () => over.provenAccess ?? null,
    // The real query only looks inside the accounts it is given; so does this one, and it records what it was asked.
    candidates: async (_i, ids, emails) => { log.candidateAsks.push([...ids]); return contacts.filter((c) => ids.includes(c.locationId) && emails.includes(c.email)); },
    policies: async () => ({ agency: over.agencyPolicy ?? null, accounts: over.accountPolicies ?? {} }),
    settings: async () => over.settings ?? CONFIRMED,
    writesToday: async () => ({ user: 0, byAccount: {} }),
    insertMeeting: async (row) => {
      const key = `${row.ownerUserId}|${row.provider}|${row.providerMeetingId}`;
      if ([...meetings.values()].some((m) => `${m.ownerUserId}|${m.provider}|${m.providerMeetingId}` === key)) return null;
      const id = `M${meetings.size + 1}`;
      meetings.set(id, { ...row, id });
      return id;
    },
    updateMeeting: async (id, status, reason) => { log.updates.push([id, status, reason]); const m = meetings.get(id); if (m) { m.status = status; m.reason = reason; } },
    recordWrite: async (r) => { log.writes.push(r); return true; },
    bump: async (_id, field) => { log.bumps.push(field); },
  };
  return { store, meetings, log };
}

// A real CRM write client over a fake transport and a recording audit. `fetched` lists what would have gone to the CRM.
function crm() {
  const fetched: Array<{ url: string; body: Record<string, unknown> }> = [];
  const audit: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const writer: Writer = (a) => writeToCrm(
    { installationId: a.installationId, locationId: a.locationId, contactId: a.contactId, meetingId: a.meetingId, request: a.request as CrmRequest, token: async () => "tok",
      fetchImpl: (async (url: string, init: RequestInit) => { fetched.push({ url, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ note: { id: `NOTE${fetched.length}abc` } }), { status: 201 }); }) as typeof fetch },
    { audit: async (r) => { audit.push({ action: r.action, detail: r.detail }); }, log: (l: unknown) => { logs.push(String(l)); } },
  ) as Promise<WriteResult>;
  return { writer, fetched, audit, logs };
}

const CONTACT_B: Candidate = { locationId: "LB", contactId: "CB1", email: "lee@client.test" };

describe("a meeting through one person's connection", () => {
  it("ACCEPTANCE (dry run, the committed default): an agency admin who connected once has a meeting with a contact in account B planned into B as a note written as that person, and NOTHING is sent", async () => {
    const { store, meetings, log } = memStore({ contacts: [CONTACT_B], accountPolicies: { LB: { destinations: ["note"] } } });
    const out = crm();
    const result = await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", store, out.writer);
    expect(result).toMatchObject({ kind: "written", targets: [{ locationId: "LB", contactId: "CB1", outcome: "dry_run" }] });
    expect(out.fetched, "nothing reaches the CRM in a dry run").toEqual([]);
    expect(out.audit).toHaveLength(1);
    expect(out.audit[0].action).toBe("dry_run.would_write");
    expect(out.audit[0].detail).toMatchObject({ what: "crm.note.create", ids: { locationId: "LB", contactId: "CB1", meetingId: "M1" }, fields: ["body", "userId"] });
    expect(JSON.stringify(out.audit) + out.logs.join()).not.toMatch(/quote by Friday|Kitchen|FULL TRANSCRIPT|lee@client/);
    const row = [...meetings.values()][0];
    expect(row).toMatchObject({ ownerUserId: "U-agency_admin", status: "dry_run", reason: "WOULD WRITE", providerMeetingId: "rec-1" });
    expect(log.writes, "a dry run is not a write, so the write log stays empty").toEqual([]);
    expect(log.bumps).toEqual(["saved"]);
  });

  it("with WRITE_GHL_LIVE on, the note is written once, as the connecting person, and logged with the id the CRM gave it", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const { store, meetings, log } = memStore({ contacts: [CONTACT_B] });
    const out = crm();
    const result = await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", store, out.writer);
    expect(result).toMatchObject({ kind: "written", targets: [{ locationId: "LB", contactId: "CB1", outcome: "written" }] });
    expect(out.fetched).toHaveLength(1);
    expect(out.fetched[0].url).toBe("https://services.leadconnectorhq.com/contacts/CB1/notes");
    expect(out.fetched[0].body.userId).toBe("U-agency_admin");
    expect(String(out.fetched[0].body.body)).toContain("Summary: they want a quote by Friday.");
    expect(String(out.fetched[0].body.body), "the transcript is never put in a note by this path").not.toContain("FULL TRANSCRIPT");
    expect(log.writes).toEqual([{ installationId: "INST1", meetingId: "M1", locationId: "LB", contactId: "CB1", kind: "note", ghlId: "NOTE1abc", authoredBy: "U-agency_admin" }]);
    expect([...meetings.values()][0].status).toBe("saved");
  });

  it("two simultaneous deliveries of the same meeting give exactly one stored meeting and exactly one note", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const { store, meetings, log } = memStore({ contacts: [CONTACT_B] });
    const out = crm();
    const conn = connOf(personOf("agency_admin"));
    const results = await Promise.all([ingestPersonalMeeting(conn, meeting(), "rec-1", store, out.writer), ingestPersonalMeeting(conn, meeting(), "rec-1", store, out.writer), ingestPersonalMeeting(conn, meeting(), "rec-1", store, out.writer)]);
    expect(results.filter((r) => r.kind === "written")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "duplicate")).toHaveLength(2);
    expect(meetings.size).toBe(1);
    expect(out.fetched).toHaveLength(1);
    expect(log.writes).toHaveLength(1);
  });

  it("the same meeting recorded by two different people is two private meetings, one each", async () => {
    const { store, meetings } = memStore({ contacts: [CONTACT_B] });
    const out = crm();
    await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", store, out.writer);
    await ingestPersonalMeeting(connOf(personOf("agency_owner")), meeting(), "rec-1", store, out.writer);
    expect([...meetings.values()].map((m) => m.ownerUserId).sort()).toEqual(["U-agency_admin", "U-agency_owner"]);
  });

  it("the first automatic save needs the person's confirmed preview: until then the meeting is kept and nothing is written", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const { store, meetings } = memStore({ contacts: [CONTACT_B], settings: { ...CONFIRMED, previewConfirmedAt: null } });
    const out = crm();
    const result = await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", store, out.writer);
    expect(result).toMatchObject({ kind: "kept", reason: "preview_needed" });
    expect(out.fetched).toEqual([]);
    expect([...meetings.values()][0]).toMatchObject({ status: "skipped", reason: "preview_needed" });
  });

  it("company staff whose access cannot be proven match nothing and never cause a lookup in any account", async () => {
    const { store, meetings, log } = memStore({ contacts: [CONTACT_B, { ...CONTACT_B, locationId: "LA", contactId: "CA1" }] });
    const out = crm();
    const result = await ingestPersonalMeeting(connOf(personOf("agency_staff")), meeting(), "rec-1", store, out.writer);
    expect(result).toMatchObject({ kind: "inbox", reason: "no_match" });
    expect(log.candidateAsks.flat(), "no account was searched").toEqual([]);
    expect(out.fetched).toEqual([]);
    expect([...meetings.values()][0].status).toBe("needs_contact");
  });

  it("company staff with proven access to A only: a contact in B is never searched and nothing is written there", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const { store, log } = memStore({ contacts: [CONTACT_B], provenAccess: ["LA"] });
    const out = crm();
    const result = await ingestPersonalMeeting(connOf(personOf("agency_staff")), meeting(), "rec-1", store, out.writer);
    expect(result).toMatchObject({ kind: "inbox", reason: "no_match" });
    expect(log.candidateAsks).toEqual([["LA"]]);
    expect(out.fetched).toEqual([]);
  });

  it("an account's own user is matched in their own account only, even when the same email is a contact elsewhere", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const { store, log } = memStore({ contacts: [CONTACT_B, { ...CONTACT_B, locationId: "LA", contactId: "CA1" }] });
    const out = crm();
    const result = await ingestPersonalMeeting(connOf(personOf("account_user")), meeting(), "rec-1", store, out.writer);
    expect(result).toMatchObject({ kind: "written", targets: [{ locationId: "LA", contactId: "CA1" }] });
    expect(log.candidateAsks).toEqual([["LA"]]);
    expect(out.fetched.map((f) => f.url)).toEqual(["https://services.leadconnectorhq.com/contacts/CA1/notes"]);
  });

  it("a duplicate contact record and the same email in two accounts both go to the inbox with their reason, and nothing is written", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const out = crm();
    const dup = memStore({ contacts: [{ ...CONTACT_B, locationId: "LA", contactId: "CA1" }, { ...CONTACT_B, locationId: "LA", contactId: "CA2" }] });
    expect(await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", dup.store, out.writer)).toMatchObject({ kind: "inbox", reason: "duplicate_contact" });
    const cross = memStore({ contacts: [{ ...CONTACT_B, locationId: "LA", contactId: "CA1" }, CONTACT_B] });
    expect(await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", cross.store, out.writer)).toMatchObject({ kind: "inbox", reason: "cross_account" });
    expect(out.fetched).toEqual([]);
  });

  it("an unmatched meeting waits in the person's own inbox for the retention period, with its content for them to link", async () => {
    const { store, meetings } = memStore({ contacts: [], accountPolicies: { LA: { inboxRetentionDays: 7 } } });
    const out = crm();
    const result = await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", store, out.writer);
    expect(result).toMatchObject({ kind: "inbox", reason: "no_match" });
    const row = [...meetings.values()][0];
    expect(row).toMatchObject({ status: "needs_contact", reason: "no_match", expiresAt: NOW + 7 * 86_400_000, attendeeEmails: ["lee@client.test", "me@agency.test"] });
    expect(row.summary).toContain("quote by Friday");
    expect(JSON.stringify(row), "the transcript is never stored").not.toContain("FULL TRANSCRIPT");
  });

  it("'do not keep it' stores no content at all, only that it was counted", async () => {
    const { store, meetings, log } = memStore({ contacts: [], settings: { ...CONFIRMED, unmatchedMode: "discard" } });
    const out = crm();
    const result = await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", store, out.writer);
    expect(result.kind).toBe("discarded");
    expect([...meetings.values()][0]).toMatchObject({ status: "skipped", title: null, summary: null, attendeeEmails: [], recordingUrl: null });
    expect(log.bumps).toEqual(["skipped"]);
  });

  it("a policy that switches writing off keeps a matched meeting with the person and writes nothing", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const { store } = memStore({ contacts: [CONTACT_B], agencyPolicy: { allowCrmWrites: false } });
    const out = crm();
    expect(await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", store, out.writer)).toMatchObject({ kind: "inbox", reason: "writes_off" });
    expect(out.fetched).toEqual([]);
    expect(effectivePolicy({ allowCrmWrites: false }, {}).allowCrmWrites).toBe(false);
  });

  it("a refused write is recorded as failed and not logged as a write", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const { store, meetings, log } = memStore({ contacts: [CONTACT_B] });
    const refuse: Writer = async () => ({ outcome: "needs_permission" });
    const result = await ingestPersonalMeeting(connOf(personOf("agency_admin")), meeting(), "rec-1", store, refuse);
    expect(result).toMatchObject({ kind: "written", targets: [{ outcome: "needs_permission" }] });
    expect([...meetings.values()][0]).toMatchObject({ status: "failed", reason: "write_failed" });
    expect(log.writes).toEqual([]);
  });
});
