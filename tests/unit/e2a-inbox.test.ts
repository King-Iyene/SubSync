import { afterEach, describe, expect, it, vi } from "vitest";
import { alwaysIgnore, daysLeft, dismissMeeting, findContacts, kindOf, linkMeeting, messageFor, outcomeWords, previewFor } from "@/lib/connections/inbox";
import { ingestPersonalMeeting } from "@/lib/connections/ingest";
import { parseFathomDelivery } from "@/lib/connections/fathom";
import { matrixFor } from "@/lib/connections/policy";
import { INBOX_MESSAGE } from "@/lib/connections/meeting-plan";
import { decideRemoval, MAX_REMOVAL_SHARE } from "@/lib/connections/maintenance";
import { connOf, crm, fathomPayload, memStore, NOW, personOf, CONFIRMED } from "./e2a-support";

// Stage E2a item 5: the private Meeting inbox (Link, Dismiss, Always ignore), against an in-memory stand-in for the database and a fake CRM transport.

afterEach(() => vi.unstubAllEnvs());

const LEE = { locationId: "LB", contactId: "CB1", email: "lee@client.test", name: "Lee Client" };
const PAT = { locationId: "LA", contactId: "CA9", email: "pat@other.test", name: "Pat Other" };
const DAY = 86_400_000;

/** A call that nobody matched, already waiting in the inbox of the given person. */
async function waiting(over: Parameters<typeof memStore>[0] = {}, role: Parameters<typeof personOf>[0] = "agency_admin") {
  const mem = memStore({ contacts: [LEE, PAT], ...over });
  const out = crm();
  const person = personOf(role);
  const conn = connOf(person);
  mem.connection.conn = conn;
  const d = parseFathomDelivery(fathomPayload({}, [{ name: "Stranger", email: "stranger@nowhere.test", is_external: true }]))!;
  const result = await ingestPersonalMeeting(conn, d.meeting, d.recordingId, { ...mem.store, candidates: async () => [] }, out.writer, { internalEmails: d.internalEmails, withNames: d.withNames, rep: d.recordedByName });
  if (result.kind !== "inbox") throw new Error("expected the call to wait in the inbox");
  return { mem, out, person, conn, id: result.meetingId };
}

