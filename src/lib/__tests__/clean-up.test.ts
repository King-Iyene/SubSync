import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkSelect, groupDuplicates, nameSimilarity, scorePair, suggestKeep, type Person } from "../analytics/dedupe.ts";
import { bestPairs, groupGuard, groupLabel, pairGuard, sourceOfDuplicates } from "../analytics/dedupe-guide.ts";

const p = (id: string, o: Partial<Person> = {}): Person => ({
  contactId: id, name: "Ada Lovelace", email: null, phone: null, tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null,
  source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...o,
});

// Golden data. Each fixture is a case that real accounts produce.
const typo = [p("t1", { name: "Jon Smith", phone: "+15550102030", email: "jon@acme.com" }), p("t2", { name: "John Smith", phone: "(555) 010-2030", email: "john@acme.com" })];
const family = [p("f1", { name: "Mary Okafor", phone: "+2348012345678" }), p("f2", { name: "Peter Okafor", phone: "+2348012345678" })];
const office = [p("o1", { name: "Amaka Obi", email: "info@clinic.com" }), p("o2", { name: "Tunde Bello", email: "info@clinic.com" })];
let seed = 7;
const word = () => Array.from({ length: 8 }, () => { seed = (seed * 1103515245 + 12345) % 2147483648; return String.fromCharCode(97 + (seed >> 8) % 26); }).join("");
const junk88 = Array.from({ length: 88 }, (_, i) => p("j" + i, { name: `${word()} ${word()}`, phone: "+15559990000", email: `user${i}@mail${i % 7}.com` }));

test("names: order, typos and initials count as alike; different people do not", () => {
  assert.equal(nameSimilarity("Ann Smith", "smith ann"), 1);
  assert.ok((nameSimilarity("Jon Smith", "John Smith") ?? 0) >= 0.8);
  assert.ok((nameSimilarity("J Smith", "John Smith") ?? 0) >= 0.8);
  assert.ok((nameSimilarity("Mary Okafor", "Peter Okafor") ?? 1) < 0.8);
  assert.ok((nameSimilarity("Marvin Morris", "Goodness Favour") ?? 1) < 0.5);
  assert.equal(nameSimilarity("Unnamed contact", "Ada Lovelace"), null);
});

test("the same person with a typo in the name is still a confident match", () => {
  const s = scorePair(typo[0], typo[1]);
  assert.ok(s.score >= 85, String(s.score));
  assert.ok(s.reasons.includes("similar name"));
  const g = groupDuplicates(typo);
  assert.equal(g.length, 1);
  assert.notEqual(g[0].kind, "shared");
});

test("a family phone shared by different names is not a duplicate and is not shown as sure", () => {
  const s = scorePair(family[0], family[1]);
  assert.ok(s.score <= 40, String(s.score));
  assert.ok(s.reasons.includes("different names"));
  const g = groupDuplicates(family);
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, "shared");
  assert.equal(groupLabel(g[0]).title, "Same phone or email, probably different people");
  assert.equal(groupLabel(g[0]).showPercent, false);
  assert.equal(groupGuard(g[0]).level, "block");
});

test("a shared office inbox is the same", () => {
  const g = groupDuplicates(office);
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, "shared");
  assert.ok(g[0].confidence < 50);
});

test("the 88-record junk group: one shared group, never 99%, never in a bulk action, best three pairs only", () => {
  const groups = groupDuplicates(junk88);
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.kind, "shared");
  assert.equal(g.people.length, 88, "the count is honest");
  assert.ok(g.confidence < 50);
  assert.equal(bulkSelect(groups, new Set(), 0).length, 0);
  assert.equal(bestPairs(g.people).length, 3);
  assert.equal(bestPairs(g.people, 3).length <= 3, true);
});

test("real duplicates inside a shared phone stay separate from the people who only share it", () => {
  const people = [p("a1", { name: "Ann Bell", phone: "5550001111" }), p("a2", { name: "Ann Bell", phone: "5550001111" }), p("b1", { name: "Bob Bell", phone: "5550001111" })];
  const groups = groupDuplicates(people);
  const real = groups.find((g) => g.kind !== "shared")!;
  assert.deepEqual(real.people.map((x) => x.contactId).sort(), ["a1", "a2"]);
  const shared = groups.find((g) => g.kind === "shared")!;
  assert.equal(shared.people.length, 2, "one representative of the real group plus Bob");
});

