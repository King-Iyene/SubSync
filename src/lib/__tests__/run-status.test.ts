import assert from "node:assert/strict";
import { test } from "node:test";
import { changedLine, progressWords, runState, SYNC_THROTTLE_MS, throttle } from "../sync/run-status.ts";

test("one sync per account per 30 seconds: the second press is told how long to wait", () => {
  const t0 = 1_000_000;
  assert.deepEqual(throttle(null, t0), { ok: true });
  assert.deepEqual(throttle(t0 - SYNC_THROTTLE_MS, t0), { ok: true });
  assert.deepEqual(throttle(t0 - 10_000, t0), { ok: false, retryAfterSec: 20 });
  assert.deepEqual(throttle(t0 - 29_999, t0), { ok: false, retryAfterSec: 1 });
});

test("run state: syncing while work is queued, error when something failed, done otherwise", () => {
  assert.equal(runState({ pending: 3, failed: 1, done: 5 }), "syncing");
  assert.equal(runState({ pending: 0, failed: 1, done: 5 }), "error");
  assert.equal(runState({ pending: 0, failed: 0, done: 5 }), "done");
  assert.equal(runState({ pending: 0, failed: 0, done: 0 }), "idle");
});

test("the words of the popup", () => {
  assert.equal(changedLine({ contacts: 12, conversations: 1, appointments: 0 }), "12 contacts, 1 conversation, 0 appointments updated");
  assert.equal(progressWords({ done: 3, total: 10 }), "3 of 10 steps done");
  assert.equal(progressWords({ done: 0, total: 0 }), "Starting...");
});
