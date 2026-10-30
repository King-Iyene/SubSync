import assert from "node:assert/strict";
import { test } from "node:test";
import { industryKey, industryOptions, matchesSegment, playbookFor, replyHoursFor, PLAYBOOKS } from "../analytics/playbooks.ts";

test("free-text industries are grouped into the right kind", () => {
  assert.equal(industryKey("Dental"), "medical");
  assert.equal(industryKey("Family dentist"), "medical");
  assert.equal(industryKey("Physiotherapy clinic"), "medical");
  assert.equal(industryKey("Real Estate"), "real_estate");
  assert.equal(industryKey("Estate agent"), "real_estate");
  assert.equal(industryKey("Fashion boutique"), "retail_fashion");
  assert.equal(industryKey("Roofing"), "home_services");
  assert.equal(industryKey("Personal injury law firm"), "legal_finance");
  assert.equal(industryKey("Yoga studio"), "fitness_beauty");
  assert.equal(industryKey("Aerospace parts"), "other");
  assert.equal(industryKey(""), "unset");
  assert.equal(industryKey(null), "unset");
});

test("every playbook has what the app needs to use it", () => {
  for (const p of PLAYBOOKS) {
    assert.ok(p.replyHours >= 1 && p.replyHours <= 24, p.id);
    assert.ok(p.staleDays >= 7 && p.dormantDays >= 7, p.id);
    assert.ok(p.watch.length >= 3 && p.checklist.length >= 3 && p.callLists.length >= 2, p.id);
  }
  assert.ok(playbookFor("Dental")?.privacy, "the medical playbook speaks to privacy");
});

test("filter options count the kinds present and sort the biggest first", () => {
  const options = industryOptions(["Dental", "Dentist", "Roofing", null, "Real estate", "Medical clinic", "Widgets"]);
  assert.deepEqual(options.map((o) => [o.key, o.accounts]), [["medical", 3], ["home_services", 1], ["unset", 1], ["other", 1], ["real_estate", 1]], "ties sort by label");
  assert.equal(options[0].label, "Medical, dental and health clinics");
});

test("a segment matches on industry kind, owner, or both", () => {
  const a = { industry: "Dental", owner: "Dana" };
  assert.equal(matchesSegment(a, {}), true);
  assert.equal(matchesSegment(a, { industry: "medical" }), true);
  assert.equal(matchesSegment(a, { industry: "real_estate" }), false);
  assert.equal(matchesSegment(a, { owner: " dana " }), true);
  assert.equal(matchesSegment(a, { owner: "Marcus" }), false);
  assert.equal(matchesSegment(a, { industry: "medical", owner: "Marcus" }), false);
  assert.equal(matchesSegment({ industry: null, owner: null }, { industry: "unset" }), true);
});

test("the reply target only changes when industry targets are on and the industry is known", () => {
  assert.equal(replyHoursFor("Dental", 4, false), 4);
  assert.equal(replyHoursFor("Dental", 4, true), 2);
  assert.equal(replyHoursFor("Roofing", 4, true), 1);
  assert.equal(replyHoursFor("Widgets", 4, true), 4);
  assert.equal(replyHoursFor(null, 4, true), 4);
});