test("keep suggestion gives one reason in the agreed order", () => {
  const withDeal = p("d", { openDeals: 1 });
  const recent = p("r", { lastActivityAt: new Date().toISOString(), email: "a@b.com", phone: "5550102030" });
  assert.deepEqual([suggestKeep([recent, withDeal]).person.contactId, suggestKeep([recent, withDeal]).reason], ["d", "It has an open deal"]);
  const appt = p("ap", { upcomingAppointments: 1 });
  assert.equal(suggestKeep([recent, appt]).reason, "It has an upcoming appointment");
  const old = p("old", { lastActivityAt: "2025-01-01T00:00:00Z" });
  assert.deepEqual([suggestKeep([old, recent]).person.contactId, suggestKeep([old, recent]).reason], ["r", "It has the most recent activity"]);
  const full = p("full", { email: "a@b.com", phone: "5550102030", tags: ["x"] });
  assert.deepEqual([suggestKeep([p("bare"), full]).person.contactId, suggestKeep([p("bare"), full]).reason], ["full", "It has the most complete details"]);
  assert.equal(suggestKeep([p("x", { createdAt: "2025-01-01T00:00:00Z" }), p("y")]).reason, "It is the oldest record");
});

test("safeguards: do not disturb is left alone, open deals and appointments are protected, low similarity is blocked", () => {
  const dnd = [p("1", { email: "a@b.com", dnd: true }), p("2", { email: "a@b.com" })];
  assert.equal(groupGuard(groupDuplicates(dnd)[0]).level, "block");
  assert.equal(bulkSelect(groupDuplicates(dnd), new Set(), 0).length, 0, "no bulk action touches a do-not-disturb group");
  assert.equal(pairGuard(p("k", { email: "a@b.com" }), p("o", { email: "a@b.com", openDeals: 1 })).level, "block", "the one with a deal must be kept");
  assert.equal(pairGuard(p("k", { email: "a@b.com", openDeals: 1 }), p("o", { email: "a@b.com", upcomingAppointments: 1 })).level, "block", "both busy");
  assert.equal(pairGuard(p("k", { email: "a@b.com", openDeals: 1 }), p("o", { email: "a@b.com" })).level, "ok");
  assert.equal(pairGuard(p("k", { name: "Ann A" }), p("o", { name: "Zed Q" })).level, "block", "very low similarity is blocked");
  const diff = pairGuard(p("k", { email: "a@b.com", phone: "5550102030" }), p("o", { email: "a@b.com", phone: "5550102030", name: "Ada  Lovelace" }));
  assert.equal(diff.level, "ok");
  const warn = pairGuard(p("k", { phone: "5550102030", email: "a@b.com" }), p("o", { phone: "5550102030", email: "b@b.com" }));
  assert.equal(warn.level, "warn");
  assert.deepEqual(warn.warnings, ["The email is different."]);
});

test("source of duplicates names the import day", () => {
  const people = [...Array.from({ length: 30 }, (_, i) => p("i" + i, { createdAt: "2026-06-22T10:00:00Z", source: "CSV import" })), ...Array.from({ length: 10 }, (_, i) => p("n" + i, { createdAt: `2026-07-0${1 + (i % 9)}T10:00:00Z` }))];
  const s = sourceOfDuplicates(people);
  assert.equal(s.days[0].day, "2026-06-22");
  assert.equal(s.days[0].looksLikeImport, true);
  assert.match(s.line, /75% were added on 2026-06-22\. That looks like an import\./);
  assert.deepEqual(s.sources[0], { source: "CSV import", count: 30 });
  assert.equal(sourceOfDuplicates([]).line, "We do not know when these were added.");
});

test("every label is plain: no old jargon", () => {
  for (const kind of ["exact", "format", "name", "shared"] as const) {
    const l = groupLabel({ kind, reasons: ["same email"], confidence: 90 });
    assert.doesNotMatch(l.title + l.line, /merge into kept|platform|survivor|exact match/i);
  }
});