describe("Link: the person picks the account and the contact, and SubSync checks the pick again", () => {
  it("ACCEPTANCE: linking a waiting call writes the note to THAT contact, as the person, and the call is handled (dry run: one WOULD WRITE, nothing sent)", async () => {
    const w = await waiting();
    const r = await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LB", contactId: "CB1" }, w.out.writer);
    expect(r).toEqual({ ok: true, dryRun: true, notes: 0 });
    expect(w.out.fetched).toEqual([]);
    expect(w.out.audit.filter((a) => a.action === "dry_run.would_write")).toHaveLength(1);
    expect(w.out.audit[0].detail).toMatchObject({ ids: { locationId: "LB", contactId: "CB1", meetingId: w.id } });
    expect(w.mem.meetings.get(w.id)).toMatchObject({ status: "dry_run", reason: "WOULD WRITE" });
    expect(w.mem.meetings.get(w.id)?.expiresAt).toBeNull();
  });

  it("with the switch on the note goes to the picked contact and is logged with the id the CRM gave it", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const w = await waiting();
    const r = await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LB", contactId: "CB1" }, w.out.writer);
    expect(r).toEqual({ ok: true, dryRun: false, notes: 1 });
    expect(w.out.fetched).toHaveLength(1);
    expect(w.out.fetched[0].url).toBe("https://services.leadconnectorhq.com/contacts/CB1/notes");
    expect(w.out.fetched[0].body.userId).toBe(w.person.userId);
    expect(String(w.out.fetched[0].body.body)).toContain("Recorded by: Rep Seller, with Fathom");
    expect(w.mem.log.writes).toEqual([{ installationId: "INST1", meetingId: w.id, locationId: "LB", contactId: "CB1", kind: "note", ghlId: "NOTE1abc", authoredBy: w.person.userId }]);
    expect(w.mem.meetings.get(w.id)?.status).toBe("saved");
  });

  it("a client's staff member can never link into another account, and an invented contact id finds nothing: no request, the call keeps waiting", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const w = await waiting({}, "account_user");
    const other = await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LB", contactId: "CB1" }, w.out.writer);
    expect(other).toMatchObject({ ok: false, code: "not_found" });
    const invented = await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LA", contactId: "NOPE" }, w.out.writer);
    expect(invented).toMatchObject({ ok: false, code: "not_found" });
    expect(w.out.fetched).toEqual([]);
    expect(w.mem.meetings.get(w.id)?.status).toBe("needs_contact");
    // Their own account works.
    expect(await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LA", contactId: "CA9" }, w.out.writer)).toMatchObject({ ok: true });
  });

  it("another person can never link, dismiss or ignore someone else's call, whatever id they send", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const w = await waiting();
    const intruder = personOf("agency_owner");
    expect(await linkMeeting(w.mem.store, intruder, "INST1", w.id, { locationId: "LB", contactId: "CB1" }, w.out.writer)).toMatchObject({ ok: false, code: "not_found" });
    expect(await dismissMeeting(w.mem.store, intruder, "INST1", w.id)).toBe(false);
    expect(await alwaysIgnore(w.mem.store, intruder, "INST1", w.id, "stranger@nowhere.test")).toBe(false);
    expect(await w.mem.store.listWaiting("INST1", intruder.userId)).toEqual([]);
    expect(await linkMeeting(w.mem.store, w.person, "OTHER-INSTALL", w.id, { locationId: "LB", contactId: "CB1" }, w.out.writer)).toMatchObject({ ok: false, code: "not_found" });
    expect(w.out.fetched).toEqual([]);
    expect(w.mem.meetings.get(w.id)?.status).toBe("needs_contact");
  });

  it("the account's rules and the permission apply to a link exactly as to an automatic note", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const closed = await waiting({ accountPolicies: { LB: { allowCrmWrites: false } } });
    expect(await linkMeeting(closed.mem.store, closed.person, "INST1", closed.id, { locationId: "LB", contactId: "CB1" }, closed.out.writer)).toMatchObject({ ok: false, code: "not_allowed", message: INBOX_MESSAGE.writes_off });
    const noScope = await waiting({ writeScope: false });
    expect(await linkMeeting(noScope.mem.store, noScope.person, "INST1", noScope.id, { locationId: "LB", contactId: "CB1" }, noScope.out.writer)).toMatchObject({ ok: false, code: "needs_permission" });
    const capped = await waiting({ writesTodayUser: 50 });
    expect(await linkMeeting(capped.mem.store, capped.person, "INST1", capped.id, { locationId: "LB", contactId: "CB1" }, capped.out.writer)).toMatchObject({ ok: false, code: "not_allowed" });
    expect([closed, noScope, capped].every((x) => x.out.fetched.length === 0)).toBe(true);
  });

  it("a CRM that refuses leaves the call waiting and says so; the permission refusal is 'Needs permission: reconnect'", async () => {
    vi.stubEnv("WRITE_GHL_LIVE", "true");
    const w = await waiting();
    const refuse = crm({ respond: () => new Response("{}", { status: 403 }) });
    const r = await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LB", contactId: "CB1" }, refuse.writer);
    expect(r).toMatchObject({ ok: false, code: "needs_permission" });
    expect(w.mem.meetings.get(w.id)?.status).toBe("needs_contact");
    const broken = crm({ respond: () => new Response("{}", { status: 422 }) });
    expect(await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LB", contactId: "CB1" }, broken.writer)).toMatchObject({ ok: false, code: "write_failed" });
    expect(w.mem.meetings.get(w.id)?.status).toBe("needs_contact");
    expect(w.mem.log.writes).toEqual([]);
  });

  it("a call that waits for the person's first OK cannot be linked (confirm first), and a handled call cannot be linked twice", async () => {
    const held = await waiting({ settings: { ...CONFIRMED, previewConfirmedAt: null }, contacts: [LEE] });
    // That call matched nothing, so it is an ordinary inbox call; make a real held one from a matching call.
    const mem = held.mem;
    const d = parseFathomDelivery(fathomPayload({ recording_id: 777 }))!;
    const kept = await ingestPersonalMeeting(held.conn, d.meeting, d.recordingId, mem.store, held.out.writer, {});
    expect(kept).toMatchObject({ kind: "kept" });
    const id = (kept as { meetingId: string }).meetingId;
    expect(await linkMeeting(mem.store, held.person, "INST1", id, { locationId: "LB", contactId: "CB1" }, held.out.writer)).toMatchObject({ ok: false, code: "confirm_first" });

    const w = await waiting();
    expect(await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LB", contactId: "CB1" }, w.out.writer)).toMatchObject({ ok: true });
    expect(await linkMeeting(w.mem.store, w.person, "INST1", w.id, { locationId: "LB", contactId: "CB1" }, w.out.writer)).toMatchObject({ ok: false, code: "not_found" });
    expect(w.out.audit.filter((a) => a.action === "dry_run.would_write")).toHaveLength(1);
  });
});

