import { afterEach, describe, expect, it, vi } from "vitest";
import { mapMessage, leadFromMessages } from "@/lib/analytics/speed-intel";
import { waitingState } from "@/lib/analytics/waiting";
import type { FieldMapping } from "@/lib/connections/contact-fields";
import { candidateIds } from "@/lib/connections/echo";
import { parseFathomDelivery } from "@/lib/connections/fathom";
import { deliverNotes, ingestPersonalMeeting, type DeliveryExtras, type PersonSettings } from "@/lib/connections/ingest";
import type { PlanTarget } from "@/lib/connections/meeting-plan";
import { effectivePolicy, matrixFor } from "@/lib/connections/policy";
import { usableChars } from "@/lib/connections/content-split";
import { ASSUMED_LIMITS } from "@/lib/ghl/crm-writes";
import { CONFIRMED, connOf, crm, fathomPayload, NOW, personOf } from "./e2a-support";
import { memStoreE2b, type E2bOver } from "./e2b-support";

// Stage E2b through the real ingest path (planning, the account's rules over the person's choices, composing, the write client) against the in-memory
// stand-in for the database and a FAKE CRM transport. The CRM address is only ever recorded, never called: with WRITE_GHL_LIVE off (the committed default)
// nothing is even built into a request, and with it stubbed on the transport is `crm()`'s fake fetch. No real token, no network.

afterEach(() => vi.unstubAllEnvs());

const LEE = { locationId: "LB", contactId: "CB1", email: "lee@client.test", name: "Lee Client" };
const ALL_PLACES = { destinations: ["note", "comment", "field"], allowTranscripts: true };
const MAP = (item: FieldMapping["item"], over: Partial<FieldMapping> = {}): FieldMapping => ({ item, customFieldId: `FLD_${item}_1`, fieldName: `Field ${item}`, fieldType: "text", enabled: true, ...over });
const custom = (c: Record<string, string>, over: Partial<PersonSettings> = {}): PersonSettings => ({ ...CONFIRMED, preset: "custom", presetChosen: true, custom: c, ...over });

const run = async (a: { over?: E2bOver; payload?: Record<string, unknown>; transcript?: boolean; id?: number; role?: Parameters<typeof personOf>[0] } = {}) => {
  const mem = memStoreE2b({ contacts: [LEE], ...a.over });
  const out = crm();
  const conn = connOf(personOf(a.role ?? "account_admin", { homeLocationId: "LB", kind: "client", companyKey: "CO1" }));
  mem.connection.conn = conn;
  const ingest = async (payload = a.payload, id = a.id) => {
    const d = parseFathomDelivery(fathomPayload({ ...(payload ?? {}), ...(id ? { recording_id: id } : {}) }), { transcript: a.transcript === true })!;
    const extras: DeliveryExtras = { rep: d.recordedByName, withNames: d.withNames, durationMinutes: d.durationMinutes, internalEmails: d.internalEmails, transcript: d.transcriptText, callUrl: d.callUrl };
    return ingestPersonalMeeting(conn, d.meeting, d.recordingId, mem.store, out.writer, extras);
  };
  return { mem, out, conn, ingest };
};

const urls = (out: ReturnType<typeof crm>) => out.fetched.map((f) => f.url.replace("https://services.leadconnectorhq.com", ""));
const longSummary = (n: number) => Array.from({ length: n }, (_, i) => `Point ${i + 1}. ${"detail ".repeat(36)}`.trim()).join("\n\n");

