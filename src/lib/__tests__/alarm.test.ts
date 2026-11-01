import assert from "node:assert/strict";
import { test } from "node:test";
import { alarmAction, evaluateInstall, REMIND_EVERY_MINUTES, type AlarmInput, type AlarmVerdict } from "../sync/alarm.ts";
import { summariseCycles } from "../sync/timeline.ts";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const base = (o: Partial<AlarmInput> = {}): AlarmInput => ({ installationId: "inst-1", oldestSuccessAt: ago(10), accounts: 3, pendingJobs: 0, oldestPendingMinutes: null, failedJobs24h: 0, ...o });

test("the alarm is raised only when the oldest account is older than 30 minutes", () => {
  assert.equal(evaluateInstall(base({ oldestSuccessAt: ago(29) }), NOW).state, "ok");
  assert.equal(evaluateInstall(base({ oldestSuccessAt: ago(30) }), NOW).state, "ok");
  const v = evaluateInstall(base({ oldestSuccessAt: ago(31), pendingJobs: 4, failedJobs24h: 2 }), NOW);
  assert.equal(v.state, "alarm");
  assert.equal(v.ageMinutes, 31);
  assert.match(v.why, /31 minutes ago.*4 jobs waiting, 2 failed/);
});

test("no accounts is idle, a first sync in progress is not an alarm, a first sync that goes nowhere is", () => {
  assert.equal(evaluateInstall(base({ oldestSuccessAt: null, accounts: 0 }), NOW).state, "idle");
  assert.equal(evaluateInstall(base({ oldestSuccessAt: null, pendingJobs: 5, oldestPendingMinutes: 4 }), NOW).state, "first_sync");
  assert.equal(evaluateInstall(base({ oldestSuccessAt: null, pendingJobs: 5, oldestPendingMinutes: 45 }), NOW).state, "alarm");
  assert.equal(evaluateInstall(base({ oldestSuccessAt: null, pendingJobs: 0 }), NOW).state, "alarm");
});

const alarm: AlarmVerdict = { installationId: "inst-1", state: "alarm", ageMinutes: 40, why: "x" };
const ok: AlarmVerdict = { installationId: "inst-1", state: "ok", ageMinutes: 3, why: "Fresh." };

test("one line when an alarm starts, a reminder an hour later, one line when it clears", () => {
  assert.equal(alarmAction(alarm, { action: null, at: null }, NOW), "raise");
  assert.equal(alarmAction(alarm, { action: "sync.recovered", at: NOW - 3_600_000 }, NOW), "raise", "a new alarm after a recovery");
  assert.equal(alarmAction(alarm, { action: "sync.alarm", at: NOW - 10 * 60_000 }, NOW), "none", "still standing, already written down");
  assert.equal(alarmAction(alarm, { action: "sync.alarm", at: NOW - REMIND_EVERY_MINUTES * 60_000 }, NOW), "remind");
  assert.equal(alarmAction(ok, { action: "sync.alarm", at: NOW - 5 * 60_000 }, NOW), "recover");
  assert.equal(alarmAction(ok, { action: "sync.recovered", at: NOW - 5 * 60_000 }, NOW), "none");
  assert.equal(alarmAction(ok, { action: null, at: null }, NOW), "none");
  assert.equal(alarmAction({ ...ok, state: "first_sync" }, { action: "sync.alarm", at: NOW }, NOW), "none", "a first sync neither raises nor clears");
});

test("a twelve hour outage writes a handful of lines, not hundreds", () => {
  let last = { action: null as "sync.alarm" | "sync.recovered" | null, at: null as number | null };
  let lines = 0;
  for (let t = NOW; t < NOW + 12 * 3_600_000; t += 10 * 60_000) {
    const a = alarmAction(alarm, last, t);
    if (a !== "none") { lines++; last = { action: "sync.alarm", at: t }; }
  }
  assert.ok(lines <= 13, `wrote ${lines} lines in 12 hours`);
  assert.ok(lines >= 12);
});

test("cycle summary: the median gap, the longest gap and the gaps over 30 minutes", () => {
  const T = Date.parse("2026-11-01T00:00:00Z");
  const m = (min: number) => T + min * 60_000;
  const s = summariseCycles([m(0), m(15), m(30), m(45), m(135), m(150)], m(160));
  assert.equal(s.cycles, 6);
  assert.equal(s.medianGapMinutes, 15);
  assert.equal(s.longestGap?.minutes, 90);
  assert.equal(s.slowGaps.length, 1);
  assert.equal(s.sinceLastMinutes, 10);
  const empty = summariseCycles([], m(0));
  assert.equal(empty.cycles, 0);
  assert.equal(empty.medianGapMinutes, null);
  assert.equal(empty.longestGap, null);
});
