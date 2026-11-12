import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Person } from "../analytics/dedupe.ts";
import { BULK_NOTE, SKIP_TITLE, WILL_TITLE, judgeBulkPair, planBulk, protectedWhy, skipLine, undoRecord, willLine } from "../dq/bulk-merge.ts";
import { consequence, consequenceText, fieldRows, lastConversationLine, type DetailFacts, type DetailPerson } from "../dq/dupe-impact.ts";
import { pickMaster } from "../dq/master-rank.ts";

const src = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");
const ALL_READ: [] = [];
// Two copies of the same person: same email and phone, same name. Older copy first.
const P = (id: string, o: Partial<Person> = {}): Person => ({
  contactId: id, name: "Ann Lee", email: "ann@x.org", phone: "+15550100", tags: [], createdAt: id === "old" ? "2026-01-01T00:00:00Z" : "2026-03-01T00:00:00Z", lastActivityAt: null, source: null,
  openDeals: 0, wonDeals: 0, hasConversation: false, ...o,
});

test("bulk REFUSES when payments, automations or courses are unreadable (today's default), even if one copy looks clearly better", () => {
  const v = judgeBulkPair([P("old", { wonDeals: 2, hasConversation: true }), P("new")]);
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.code, "unreadable");
  assert.match(!v.ok ? v.why : "", /payments and subscriptions, automations, courses and memberships/);
});

test("bulk merges only when everything is readable and one copy is clearly the master; the older one must be kept", () => {
  const v = judgeBulkPair([P("old", { wonDeals: 1 }), P("new")], { unreadable: ALL_READ });
  assert.equal(v.ok, true);
  if (v.ok) { assert.equal(v.keepId, "old"); assert.equal(v.goneId, "new"); assert.match(v.why, /has a won deal/); }
});

test("bulk REFUSES a tie in the same top tier", () => {
  const v = judgeBulkPair([P("old", { wonDeals: 1 }), P("new", { openDeals: 0, wonDeals: 2 })], { unreadable: ALL_READ });
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.code, "tie");
  assert.match(!v.ok ? v.why : "", /Both copies have a deal/);
  const eq = judgeBulkPair([P("old"), P("new", { createdAt: "2026-01-01T00:00:00Z" })], { unreadable: ALL_READ });
  assert.equal(eq.ok, false); // a full tie asks a person
});

test("bulk REFUSES when anybody is protected, with the reason in plain words", () => {
  for (const [o, re] of [[{ dnd: true }, /Do Not Disturb/], [{ openDeals: 1 }, /open deal/], [{ nextAppointmentAt: "2027-01-01T10:00:00Z" }, /coming appointment/]] as const) {
    const v = judgeBulkPair([P("old"), P("new", o)], { unreadable: ALL_READ });
    assert.equal(v.ok, false);
    assert.equal(!v.ok && v.code, "protected");
    assert.match(!v.ok ? v.why : "", re);
  }
  assert.equal(protectedWhy([P("old"), P("new")]), null);
  assert.match(protectedWhy([P("old"), { ...P("new"), payments: true } as Person]) ?? "", /ongoing payment/);
});

test("bulk REFUSES pairs that look like different people", () => {
  const phoneShared = judgeBulkPair([P("old", { name: "Ann Lee" }), P("new", { name: "Bob Okafor", email: "bob@x.org" })], { unreadable: ALL_READ });
  assert.equal(!phoneShared.ok && phoneShared.code, "different_people");
  const both = judgeBulkPair([P("old"), P("new", { email: "other@x.org", phone: "+15559999" })], { unreadable: ALL_READ });
  assert.equal(!both.ok && both.code, "different_people");
  const firstNames = judgeBulkPair([P("old", { name: "Ann Lee" }), P("new", { name: "Mary Lee" })], { unreadable: ALL_READ });
  assert.equal(firstNames.ok, false);
  const office = judgeBulkPair([P("old", { email: "info@acme.com", name: "Ann Lee" }), P("new", { email: "info@acme.com", name: "Sam Park" })], { unreadable: ALL_READ });
  assert.equal(office.ok, false);
});

