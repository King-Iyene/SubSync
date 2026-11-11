import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { emailWarnings, dialPlan, DIALER_LINK_KNOWN } from "../people/dial.ts";
import { mapMessageEvent } from "../people/helpers.ts";
import {
  changedLine, changedSince, copyDetails, dayHeading, earliest, groupByDay, mergeTimeline, noShowToRebook, noteToSelf, personHeadline, spanWords, withLive,
  type PersonFacts, type TimelineItem,
} from "../people/person.ts";
import {
  allClearStep, cleanRecent, COUNT_CAP, countWords, emptyRecent, isListId, LIST_IDS, lastOpened, listInfo, pageOf, personKey, pushOpened, pushQuery, queueSay, searchTerm, startHere,
  startOnMine, MAX_OPENED, MAX_RECENT_QUERIES,
} from "../people/queue.ts";
import { activityWords, isMine, listText, matchesPerson, rowLine } from "../people/rows.ts";

// People, the rebuild (stage PEOPLE): the headline of a person, the timeline, "what changed since you last looked", the five call lists' rules, the search term, recent searches,
// the words on a row, and "Mine". Every rule is pure, so these run without a database.

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const H = 3_600_000, D = 86_400_000;
const base: PersonFacts = {
  nowMs: NOW, dnd: false, hasPhone: true, waiting: null, noShow: null, nextAppointmentMs: null, openDeals: { count: 0, value: 0, staleDays: null, stage: null }, wonDeals: 0,
  lastActivityMs: NOW - 2 * D, addedMs: NOW - 30 * D, followUpDueMs: null,
};

// ---------------- the headline ----------------

test("a person who asked not to be contacted is a stop, and nothing else outranks it", () => {
  const h = personHeadline({ ...base, dnd: true, waiting: { sinceMs: NOW - H, never: true }, noShow: { atMs: NOW - D } });
  assert.equal(h.tone, "stop");
  assert.match(h.line, /Asked not to be contacted/);
  assert.match(h.next ?? "", /Open them in your CRM/);
});

test("a customer waiting for an answer comes next: never answered says so, with how long", () => {
  const h = personHeadline({ ...base, waiting: { sinceMs: NOW - 3 * H, never: true } });
  assert.equal(h.tone, "act");
  assert.equal(h.line, "Never answered. Waiting 3 hours.");
  assert.equal(personHeadline({ ...base, waiting: { sinceMs: NOW - 20 * 60_000, never: false } }).line, "Waiting for a reply for 20 minutes.");
  assert.equal(personHeadline({ ...base, hasPhone: false, waiting: { sinceMs: NOW - H, never: false } }).next, "Reply in your CRM.");
});

test("then a no-show to rebook, a follow-up that is due, and a deal gone quiet, in that order", () => {
  const noShow = personHeadline({ ...base, noShow: { atMs: Date.UTC(2026, 10, 3) }, openDeals: { count: 1, value: 5000, staleDays: 20, stage: "Proposal" } });
  assert.equal(noShow.line, "Missed their appointment on Nov 3 and has not booked again.");
  assert.equal(noShow.next, "Call to rebook.");
  const followUp = personHeadline({ ...base, followUpDueMs: NOW - 2 * H, openDeals: { count: 1, value: 5000, staleDays: 20, stage: null } });
  assert.equal(followUp.line, "A follow-up was due today.");
  const stale = personHeadline({ ...base, openDeals: { count: 1, value: 12000, staleDays: 21, stage: "Proposal" } });
  assert.equal(stale.line, "An open deal worth $12,000 has not moved in 21 days.");
  assert.equal(personHeadline({ ...base, openDeals: { count: 2, value: 0, staleDays: 9, stage: null } }).line, "2 open deals has not moved in 9 days.");
});

test("a booking coming up, an open deal, a customer, and quiet people each get one plain line, and nothing is invented", () => {
  assert.equal(personHeadline({ ...base, nextAppointmentMs: Date.UTC(2026, 10, 9) }).line, "Booked for Nov 9.");
  assert.equal(personHeadline({ ...base, openDeals: { count: 1, value: 800, staleDays: null, stage: "Quote" } }).line, "1 open deal, $800, in Quote.");
  assert.match(personHeadline({ ...base, wonDeals: 1, lastActivityMs: NOW - 90 * D }).line, /^A customer\. Last activity 90 days ago\.$/);
  assert.equal(personHeadline({ ...base, wonDeals: 1, lastActivityMs: NOW - 90 * D }).next, "A good moment to check in.");
  assert.equal(personHeadline({ ...base, lastActivityMs: NOW - 120 * D }).line, "No activity for 120 days.");
  assert.equal(personHeadline({ ...base, lastActivityMs: null, addedMs: NOW - 2 * H }).line, "A new contact from the last day.");
  const none = personHeadline({ ...base, lastActivityMs: null, addedMs: null });
  assert.equal(none.line, "No activity recorded yet.");
  assert.equal(none.next, null);
});