describe("contact fields through the real path", () => {
  it("a field is written only when the admin mapped it", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "note", action_items: "field", recording_link: "note", attendees_and_date: "note", transcript: "off" });
    const without = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES }, mappings: {} } });
    await without.ingest();
    expect(urls(without.out), "no mapping: no field update, and the action items are not lost into a note either").toEqual(["/contacts/CB1/notes"]);
    expect(without.out.fetched[0].body.body).not.toContain("Action items");

    const withMap = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES }, mappings: { LB: [MAP("next_steps")] } } });
    await withMap.ingest();
    expect(urls(withMap.out)).toEqual(["/contacts/CB1/notes", "/contacts/CB1"]);
    expect(withMap.out.fetched[1].body).toEqual({ customFields: [{ id: "FLD_next_steps_1", field_value: "Send the quote" }] });
    expect(withMap.out.fetched[0].body.body).not.toContain("Action items");
  });

  it("a mapped field the admin switched off is not written, and the account must allow the Contact field place", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "note", action_items: "field", recording_link: "off", attendees_and_date: "note", transcript: "off" });
    const off = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES }, mappings: { LB: [MAP("next_steps", { enabled: false })] } } });
    await off.ingest();
    expect(urls(off.out)).toEqual(["/contacts/CB1/notes"]);
    // The place itself is not allowed by the account: clipped to SubSync only, with the reason, and no field request is built.
    const notAllowed = await run({ over: { settings: table, accountPolicies: { LB: { destinations: ["note"] } }, mappings: { LB: [MAP("next_steps")] } } });
    const done = await notAllowed.ingest();
    expect(urls(notAllowed.out)).toEqual(["/contacts/CB1/notes"]);
    expect(done).toMatchObject({ kind: "written", clips: 1 });
  });

  it("an older meeting never overwrites a newer value; a newer one does; a retry of the same meeting does nothing", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "off", action_items: "field", recording_link: "off", attendees_and_date: "field", transcript: "off" });
    const h = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES }, mappings: { LB: [MAP("next_steps"), MAP("last_meeting_date", { fieldType: "date" })] } } });
    const at = (iso: string, who: string) => ({ recording_start_time: iso, action_items: [{ description: who }] });

    await h.ingest(at("2026-11-03T09:00:00Z", "Newer step"), 2001);
    expect(h.out.fetched).toHaveLength(1);
    expect(h.out.fetched[0].body.customFields).toEqual([{ id: "FLD_last_meeting_date_1", field_value: "2026-11-03" }, { id: "FLD_next_steps_1", field_value: "Newer step" }]);

    // a late delivery of an older meeting: nothing is sent
    await h.ingest(at("2026-11-01T09:00:00Z", "Older step"), 2002);
    expect(h.out.fetched, "the older meeting changed nothing").toHaveLength(1);
    const lastReport = h.mem.e2b.log.deliveries.at(-1)![0];
    expect(lastReport.written).toEqual([]);
    // the date and next steps are older; "Last meeting with" was never mapped, which is also said
    expect(lastReport.skipped.map((s) => s.code)).toEqual(["older_meeting", "older_meeting", "not_mapped"]);

    // a retry of the very same meeting is a duplicate delivery and does nothing
    expect(await h.ingest(at("2026-11-03T09:00:00Z", "Newer step"), 2001)).toEqual({ kind: "duplicate" });
    expect(h.out.fetched).toHaveLength(1);

    // a newer meeting does overwrite
    await h.ingest(at("2026-11-05T09:00:00Z", "Newest step"), 2003);
    expect(h.out.fetched).toHaveLength(2);
    expect(JSON.stringify(h.out.fetched[1].body)).toContain("Newest step");
    expect(h.mem.e2b.fieldState.get("LB|CB1|next_steps")!.startedAt).toBe(Date.parse("2026-11-05T09:00:00Z"));
  });

  it("an older and a newer meeting arriving at the same moment still leave the newer value (the contact's lock serialises them)", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "off", action_items: "field", recording_link: "off", attendees_and_date: "off", transcript: "off" });
    const h = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES }, mappings: { LB: [MAP("next_steps")] } } });
    await Promise.all([
      h.ingest({ recording_start_time: "2026-11-05T09:00:00Z", action_items: [{ description: "New" }] }, 3002),
      h.ingest({ recording_start_time: "2026-11-02T09:00:00Z", action_items: [{ description: "Old" }] }, 3001),
    ]);
    // whichever got the lock first, the value left in the contact is never the older one after the newer one: the last write sent is the newest meeting's
    const sent = h.out.fetched.map((f) => JSON.stringify(f.body));
    expect(sent.at(-1)).toContain("New");
    expect(h.mem.e2b.fieldState.get("LB|CB1|next_steps")!.startedAt).toBe(Date.parse("2026-11-05T09:00:00Z"));
  });

  it("test mode (the committed default) plans the field update, records the line, and sends and remembers nothing", async () => {
    const table = custom({ summary: "off", action_items: "field", recording_link: "off", attendees_and_date: "off", transcript: "off" });
    const h = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES }, mappings: { LB: [MAP("next_steps")] } } });
    const done = await h.ingest();
    expect(done).toMatchObject({ kind: "written" });
    expect(h.out.fetched).toEqual([]);
    expect(h.out.audit.filter((a) => a.action === "dry_run.would_write").map((a) => a.detail.what)).toEqual(["crm.field.update"]);
    expect(h.mem.e2b.fieldState.size, "a test-mode run does not claim the field").toBe(0);
    expect(h.mem.e2b.log.fieldWrites).toEqual([]);
    expect(JSON.stringify(h.out.audit) + h.out.lines.join()).not.toMatch(/Send the quote|FLD_next/);
  });

  it("each skipped or cut field is logged with its plain reason, never its value", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "field", action_items: "off", recording_link: "field", attendees_and_date: "off", transcript: "off" });
    const long = Array.from({ length: 150 }, (_, i) => `word${i}`).join(" ");
    const h = await run({
      over: { settings: table, accountPolicies: { LB: ALL_PLACES }, mappings: { LB: [MAP("last_meeting_summary"), MAP("recording_url", { fieldType: "other" })] } },
      payload: { default_summary: { markdown_formatted: long } },
    });
    await h.ingest();
    const r = h.mem.e2b.log.deliveries.at(-1)![0];
    expect(r.written).toEqual(["last_meeting_summary"]);
    expect(r.cut).toHaveLength(1);
    expect(r.skipped).toEqual([expect.objectContaining({ item: "recording_url", code: "type_mismatch" })]);
    expect(JSON.stringify(r.skipped)).not.toContain("fathom.video");
  });
});

