import assert from "node:assert/strict";
import { test } from "node:test";
import { formatName, formatPhone, matchesTagFilter, parseParams, planChanges, summarise, type ContactLite } from "../analytics/cleanup-intel.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const DAY = 86_400_000;
const c = (id: string, o: Partial<ContactLite> = {}): ContactLite => ({ id, firstName: "Ada", lastName: "Lovelace", phone: null, email: "a@b.com", tags: [], lastActivityAt: NOW - DAY, dateAdded: NOW - 400 * DAY, source: null, ...o });

test("phones are tidied but never guessed", () => {
  assert.equal(formatPhone("+1 (555) 010-2030", null), "+15550102030");
  assert.equal(formatPhone("+15550102030", null), null, "already in the standard form");
  assert.equal(formatPhone("0044 20 7946 0958", null), "+442079460958");
  assert.equal(formatPhone("555-010-2030", null), null, "a bare local number is not guessed without a country code");
  assert.equal(formatPhone("555-010-2030", "+1"), "+15550102030");
  assert.equal(formatPhone("0803 123 4567", "234"), "+2348031234567", "a leading zero is dropped");
  assert.equal(formatPhone("2348031234567", "234"), "+2348031234567", "a number that already carries its country code");
  assert.equal(formatPhone("12345", "+1"), null, "too short to be a phone number");
  assert.equal(formatPhone("call me", "+1"), null);
  assert.equal(formatPhone(null, "+1"), null);
});

test("names are fixed only when entirely upper or lower case", () => {
  assert.equal(formatName("JOHN"), "John");
  assert.equal(formatName("mary-jane"), "Mary-Jane");
  assert.equal(formatName("O'BRIEN"), "O'Brien");
  assert.equal(formatName("van der berg"), "Van der Berg");
  assert.equal(formatName("McDonald"), null, "mixed case was typed on purpose");
  assert.equal(formatName("DeShawn"), null);
  assert.equal(formatName("  Ada   Lovelace "), "Ada Lovelace", "stray spaces are tidied");
  assert.equal(formatName("Ada"), null);
  assert.equal(formatName("123"), null);
});

test("the plan lists each change with its before and after, and nothing else", () => {
  const contacts = [
    c("1", { phone: "(555) 010-2030", firstName: "JOHN", lastName: "smith" }),
    c("2", { phone: "+15550102030" }),
    c("3", { firstName: "Mary", lastName: "Jones" }),
  ];
  const { changes } = planChanges(contacts, { rules: ["phone", "name"], defaultCountryCode: "+1", tag: null }, NOW);
  assert.deepEqual(changes.map((x) => [x.contactId, x.field, x.before, x.after]), [
    ["1", "phone", "(555) 010-2030", "+15550102030"], ["1", "firstName", "JOHN", "John"], ["1", "lastName", "smith", "Smith"],
  ]);
  assert.deepEqual(summarise(changes), { email: 0, phone: 1, name: 2, tagAdd: 0, tagRemove: 0, contacts: 1 });
});

test("tags apply only to who matches the filter, and not twice", () => {
  const contacts = [
    c("1", { email: null }), c("2", { email: null, tags: ["No Email"] }), c("3"),
    c("4", { lastActivityAt: NOW - 120 * DAY }), c("5", { lastActivityAt: null, dateAdded: NOW - 10 * DAY }),
  ];
  const add = (where: object) => planChanges(contacts, { rules: ["tag"], defaultCountryCode: null, tag: { action: "add", name: "No Email", where } }, NOW).changes.map((x) => x.contactId);
  assert.deepEqual(add({ missing: "email" }), ["1"], "contact 2 already has the tag");
  assert.deepEqual(planChanges(contacts, { rules: ["tag"], defaultCountryCode: null, tag: { action: "add", name: "Quiet", where: { idleDays: 90 } } }, NOW).changes.map((x) => x.contactId), ["4"]);
  const remove = planChanges(contacts, { rules: ["tag"], defaultCountryCode: null, tag: { action: "remove", name: "no email", where: { missing: "email" } } }, NOW).changes;
  assert.deepEqual(remove.map((x) => [x.contactId, x.after]), [["2", "without"]], "tag names match regardless of case");
  assert.equal(matchesTagFilter(c("x", { source: "Facebook Ads" }), { source: "facebook ads" }, NOW), true);
});

test("a large plan is capped and says so", () => {
  const many = Array.from({ length: 6_000 }, (_, i) => c(String(i), { firstName: "JOHN" }));
  const { changes, truncated } = planChanges(many, { rules: ["name"], defaultCountryCode: null, tag: null }, NOW);
  assert.equal(changes.length, 5_000);
  assert.equal(truncated, true);
});

test("what the user sends is checked, and a tag can never go to everyone", () => {
  assert.equal(parseParams({ rules: [] }).ok, false);
  assert.equal(parseParams({ rules: ["delete_everything"] }).ok, false);
  assert.equal(parseParams({ rules: ["phone"], defaultCountryCode: "+99999" }).ok, false);
  assert.deepEqual(parseParams({ rules: ["phone", "name", "phone"], defaultCountryCode: "+234" }), { ok: true, params: { rules: ["phone", "name"], defaultCountryCode: "234", tag: null } });
  assert.equal(parseParams({ rules: ["tag"], tag: { action: "add", name: "x", where: {} } }).ok, false, "no filter");
  assert.equal(parseParams({ rules: ["tag"], tag: { action: "wipe", name: "x", where: { missing: "email" } } }).ok, false);
  assert.equal(parseParams({ rules: ["tag"], tag: { action: "add", name: "a,b", where: { missing: "email" } } }).ok, false);
  assert.equal(parseParams({ rules: ["tag"], tag: { action: "add", name: "x", where: { idleDays: 0 } } }).ok, false);
  const ok = parseParams({ rules: ["tag"], tag: { action: "add", name: " No Email ", where: { missing: "email", idleDays: "90" } } });
  assert.equal(ok.ok && ok.params.tag?.name, "No Email");
  assert.equal(ok.ok && ok.params.tag?.where.idleDays, 90);
});
