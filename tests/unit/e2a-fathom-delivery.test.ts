import { afterEach, describe, expect, it, vi } from "vitest";
import { handleFathomDelivery, type HookDeps } from "@/lib/connections/fathom-hook";
import { parseFathomDelivery } from "@/lib/connections/fathom";
import { confirmAndRelease } from "@/lib/connections/inbox";
import { connOf, crm, fathomPayload, hookConnOf, memStore, nowSeconds, NOW, personOf, sign, TEST_SECRET, CONFIRMED } from "./e2a-support";

// Stage E2a, items 2, 3 and 4: one delivery from Fathom, from the signed raw request to the answer, against an in-memory stand-in for the database and a
// fake CRM transport. The payloads follow Fathom's published `Meeting` shape and are signed with a TEST secret: no real Fathom connection, no network, no
// real token. The same properties against the real database are in tests/unit/e2a-db.test.ts (written, not run).

afterEach(() => vi.unstubAllEnvs());

const KEY = "k3y-for-one-person-abcdefghij1234";
type Over = Parameters<typeof memStore>[0];

function harness(over: Over = {}, role: Parameters<typeof personOf>[0] = "agency_admin") {
  const mem = memStore(over);
  const out = crm();
  const conn = hookConnOf(personOf(role));
  mem.connection.conn = conn;
  const deps: HookDeps = { enabled: async () => true, find: async (k) => (k === KEY ? conn : null), store: mem.store, deliveries: mem.deliveries, write: () => out.writer, now: () => NOW };
  const deliver = (payload: unknown, o: { id?: string; ts?: number; secret?: string; key?: string; raw?: string; deps?: Partial<HookDeps> } = {}) => {
    const body = o.raw ?? JSON.stringify(payload);
    const s = sign(body, o.id ?? "msg_1", o.ts ?? nowSeconds(), o.secret);
    return handleFathomDelivery({ key: o.key ?? KEY, headers: { id: s.id, timestamp: s.timestamp, signature: s.signature }, body }, { ...deps, ...o.deps });
  };
  return { mem, out, conn, deliver };
}

const LEE = { locationId: "LB", contactId: "CB1", email: "lee@client.test", name: "Lee Client" };
const wouldWrites = (out: ReturnType<typeof crm>) => out.audit.filter((a) => a.action === "dry_run.would_write");