describe("the account's setup over the person's choices", () => {
  it("a locked layout cannot be changed by the person: the account's layout is what is written", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const rules = { ...ALL_PLACES, locked: ["preset"], defaults: { preset: "summary_only" } };
    const h = await run({ over: { settings: { ...CONFIRMED, preset: "full_record", presetChosen: true }, accountPolicies: { LB: rules } } });
    await h.ingest();
    expect(urls(h.out)).toEqual(["/contacts/CB1/notes"]);
    const note = String(h.out.fetched[0].body.body);
    expect(note).toContain("Summary");
    expect(note).not.toContain("Action items");
    expect(note).not.toContain("Recording:");
  });

  it("a person who never chose gets the account's default layout; one who chose keeps theirs", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const rules = { ...ALL_PLACES, defaults: { preset: "summary_only" } };
    const never = await run({ over: { settings: { ...CONFIRMED, presetChosen: false }, accountPolicies: { LB: rules } } });
    await never.ingest();
    expect(String(never.out.fetched[0].body.body)).not.toContain("Action items");
    const chose = await run({ over: { settings: { ...CONFIRMED, preset: "recommended", presetChosen: true }, accountPolicies: { LB: rules } } });
    await chose.ingest();
    expect(String(chose.out.fetched[0].body.body)).toContain("Action items");
  });

  it("locking the table removes the Custom layout: the person's custom table is replaced by the account's default", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const rules = { ...ALL_PLACES, locked: ["destinations"], defaults: { preset: "recommended" } };
    const h = await run({ over: { settings: custom({ summary: "comment", action_items: "comment", recording_link: "off", attendees_and_date: "off", transcript: "off" }), accountPolicies: { LB: rules } } });
    await h.ingest();
    expect(urls(h.out), "no comment, one note").toEqual(["/contacts/CB1/notes"]);
  });

  it("the company layer sits above the account: what the company locked and set wins over the account's value", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const company = { ...ALL_PLACES, locked: ["preset"], defaults: { preset: "summary_only" } };
    const account = { ...ALL_PLACES, defaults: { preset: "full_record" } };
    const h = await run({ over: { settings: { ...CONFIRMED, presetChosen: false }, agencyPolicy: company, accountPolicies: { LB: account } } });
    await h.ingest();
    expect(String(h.out.fetched[0].body.body)).not.toContain("Action items");
    expect(effectivePolicy(company, account).defaults.preset).toBe("summary_only");
  });

  it("with no company rule at all, an account's own administrator can allow what the careful defaults leave off", () => {
    expect(effectivePolicy(null, { allowTranscripts: true, destinations: ["note", "comment", "field"] })).toMatchObject({ allowTranscripts: true, destinations: ["note", "comment", "field"] });
    // ...but an account that has not decided keeps the careful defaults
    expect(effectivePolicy(null, null)).toMatchObject({ allowTranscripts: false, destinations: ["note", "comment"] });
    // and a company rule, once saved, is a ceiling
    expect(effectivePolicy({ allowTranscripts: false, destinations: ["note"] }, { allowTranscripts: true, destinations: ["note", "comment", "field"] })).toMatchObject({ allowTranscripts: false, destinations: ["note"] });
  });

  it("a locked 'do not keep calls nobody matches' is the admin's, whatever the person chose", async () => {
    const rules = { ...ALL_PLACES, locked: ["unmatchedMode"], defaults: { unmatchedMode: "discard" } };
    const h = await run({ over: { contacts: [], settings: { ...CONFIRMED, unmatchedMode: "inbox" }, accountPolicies: { LB: rules } } });
    expect(await h.ingest()).toMatchObject({ kind: "discarded" });
    const free = await run({ over: { contacts: [], settings: { ...CONFIRMED, unmatchedMode: "inbox" }, accountPolicies: { LB: ALL_PLACES } } });
    expect(await free.ingest()).toMatchObject({ kind: "inbox" });
  });
});