test("bulk REFUSES groups that are not pairs, and a master that is not the older record (the workflow keeps the older)", () => {
  assert.equal(!judgeBulkPair([P("old"), P("new"), P("third")]).ok && true, true);
  assert.equal((judgeBulkPair([P("old"), P("new"), P("third")]) as { code: string }).code, "size");
  const v = judgeBulkPair([P("old"), P("new", { wonDeals: 1 })], { unreadable: ALL_READ });
  assert.equal(v.ok, false);
  assert.equal(!v.ok && v.code, "not_older");
  assert.equal((judgeBulkPair([P("old", { createdAt: null }), P("new", { wonDeals: 1 })], { unreadable: ALL_READ }) as { code: string }).code, "no_dates");
});

test("PARITY: the bulk keeper is exactly the screen's master (one shared function, no second ranking)", () => {
  const pairs: Person[][] = [[P("old", { wonDeals: 1 }), P("new")], [P("old", { hasConversation: true }), P("new")], [P("old"), P("new", { phone: null })], [P("old", { appointments: 3 }), P("new")]];
  for (const people of pairs) {
    const screen = pickMaster(people, ALL_READ).suggestedId;
    const bulk = judgeBulkPair(people, { unreadable: ALL_READ });
    if (bulk.ok) assert.equal(bulk.keepId, screen);
    else assert.ok(screen === null || bulk.code === "not_older" || bulk.code === "different_people");
  }
  // With the default unreadable list the screen suggests nobody, and bulk merges nobody.
  for (const people of pairs) { assert.equal(pickMaster(people).suggestedId, null); assert.equal(judgeBulkPair(people).ok, false); }
  const routes = src("src/lib/api/dq-routes.ts");
  const bulkBlock = routes.slice(routes.indexOf('b === "bulk-merge"'), routes.indexOf("lead intake"));
  assert.ok(!bulkBlock.includes("chooseSurvivor"), "the bulk path must not use the old ranking");
  assert.ok(bulkBlock.includes("planBulk"));
  assert.ok(routes.includes("pickMaster(people)"), "the detail route uses the shared ranking");
  assert.ok(src("src/app/app/views/dq/dq-merge-view.tsx").includes("pickMaster(people)"));
});

test("plan: will and skipped lists say who is kept, who is removed, and why; the limit and the typed words follow the count", () => {
  const items = [
    { key: "g1", locationId: "L", locationName: "Roofing Co", people: [P("old", { wonDeals: 1 }), P("new")] },
    { key: "g2", locationId: "L", locationName: "Roofing Co", people: [P("old", { dnd: true }), P("new")] },
    { key: "g3", locationId: "L", locationName: "Roofing Co", people: [P("old", { wonDeals: 1 }), P("new")] },
  ];
  const plan = planBulk(items, 1, { unreadable: ALL_READ });
  assert.equal(plan.will.length, 1);
  assert.equal(plan.skipped.length, 2);
  assert.match(willLine(plan.will[0]), /^Ann Lee \(kept\) <- Ann Lee \(removed\): Ann Lee has a won deal$/);
  assert.match(skipLine(plan.skipped[0]), /Do Not Disturb/);
  assert.equal(plan.skipped[1].code, "limit");
  assert.equal(WILL_TITLE(1), "These 1 group will be merged");
  assert.equal(SKIP_TITLE(2), "These 2 groups were skipped and why");
  assert.equal(planBulk(items, 50).will.length, 0); // default unreadable: nothing merges
  assert.match(BULK_NOTE, /cannot be undone/);
});

test("undo record: reason, who is kept and removed, and the removed contact's details", () => {
  const people = [P("old", { wonDeals: 1 }), P("new", { tags: ["lead"], source: "Ads" })];
  const r = undoRecord({ people, keepId: "old", goneId: "new", why: "Ann Lee has a won deal" });
  assert.equal(r.keepContactId, "old");
  assert.equal(r.removedContactId, "new");
  assert.equal(r.reason, "Ann Lee has a won deal");
  assert.deepEqual(r.removed.tags, ["lead"]);
  assert.equal(r.removed.email, "ann@x.org");
  assert.match(r.undo, /cannot be reversed/);
  const routes = src("src/lib/api/dq-routes.ts");
  assert.ok(routes.includes('"duplicates.bulk_merge"') && routes.includes("undoRecord("), "every bulk merge writes an audit line with the undo record");
  assert.ok(routes.includes("bulkMergePhrase(judged.will.length)"), "typed words name the number of groups");
  assert.ok(routes.includes('isLive("WRITE_GHL_LIVE")') && routes.includes("writeEnabledFor"), "dry run unless the live flag and the account opt-in are on");
});

