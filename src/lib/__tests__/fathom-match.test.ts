import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseFathomDelivery } from "../connections/fathom.ts";
import { findContacts, suggestionsFor, type InboxStore, type StoredMeeting } from "../connections/inbox.ts";
import type { MeetingRow, PersonalConnection, PersonSettings, SimilarHit, Writer } from "../connections/ingest.ts";
import { normEmail, plainReason, plusBase, plusSearch, suggest, usableNames, type Hit } from "../connections/match-suggest.ts";
import { planMeeting, type Candidate, type PlanInput } from "../connections/meeting-plan.ts";
import { type Person } from "../connections/person.ts";
import { DEFAULT_POLICY } from "../connections/policy.ts";
import { rematchWaiting } from "../connections/rematch.ts";

// Fathom auto-matching (CLAUDE.md principles 12, 13, 14). Pure and in-memory: no database, no network. A call is added to a contact only when exactly ONE contact in an
// account the person can open has an attendee's exact email; everything else is a suggestion the person confirms.

const person = (role: Person["role"], over: Partial<Person> = {}): Person => ({ companyKey: "CO1", userId: `U-${role}`, name: "Rep", role, kind: role.startsWith("agency") ? "agency" : "client", homeLocationId: role.startsWith("agency") ? null : "LA", ...over });
const planInput = (over: Partial<PlanInput> = {}): PlanInput => ({
  person: person("agency_admin"), provider: "fathom", installed: [{ locationId: "LA" }, { locationId: "LB" }], provenAccess: null, attendeeEmails: ["lee@client.test"], internalEmails: ["rep@agency.test"], internalDomains: [],
  candidates: [], policies: { LA: DEFAULT_POLICY, LB: DEFAULT_POLICY }, settings: { masterSwitch: true, unmatchedMode: "inbox", matrix: { summary: "note", action_items: "note", recording_link: "note", attendees_and_date: "note", transcript: "off" } as never },
  writesToday: { user: 0, byAccount: {} }, ...over,
});
const cand = (locationId: string, contactId: string, email: string): Candidate => ({ locationId, contactId, email });

test("emails are compared the one way: trimmed, lower case, no mailto", () => {
  assert.equal(normEmail("  Lee@Client.TEST "), "lee@client.test");
  assert.equal(normEmail("mailto:Lee@Client.test"), "lee@client.test");
  assert.equal(normEmail("<Lee@Client.test>"), "lee@client.test");
  assert.equal(plusBase("Ada+crm@X.com"), "ada@x.com");
  assert.equal(plusBase("ada@x.com"), null);
});

test("certain: one exact email on one contact, in any letter case", () => {
  const plan = planMeeting(planInput({ attendeeEmails: ["LEE@Client.test "], candidates: [cand("LA", "C1", "lee@client.test")] }));
  assert.equal(plan.kind, "write");
  assert.deepEqual(plan.kind === "write" && plan.targets.map((t) => `${t.locationId}:${t.contactId}`), ["LA:C1"]);
});

test("every outside attendee is looked at, not only the first", () => {
  const plan = planMeeting(planInput({ attendeeEmails: ["first@nowhere.test", "second@client.test"], candidates: [cand("LB", "C2", "second@client.test")] }));
  assert.equal(plan.kind, "write");
  assert.deepEqual(plan.kind === "write" && plan.targets.map((t) => t.contactId), ["C2"]);
});

test("ambiguous: the same email in two accounts, or on two contacts, is never decided", () => {
  const cross = planMeeting(planInput({ candidates: [cand("LA", "C1", "lee@client.test"), cand("LB", "C9", "lee@client.test")] }));
  assert.deepEqual([cross.kind, cross.kind === "inbox" && cross.reason], ["inbox", "cross_account"]);
  const dupe = planMeeting(planInput({ candidates: [cand("LA", "C1", "lee@client.test"), cand("LA", "C2", "lee@client.test")] }));
  assert.deepEqual([dupe.kind, dupe.kind === "inbox" && dupe.reason], ["inbox", "duplicate_contact"]);
});