describe("the conversation comment and long content", () => {
  it("a summary sent as a comment is an internal comment, as the person, to the contact", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "comment", action_items: "note", recording_link: "note", attendees_and_date: "note", transcript: "off" });
    const h = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES } } });
    await h.ingest();
    expect(urls(h.out).sort()).toEqual(["/contacts/CB1/notes", "/conversations/messages"].sort());
    const comment = h.out.fetched.find((f) => f.url.endsWith("/conversations/messages"))!;
    expect(comment.body).toMatchObject({ type: "InternalComment", contactId: "CB1", userId: "U-account_admin" });
    expect(String(comment.body.message)).toContain("Budget is flexible");
    expect(h.mem.log.writes.map((w) => `${w.kind}:${w.partNo ?? 1}`).sort()).toEqual(["comment:1", "note:1"]);
  });

  it("without the permission for comments a comment row waits as SubSync only (Needs permission), and the note is still written", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "comment", action_items: "note", recording_link: "off", attendees_and_date: "note", transcript: "off" });
    const h = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES }, commentScope: false } });
    const done = await h.ingest();
    expect(urls(h.out)).toEqual(["/contacts/CB1/notes"]);
    expect(done).toMatchObject({ kind: "written", clips: 1 });
  });

  it("a long summary splits into 'Part i of N' notes at paragraph boundaries, each part written once, numbered in the write log", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { accountPolicies: { LB: ALL_PLACES } }, payload: { default_summary: { markdown_formatted: longSummary(20) } } });
    await h.ingest();
    const bodies = h.out.fetched.map((f) => String(f.body.body));
    expect(bodies.length).toBeGreaterThan(1);
    bodies.forEach((b, i) => { expect(b.startsWith(`Part ${i + 1} of ${bodies.length}`)).toBe(true); expect(b.length).toBeLessThanOrEqual(usableChars(ASSUMED_LIMITS.noteChars)); });
    expect(h.mem.log.writes.map((w) => w.partNo ?? 1)).toEqual(bodies.map((_, i) => i + 1));
    const all = bodies.join("\n");
    for (let i = 1; i <= 20; i++) expect(all).toContain(`Point ${i}.`);
  });

  it("a long summary as comments splits into comments, each within the comment limit", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "comment", action_items: "off", recording_link: "off", attendees_and_date: "off", transcript: "off" });
    const h = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES } }, payload: { default_summary: { markdown_formatted: longSummary(20) } } });
    await h.ingest();
    expect(h.out.fetched.length).toBeGreaterThan(1);
    for (const f of h.out.fetched) {
      expect(f.url.endsWith("/conversations/messages")).toBe(true);
      expect(String(f.body.message).length).toBeLessThanOrEqual(usableChars(ASSUMED_LIMITS.commentChars));
    }
  });

  it("when a part fails the next parts are not written after it (no Part 3 without Part 2), and the meeting is marked partly saved", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    // The first part is accepted; from the second on the CRM refuses (400 is not retried).
    const out = crm({ respond: (n) => (n === 1 ? new Response(JSON.stringify({ note: { id: "N1abcdef" } }), { status: 201 }) : new Response("{}", { status: 400 })) });
    const conn = connOf(personOf("account_admin", { homeLocationId: "LB", kind: "client" }));
    const mem = memStoreE2b({ contacts: [LEE], settings: CONFIRMED, accountPolicies: { LB: ALL_PLACES } });
    mem.connection.conn = conn;
    const d = parseFathomDelivery(fathomPayload({ default_summary: { markdown_formatted: longSummary(20) } }))!;
    await ingestPersonalMeeting(conn, d.meeting, d.recordingId, mem.store, out.writer, {});
    expect(out.fetched, "part 1 went, part 2 was refused, and nothing was tried after it").toHaveLength(2);
    expect(String(out.fetched[1].body.body)).toMatch(/^Part 2 of \d+/);
    const row = [...mem.meetings.values()][0];
    expect(row).toMatchObject({ status: "saved", reason: "partly_saved" });
    expect(mem.e2b.log.released, "the refused part gives its slot back, so a retry can write it").toHaveLength(1);
  });
});