test("how long is said in words a person would use", () => {
  assert.equal(spanWords(10_000), "under a minute");
  assert.equal(spanWords(60_000), "1 minute");
  assert.equal(spanWords(95 * 60_000), "2 hours");
  assert.equal(spanWords(47 * H), "47 hours");
  assert.equal(spanWords(49 * H), "2 days");
});

test("a no-show is to rebook only inside 14 days and with no later booking that is not cancelled or itself missed", () => {
  const at = NOW - 3 * D;
  assert.equal(noShowToRebook(at, NOW, []), true);
  assert.equal(noShowToRebook(NOW - 15 * D, NOW, []), false, "older than 14 days");
  assert.equal(noShowToRebook(at, NOW, [{ startMs: NOW + D, status: "booked" }]), false, "booked again");
  assert.equal(noShowToRebook(at, NOW, [{ startMs: NOW + D, status: "cancelled" }]), true, "a cancelled booking does not count");
  assert.equal(noShowToRebook(at, NOW, [{ startMs: NOW - D, status: "noshow" }]), true, "a second miss is still a miss");
  assert.equal(noShowToRebook(NOW + D, NOW, []), false, "not in the past yet");
  assert.equal(earliest(null, 5, 3), 3);
  assert.equal(earliest(null, null), null);
});

// ---------------- the timeline ----------------

const T = (at: string, kind: TimelineItem["kind"], title: string, detail?: string): TimelineItem => ({ at, kind, title, detail });

test("the timeline is newest first, the same moment and words appear once, and a time that cannot be read is dropped", () => {
  const out = mergeTimeline([
    [T("2026-11-01T10:00:00Z", "contact", "Added as a contact"), T("not a date", "call", "Bad")],
    [T("2026-11-04T09:00:00Z", "call", "Call logged: Voicemail"), T("2026-11-04T09:00:00.000Z", "call", "Call logged: Voicemail")],
    [T("2026-11-03T09:00:00Z", "tag", "Tag added: vip")],
  ]);
  assert.deepEqual(out.map((i) => i.title), ["Call logged: Voicemail", "Tag added: vip", "Added as a contact"]);
});

test("the timeline is capped", () => {
  const many = Array.from({ length: 200 }, (_, i) => T(new Date(NOW - i * 60_000).toISOString(), "message", `m${i}`));
  assert.equal(mergeTimeline([many]).length, 80);
  assert.equal(mergeTimeline([many], 5).length, 5);
});

test("what changed since the person last looked: only newer things, never the 'added' row, and nothing the first time", () => {
  const items = [T("2026-11-04T10:00:00Z", "message", "Text message from them"), T("2026-11-03T10:00:00Z", "deal", "Deal moved to Proposal"), T("2026-11-01T10:00:00Z", "contact", "Added as a contact")];
  assert.equal(changedSince(items, null), null, "the first time there is nothing to compare");
  assert.equal(changedSince(items, "garbage"), null);
  const c = changedSince(items, "2026-11-02T00:00:00Z");
  assert.equal(c?.count, 2);
  assert.deepEqual(c?.titles, ["Text message from them", "Deal moved to Proposal"]);
  assert.equal(changedLine(c!, Date.parse("2026-11-05T00:00:00Z")), "2 things since you last looked, 3 days ago: Text message from them; Deal moved to Proposal.");
  const none = changedSince(items, "2026-11-04T11:00:00Z")!;
  assert.equal(changedLine(none, Date.parse("2026-11-05T11:00:00Z")), "Nothing new since you last looked, 24 hours ago.");
  const long = changedSince(Array.from({ length: 5 }, (_, i) => T(`2026-11-0${i + 2}T10:00:00Z`, "message", `m${i}`)), "2026-11-01T00:00:00Z")!;
  assert.match(changedLine(long, Date.parse("2026-11-08T00:00:00Z")), /; and more\.$/);
});