test("a plus tag is only ever a suggestion: ada+crm@x.com does not match a contact saved as ada@x.com", () => {
  const plan = planMeeting(planInput({ attendeeEmails: ["ada+crm@x.com"], candidates: [] }));
  assert.deepEqual([plan.kind, plan.kind === "inbox" && plan.reason], ["inbox", "no_match"]);
  const s = suggest({ emails: ["ada+crm@x.com"], names: [], reachable: ["LA"], hits: [{ locationId: "LA", contactId: "C5", email: "ada@x.com", name: "Ada L", lastActivityAt: null, via: "plus" }] });
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, "plus_tag");
  const reverse = suggest({ emails: ["ada@x.com"], names: [], reachable: ["LA"], hits: [{ locationId: "LA", contactId: "C6", email: "ada+old@x.com", name: null, lastActivityAt: null, via: "plus" }] });
  assert.equal(reverse[0]?.kind, "plus_tag");
  const search = plusSearch(["ada+crm@x.com", "bob@y.com"]);
  assert.deepEqual(search.bases, ["ada@x.com"]);
  assert.ok(search.patterns.includes("ada+%@x.com") && search.patterns.includes("bob+%@y.com"));
});

test("no outside attendee, and no email at all, are different reasons with plain words", () => {
  const mine = planMeeting(planInput({ attendeeEmails: ["rep@agency.test"] }));
  assert.deepEqual([mine.kind, mine.kind === "inbox" && mine.reason], ["inbox", "no_external_attendee"]);
  const none = planMeeting(planInput({ attendeeEmails: [] }));
  assert.deepEqual([none.kind, none.kind === "inbox" && none.reason], ["inbox", "no_attendee_emails"]);
  assert.match(plainReason("no_attendee_emails", 0, 0), /did not send anyone's email/);
  assert.match(plainReason("no_match", 2, 0), /None of the attendees' emails is in your CRM yet/);
  assert.match(plainReason("no_match", 1, 0), /attendee's email is not in your CRM yet/);
  assert.match(plainReason("no_match", 1, 2), /may be them/);
});

test("a contact in an account the person cannot open is never matched, even when it is the only one", () => {
  const staff = person("agency_staff");
  const noAccess = planMeeting(planInput({ person: staff, provenAccess: null, candidates: [cand("LA", "C1", "lee@client.test")] }));
  assert.equal(noAccess.kind, "inbox");
  const oneAccount = planMeeting(planInput({ person: staff, provenAccess: ["LA"], candidates: [cand("LA", "C1", "lee@client.test"), cand("LB", "C9", "lee@client.test")] }));
  // LB is not theirs, so the LB contact is not even looked at: one reachable record is certain, and it is the LA one.
  assert.deepEqual(oneAccount.kind === "write" && oneAccount.targets.map((t) => `${t.locationId}:${t.contactId}`), ["LA:C1"]);
  const otherSide = planMeeting(planInput({ person: staff, provenAccess: ["LA"], candidates: [cand("LB", "C9", "lee@client.test")] }));
  assert.equal(otherSide.kind, "inbox");
});

test("a held write still says who the call was matched to", () => {
  const off = planMeeting(planInput({ candidates: [cand("LA", "C1", "lee@client.test")], policies: { LA: { ...DEFAULT_POLICY, allowCrmWrites: false }, LB: DEFAULT_POLICY } }));
  assert.equal(off.kind, "inbox");
  assert.deepEqual(off.kind === "inbox" && off.matched?.map((c) => c.contactId), ["C1"]);
});

test("possible matches: several contacts with one email, same full name; unreachable accounts and lone emails are left out", () => {
  const hits: Hit[] = [
    { locationId: "LA", contactId: "C1", email: "lee@client.test", name: "Lee Client", lastActivityAt: "2026-11-10T10:00:00.000Z", via: "exact" },
    { locationId: "LB", contactId: "C2", email: "lee@client.test", name: "Lee Client", lastActivityAt: null, via: "exact" },
    { locationId: "LC", contactId: "C3", email: "lee@client.test", name: "Lee Client", lastActivityAt: null, via: "exact" },
    { locationId: "LA", contactId: "C4", email: "other@client.test", name: "Pat Person", lastActivityAt: null, via: "exact" },
    { locationId: "LA", contactId: "C5", email: "pat@else.test", name: "Pat Person", lastActivityAt: null, via: "name" },
  ];
  const s = suggest({ emails: ["lee@client.test", "other@client.test"], names: ["Pat Person"], hits, reachable: ["LA", "LB"] });
  assert.deepEqual(s.map((x) => `${x.kind}:${x.locationId}:${x.contactId}`), ["same_email:LA:C1", "same_email:LB:C2", "same_name:LA:C5"]);
  assert.deepEqual(usableNames(["Pat", "Pat Person", "a@b.com", "100% sure"]), ["Pat Person"]);
});

// ---- a small in-memory store for the rematch, the suggestions and the search ----
type Row = MeetingRow & { id: string };
function memory(over: { contacts?: Array<Candidate & { name?: string }>; accounts?: string[]; settings?: Partial<PersonSettings>; policies?: Record<string, unknown> } = {}) {
  const contacts = over.contacts ?? [];
  const meetings = new Map<string, Row>();
  const claims = new Set<string>();
  const log = { writes: [] as Array<{ locationId: string; contactId: string; meetingId: string }>, searched: [] as string[][], candidateAsks: [] as string[][] };
  const settings: PersonSettings = { masterSwitch: true, unmatchedMode: "inbox", preset: "recommended", custom: null, previewConfirmedAt: 1, ...over.settings };
  const asStored = (m: Row): StoredMeeting => ({
    id: m.id, ownerUserId: m.ownerUserId, connectionId: m.connectionId, installationId: m.installationId, provider: "fathom", title: m.title, startedAt: m.startedAt, attendeeEmails: m.attendeeEmails, summary: m.summary,
    actionItems: m.actionItems, recordingUrl: m.recordingUrl, status: m.status, reason: m.reason, expiresAt: m.expiresAt, createdAt: 0,
  });
  const store: InboxStore = {
    now: () => Date.parse("2026-11-13T10:00:00Z"),
    installed: async () => (over.accounts ?? ["LA", "LB"]).map((locationId) => ({ locationId })),
    provenAccess: async () => null,
    candidates: async (_i, ids, emails) => { log.candidateAsks.push([...ids]); return contacts.filter((c) => ids.includes(c.locationId) && emails.map(normEmail).includes(normEmail(c.email))); },
    policies: async () => ({ agency: null, accounts: (over.policies ?? {}) as Record<string, unknown> }),
    settings: async () => settings,
    writesToday: async () => ({ user: 0, byAccount: {} }),
    insertMeeting: async (row) => { const id = `M${meetings.size + 1}`; meetings.set(id, { ...row, id }); return id; },
    updateMeeting: async (id, status, reason, expiresAt) => { const m = meetings.get(id); if (m) { m.status = status; m.reason = reason; if (expiresAt !== undefined) m.expiresAt = expiresAt; } },
    recordWrite: async (r) => { log.writes.push({ locationId: r.locationId, contactId: r.contactId, meetingId: r.meetingId }); return true; },
    bump: async () => undefined,
    hasWriteScope: async () => true,
    claimPart: async (r) => { const k = `${r.meetingId}|${r.contactId}|${r.kind}|${r.partNo}`; if (claims.has(k)) return false; claims.add(k); return true; },
    finishPart: async (r, ghlId) => { log.writes.push({ locationId: r.locationId, contactId: r.contactId, meetingId: r.meetingId }); void ghlId; },
    releasePart: async (r) => { claims.delete(`${r.meetingId}|${r.contactId}|${r.kind}|${r.partNo}`); },
    noteDetails: async () => undefined,
    claimWaiting: async (inst, user, id, from) => { const m = meetings.get(id); if (!m || m.installationId !== inst || m.ownerUserId !== user || m.status !== "needs_contact" || m.reason !== from) return false; m.reason = "rematching"; return true; },
    similarContacts: async (_i, ids, q): Promise<SimilarHit[]> => contacts.filter((c) => ids.includes(c.locationId) && q.emails.map(normEmail).includes(normEmail(c.email))).map((c) => ({ locationId: c.locationId, contactId: c.contactId, email: normEmail(c.email), name: c.name ?? null, lastActivityAt: null, via: "exact" as const })),
    getMeeting: async (inst, user, id) => { const m = meetings.get(id); return m && m.installationId === inst && m.ownerUserId === user ? asStored(m) : null; },
    listWaiting: async (inst, user) => [...meetings.values()].filter((m) => m.installationId === inst && m.ownerUserId === user && m.status === "needs_contact").map(asStored),
    contactIn: async () => null,
    searchContacts: async (_i, ids) => { log.searched.push([...ids]); return []; },
    scrub: async () => false, addIgnored: async () => undefined, claimHeld: async () => false, confirmPreview: async () => undefined, getConnection: async () => null,
  };
  return { store, meetings, log };
}
const waiting = (mem: ReturnType<typeof memory>, who: Person, emails: string[], reason = "no_match", id = "x") => {
  const row: Row = { id, installationId: "INST1", ownerUserId: who.userId, connectionId: `CONN-${who.userId}`, provider: "fathom", providerMeetingId: id, startedAt: "2026-11-12T10:00:00.000Z", title: "Call", attendeeEmails: emails, summary: "They want a quote.", actionItems: ["Send the quote"], recordingUrl: null, status: "needs_contact", reason, expiresAt: null };
  mem.meetings.set(row.id, row);
  return row;
};
const connOf = (p: Person): PersonalConnection => ({ id: `CONN-${p.userId}`, installationId: "INST1", provider: "fathom", person: p, accountEmail: "rep@agency.test" });
const okWriter: Writer = async () => ({ outcome: "written", id: "NOTE1" });

test("rematch: a waiting call whose contact now exists is added once, and a second pass (or two at once) writes nothing more", async () => {
  process.env.WRITE_GHL_LIVE = "true";
  try {
    const who = person("agency_admin");
    const mem = memory({ contacts: [{ locationId: "LA", contactId: "C1", email: "Lee@Client.test", name: "Lee" }] });
    waiting(mem, who, ["lee@client.test"], "no_match", "M-a");
    const [one, two] = await Promise.all([rematchWaiting(mem.store, connOf(who), okWriter), rematchWaiting(mem.store, connOf(who), okWriter)]);
    assert.equal(one.added + two.added, 1, "exactly one of two simultaneous passes won the call");
    assert.equal(mem.meetings.get("M-a")?.status, "saved");
    const writes = mem.log.writes.length;
    assert.ok(writes >= 1);
    const again = await rematchWaiting(mem.store, connOf(who), okWriter);
    assert.deepEqual(again, { checked: 0, added: 0, matchedWaiting: 0, unchanged: 0 });
    assert.equal(mem.log.writes.length, writes, "nothing new was written");
    assert.ok(mem.log.writes.every((w) => w.contactId === "C1" && w.locationId === "LA"));
  } finally { delete process.env.WRITE_GHL_LIVE; }
});

test("rematch never decides an ambiguous call, and never reaches an account the person cannot open", async () => {
  process.env.WRITE_GHL_LIVE = "true";
  try {
    const who = person("agency_admin");
    const ambiguous = memory({ contacts: [{ locationId: "LA", contactId: "C1", email: "lee@client.test" }, { locationId: "LB", contactId: "C2", email: "lee@client.test" }] });
    waiting(ambiguous, who, ["lee@client.test"], "no_match", "M-b");
    const r = await rematchWaiting(ambiguous.store, connOf(who), okWriter);
    assert.equal(r.added, 0);
    assert.equal(ambiguous.meetings.get("M-b")?.status, "needs_contact");
    assert.equal(ambiguous.meetings.get("M-b")?.reason, "cross_account");
    assert.equal(ambiguous.log.writes.length, 0);

    // A client user may only ever use their own account: the other client's contact is never asked about.
    const client = person("account_user", { homeLocationId: "LA" });
    const other = memory({ contacts: [{ locationId: "LB", contactId: "C9", email: "lee@client.test" }] });
    waiting(other, client, ["lee@client.test"], "no_match", "M-c");
    const o = await rematchWaiting(other.store, connOf(client), okWriter);
    assert.equal(o.added, 0);
    assert.ok(other.log.candidateAsks.every((ids) => ids.length === 1 && ids[0] === "LA"));
    assert.equal(other.log.writes.length, 0);
  } finally { delete process.env.WRITE_GHL_LIVE; }
});

test("rematch: a certain match held by a rule stays in the inbox and remembers who it will go to", async () => {
  process.env.WRITE_GHL_LIVE = "true";
  try {
    const who = person("agency_admin");
    const mem = memory({ contacts: [{ locationId: "LA", contactId: "C1", email: "lee@client.test" }], policies: { LA: { ...DEFAULT_POLICY, allowCrmWrites: false } } });
    waiting(mem, who, ["lee@client.test"], "no_match", "M-d");
    let remembered: string | null = null;
    mem.store.noteDetails = async (_id, d) => { remembered = d.matched ? `${d.matched.locationId}:${d.matched.contactId}` : null; };
    const r = await rematchWaiting(mem.store, connOf(who), okWriter);
    assert.deepEqual([r.added, r.matchedWaiting], [0, 1]);
    assert.equal(mem.meetings.get("M-d")?.status, "needs_contact");
    assert.equal(mem.meetings.get("M-d")?.reason, "writes_off");
    assert.equal(remembered, "LA:C1");
    assert.equal(mem.log.writes.length, 0);
  } finally { delete process.env.WRITE_GHL_LIVE; }
});

test("rematch leaves a call alone when the first note still waits for the person's OK, and remembers the contact", async () => {
  const who = person("agency_admin");
  const mem = memory({ contacts: [{ locationId: "LA", contactId: "C1", email: "lee@client.test" }], settings: { previewConfirmedAt: null } });
  waiting(mem, who, ["lee@client.test"], "no_match", "M-e");
  const r = await rematchWaiting(mem.store, connOf(who), okWriter);
  assert.equal(r.added, 0);
  assert.equal(mem.meetings.get("M-e")?.reason, "preview_needed");
  assert.equal(mem.log.writes.length, 0);
});

test("one person's pass never touches another person's waiting call", async () => {
  process.env.WRITE_GHL_LIVE = "true";
  try {
    const me = person("agency_admin");
    const them = person("agency_owner");
    const mem = memory({ contacts: [{ locationId: "LA", contactId: "C1", email: "lee@client.test" }] });
    waiting(mem, them, ["lee@client.test"], "no_match", "M-theirs");
    const r = await rematchWaiting(mem.store, connOf(me), okWriter);
    assert.equal(r.checked, 0);
    assert.equal(mem.meetings.get("M-theirs")?.status, "needs_contact");
  } finally { delete process.env.WRITE_GHL_LIVE; }
});

test("suggestions and the manual search cover every account the person can open, and only those", async () => {
  const owner = person("agency_admin");
  const mem = memory({ accounts: ["LA", "LB", "LC"], contacts: [{ locationId: "LA", contactId: "C1", email: "lee@client.test", name: "Lee Client" }, { locationId: "LC", contactId: "C3", email: "lee@client.test", name: "Lee Client" }] });
  waiting(mem, owner, ["lee@client.test"], "cross_account", "M-f");
  const stored = (await mem.store.listWaiting("INST1", owner.userId))[0]!;
  const s = await suggestionsFor(mem.store, owner, "INST1", stored);
  assert.deepEqual(s.map((x) => `${x.locationId}:${x.contactId}`).sort(), ["LA:C1", "LC:C3"]);
  await findContacts(mem.store, owner, "INST1", "lee", null);
  assert.deepEqual(mem.log.searched.at(-1), ["LA", "LB", "LC"]);
  await findContacts(mem.store, owner, "INST1", "lee", "LB");
  assert.deepEqual(mem.log.searched.at(-1), ["LB"]);
  await findContacts(mem.store, owner, "INST1", "lee", "LZ");
  assert.equal(mem.log.searched.length, 2, "an account the person cannot open is not searched at all");
  // Company staff whose access cannot be proven see no accounts, so nothing is searched or suggested.
  const staff = person("agency_staff");
  assert.deepEqual(await findContacts(mem.store, staff, "INST1", "lee", null), []);
  assert.deepEqual(await suggestionsFor(mem.store, staff, "INST1", stored), []);
  // A client user is limited to the one account.
  const client = person("account_user", { homeLocationId: "LB" });
  await findContacts(mem.store, client, "INST1", "lee", null);
  assert.deepEqual(mem.log.searched.at(-1), ["LB"]);
});

test("the manual search uses the same engine as Find a lead", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/connections/inbox-store.ts"), "utf8");
  assert.match(source, /findPeople\(installationId, locationIds,/);
  assert.doesNotMatch(source, /order by full_name nulls last limit 20/, "no separate name-prefix query with its own top 20");
});

test("Fathom delivery: outside names, counts of invitees and a speaker-matched email are read; no address is kept in the counts", () => {
  const parsed = parseFathomDelivery({
    recording_id: 42, title: "Quote call", default_summary: { markdown_formatted: "Notes" },
    recorded_by: { name: "Rep", email: "rep@agency.test" },
    calendar_invitees: [{ name: "Rep", email: "rep@agency.test", is_external: false }, { name: "Lee Client", email: "LEE@client.test", is_external: true }, { name: "Pat Nomail", email: null, is_external: true }],
    transcript: [{ speaker: { display_name: "Sam Speaker", matched_calendar_invitee_email: "sam@client.test" }, text: "words" }],
  })!;
  assert.deepEqual(parsed.inviteeStats, { invitees: 3, withEmail: 2, outside: 2 });
  assert.deepEqual(parsed.outsideNames, ["Lee Client", "Pat Nomail"]);
  assert.deepEqual(parsed.meeting.attendees.map((a) => a.email).filter(Boolean), ["lee@client.test"], "the transcript speakers are only a fallback when no invitee has an email");
  const fallback = parseFathomDelivery({
    recording_id: 44, title: "Ad hoc", recorded_by: { email: "rep@agency.test" }, calendar_invitees: [{ name: "Sam Speaker", email: null }],
    transcript: [{ speaker: { display_name: "Sam Speaker", matched_calendar_invitee_email: "Sam@client.test" }, text: "words" }],
  })!;
  assert.deepEqual(fallback.meeting.attendees.map((a) => a.email).filter(Boolean), ["sam@client.test"]);
  assert.ok(!JSON.stringify(parsed.inviteeStats).includes("@"));
  const none = parseFathomDelivery({ recording_id: 43, title: "Ad hoc", recorded_by: { email: "rep@agency.test" }, calendar_invitees: [] })!;
  assert.deepEqual(none.inviteeStats, { invitees: 0, withEmail: 0, outside: 0 });
  assert.deepEqual(none.meeting.attendees, []);
});