describe("the transcript: only when the person turned it on AND the account allows it", () => {
  const FULL = { ...CONFIRMED, preset: "full_record" as const, presetChosen: true };
  const comments = (out: ReturnType<typeof crm>) => out.fetched.filter((f) => f.url.endsWith("/conversations/messages")).map((f) => String(f.body.message));

  it("on by the person and allowed by the account: written as its own comment, and never kept in SubSync", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { settings: FULL, accountPolicies: { LB: ALL_PLACES } }, transcript: true });
    await h.ingest();
    const c = comments(h.out);
    expect(c).toHaveLength(1);
    expect(c[0]).toContain("FULL TRANSCRIPT WORDS");
    expect(c[0]).toContain("Transcript: Kitchen quote");
    const stored = JSON.stringify([...h.mem.meetings.values()]);
    expect(stored, "the transcript is not in what SubSync stores").not.toContain("FULL TRANSCRIPT");
  });

  it("on by the person but not allowed by the account: not written, and the clip is counted", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { settings: FULL, accountPolicies: { LB: { destinations: ["note", "comment"], allowTranscripts: false } } }, transcript: true });
    const done = await h.ingest();
    expect(comments(h.out)).toEqual([]);
    expect(JSON.stringify(h.out.fetched)).not.toContain("FULL TRANSCRIPT");
    expect(done).toMatchObject({ kind: "written", clips: 1 });
  });

  it("allowed by the account but not turned on by the person: never written", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { settings: { ...CONFIRMED, presetChosen: true }, accountPolicies: { LB: ALL_PLACES } }, transcript: true });
    await h.ingest();
    expect(comments(h.out)).toEqual([]);
    expect(JSON.stringify(h.out.fetched)).not.toContain("FULL TRANSCRIPT");
  });

  it("a company rule that says no beats an account that says yes", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { settings: FULL, agencyPolicy: { destinations: ["note", "comment"], allowTranscripts: false }, accountPolicies: { LB: ALL_PLACES } }, transcript: true });
    await h.ingest();
    expect(comments(h.out)).toEqual([]);
  });

  it("a transcript the delivery carried is never even read unless the choices could use it", () => {
    const withIt = parseFathomDelivery(fathomPayload(), { transcript: true })!;
    expect(withIt.transcriptText).toContain("FULL TRANSCRIPT WORDS");
    const without = parseFathomDelivery(fathomPayload())!;
    expect(without.transcriptText).toBeNull();
    expect(JSON.stringify(without)).not.toContain("FULL TRANSCRIPT");
  });

  it("a transcript beyond the size cap is saved as a link, and the comment says so", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const turns = Array.from({ length: 700 }, (_, i) => ({ speaker: { display_name: i % 2 ? "Lee Client" : "Rep Seller" }, text: `Turn ${i} ${"words ".repeat(18)}`.trim(), timestamp: "00:00:05" }));
    const h = await run({ over: { settings: FULL, accountPolicies: { LB: ALL_PLACES } }, transcript: true, payload: { transcript: turns } });
    await h.ingest();
    const c = comments(h.out);
    expect(c).toHaveLength(1);
    expect(c[0]).toContain("too long to save here");
    expect(c[0]).toContain("https://fathom.video/calls/123456789");
    expect(c[0]).not.toContain("Turn 5 ");
  });
});