test("live messages and calls from the CRM join the timeline, and replace the one 'last message' row", () => {
  const base2 = [T("2026-11-04T10:00:00Z", "message", "Last message: text message from them"), T("2026-11-01T10:00:00Z", "contact", "Added as a contact")];
  assert.equal(withLive(base2, null).length, 2);
  assert.equal(withLive(base2, { messages: [], calls: [] }).length, 2);
  const out = withLive(base2, {
    messages: [{ at: "2026-11-04T10:00:00Z", direction: "inbound", channel: "Text message", by: null }, { at: "2026-11-04T10:05:00Z", direction: "outbound", channel: "Email", by: "Priya Shah" }],
    calls: [{ at: "2026-11-03T08:00:00Z", direction: "outbound", result: "Answered, 2 min", by: "Priya Shah" }],
  });
  assert.deepEqual(out.map((i) => i.title), ["Email from your team", "Text message from them", "Outgoing call: Answered, 2 min", "Added as a contact"]);
  assert.ok(!out.some((i) => i.title.startsWith("Last message")));
  // The words of a message are never part of a timeline entry: only the channel, the way it went and who sent it.
  assert.equal(out[0].detail, "by Priya Shah");
});

test("a message of the CRM becomes a timeline entry without its words; calls, comments and activity are not messages", () => {
  const m = mapMessageEvent({ messageType: "TYPE_SMS", direction: "inbound", dateAdded: "2026-11-04T10:00:00Z", body: "my secret words", userId: "u1" });
  assert.ok(m);
  assert.equal(m.direction, "inbound");
  assert.equal(m.channel, "Text message");
  assert.equal(m.userId, "u1");
  assert.ok(!JSON.stringify(m).includes("secret"), "the text of the message is never kept");
  assert.equal(mapMessageEvent({ messageType: "TYPE_CALL", dateAdded: 1 }), null);
  assert.equal(mapMessageEvent({ messageType: "TYPE_INTERNAL_COMMENT", dateAdded: "2026-11-04T10:00:00Z" }), null);
  assert.equal(mapMessageEvent({ messageType: "TYPE_ACTIVITY_CONTACT", dateAdded: "2026-11-04T10:00:00Z" }), null);
  assert.equal(mapMessageEvent({ messageType: "TYPE_EMAIL", dateAdded: "nonsense" }), null);
  assert.equal(mapMessageEvent({ type: "TYPE_EMAIL", dateAdded: 1_700_000_000, direction: "OUTBOUND" })?.direction, "outbound", "seconds are read as seconds");
});

test("days are headed Today, Yesterday or a date, and the timeline groups by them in order", () => {
  assert.equal(dayHeading(new Date(NOW - 3 * H).toISOString(), NOW), "Today");
  assert.equal(dayHeading(new Date(NOW - D).toISOString(), NOW), "Yesterday");
  assert.equal(dayHeading("2026-10-01T10:00:00Z", NOW), "Oct 1, 2026");
  assert.equal(dayHeading("nope", NOW), "");
  const g = groupByDay([T(new Date(NOW - H).toISOString(), "call", "a"), T(new Date(NOW - 2 * H).toISOString(), "call", "b"), T(new Date(NOW - D).toISOString(), "call", "c")], NOW);
  assert.deepEqual(g.map((x) => [x.heading, x.items.length]), [["Today", 2], ["Yesterday", 1]]);
});

// ---------------- text for the clipboard ----------------

test("details copy as one block, and a note keeps its date, the person and the words; empty text gives nothing", () => {
  assert.equal(copyDetails({ name: "Ada Lovelace", account: "Acme Dental", phone: "+15550101111", email: "ada@x.test", owner: "Priya", why: "Waiting 3 h" }), "Ada Lovelace (Acme Dental)\n+15550101111\nada@x.test\nOwner: Priya\nWaiting 3 h");
  assert.equal(copyDetails({ name: "Solo" }), "Solo");
  assert.equal(noteToSelf({ name: "Ada", account: "Acme", text: "  ", now: new Date(NOW) }), null);
  assert.equal(noteToSelf({ name: "Ada", account: "Acme", text: " Call back Friday ", now: new Date(NOW) }), "Nov 5, 2026, Ada (Acme):\nCall back Friday");
  assert.equal(noteToSelf({ name: "Ada", text: "x".repeat(5000), now: new Date(NOW) })!.length, "Nov 5, 2026, Ada:\n".length + 2000);
});

// ---------------- the five lists ----------------

