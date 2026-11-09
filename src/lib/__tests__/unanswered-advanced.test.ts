import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasRepeatUnread, isBreachSpike, isHandoffWindow, isUnansweredOutcome, ownerlessFor, patternCounts,
  slaTargetLabel, shouldEscalateUnacknowledged, unansweredBusinessElapsedMs, weeklyReceipt, workloadWarnings,
} from "../analytics/unanswered-advanced.ts";

test("business clock pauses nights and weekends in the account time zone", () => {
  const start = Date.parse("2026-11-06T21:00:00Z"); // Friday, 4pm in New York
  const end = Date.parse("2026-11-09T15:00:00Z"); // Monday, 10am in New York
  assert.equal(unansweredBusinessElapsedMs(start, end, "America/New_York", 9, 17), 2 * 60 * 60_000);
});

test("business clock handles closed hours and invalid schedules explicitly", () => {
  const start = Date.parse("2026-11-09T12:00:00Z");
  assert.equal(unansweredBusinessElapsedMs(start, start + 8 * 60 * 60_000, "UTC", 9, 17), 5 * 60 * 60_000);
  assert.throws(() => unansweredBusinessElapsedMs(start, start + 1, "UTC", 17, 9), RangeError);
});

test("escalation waits for an unread, unresolved owner alert and its grace period", () => {
  assert.equal(shouldEscalateUnacknowledged({ createdAt: 0, now: 119 * 60_000, readAt: null, resolvedAt: null }), false);
  assert.equal(shouldEscalateUnacknowledged({ createdAt: 0, now: 120 * 60_000, readAt: null, resolvedAt: null }), true);
  assert.equal(shouldEscalateUnacknowledged({ createdAt: 0, now: 30 * 60_000, readAt: null, resolvedAt: null, graceMinutes: 30 }), true);
  assert.equal(shouldEscalateUnacknowledged({ createdAt: 0, now: 200 * 60_000, readAt: 1, resolvedAt: null }), false);
  assert.equal(shouldEscalateUnacknowledged({ createdAt: 0, now: 200 * 60_000, readAt: null, resolvedAt: 1 }), false);
});

test("owner workload warning is thresholded, stable and excludes unassigned conversations", () => {
  const rows: Array<{ ownerId: string | null }> = [...Array(10)].map(() => ({ ownerId: "setter-b" }));
  rows.push({ ownerId: "setter-a" }, { ownerId: null });
  assert.deepEqual(workloadWarnings(rows), [{ ownerId: "setter-b", waiting: 10 }]);
});

test("repeat patterns are grouped by owner, source and local hour", () => {
  assert.deepEqual(patternCounts([
    { ownerId: "u2", source: "Referral", localHour: 10 },
    { ownerId: "u1", source: "Referral", localHour: 10 },
    { ownerId: null, source: null, localHour: 21 },
  ]), {
    byOwner: [{ key: "u1", count: 1 }, { key: "u2", count: 1 }],
    bySource: [{ key: "Referral", count: 2 }],
    byHour: [{ key: 10, count: 2 }, { key: 21, count: 1 }],
  });
});

test("breach spike needs enough history, a nonzero baseline and a twofold increase", () => {
  assert.equal(isBreachSpike(10, [2, 2, 2, 2, 2, 2, 2]), true);
  assert.equal(isBreachSpike(4, [1, 1, 1]), false);
  assert.equal(isBreachSpike(10, [0, 0, 0]), false);
  assert.equal(isBreachSpike(10, [1, 2]), false);
});

test("handoff alert window is the final half-hour of a weekday shift", () => {
  assert.equal(isHandoffWindow(Date.parse("2026-11-09T16:45:00Z"), "UTC", 17), true);
  assert.equal(isHandoffWindow(Date.parse("2026-11-09T16:20:00Z"), "UTC", 17), false);
  assert.equal(isHandoffWindow(Date.parse("2026-11-08T16:45:00Z"), "UTC", 17), false);
});

test("ownerless alerts wait one hour and never fire for assigned conversations", () => {
  assert.equal(ownerlessFor(60 * 60_000, 0, null), true);
  assert.equal(ownerlessFor(30 * 60_000, 0, null), false);
  assert.equal(ownerlessFor(60 * 60_000, 0, "setter"), false);
});

test("weekly receipt counts are nonnegative and uses the lower middle response time", () => {
  assert.deepEqual(weeklyReceipt({ breached: 4, recovered: 3, unresolved: 1, recoveryMinutes: [60, 10, 30, -5] }), {
    breached: 4, recovered: 3, unresolved: 1, medianMinutes: 30,
  });
  assert.equal(weeklyReceipt({ breached: -1, recovered: 0, unresolved: 0, recoveryMinutes: [] }).breached, 0);
});

test("repeat unread signal says only what the stored unread counter proves", () => {
  assert.equal(hasRepeatUnread(1), false);
  assert.equal(hasRepeatUnread(2), true);
  assert.equal(hasRepeatUnread(-1), false);
});

test("SLA preset labels reflect configured account or industry targets", () => {
  assert.equal(slaTargetLabel({ minutes: 15, industryPreset: true }), "Industry reply target");
  assert.equal(slaTargetLabel({ minutes: 15, industryPreset: false }), "Account reply target");
  assert.equal(slaTargetLabel({ minutes: null, industryPreset: false }), "Default reply target");
});

test("close-out choices are from the fixed non-free-text set", () => {
  assert.equal(isUnansweredOutcome("appointment_booked"), true);
  assert.equal(isUnansweredOutcome("arbitrary text"), false);
});