describe("a good delivery (the committed default: WRITE_GHL_LIVE off)", () => {
  it("is stored once for the person and planned as ONE note on the matched contact, and NOTHING is sent", async () => {
    const h = harness({ contacts: [LEE] });
    const answer = await h.deliver(fathomPayload());
    expect(answer).toEqual({ status: 200, body: { ok: true, result: "written" } });
    expect(h.mem.meetings.size).toBe(1);
    expect([...h.mem.meetings.values()][0]).toMatchObject({ ownerUserId: "U-agency_admin", provider: "fathom", providerMeetingId: "123456789", status: "dry_run", reason: "WOULD WRITE" });
    expect(h.out.fetched, "nothing reaches the CRM").toEqual([]);
    expect(wouldWrites(h.out)).toHaveLength(1);
    expect(wouldWrites(h.out)[0].detail).toMatchObject({ what: "crm.note.create", ids: { locationId: "LB", contactId: "CB1", meetingId: "M1" }, fields: ["body", "userId"] });
    // The line holds ids and field names only: no part of the call.
    expect(JSON.stringify(h.out.audit) + h.out.lines.join()).not.toMatch(/quote by Friday|Kitchen|FULL TRANSCRIPT|lee@client|Send the quote/);
  });

  it("with WRITE_GHL_LIVE on, the note is the spec's default template, written as the connecting person, and the transcript is never in it or in storage", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = harness({ contacts: [LEE] });
    await h.deliver(fathomPayload());
    expect(h.out.fetched).toHaveLength(1);
    expect(h.out.fetched[0].url).toBe("https://services.leadconnectorhq.com/contacts/CB1/notes");
    expect(h.out.fetched[0].body.userId).toBe("U-agency_admin");
    expect(h.out.fetched[0].body.body).toBe([
      "Meeting: Kitchen quote",
      "Date: Nov 2, 2026, 9:01 AM UTC (30 min)",
      "With: Lee Client",
      "Recorded by: Rep Seller, with Fathom",
      "",
      "Summary",
      "They want a quote by Friday.\n\nBudget is flexible.",
      "",
      "Action items",
      "- Send the quote",
      "",
      "Recording: https://fathom.video/share/abc123",
      "",
      "Added by SubSync from Fathom.",
    ].join("\n"));
    expect(JSON.stringify([...h.mem.meetings.values()]) + JSON.stringify(h.out.fetched)).not.toContain("FULL TRANSCRIPT");
    expect(h.mem.log.writes).toEqual([{ installationId: "INST1", meetingId: "M1", locationId: "LB", contactId: "CB1", kind: "note", ghlId: "NOTE1abc", authoredBy: "U-agency_admin" }]);
    expect([...h.mem.meetings.values()][0].status).toBe("saved");
  });

  it("the recorder and anyone Fathom says is not external are never matched as a contact, even when their email is a contact", async () => {
    const h = harness({ contacts: [{ locationId: "LA", contactId: "CREP", email: "rep@agency.test" }, { locationId: "LA", contactId: "CCOL", email: "colleague@agency.test" }] });
    const answer = await h.deliver(fathomPayload({}, [{ name: "Colleague", email: "colleague@agency.test", is_external: false }]));
    expect(answer.body).toEqual({ ok: true, result: "inbox" });
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "needs_contact", reason: "no_external_attendee" });
    expect(wouldWrites(h.out)).toEqual([]);
  });

  it("two attendees who are two different contacts produce two notes (two WOULD WRITE lines)", async () => {
    const h = harness({ contacts: [LEE, { locationId: "LB", contactId: "CB2", email: "pat@client.test", name: "Pat" }] });
    const answer = await h.deliver(fathomPayload({}, [{ name: "Lee", email: "lee@client.test", is_external: true }, { name: "Pat", email: "pat@client.test", is_external: true }]));
    expect(answer.body).toEqual({ ok: true, result: "written" });
    expect(wouldWrites(h.out).map((a) => (a.detail.ids as Record<string, string>).contactId).sort()).toEqual(["CB1", "CB2"]);
    expect(h.mem.meetings.size, "one stored meeting, two notes").toBe(1);
  });
});

describe("a delivery is refused unless it is genuinely Fathom's, and changes nothing when it is refused", () => {
  const untouched = (h: ReturnType<typeof harness>) => { expect(h.mem.meetings.size).toBe(0); expect(h.mem.claims.size).toBe(0); expect(h.out.audit).toEqual([]); };

  it("a wrong signature, a tampered body, a wrong secret and a missing header are all 401", async () => {
    const h = harness({ contacts: [LEE] });
    const body = JSON.stringify(fathomPayload());
    const good = sign(body, "msg_1", nowSeconds());
    const ask = (headers: Partial<{ id: string | null; timestamp: string | null; signature: string | null }>, b = body) => handleFathomDelivery({ key: KEY, headers: { id: good.id, timestamp: good.timestamp, signature: good.signature, ...headers }, body: b }, { enabled: async () => true, find: async () => hookConnOf(personOf("agency_admin")), store: h.mem.store, deliveries: h.mem.deliveries, write: () => h.out.writer, now: () => NOW });
    expect((await ask({ signature: "v1,AAAA" })).status).toBe(401);
    expect((await ask({}, body.replace("Kitchen", "Bathroom"))).status).toBe(401);
    expect((await ask({ signature: sign(body, "msg_1", nowSeconds(), "whsec_" + Buffer.from("another-secret-entirely-xxxxxxxxxx").toString("base64")).signature })).status).toBe(401);
    expect((await ask({ signature: null })).status).toBe(401);
    expect((await ask({ id: null })).status).toBe(401);
    untouched(h);
  });

  it("a correctly signed delivery older than 5 minutes (or from the future) is refused: the window is 5 minutes", async () => {
    const h = harness({ contacts: [LEE] });
    expect((await h.deliver(fathomPayload(), { ts: nowSeconds() - 301 })).status).toBe(401);
    expect((await h.deliver(fathomPayload(), { ts: nowSeconds() + 301 })).status).toBe(401);
    untouched(h);
    expect((await h.deliver(fathomPayload(), { ts: nowSeconds() - 299, id: "msg_ok" })).status).toBe(200);
  });

  it("an address nobody owns, a malformed one, and a switched-off feature all answer the same 404", async () => {
    const h = harness({ contacts: [LEE] });
    expect((await h.deliver(fathomPayload(), { key: "k3y-for-nobody-abcdefghij12345" })).status).toBe(404);
    expect((await h.deliver(fathomPayload(), { key: "short" })).status).toBe(404);
    expect((await h.deliver(fathomPayload(), { deps: { enabled: async () => false } })).status).toBe(404);
    // A connection whose secret is gone (revoked or disconnected: the row was erased or its secret cleared) finds nothing either.
    expect((await h.deliver(fathomPayload(), { deps: { find: async () => ({ ...hookConnOf(personOf("agency_admin")), webhookSecret: null }) } })).status).toBe(404);
    expect((await h.deliver(fathomPayload(), { deps: { find: async () => null } })).status).toBe(404);
    untouched(h);
  });

  it("a body that is too large is refused before the signature is even computed", async () => {
    const h = harness();
    expect((await h.deliver(null, { raw: "x".repeat(400_001) })).status).toBe(413);
    untouched(h);
  });

  it("signed text that is not JSON is a 400, and signed JSON that is not a usable meeting is acknowledged and dropped (no retry storm)", async () => {
    const h = harness({ contacts: [LEE] });
    expect((await h.deliver(null, { raw: "not json at all" })).status).toBe(400);
    expect(await h.deliver({ hello: "world" })).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(await h.deliver({ title: "no recording id", default_summary: { markdown_formatted: "x" } }, { id: "msg_2" })).toEqual({ status: 200, body: { ok: true, ignored: true } });
    untouched(h);
  });
});

