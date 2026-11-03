import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkSelect, chooseSurvivor, classify, foldEmail, groupDuplicates, normEmail, normPhone, planFields, scorePair, type Person } from "../analytics/dedupe.ts";

const p = (id: string, o: Partial<Person> = {}): Person => ({
  contactId: id, name: "Ada Lovelace", email: null, phone: null, tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null,
  source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...o,
});

test("phones match across formats and emails across case and gmail tricks", () => {
  assert.equal(normPhone("+1 (555) 010-2030"), "5550102030");
  assert.equal(normPhone("15550102030"), "5550102030");
  assert.equal(normPhone("12345"), null);
  assert.equal(normEmail("  ADA@Example.com "), "ada@example.com");
  assert.equal(normEmail("not an email"), null);
  assert.equal(foldEmail("A.da+promo@gmail.com"), "ada@gmail.com");
  assert.equal(foldEmail("ada+x@work.com"), "ada@work.com");
});

test("identical email or phone is a confident match, format differences a little less", () => {
  assert.ok(scorePair(p("a", { email: "x@y.com" }), p("b", { email: "x@y.com" })).score >= 90);
  assert.ok(scorePair(p("a", { phone: "+15550102030" }), p("b", { phone: "+15550102030" })).score >= 90);
  const fmt = scorePair(p("a", { phone: "+15550102030" }), p("b", { phone: "(555) 010-2030" }));
  assert.ok(fmt.score >= 75 && fmt.score < 90 || fmt.score === 85);
  assert.deepEqual(fmt.reasons, ["phone in a different format", "same name"]);
  const mail = scorePair(p("a", { email: "ADA@y.com" }), p("b", { email: "ada@y.com" }));
  assert.ok(mail.score >= 80 && mail.score < 90);
});

test("the same name alone is only a weak hint; with another signal it adds confidence", () => {
  assert.equal(scorePair(p("a"), p("b")).score, 35);
  assert.ok(scorePair(p("a", { phone: "5550102030" }), p("b", { phone: "5550102030" })).score >= 95);
  assert.equal(scorePair(p("a", { name: "Unnamed contact" }), p("b", { name: "Unnamed contact" })).score, 0);
  assert.equal(scorePair(p("a", { name: "Ada" }), p("b", { name: "Ada" })).score, 0);
});

test("groups link records through shared keys and ignore unrelated ones", () => {
  const people = [
    p("1", { email: "ada@y.com", phone: "+15550102030" }),
    p("2", { email: "ada@y.com" }),
    p("3", { phone: "(555) 010-2030" }),
    p("4", { name: "Grace Hopper", email: "grace@y.com" }),
  ];
  const groups = groupDuplicates(people);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].people.map((x) => x.contactId).sort(), ["1", "2", "3"]);
  assert.ok(groups[0].confidence >= 90);
  assert.equal(groups[0].kind, "format");
});

test("a shared placeholder phone number does not glue strangers together by name alone", () => {
  const people = [p("1", { name: "Ann One", phone: "5550000000" }), p("2", { name: "Bob Two", phone: "5550000000" })];
  const g = groupDuplicates(people);
  // Same phone with different names is listed, but only as "probably different people" (C2).
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, "shared");
  // ... but a name-only link stays below the grouping threshold.
  assert.equal(groupDuplicates([p("1"), p("2")]).length, 0);
});

test("the survivor is the record with deals, conversations and the most complete details", () => {
  const rich = p("rich", { wonDeals: 1, email: "a@b.com", phone: "5550102030", hasConversation: true });
  const bare = p("bare", { createdAt: "2025-01-01T00:00:00Z" });
  assert.equal(chooseSurvivor([bare, rich]).contactId, "rich");
  const old = p("old", { createdAt: "2025-01-01T00:00:00Z" });
  const newer = p("new", { createdAt: "2026-06-01T00:00:00Z" });
  assert.equal(chooseSurvivor([newer, old]).contactId, "old");
});

test("the field plan keeps the survivor's values, fills gaps and combines tags", () => {
  const survivor = p("s", { wonDeals: 1, email: "ada@y.com", phone: null, tags: ["vip"] });
  const other = p("o", { email: "ada@y.com", phone: "+15550102030", tags: ["lead"] });
  const plan = planFields({ people: [survivor, other], survivorId: "s" });
  const by = Object.fromEntries(plan.map((f) => [f.field, f]));
  assert.equal(by.email.keep, "ada@y.com");
  assert.equal(by.phone.keep, "+15550102030");
  assert.equal(by.phone.from, "another record");
  assert.equal(by.tags.keep, "vip, lead");
});

test("summary and bulk selection respect confidence and what was already reviewed", () => {
  const groups = groupDuplicates([
    p("1", { email: "a@y.com" }), p("2", { email: "a@y.com" }),
    p("3", { phone: "+15550102030", name: "C C" }), p("4", { phone: "(555) 010-2030", name: "D D" }),
  ]);
  assert.deepEqual(classify(groups), { exact: 1, format: 0, name: 0, shared: 1, contacts: 4 });
  assert.equal(bulkSelect(groups, new Set(), 90).length, 1);
  assert.equal(bulkSelect(groups, new Set(groups.map((g) => g.key)), 0).length, 0);
  assert.equal(bulkSelect(groups, new Set(), 0).length, 1, "a group of probably different people is never bulk selected");
});

test("group keys are stable for the same set of contacts", () => {
  const a = groupDuplicates([p("1", { email: "a@y.com" }), p("2", { email: "a@y.com" })])[0].key;
  const b = groupDuplicates([p("2", { email: "a@y.com" }), p("1", { email: "a@y.com" })])[0].key;
  assert.equal(a, b);
});
