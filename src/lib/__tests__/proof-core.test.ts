import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeOf, defaultSections, headline, METRIC_INFO, monthWindow, normalizeSections, periodChoices, reportText, samplePayload, statusOf, textProblem, trendMonths, trendReady, validPeriod, type PrPayload,
} from "../analytics/proof-core.ts";

const NOW = new Date("2026-11-11T10:00:00Z");

test("a finished month is compared with the whole month before, the month in progress with the same number of days", () => {
  const done = monthWindow("2026-10", NOW);
  assert.deepEqual([done.from, done.to, done.prevFrom, done.prevTo, done.partial], ["2026-10-01", "2026-11-01", "2026-09-01", "2026-10-01", false]);
  const now = monthWindow("2026-11", NOW);
  assert.equal(now.partial, true);
  assert.deepEqual([now.from, now.to, now.lastDay], ["2026-11-01", "2026-11-12", "2026-11-11"]);
  assert.deepEqual([now.prevFrom, now.prevTo], ["2026-10-01", "2026-10-12"], "11 days of November against 11 days of October");
  assert.equal(monthWindow("2027-01", new Date("2027-01-20T00:00:00Z")).prevMonth, "2026-12", "across a year");
  assert.equal(monthWindow("2026-03", new Date("2026-03-31T12:00:00Z")).prevTo, "2026-03-01", "a short month before is never overrun");
});

test("the months a report can be made for, and the six on the trend line", () => {
  assert.deepEqual(periodChoices(NOW, 3), ["2026-10", "2026-11", "2026-09"]);
  assert.equal(validPeriod("2026-10", NOW), true);
  assert.equal(validPeriod("2026-12", NOW), false, "never the future");
  assert.equal(validPeriod("2026-13", NOW), false);
  assert.equal(validPeriod("2020-01", NOW), false, "not two years back");
  assert.equal(validPeriod("../x", NOW), false);
  assert.deepEqual(trendMonths("2026-02"), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
});

test("a change is worded with a direction word and only against the account's own earlier month", () => {
  assert.deepEqual(changeOf("count", 120, 100, "September"), { text: "up 20% on September", tone: "good" });
  assert.deepEqual(changeOf("count", 80, 100, "September"), { text: "down 20% on September", tone: "bad" });
  assert.deepEqual(changeOf("count", 5, 2, "September"), { text: "September: 2", tone: "flat" }, "a tiny earlier month is quoted, not turned into a percentage");
  assert.equal(changeOf("count", 5, null, "September"), null, "no earlier month, no comparison");
  assert.equal(changeOf("count", null, 5, "September"), null);
  assert.deepEqual(changeOf("pct", 91, 84, "September"), { text: "up 7 points on September", tone: "good" });
  assert.equal(changeOf("pct", 15, 22, "September", "down")?.tone, "good", "a lower no-show rate is good");
  assert.deepEqual(changeOf("minutes", 3, 9, "September", "down"), { text: "faster than September (9 min)", tone: "good" });
  assert.equal(changeOf("minutes", 10, 10.5, "September", "down")?.tone, "flat");
  assert.equal(changeOf("money", 50, 0, "September")?.text, "September: $0", "a zero earlier value is quoted");
});

const base = (): PrPayload => ({ ...samplePayload(NOW), account: "Acme Roofing" });

test("the headline uses only measured figures and leaves a sentence out when its figure is missing", () => {
  const p = base();
  assert.match(headline(p), /^In October, 142 new leads came in and 91% got a first reply within 5 min\./);
  assert.match(headline(p), /11 leads that had gone quiet were won back, 38 appointments were booked and 9 deals won \(\$23,400\)\./);
  const none: PrPayload = { ...p, leads: { current: null, previous: null }, withinTarget: { current: null, previous: null }, recovered: { current: null, previous: null }, booked: { current: null, previous: null }, won: { deals: { current: null, previous: null }, value: { current: null, previous: null } } };
  assert.match(headline(none), /^Not enough has been recorded for October 2026 yet/);
  assert.match(headline({ ...p, partial: true }), /^So far in October/);
});

test("trend lines need two real months, a gap is not a flat line", () => {
  assert.equal(trendReady([null, null, 5, null, null, null]), false);
  assert.equal(trendReady([null, 3, null, 5, null, null]), true);
  const sample = samplePayload(NOW);
  assert.equal(sample.trend.length, 6);
});

test("the copied text has only switched-on sections, no vendor word, and the closing note", () => {
  const p = base();
  const all = reportText(p, { name: "Brightside Marketing", logoUrl: null, color: null }, "Hello", defaultSections());
  assert.match(all, /^Brightside Marketing: Acme Roofing\nOctober 2026\n\nHello\n\nIn October/);
  assert.match(all, /- Typical first reply: 3 min \(faster than September \(5 min\)\)/);
  assert.match(all, /- Value of deals won: \$23,400 \(up 18% on September\)/);
  assert.match(all, /not a promise about the future/);
  const few = reportText(p, { name: "B", logoUrl: null, color: null }, null, { ...defaultSections(), appointments: false, pipeline: false, timeline: false });
  assert.doesNotMatch(few, /Appointments booked|Deals won|What we did for you/);
  assert.doesNotMatch(all, /subsync|gohighlevel|highlevel|\bghl\b|sub-account|location|agency/i);
  const gone: PrPayload = { ...p, replyMedian: { current: null, previous: null } };
  assert.doesNotMatch(reportText(gone, { name: "B", logoUrl: null, color: null }, null, defaultSections()), /Typical first reply/, "an unmeasured figure is left out, never printed as zero");
});

test("every metric has a plain meaning and a formula, and none names the product or the platform", () => {
  for (const [k, i] of Object.entries(METRIC_INFO)) {
    assert.ok(i.meaning.length > 20 && i.formula.length > 30, k);
    assert.doesNotMatch(`${i.label} ${i.meaning} ${i.formula}`, /subsync|gohighlevel|highlevel|\bghl\b|sub-account|location|agency|benchmark/i, k);
  }
});

test("text that names the platform, or promises a result, is refused", () => {
  assert.equal(textProblem("Thanks for being a client"), null);
  assert.ok(textProblem("Powered by GoHighLevel"));
  assert.ok(textProblem("We guarantee a reply in 5 minutes"));
  assert.ok(textProblem("My sub-account"));
});

test("sections: unknown keys and wrong types are ignored", () => {
  assert.deepEqual(normalizeSections({ reply: false, hack: false, trends: "no" }), { ...defaultSections(), reply: false });
  assert.deepEqual(normalizeSections(null), defaultSections());
});

test("status of a report: not prepared, draft, shared, viewed after it was shared", () => {
  assert.equal(statusOf({ exists: false, shared: false, sharedAt: null, lastViewedAt: null }), "none");
  assert.equal(statusOf({ exists: true, shared: false, sharedAt: null, lastViewedAt: null }), "draft");
  assert.equal(statusOf({ exists: true, shared: true, sharedAt: "2026-11-02T00:00:00Z", lastViewedAt: null }), "shared");
  assert.equal(statusOf({ exists: true, shared: true, sharedAt: "2026-11-02T00:00:00Z", lastViewedAt: "2026-11-01T00:00:00Z" }), "shared", "an open before it was shared does not count");
  assert.equal(statusOf({ exists: true, shared: true, sharedAt: "2026-11-02T00:00:00Z", lastViewedAt: "2026-11-03T00:00:00Z" }), "viewed");
});
