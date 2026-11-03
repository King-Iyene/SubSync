import assert from "node:assert/strict";
import { test } from "node:test";
import { CRON_EVERY_MINUTES, inSendWindow, nextRefreshAt, REFRESH_DUE_AFTER_MINUTES, REFRESH_EVERY_MINUTES, refreshDue, SEND_CATCHUP_HOURS } from "../sync/schedule.ts";

const MIN = 60_000;
const T0 = Date.parse("2026-11-01T00:00:48Z"); // the live cron wakes a little under a minute past the 5 minute mark

// A fake scheduler: it wakes every CRON_EVERY_MINUTES, starts a cycle when none is queued and one is due (the same two rules the SQL in
// scheduleFastRefresh applies), and a cycle takes `jobMs` to finish. Returns when each cycle was queued.
function simulate(opts: { hours: number; jobMs?: number; skipTicks?: (t: number) => boolean; duplicateTicks?: boolean; due?: (last: number | null, now: number) => boolean }) {
  const due = opts.due ?? refreshDue;
  const starts: number[] = [];
  let last: number | null = null;
  let busyUntil = 0;
  const end = T0 + opts.hours * 60 * MIN;
  for (let t = T0; t < end; t += CRON_EVERY_MINUTES * MIN) {
    if (opts.skipTicks?.(t)) continue;
    for (const at of opts.duplicateTicks ? [t, t + 1000] : [t]) {
      if (at < busyUntil) continue;
      if (due(last, at)) { starts.push(at); last = at; busyUntil = at + (opts.jobMs ?? 30_000); }
    }
  }
  return starts;
}
const gaps = (s: number[]) => s.slice(1).map((t, i) => Math.round((t - s[i]) / MIN));

test("the refresh really runs every 15 minutes (the old rule measured from the finish and ran every 20)", () => {
  const starts = simulate({ hours: 24 });
  assert.equal(REFRESH_EVERY_MINUTES, 15);
  assert.ok(gaps(starts).every((g) => g === 15), `every gap is 15 minutes, got ${[...new Set(gaps(starts))].join(",")}`);
  assert.equal(starts.length, 96);

  // The rule the code had before: due when the last cycle FINISHED at least 15 minutes ago. The scheduler only wakes on the 5 minute grid and
  // a cycle finishes some seconds after its wake-up, so the tick 15 minutes later is a few seconds too early and the next one is used: 20 minutes.
  let lastFinish: number | null = null;
  const old = (_: number | null, now: number) => lastFinish === null || now - lastFinish >= 15 * MIN;
  const oldStarts: number[] = [];
  let busyUntil = 0;
  for (let t = T0; t < T0 + 24 * 60 * MIN; t += 5 * MIN) {
    if (t < busyUntil) continue;
    if (old(null, t)) { oldStarts.push(t); lastFinish = t + 30_000; busyUntil = lastFinish; }
  }
  assert.ok(gaps(oldStarts).every((g) => g === 20), "the old rule gave 20 minutes, which is what the live history showed");
});

test("a slow cycle (several minutes) is not overlapped and does not push the next ones past the due time by more than one tick", () => {
  const starts = simulate({ hours: 12, jobMs: 7 * MIN });
  assert.ok(gaps(starts).every((g) => g === 15 || g === 20), "never closer than 15 minutes, never later than one tick after");
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 7 * MIN, "no overlap");
});

test("after an outage the first wake-up starts a cycle at once, then the rhythm resumes", () => {
  const outageStart = T0 + 2 * 60 * MIN;
  const outageEnd = T0 + 5 * 60 * MIN;
  const starts = simulate({ hours: 8, skipTicks: (t) => t >= outageStart && t < outageEnd });
  const afterOutage = starts.filter((t) => t >= outageEnd);
  assert.equal(afterOutage[0], outageEnd, "the first wake-up after the outage runs a cycle immediately");
  assert.ok(gaps(afterOutage).every((g) => g === 15), "and the 15 minute rhythm is back");
  assert.ok(starts.filter((t) => t >= outageStart && t < outageEnd).length === 0, "nothing ran during the outage");
});

test("a wake-up delivered twice, a second apart, starts one cycle, not two", () => {
  const starts = simulate({ hours: 6, duplicateTicks: true });
  assert.ok(gaps(starts).every((g) => g === 15));
});

test("the next refresh time is on the scheduler's grid and never in the past", () => {
  const now = Date.parse("2026-11-01T10:07:00Z");
  const last = Date.parse("2026-11-01T10:05:48Z");
  const next = nextRefreshAt(last, now);
  assert.equal(new Date(next).toISOString(), "2026-11-01T10:20:00.000Z");
  assert.ok(next >= now);
  assert.equal(nextRefreshAt(null, now), Math.ceil(now / (5 * MIN)) * 5 * MIN, "never refreshed: the next wake-up");
  assert.equal(nextRefreshAt(now - 3 * 60 * MIN, now), Math.ceil(now / (5 * MIN)) * 5 * MIN, "overdue: the next wake-up");
  assert.equal(REFRESH_DUE_AFTER_MINUTES, 14);
});

test("refreshDue boundaries", () => {
  const now = Date.parse("2026-11-01T10:00:00Z");
  assert.equal(refreshDue(null, now), true);
  assert.equal(refreshDue(now - 13 * MIN, now), false);
  assert.equal(refreshDue(now - 14 * MIN, now), true);
});

test("the send window is the chosen hour and the next few, never past midnight", () => {
  assert.equal(SEND_CATCHUP_HOURS, 3);
  assert.equal(inSendWindow(7, 8), false);
  assert.equal(inSendWindow(8, 8), true);
  assert.equal(inSendWindow(10, 8), true);
  assert.equal(inSendWindow(11, 8), false);
  assert.equal(inSendWindow(23, 23), true);
  assert.equal(inSendWindow(0, 23), false, "a new local day is a different day");
  assert.equal(inSendWindow(0, 0), true);
});