// ---------------------------------------------------------------- detail rows
const F = (o: Partial<DetailFacts> = {}): DetailFacts => ({ lastConversation: null, deals: [], calendars: [], nextCalendar: null, ...o });
const D = (o: Partial<DetailPerson> = {}): DetailPerson => ({ ...(P("old") as unknown as DetailPerson), ...o });
const row = (p: DetailPerson, id: string) => fieldRows(p).find((r) => r.id === id)!;

test("rows: last conversation shows date, channel and who wrote last when SubSync holds it", () => {
  const p = D({ hasConversation: true, facts: F({ lastConversation: { at: "2026-03-03T10:00:00Z", type: "TYPE_SMS", direction: "outbound" } }) });
  assert.match(row(p, "conv").value ?? "", /Mar 3, 2026, text message, your team wrote last/);
  assert.equal(row(p, "conv").note, undefined);
  assert.match(lastConversationLine({ at: null, type: "TYPE_EMAIL", direction: "inbound" }), /date not recorded, email, the contact wrote last/);
  assert.match(row(D({ hasConversation: true }), "conv").note ?? "", /cannot see this yet/); // facts not loaded: still honest
});

test("rows: deals show pipeline, stage and value; appointments show the calendar; opportunities owner is read", () => {
  const p = D({ openDeals: 1, wonDeals: 1, nextAppointmentAt: "2027-01-05T10:00:00Z", appointments: 2, facts: F({
    deals: [{ status: "open", pipeline: "Sales", stage: "Quoted", value: 1200, owner: "Dana" }, { status: "won", pipeline: "Sales", stage: "Won", value: 800, owner: null }],
    calendars: ["Roof visit", "Phone"], nextCalendar: "Roof visit" }) });
  assert.equal(row(p, "open").note, "Sales > Quoted, $1,200");
  assert.equal(row(p, "won").note, "Sales > Won, $800");
  assert.equal(row(p, "next").note, "Calendar: Roof visit");
  assert.equal(row(p, "appts").note, "Calendars: Roof visit, Phone");
  assert.equal(row(p, "oppowner").value, "Dana");
  assert.equal(row(D(), "oppowner").value, null); // not loaded = unreadable, never "none"
});

test("rows: what truly needs a missing permission stays unreadable even with facts loaded", () => {
  const rows = fieldRows(D({ facts: F() }));
  const unseen = rows.filter((r) => r.value === null).map((r) => r.id);
  for (const id of ["pay", "inv", "wf", "camp", "course", "notes", "cf"]) assert.ok(unseen.includes(id), id);
  for (const id of ["oppowner", "conv", "open", "won", "next", "appts"]) assert.ok(!unseen.includes(id), id);
  assert.ok(src("src/lib/api/dq-routes.ts").includes("loadDetailFacts("), "the facts come from our own copy, loaded for the group on screen only");
});

test("preview text includes every consequence: keep, moves, removal, what cannot move, and each risk", () => {
  const people = [D({ tags: ["x"] }), D({ contactId: "new", tags: ["x", "y"], openDeals: 1, openValue: 900, hasConversation: true, appointments: 1, nextAppointmentAt: "2027-01-05T10:00:00Z", dnd: true })];
  const c = consequence(people, "old")!;
  const t = consequenceText(c);
  for (const re of [/keep Ann Lee;/, /1 tag, 1 deal, 1 conversation, 1 appointment/, /notes and tasks/, /remove Ann Lee\./, /workflow enrolments, payments and subscriptions, course access/, /Check them in your CRM first/]) assert.match(t, re);
  assert.equal(c.risks.length, 3);
  assert.match(c.risks.join(" "), /booking on Jan 5, 2027/);
  assert.match(c.risks.join(" "), /open deal \(\$900\)/);
  assert.match(c.risks.join(" "), /Do Not Disturb/);
});