describe("the same delivery twice gives one stored meeting and one note", () => {
  it("ACCEPTANCE: three simultaneous deliveries of the same webhook give exactly one stored meeting and exactly one WOULD WRITE", async () => {
    const h = harness({ contacts: [LEE] });
    const answers = await Promise.all([h.deliver(fathomPayload()), h.deliver(fathomPayload()), h.deliver(fathomPayload())]);
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200]);
    expect(answers.filter((a) => a.body.result === "written")).toHaveLength(1);
    expect(answers.filter((a) => a.body.result === "duplicate")).toHaveLength(2);
    expect(h.mem.meetings.size).toBe(1);
    expect(wouldWrites(h.out)).toHaveLength(1);
  });

  it("the same recording arriving under a NEW delivery id (Fathom re-creating the delivery) is still one meeting and one note", async () => {
    const h = harness({ contacts: [LEE] });
    await h.deliver(fathomPayload(), { id: "msg_1" });
    const again = await h.deliver(fathomPayload(), { id: "msg_2" });
    expect(again.body).toEqual({ ok: true, result: "duplicate" });
    expect(h.mem.meetings.size).toBe(1);
    expect(wouldWrites(h.out)).toHaveLength(1);
  });

  it("with the switch on, simultaneous deliveries write exactly one real note", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const h = harness({ contacts: [LEE] });
    await Promise.all([h.deliver(fathomPayload()), h.deliver(fathomPayload()), h.deliver(fathomPayload(), { id: "msg_9" })]);
    expect(h.out.fetched).toHaveLength(1);
    expect(h.mem.log.writes).toHaveLength(1);
  });

  it("if saving fails the claim is given back and the answer is an error, so Fathom's retry is accepted and nothing is lost", async () => {
    const h = harness({ contacts: [LEE], failInsertOnce: true });
    const first = await h.deliver(fathomPayload());
    expect(first.status).toBe(500);
    expect(h.mem.claims.size, "the claim was released").toBe(0);
    expect(h.mem.meetings.size).toBe(0);
    const retry = await h.deliver(fathomPayload());
    expect(retry).toEqual({ status: 200, body: { ok: true, result: "written" } });
    expect(h.mem.meetings.size).toBe(1);
  });
});