describe("Dismiss and Always ignore", () => {
  it("Dismiss removes the call's text and keeps only its identity, so a later delivery of the same call is still recognised", async () => {
    const w = await waiting();
    expect(await dismissMeeting(w.mem.store, w.person, "INST1", w.id)).toBe(true);
    expect(w.mem.meetings.get(w.id)).toMatchObject({ status: "skipped", reason: "dismissed", title: null, summary: null, attendeeEmails: [], actionItems: [], recordingUrl: null, expiresAt: null });
    expect(await dismissMeeting(w.mem.store, w.person, "INST1", w.id)).toBe(false);
    const again = parseFathomDelivery(fathomPayload({}, [{ name: "Stranger", email: "stranger@nowhere.test", is_external: true }]))!;
    expect(await ingestPersonalMeeting(w.conn, again.meeting, again.recordingId, w.mem.store, w.out.writer, {})).toEqual({ kind: "duplicate" });
  });

  it("Always ignore accepts only one of the call's own attendees, dismisses the call, and the next call with only that person is dropped quietly", async () => {
    const w = await waiting();
    expect(await alwaysIgnore(w.mem.store, w.person, "INST1", w.id, "someone.not.on.the.call@x.test")).toBe(false);
    expect(w.mem.ignored.size).toBe(0);
    expect(await alwaysIgnore(w.mem.store, w.person, "INST1", w.id, " Stranger@Nowhere.test ")).toBe(true);
    expect([...w.mem.ignored]).toEqual(["stranger@nowhere.test"]);
    expect(w.mem.meetings.get(w.id)).toMatchObject({ status: "skipped", reason: "ignored" });
    const next = parseFathomDelivery(fathomPayload({ recording_id: 4242 }, [{ name: "Stranger", email: "stranger@nowhere.test", is_external: true }]))!;
    const result = await ingestPersonalMeeting(w.conn, next.meeting, next.recordingId, w.mem.store, w.out.writer, { internalEmails: next.internalEmails });
    expect(result.kind).toBe("ignored");
    expect(await w.mem.store.listWaiting("INST1", w.person.userId)).toEqual([]);
  });
});

describe("the contact search only ever looks inside the accounts the person can open", () => {
  it("an agency admin searches every account of the company; a client's staff member only their own, and cannot ask for another", async () => {
    const admin = await waiting();
    const hits = await findContacts(admin.mem.store, admin.person, "INST1", "lee", null);
    expect(hits.map((h) => h.contactId)).toEqual(["CB1"]);
    expect(admin.mem.log.searches.at(-1)?.sort()).toEqual(["LA", "LB"]);

    const staff = await waiting({}, "account_user");
    expect(await findContacts(staff.mem.store, staff.person, "INST1", "lee", null)).toEqual([]);
    expect(staff.mem.log.searches.at(-1)).toEqual(["LA"]);
    expect(await findContacts(staff.mem.store, staff.person, "INST1", "lee", "LB"), "asking for another account finds nothing and searches nothing").toEqual([]);
    expect(staff.mem.log.searches).toHaveLength(1);
  });

  it("a search of less than two characters returns nothing and asks nothing", async () => {
    const w = await waiting();
    const before = w.mem.log.searches.length;
    expect(await findContacts(w.mem.store, w.person, "INST1", " a ", null)).toEqual([]);
    expect(w.mem.log.searches).toHaveLength(before);
  });
});