test("there are five ready-made lists, in the order a call is most urgent, and each one says where it comes from", () => {
  assert.deepEqual([...LIST_IDS], ["waiting", "noshows", "followups", "hot", "stale"]);
  for (const id of LIST_IDS) { const i = listInfo(id, 14); assert.ok(i.label && i.help && i.same, id); assert.ok(isListId(id)); }
  assert.equal(isListId("nonsense"), false);
  assert.match(listInfo("stale", 21).help, /21 days/);
  assert.match(listInfo("waiting", 14).same, /Speed to lead/);
  assert.match(listInfo("noshows", 14).same, /Appointments/);
  assert.match(listInfo("stale", 14).same, /Today/);
});

test("the list to start with is the most urgent one that has anybody on it", () => {
  const c = (w: number, n: number, f: number, h: number, s: number) => [{ id: "waiting" as const, total: w }, { id: "noshows" as const, total: n }, { id: "followups" as const, total: f }, { id: "hot" as const, total: h }, { id: "stale" as const, total: s }];
  assert.equal(startHere(c(3, 9, 0, 4, 20)), "waiting");
  assert.equal(startHere(c(0, 9, 0, 4, 20)), "noshows");
  assert.equal(startHere(c(0, 0, 0, 0, 20)), "stale");
  assert.equal(startHere(c(0, 0, 0, 0, 0)), null);
});

test("the sentence at the top names the most urgent list and the rest in short", () => {
  const counts = [{ id: "waiting" as const, total: 12 }, { id: "noshows" as const, total: 7 }, { id: "followups" as const, total: 0 }, { id: "hot" as const, total: 9 }, { id: "stale" as const, total: 1 }];
  const s = queueSay(counts, 14);
  assert.equal(s.head, "12 new leads have never had a reply.");
  assert.equal(s.also, "Also: 7 no-shows, 9 hot leads, 1 stale deal.");
  assert.equal(s.allClear, false);
  assert.equal(queueSay([{ id: "waiting", total: 1 }], 14).head, "1 new lead has never had a reply.");
  assert.equal(queueSay([{ id: "stale", total: 4 }], 21).head, "4 deals have not moved for 21 days or more.");
  const clear = queueSay(counts.map((c) => ({ ...c, total: 0 })), 14);
  assert.deepEqual(clear, { head: "Nobody needs a call right now.", also: null, allClear: true });
  assert.match(allClearStep(true), /across your clients/);
  assert.ok(!/across your clients/.test(allClearStep(false)));
});

test("a client's staff start on their own queue only when something is assigned to them; anyone else starts on everyone", () => {
  assert.equal(startOnMine({ staff: true, mine: 3 }), true);
  assert.equal(startOnMine({ staff: true, mine: 0 }), false, "a queue of zero would look broken");
  assert.equal(startOnMine({ staff: true, mine: null }), false);
  assert.equal(startOnMine({ staff: false, mine: 12 }), false);
});

test("'Mine' is the contact's owner, or the booking's person for a no-show; with no id nobody is mine", () => {
  assert.equal(isMine({ owner: "u1" }, "u1"), true);
  assert.equal(isMine({ owner: "u2", assignee: "u1" }, "u1"), true);
  assert.equal(isMine({ owner: null, assignee: null }, "u1"), false);
  assert.equal(isMine({ owner: "u1" }, null), false);
});

test("paging in memory never runs off the end and always says which rows it shows", () => {
  const list = Array.from({ length: 60 }, (_, i) => i);
  assert.deepEqual(pageOf(list, 1, 25), { rows: list.slice(0, 25), page: 1, pages: 3, total: 60, from: 1, to: 25 });
  assert.equal(pageOf(list, 3, 25).rows.length, 10);
  assert.equal(pageOf(list, 99, 25).page, 3, "a page past the end is the last page");
  assert.equal(pageOf(list, -4, 25).page, 1);
  const none = pageOf([], 1, 25);
  assert.deepEqual([none.total, none.pages, none.from, none.to], [0, 1, 0, 0]);
});

// ---------------- the search box ----------------