describe("one write per part, even when the same work runs twice at once", () => {
  it("two simultaneous deliveries of the same parts write each part exactly once", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { accountPolicies: { LB: ALL_PLACES } } });
    const target: PlanTarget = {
      locationId: "LB", contactId: "CB1", email: "lee@client.test", allowed: true, blockedBecause: null, clips: [], template: null, mappings: [],
      items: { ...matrixFor("recommended", null), summary: "comment" },
    };
    const args = {
      conn: h.conn, meetingId: "M-same", targets: [target], store: h.mem.store, write: h.out.writer, sentToday: 0, capFor: () => 50,
      input: { title: "Kitchen quote", startedAt: "2026-11-02T09:01:00.000Z", durationMinutes: 30, attendeeNames: ["Lee"], rep: "Rep", tool: "Fathom", summary: "A summary", actionItems: ["Send"], recordingUrl: null },
    };
    const [a, b] = await Promise.all([deliverNotes(args), deliverNotes(args)]);
    // one note and one comment in total, not two of each
    expect(h.out.fetched.map((f) => f.url.replace(/^.*\.com/, "")).sort()).toEqual(["/contacts/CB1/notes", "/conversations/messages"]);
    expect([...a.done, ...b.done].filter((d) => d.outcome === "already_written")).toHaveLength(2);
    expect([...a.done, ...b.done].filter((d) => d.outcome === "written")).toHaveLength(2);
    // a third run later also writes nothing
    const c = await deliverNotes(args);
    expect(h.out.fetched).toHaveLength(2);
    expect(c.done.every((d) => d.outcome === "already_written")).toBe(true);
  });

  it("a part whose write failed gives its slot back, so a retry can write it", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const mem = memStoreE2b({ contacts: [LEE] });
    const conn = connOf(personOf("account_admin", { homeLocationId: "LB", kind: "client" }));
    const bad = crm({ respond: () => new Response("{}", { status: 400 }) });
    const target: PlanTarget = { locationId: "LB", contactId: "CB1", email: "x@y.test", allowed: true, blockedBecause: null, clips: [], template: null, mappings: [], items: matrixFor("recommended", null) };
    const args = { conn, meetingId: "M-retry", targets: [target], store: mem.store, sentToday: 0, capFor: () => 50, input: { title: "T", startedAt: null, durationMinutes: null, attendeeNames: [], rep: "R", tool: "Fathom", summary: "S", actionItems: [], recordingUrl: null } };
    const first = await deliverNotes({ ...args, write: bad.writer });
    expect(first.done.map((d) => d.outcome)).toEqual(["failed"]);
    const good = crm();
    const second = await deliverNotes({ ...args, write: good.writer });
    expect(second.done.map((d) => d.outcome)).toEqual(["written"]);
    expect(good.fetched).toHaveLength(1);
  });
});