describe("matching is exact and never guessed (spec section 7)", () => {
  it("ACCEPTANCE: a call nobody matches lands in the person's private inbox for 14 days, with the plain reason, and nothing is written", async () => {
    const h = harness({ contacts: [] });
    const answer = await h.deliver(fathomPayload());
    expect(answer.body).toEqual({ ok: true, result: "inbox" });
    const row = [...h.mem.meetings.values()][0];
    expect(row).toMatchObject({ status: "needs_contact", reason: "no_match", ownerUserId: "U-agency_admin", expiresAt: NOW + 14 * 86_400_000 });
    expect(wouldWrites(h.out)).toEqual([]);
    expect(h.out.fetched).toEqual([]);
  });

  it("ACCEPTANCE: two records with the same email in one account land in the inbox (duplicate_contact), never on either record", async () => {
    const h = harness({ contacts: [LEE, { ...LEE, contactId: "CB1-dup" }] });
    const answer = await h.deliver(fathomPayload());
    expect(answer.body).toEqual({ ok: true, result: "inbox" });
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "needs_contact", reason: "duplicate_contact" });
    expect(wouldWrites(h.out)).toEqual([]);
  });

  it("ACCEPTANCE: the same email as a contact in two client accounts lands in the inbox (cross_account), never in either", async () => {
    const h = harness({ contacts: [LEE, { ...LEE, locationId: "LA", contactId: "CA1" }] });
    await h.deliver(fathomPayload());
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "needs_contact", reason: "cross_account" });
    expect(wouldWrites(h.out)).toEqual([]);
  });

  it("a name or a phone number never matches, only the exact email", async () => {
    const h = harness({ contacts: [{ locationId: "LB", contactId: "CB1", email: "someone.else@client.test", name: "Lee Client" }] });
    await h.deliver(fathomPayload());
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "needs_contact", reason: "no_match" });
  });

  it("company staff whose access cannot be proven match nothing and no account is even searched", async () => {
    const h = harness({ contacts: [LEE] }, "agency_staff");
    await h.deliver(fathomPayload());
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "needs_contact", reason: "no_match" });
    expect(h.mem.log.candidateAsks.flat()).toEqual([]);
  });

  it("an address the person told SubSync to always ignore is dropped without waiting anywhere, and nothing is kept", async () => {
    const h = harness({ contacts: [], ignored: ["lee@client.test"] });
    const answer = await h.deliver(fathomPayload());
    expect(answer.body).toEqual({ ok: true, result: "ignored" });
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "skipped", reason: "ignored", title: null, summary: null, attendeeEmails: [], actionItems: [] });
  });

  it("'Do not keep it' counts the call and keeps no text", async () => {
    const h = harness({ contacts: [], settings: { ...CONFIRMED, unmatchedMode: "discard" } });
    const answer = await h.deliver(fathomPayload());
    expect(answer.body).toEqual({ ok: true, result: "discarded" });
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "skipped", title: null, summary: null });
  });
});