test("a name or email needs two characters and a phone number three digits; spaces are squeezed", () => {
  assert.deepEqual(searchTerm("  Ada   Lovelace "), { ok: true, q: "Ada Lovelace", kind: "name" });
  assert.deepEqual(searchTerm("ada@x.test"), { ok: true, q: "ada@x.test", kind: "email" });
  assert.deepEqual(searchTerm("(555) 010-1111"), { ok: true, q: "(555) 010-1111", kind: "phone" });
  assert.deepEqual(searchTerm("+1 555"), { ok: true, q: "+1 555", kind: "phone" });
  assert.deepEqual(searchTerm("55"), { ok: false, reason: "short" }, "two digits would match every number");
  assert.deepEqual(searchTerm("a"), { ok: false, reason: "short" });
  assert.deepEqual(searchTerm("   "), { ok: false, reason: "empty" });
  assert.equal((searchTerm("x".repeat(300)) as { q: string }).q.length, 100);
  assert.equal(countWords(1234, false), "1,234");
  assert.equal(countWords(COUNT_CAP, true), "10,000+");
});

test("a search matches the name, the email, the account or the last digits of the phone, ignoring case and accents", () => {
  const p = { name: "Zoë Müller", email: "zoe@acme.test", phone: "+1 (555) 010-1111", locationName: "Acme Dental" };
  assert.equal(matchesPerson(p, "zoe m"), true);
  assert.equal(matchesPerson(p, "MULLER"), true);
  assert.equal(matchesPerson(p, "acme"), true);
  assert.equal(matchesPerson(p, "010-1111"), true);
  assert.equal(matchesPerson(p, "99"), false, "two digits are not a phone search");
  assert.equal(matchesPerson(p, "nobody"), false);
  assert.equal(matchesPerson(p, ""), true);
  assert.equal(matchesPerson({ ...p, phone: "+15550101999" }, "zoe1999@acme"), false, "an email that holds digits is not looked for in the phone numbers");
  assert.equal(matchesPerson({ ...p, phone: "+15550101999" }, "(555) 010-1999"), true, "a phone number written with brackets is");
});

// ---------------- recent searches and recently opened ----------------

test("recent searches keep the newest first, once each, and no more than eight; a damaged value is read as empty", () => {
  let r = emptyRecent();
  for (const q of ["ada", "grace", "ADA", "x", "linus"]) r = pushQuery(r, q);
  assert.deepEqual(r.q, ["linus", "ADA", "grace"], "a one-letter search is not kept and the same words are kept once");
  for (let i = 0; i < 20; i++) r = pushQuery(r, `person ${i}`);
  assert.equal(r.q.length, MAX_RECENT_QUERIES);
  assert.deepEqual(cleanRecent("garbage"), emptyRecent());
  assert.deepEqual(cleanRecent({ q: ["ok", 5, " "], opened: [{ k: "bad key", at: "2026-11-01T00:00:00Z" }, { k: "loc1:c1c", at: "nope" }] }), { q: ["ok"], opened: [] });
});

test("opened people keep the newest first, once each, and remember when", () => {
  let r = emptyRecent();
  r = pushOpened(r, personKey("locA1", "cont1"), "2026-11-01T10:00:00Z");
  r = pushOpened(r, personKey("locA1", "cont2"), "2026-11-02T10:00:00Z");
  r = pushOpened(r, personKey("locA1", "cont1"), "2026-11-03T10:00:00Z");
  assert.deepEqual(r.opened.map((o) => o.k), ["locA1:cont1", "locA1:cont2"]);
  assert.equal(lastOpened(r, "locA1:cont2"), "2026-11-02T10:00:00Z");
  assert.equal(lastOpened(r, "locA1:cont9"), null);
  for (let i = 0; i < MAX_OPENED + 40; i++) r = pushOpened(r, personKey("locA1", `c${String(i).padStart(4, "0")}`), "2026-11-04T10:00:00Z");
  assert.equal(r.opened.length, MAX_OPENED);
});

// ---------------- the words on a row ----------------

test("a row's second line says why on a call list and how to reach them in a search, and leaves out what it does not know", () => {
  const p = { name: "Ada", why: "Never answered, waiting 3 h", locationName: "Acme", phone: "+15550101111", email: "ada@x.test", owner: "u1", ownerName: "Priya Shah", lastActivityAt: null, dateAdded: new Date(NOW - 2 * D).toISOString() };
  assert.equal(rowLine(p, { showAccount: true, nowMs: NOW }), "Never answered, waiting 3 h · Acme · Owner Priya Shah");
  assert.equal(rowLine(p, { showAccount: false, nowMs: NOW }), "Never answered, waiting 3 h · Owner Priya Shah");
  assert.equal(rowLine({ ...p, owner: null }, { showAccount: false, nowMs: NOW }), "Never answered, waiting 3 h · No owner");
  assert.equal(rowLine({ ...p, why: "" }, { showAccount: true, nowMs: NOW }), "+15550101111 · ada@x.test · Acme · added 2 days ago");
  assert.equal(rowLine({ name: "Bo", why: "", phone: null, email: null, lastActivityAt: null, dateAdded: null }, { showAccount: false, nowMs: NOW }), "no activity recorded");
  assert.equal(activityWords({ lastActivityAt: new Date(NOW - H).toISOString(), dateAdded: null }, NOW), "active today");
  assert.equal(activityWords({ lastActivityAt: new Date(NOW - D - H).toISOString(), dateAdded: null }, NOW), "active yesterday");
});