describe("the same meeting recorded by two tools (the rule is built before Zoom exists)", () => {
  const ZOOM_SEEN = (status: string) => ({ id: "Z1", provider: "zoom", startedAt: "2026-11-02T09:00:00.000Z", attendeeEmails: ["rep@agency.test", "lee@client.test"], title: "Kitchen quote", status });

  it("a copy from another tool that was already written means this one is a duplicate and writes nothing", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { accountPolicies: { LB: ALL_PLACES }, seen: [ZOOM_SEEN("saved")] } });
    const done = await h.ingest();
    expect(done).toMatchObject({ kind: "same_meeting", reason: "already_in_crm" });
    expect(h.out.fetched).toEqual([]);
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "duplicate", reason: "already_in_crm", title: null, summary: null });
  });

  it("the preferred tool wins over a waiting copy from a less preferred one, which becomes a duplicate", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { accountPolicies: { LB: ALL_PLACES }, seen: [ZOOM_SEEN("needs_contact")] } });
    const done = await h.ingest();
    expect(done).toMatchObject({ kind: "written" });
    expect(h.out.fetched).toHaveLength(1);
    expect(h.mem.e2b.log.duplicates).toEqual([["Z1"]]);
  });

  it("the person's own order can put the other tool first", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { settings: { ...CONFIRMED, sourcePriority: ["zoom", "fathom", "google_meet"] }, accountPolicies: { LB: ALL_PLACES }, seen: [ZOOM_SEEN("needs_contact")] } });
    expect(await h.ingest()).toMatchObject({ kind: "same_meeting", reason: "preferred_tool_has_it" });
    expect(h.out.fetched).toEqual([]);
  });

  it("a different meeting at another time is not a duplicate", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = await run({ over: { accountPolicies: { LB: ALL_PLACES }, seen: [{ ...ZOOM_SEEN("saved"), startedAt: "2026-11-02T14:00:00.000Z" }] } });
    expect(await h.ingest()).toMatchObject({ kind: "written" });
  });
});

describe("our own comments never change our own numbers (Speed to lead still ignores them)", () => {
  // The platform reports a comment as an outbound message from the person with the source "app": exactly what a real human reply looks like.
  const OUR_COMMENT = { id: "msg-ours-1", direction: "outbound", messageType: "InternalComment", userId: "U-account_admin", source: "app", dateAdded: "2026-11-02T10:05:00.000Z", contactId: "CB1" };

  it("a comment SubSync wrote is never a first reply: the lead stays unanswered, and the conversation is not 'waiting' on a person", () => {
    const lead = Date.parse("2026-11-02T10:00:00.000Z");
    const msgs = [mapMessage(OUR_COMMENT)!];
    expect(leadFromMessages(msgs, lead)).toEqual({ leadAt: lead, touchAt: null, touchUserId: null });
    expect(leadFromMessages(msgs, lead, true)?.touchAt, "not even when automated touches are counted").toBeNull();
    expect(waitingState({ direction: "outbound", at: Date.parse(OUR_COMMENT.dateAdded), type: "InternalComment" }, Date.parse("2026-11-02T11:00:00.000Z"), 1)).toBe("none");
    // the same message as a real text from the same person DOES count, so the test is not passing by ignoring everything
    expect(leadFromMessages([mapMessage({ ...OUR_COMMENT, messageType: "TYPE_SMS" })!], lead)?.touchAt).toBe(Date.parse(OUR_COMMENT.dateAdded));
  });

  it("the comment we wrote is recognised as ours by the id the CRM gave it, so its webhook is dropped", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const table = custom({ summary: "comment", action_items: "off", recording_link: "off", attendees_and_date: "off", transcript: "off" });
    const h = await run({ over: { settings: table, accountPolicies: { LB: ALL_PLACES } } });
    await h.ingest();
    const ours = h.mem.log.writes.find((w) => w.kind === "comment")!;
    expect(ours.ghlId).toMatch(/^NOTE\d/);
    expect(candidateIds({ messageId: ours.ghlId, messageType: "InternalComment" })).toContain(ours.ghlId);
  });
});

describe("time is passed in, not read: the in-memory store is on the same clock as the meeting", () => {
  it("the fixtures start the day of the sample call", () => {
    expect(NOW).toBe(Date.parse("2026-11-02T10:00:00Z"));
  });
});
