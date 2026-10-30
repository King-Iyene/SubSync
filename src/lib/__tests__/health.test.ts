import assert from "node:assert/strict";
import { test } from "node:test";
import { healthLevel } from "../analytics/health-level.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const hrs = (h: number) => NOW - h * 3_600_000;

test("no finished sync yet is idle, not an error", () => {
  const h = healthLevel({ now: NOW, lastSyncAt: null, failedJobs24h: 0, totalJobs24h: 0, tokenExpiresAt: null });
  assert.equal(h.level, "idle");
});

test("a recent clean sync is healthy", () => {
  const h = healthLevel({ now: NOW, lastSyncAt: hrs(1), failedJobs24h: 0, totalJobs24h: 40, tokenExpiresAt: hrs(-20) });
  assert.equal(h.level, "healthy");
  assert.equal(h.stale, false);
});

test("a sync older than 6 hours is degraded and stale", () => {
  const h = healthLevel({ now: NOW, lastSyncAt: hrs(9), failedJobs24h: 0, totalJobs24h: 40, tokenExpiresAt: null });
  assert.equal(h.level, "degraded");
  assert.equal(h.stale, true);
});

test("a few failures among many jobs are tolerated, many are not", () => {
  assert.equal(healthLevel({ now: NOW, lastSyncAt: hrs(1), failedJobs24h: 1, totalJobs24h: 100, tokenExpiresAt: null }).level, "healthy");
  assert.equal(healthLevel({ now: NOW, lastSyncAt: hrs(1), failedJobs24h: 15, totalJobs24h: 100, tokenExpiresAt: null }).level, "degraded");
  assert.equal(healthLevel({ now: NOW, lastSyncAt: hrs(1), failedJobs24h: 8, totalJobs24h: 10, tokenExpiresAt: null }).level, "down");
});

test("a connection not refreshed for days is down", () => {
  const h = healthLevel({ now: NOW, lastSyncAt: hrs(1), failedJobs24h: 0, totalJobs24h: 10, tokenExpiresAt: NOW - 4 * 86_400_000 });
  assert.equal(h.level, "down");
});