test("a list copies as one person a line, tab separated, with the account only when several are shown", () => {
  const rows = [{ name: "Ada", phone: "+1", email: "a@x", locationName: "Acme", why: "Waiting" }, { name: "Bo", phone: null, email: null, locationName: "Beta", why: null }];
  assert.equal(listText(rows, true), "Ada\t+1\ta@x\tAcme\tWaiting\nBo\t\t\tBeta\t");
  assert.equal(listText(rows, false), "Ada\t+1\ta@x\t\tWaiting\nBo\t\t\t\t");
});

// ---------------- call and email: the warning comes first, and nothing is sent ----------------

test("an email to a person who asked not to be contacted is a stop; a missing address is a caution", () => {
  assert.deepEqual(emailWarnings({ dnd: true, email: "a@x.test" }).map((w) => [w.id, w.level]), [["dnd", "stop"]]);
  assert.deepEqual(emailWarnings({ dnd: false, email: null }).map((w) => [w.id, w.level]), [["no_email", "caution"]]);
  assert.deepEqual(emailWarnings({ dnd: false, email: "nope" }).map((w) => w.id), ["no_email"]);
  assert.deepEqual(emailWarnings({ dnd: false, email: "a@x.test" }), []);
});

test("the dialer opens the CRM's contact by default and says plainly it cannot go straight to the dialer", () => {
  const plan = dialPlan("crm", { phone: "+15550101111", contactUrl: "https://crm.example.test/v2/location/L/contacts/detail/C" });
  assert.equal(plan.href, "https://crm.example.test/v2/location/L/contacts/detail/C");
  assert.equal(plan.fallsBackToContact, !DIALER_LINK_KNOWN);
  assert.match(plan.note, /Not available from your CRM yet/);
});

// ---------------- what the screens may say ----------------

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const NEW_FILES = [
  "app/app/views/people-module.tsx", "app/app/views/people-find.tsx", "app/app/views/people-rows.tsx", "app/app/views/people-more.tsx", "app/app/views/people-filters.tsx",
  "app/app/ds/lead-drawer.tsx", "app/app/ds/lead-parts.tsx", "app/app/ds/contact-actions.tsx", "lib/people/person.ts", "lib/people/queue.ts", "lib/people/rows.ts",
  "lib/analytics/people-person-queries.ts", "lib/analytics/people-queue-queries.ts", "lib/api/people-queue-routes.ts",
];

test("no new People screen names the platform, writes a phone link or an email link, or uses a banned word (KF-3)", () => {
  for (const f of NEW_FILES) {
    const text = read(f);
    assert.ok(!/GoHighLevel|HighLevel|leadconnector|\bGHL\b|sub-?account|\bSLA\b/i.test(text), `${f} names the platform or uses a banned word`);
    assert.ok(!/tel:|mailto:/.test(text), `${f} writes a phone or email link`);
  }
});

test("the people screens use no dot pill: status is words, a rule or a colour of text (KF-1)", () => {
  for (const f of NEW_FILES.filter((x) => x.endsWith(".tsx"))) {
    const text = read(f);
    assert.ok(!/<Badge\b/.test(text), `${f} uses a badge`);
    assert.ok(!/rounded-full[^"]*bg-(?:warning|destructive|success|primary)\/|size-1\.5[^"]*rounded-full/.test(text), `${f} draws a dot`);
  }
});

test("only the panel and the filter form read the people store's private notes: no screen keeps a typed note, and the note is never sent anywhere", () => {
  const parts = read("app/app/ds/lead-parts.tsx");
  assert.ok(!/api\.(post|put)\([^)]*note/.test(parts.split("export function NoteToSelf")[1] ?? ""), "the note to self is only copied");
  assert.ok(/navigator\.clipboard\.writeText/.test(parts));
});
