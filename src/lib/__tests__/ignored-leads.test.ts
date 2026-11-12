import assert from "node:assert/strict";
import { test } from "node:test";
import { alertTitle, classifyReply, cleanIgnoredPref, effectivePref, IGNORED_DEFAULTS, moneyWords, rankAccounts, REASON_LABEL, REASONS, shouldAlert, trendWords, ignoredDedupeKey } from "../analytics/ignored-leads-core.ts";


test("an automatic reply is not an answer; a person's reply is; the setting can count automatic ones", () => {
  assert.equal(classifyReply({ human: false, auto: false, countAuto: false }), "reply_nobody");
  assert.equal(classifyReply({ human: false, auto: true, countAuto: false }), "reply_auto");
  assert.equal(classifyReply({ human: true, auto: true, countAuto: false }), "answered");
  assert.equal(classifyReply({ human: false, auto: true, countAuto: true }), "answered");
  assert.equal(classifyReply({ human: false, auto: false, countAuto: true }), "reply_nobody");
});

test("settings are cleaned, and an account's own choice wins over the company's", () => {
  assert.deepEqual(cleanIgnoredPref(null), IGNORED_DEFAULTS);
  assert.equal(cleanIgnoredPref({ minPeople: 9999 }).minPeople, 500);
  assert.equal(cleanIgnoredPref({ waitHours: 0 }).waitHours, 1);
  assert.equal(cleanIgnoredPref({ waitHours: "abc" }).waitHours, 24);
  assert.equal(cleanIgnoredPref({ to: "somebody" }).to, "agency");
  const e = effectivePref({ minPeople: 10, waitHours: 12 }, { minPeople: 3 });
  assert.equal(e.minPeople, 3);
  assert.equal(e.waitHours, 12);
  assert.equal(effectivePref({ enabled: false }, null).enabled, false);
});

test("the alert fires at the account's own threshold and only when switched on", () => {
  assert.equal(shouldAlert(4, IGNORED_DEFAULTS), false);
  assert.equal(shouldAlert(5, IGNORED_DEFAULTS), true);
  assert.equal(shouldAlert(50, { ...IGNORED_DEFAULTS, enabled: false }), false);
  assert.equal(ignoredDedupeKey("L1"), "ignored-leads:L1"); // one open alert per account = one per episode
});

test("accounts are ranked worst first and the order is stable", () => {
  const r = rankAccounts([{ name: "B", people: 3, oldestAt: 5 }, { name: "A", people: 3, oldestAt: 5 }, { name: "C", people: 9, oldestAt: 100 }, { name: "D", people: 3, oldestAt: 1 }]);
  assert.deepEqual(r.map((x) => x.name), ["C", "D", "A", "B"]);
});

test("words: title, trend and money are plain and honest", () => {
  assert.equal(alertTitle("Acme", 1, 3), "Acme is not answering 1 person, the longest for 3 hours");
  assert.match(alertTitle("Acme", 7, 100), /7 people, the longest for 4 days/);
  assert.equal(trendWords(5, null, 30), null);
  assert.equal(trendWords(5, 3, 30), "Up 2 on the 30 days before.");
  assert.equal(trendWords(3, 5, 30), "Down 2 on the 30 days before.");
  assert.equal(moneyWords(0, 4, 4), "Unpriced: none of these people has an open deal with a value.");
  assert.match(moneyWords(12_500, 4, 1), /^\$12,500 of open deals \(counted\)\. 1 person has no priced deal\.$/);
  assert.equal(moneyWords(0, 0, 0), "");
});

test("every reason has plain words with no product or vendor name", () => {
  for (const r of REASONS) assert.ok(REASON_LABEL[r].length > 3);
  assert.doesNotMatch(Object.values(REASON_LABEL).join(" "), /highlevel|gohighlevel|ghl|sub-?account|location/i);
});