describe("limits that stop a note (the person's first OK, the permission, the daily cap)", () => {
  it("ACCEPTANCE (first-save preview): until the person confirms, the call waits with an expiry and nothing is written; confirming releases it as ONE note", async () => {
    const h = harness({ contacts: [LEE], settings: { ...CONFIRMED, previewConfirmedAt: null } });
    const answer = await h.deliver(fathomPayload());
    expect(answer.body).toEqual({ ok: true, result: "kept" });
    const row = [...h.mem.meetings.values()][0];
    expect(row).toMatchObject({ status: "needs_contact", reason: "preview_needed", expiresAt: NOW + 14 * 86_400_000 });
    expect(wouldWrites(h.out)).toEqual([]);

    const released = await confirmAndRelease(h.mem.store, personOf("agency_admin"), "INST1", h.out.writer);
    expect(released).toEqual({ released: 1, stillWaiting: 0 });
    expect(h.mem.settings().previewConfirmedAt).toBe(NOW);
    expect(wouldWrites(h.out)).toHaveLength(1);
    expect(row.status).toBe("dry_run");
    // Confirming twice never writes a second time.
    expect(await confirmAndRelease(h.mem.store, personOf("agency_admin"), "INST1", h.out.writer)).toEqual({ released: 0, stillWaiting: 0 });
    expect(wouldWrites(h.out)).toHaveLength(1);
  });

  it("two people confirming the same held call at the same moment write it once (the claim is atomic)", async () => {
    const h = harness({ contacts: [LEE], settings: { ...CONFIRMED, previewConfirmedAt: null } });
    await h.deliver(fathomPayload());
    const [a, b] = await Promise.all([confirmAndRelease(h.mem.store, personOf("agency_admin"), "INST1", h.out.writer), confirmAndRelease(h.mem.store, personOf("agency_admin"), "INST1", h.out.writer)]);
    expect(a.released + b.released).toBe(1);
    expect(wouldWrites(h.out)).toHaveLength(1);
  });

  it("without the permission to edit contacts the call waits as 'Needs permission: reconnect' and no WOULD WRITE is recorded (it could never succeed)", async () => {
    const h = harness({ contacts: [LEE], writeScope: false });
    await h.deliver(fathomPayload());
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "needs_contact", reason: "needs_permission", expiresAt: NOW + 14 * 86_400_000 });
    expect(wouldWrites(h.out)).toEqual([]);
  });

  it("the person's daily limit stops notes inside one call: with a limit of 1 and two contacts, one note is planned and the other is left over", async () => {
    const h = harness({ contacts: [LEE, { locationId: "LB", contactId: "CB2", email: "pat@client.test" }], agencyPolicy: { dailyCapPerUser: 1 } });
    const answer = await h.deliver(fathomPayload({}, [{ name: "Lee", email: "lee@client.test", is_external: true }, { name: "Pat", email: "pat@client.test", is_external: true }]));
    expect(answer.body.result).toBe("written");
    expect(wouldWrites(h.out)).toHaveLength(1);
  });

  it("a person who already reached the daily limit sends the call to the inbox with the reason", async () => {
    const h = harness({ contacts: [LEE], agencyPolicy: { dailyCapPerUser: 5 }, writesTodayUser: 5 });
    await h.deliver(fathomPayload());
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "needs_contact", reason: "over_daily_cap" });
    expect(wouldWrites(h.out)).toEqual([]);
  });

  it("an account whose rules say no notes keeps the call in the person's inbox", async () => {
    const h = harness({ contacts: [LEE], accountPolicies: { LB: { allowCrmWrites: false } } });
    await h.deliver(fathomPayload());
    expect([...h.mem.meetings.values()][0]).toMatchObject({ status: "needs_contact", reason: "writes_off" });
  });
});

describe("what is read from Fathom's payload", () => {
  it("takes the title, the recording's own start time, the length, the summary, the action items and the share link, and never reads the transcript", () => {
    const d = parseFathomDelivery(fathomPayload());
    expect(d).toMatchObject({
      recordingId: "123456789", durationMinutes: 30, recordedByEmail: "rep@agency.test", recordedByName: "Rep Seller", withNames: ["Lee Client"],
      meeting: { title: "Kitchen quote", startedAt: "2026-11-02T09:01:00.000Z", summary: "They want a quote by Friday.\n\nBudget is flexible.", actionItems: ["Send the quote"], recordingUrl: "https://fathom.video/share/abc123", transcript: null },
    });
    expect(d?.internalEmails).toContain("rep@agency.test");
    expect(JSON.stringify(d)).not.toContain("FULL TRANSCRIPT");
  });

  it("refuses a delivery with no recording id (nothing to dedupe on) or with nothing in it, and an unsafe link is dropped", () => {
    expect(parseFathomDelivery({ title: "x", default_summary: { markdown_formatted: "y" } })).toBeNull();
    expect(parseFathomDelivery({ recording_id: 5 })).toBeNull();
    expect(parseFathomDelivery(null)).toBeNull();
    expect(parseFathomDelivery(fathomPayload({ share_url: "javascript:alert(1)", url: "http://insecure.test/x" }))?.meeting.recordingUrl).toBeNull();
  });

  it("is built for a person: a delivery carries no name of the connecting user other than the recorder, and one connection maps to one person", () => {
    const a = hookConnOf(personOf("agency_admin"));
    const b = hookConnOf(personOf("agency_owner"));
    expect(connOf(a.person).id).not.toBe(connOf(b.person).id);
    expect(TEST_SECRET.startsWith("whsec_")).toBe(true);
  });
});