describe("the words a person reads", () => {
  it("every reason has a plain sentence, and the three kinds of waiting call are told apart", () => {
    for (const reason of ["no_match", "duplicate_contact", "cross_account", "writes_off", "over_daily_cap", "needs_permission", "preview_needed"]) expect(messageFor(reason).length).toBeGreaterThan(20);
    expect(messageFor("needs_permission")).toContain("Needs permission: reconnect");
    expect(messageFor("no_match")).toBe("Nobody in this meeting is in your contacts. It is in your Meeting inbox for 14 days.");
    expect(messageFor("no_match", 7)).toContain("7 days");
    expect(messageFor("something_new")).toContain("waits here");
    expect(kindOf("preview_needed")).toBe("held");
    expect(kindOf("needs_permission")).toBe("permission");
    expect(kindOf("no_match")).toBe("unmatched");
    expect(kindOf("releasing")).toBe("unmatched");
  });

  it("a handled call always says what happened, and when nothing was saved it says exactly why", () => {
    expect(outcomeWords("saved", null, 2)).toBe("Added to 2 contacts in your CRM.");
    expect(outcomeWords("saved", null, 1)).toBe("Added to the contact in your CRM.");
    expect(outcomeWords("dry_run", "WOULD WRITE", 0)).toContain("wrote nothing");
    expect(outcomeWords("failed", "write_failed", 0)).toContain("Nothing was saved");
    expect(outcomeWords("skipped", "dismissed", 0)).toContain("You dismissed");
    expect(outcomeWords("skipped", "ignored", 0)).toContain("always ignore");
    expect(outcomeWords("skipped", "no_match", 0)).toContain("Nothing was saved: nobody on this call matched");
    for (const status of ["saved", "dry_run", "failed", "skipped"]) expect(outcomeWords(status, null, 0)).not.toMatch(/GoHighLevel|HighLevel|GHL|sub-account|location/i);
  });

  it("days left counts up to the expiry and never goes negative", () => {
    expect(daysLeft(NOW + 14 * DAY, NOW)).toBe(14);
    expect(daysLeft(NOW + 1, NOW)).toBe(1);
    expect(daysLeft(NOW - DAY, NOW)).toBe(0);
    expect(daysLeft(null, NOW)).toBeNull();
  });

  it("the first-save preview shows the person's own latest call as it will be written, or a clearly marked sample", async () => {
    const sample = previewFor(null, personOf("agency_admin"), matrixFor("recommended", null));
    expect(sample.sample).toBe(true);
    expect(sample.text).toContain("Sample: quote call");
    const held = memStore({ contacts: [LEE], settings: { ...CONFIRMED, previewConfirmedAt: null } });
    const conn = connOf(personOf("agency_admin"));
    held.connection.conn = conn;
    const d = parseFathomDelivery(fathomPayload())!;
    await ingestPersonalMeeting(conn, d.meeting, d.recordingId, held.store, crm().writer, { rep: d.recordedByName, withNames: d.withNames, durationMinutes: d.durationMinutes });
    const [row] = await held.store.listWaiting("INST1", conn.person.userId);
    const real = previewFor(row, conn.person, matrixFor("recommended", null));
    expect(real.sample).toBe(false);
    expect(real.text).toContain("Meeting: Kitchen quote");
    expect(real.text).toContain("Added by SubSync from Fathom.");
    // "Summary only" leaves out the action items and the recording link.
    const short = previewFor(row, conn.person, matrixFor("summary_only", null));
    expect(short.text).not.toContain("Action items");
    expect(short.text).not.toContain("Recording:");
    expect(short.text).toContain("Summary");
  });
});

describe("a person who left the CRM: the list is only used when it looks complete (E0's removeDeactivatedPeople, wired in E2a)", () => {
  it("an empty list never removes anyone", () => {
    expect(decideRemoval(["a", "b", "c"], [])).toEqual({ act: false, reason: "empty_list" });
  });
  it("a list that would remove most people at once is treated as a bad read", () => {
    expect(MAX_REMOVAL_SHARE).toBe(0.5);
    expect(decideRemoval(["a", "b", "c", "d"], ["a"])).toEqual({ act: false, reason: "would_remove_most" });
    expect(decideRemoval(["a", "b", "c", "d"], ["a", "b"])).toEqual({ act: true, ids: ["a", "b"] });
  });
  it("with only one or two people known, one leaving is allowed", () => {
    expect(decideRemoval(["a", "b"], ["a"])).toEqual({ act: true, ids: ["a"] });
    expect(decideRemoval(["a"], ["z"])).toEqual({ act: true, ids: ["z"] });
  });
});
