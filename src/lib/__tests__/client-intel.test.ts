import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activitySummary, anomalyIndices, compareAccounts, contactGap, goalProgress, periodChange, renewalStatus, roi, segmentStats, zAnomaly,
  type CompareFacts,
} from "../analytics/client-intel.ts";

const NOW = Date.parse("2026-10-16T12:00:00Z"); // mid month
const DAY = 86_400_000;

test("ROI is the value created divided by the monthly fee, and absent without a fee", () => {
  assert.deepEqual(roi({ monthlyFee: 2500, pipelineCreated30d: 18000, wonValue30d: 5000 }), { pipelineMultiple: 7.2, wonMultiple: 2 });
  assert.equal(roi({ monthlyFee: null, pipelineCreated30d: 1, wonValue30d: 1 }), null);
  assert.equal(roi({ monthlyFee: 0, pipelineCreated30d: 1, wonValue30d: 1 }), null);
});

test("renewals are bucketed by days left", () => {
  const at = (d: number) => new Date(NOW + d * DAY).toISOString().slice(0, 10);
  assert.equal(renewalStatus(null, NOW), null);
  assert.equal(renewalStatus("not a date", NOW), null);
  assert.equal(renewalStatus(at(-5), NOW)!.bucket, "overdue");
  assert.equal(renewalStatus(at(20), NOW)!.bucket, "30");
  assert.equal(renewalStatus(at(45), NOW)!.bucket, "60");
  assert.equal(renewalStatus(at(80), NOW)!.bucket, "90");
  assert.equal(renewalStatus(at(200), NOW)!.bucket, "later");
});

test("a client not contacted for 14 days, or ever, is flagged", () => {
  assert.deepEqual(contactGap(null, NOW), { days: null, flagged: true });
  assert.equal(contactGap(NOW - 13 * DAY, NOW).flagged, false);
  assert.equal(contactGap(NOW - 14 * DAY, NOW).flagged, true);
});

test("goal progress accounts for how far through the month we are", () => {
  // Oct 16 noon: about half way through a 31 day month.
  const half = goalProgress(100, 50, NOW);
  assert.equal(half.status, "on_track");
  assert.equal(goalProgress(100, 20, NOW).status, "behind");
  assert.equal(goalProgress(100, 40, NOW).status, "at_risk");
  assert.equal(goalProgress(100, 120, NOW).status, "achieved");
  assert.equal(half.pct, 50);
});

test("period change gives the difference and a percentage when there is a base", () => {
  assert.deepEqual(periodChange(120, 100), { current: 120, previous: 100, delta: 20, pct: 20 });
  assert.equal(periodChange(5, 0).pct, null);
});

test("anomaly needs history and flags a point far from the trend", () => {
  const calm = Array.from({ length: 20 }, (_, i) => 100 + (i % 3));
  assert.equal(zAnomaly([...calm, 101]), null);
  const hit = zAnomaly([...calm, 40]);
  assert.ok(hit && hit.direction === "below");
  assert.equal(zAnomaly([1, 2, 3]), null, "too little history");
  const steady = Array.from({ length: 20 }, (_, i) => 200 + (i % 2));
  assert.equal(zAnomaly([...steady, 215]), null, "statistically odd but only a 7% change");
  assert.ok(zAnomaly([...steady, 320]), "a 60% jump is flagged");
  assert.deepEqual(anomalyIndices([...calm, 40]), [20]);
});

const facts = (over: Partial<CompareFacts>): CompareFacts => ({ name: "A", new30d: 10, winRate: 0.5, avgCycleDays: 20, unanswered: 0, completenessPct: 70, score: 60, openValue: 1000, ...over });

test("account comparison explains the real differences and says so when there are none", () => {
  const notes = compareAccounts(facts({ name: "Client A", new30d: 45, winRate: 0.4, unanswered: 9 }), facts({ name: "Client B", new30d: 15, winRate: 0.62, unanswered: 1 }));
  assert.ok(notes.some((n) => n.includes("3x the new contacts")));
  assert.ok(notes.some((n) => n.includes("Client B wins more")));
  assert.ok(notes.some((n) => n.includes("Follow-up speed")));
  assert.deepEqual(compareAccounts(facts({ name: "X" }), facts({ name: "Y" })), ["X and Y look similar on the measures we track."]);
});

test("segments group by industry and average the scores", () => {
  const s = segmentStats([
    { industry: "Dental", score: 80, winRate: 0.6, openValue: 100 }, { industry: "Dental", score: 60, winRate: null, openValue: 50 },
    { industry: null, score: 40, winRate: 0.2, openValue: 10 },
  ]);
  assert.equal(s[0].industry, "Dental");
  assert.equal(s[0].avgScore, 70);
  assert.equal(s[0].avgWinRate, 0.6);
  assert.equal(s[1].industry, "Not set");
});

test("activity summary reads like a sentence", () => {
  assert.equal(activitySummary({ name: "Acme", newContacts: 45, dealsWon: 4, wonValue: 32000, pipelineCreated: 90000, days: 30 }),
    "In the last 30 days for Acme: 45 new contacts, $90,000 of new pipeline, 4 deals won worth $32,000.");
  assert.match(activitySummary({ name: "Acme", newContacts: 1, dealsWon: 0, wonValue: 0, pipelineCreated: 0, days: 30 }), /1 new contact, no deals closed yet/);
});
