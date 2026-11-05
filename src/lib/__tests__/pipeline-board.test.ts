import assert from "node:assert/strict";
import { test } from "node:test";
import type { Deal } from "../analytics/pipeline-intel.ts";
import { boardOf, stageLimits, trendWorthDrawing, DAY } from "../analytics/pipeline-board.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = (d: number) => NOW - d * DAY;
let n = 0;
const deal = (o: Partial<Deal> = {}): Deal => ({
  opportunityId: `o${++n}`, locationId: "L1", locationName: "Acme", pipelineId: "p1", pipelineName: "Sales", stageId: "s1", stageName: "New", stageOrder: 1,
  name: "Deal", contactName: "X", value: 1000, status: "open", createdAt: ago(40), stageChangedAt: ago(3), statusChangedAt: null, lastActivityAt: ago(1), assignedTo: "u1", ...o,
});
const none = new Map<string, { contactId: string | null; upcoming: boolean }>();

test("each deal is counted once, even when it appears twice", () => {
  const a = deal({ opportunityId: "dup", value: 500 });
  const b = boardOf({ deals: [a, { ...a }, deal({ value: 250 })], now: NOW, fallbackStaleDays: 14, contacts: none });
  assert.equal(b.headline.openCount, 2);
  assert.equal(b.headline.openValue, 750);
  assert.equal(b.pipelines[0].openValue, 750);
  assert.equal(b.pipelines[0].stages.reduce((s, x) => s + x.value, 0), 750);
});

test("closed deals and zero-value deals are not in the open money", () => {
  const b = boardOf({ deals: [deal({ status: "won" }), deal({ status: "lost" }), deal({ value: 0 }), deal({ value: 400 })], now: NOW, fallbackStaleDays: 14, contacts: none });
  assert.deepEqual([b.headline.openCount, b.headline.openValue], [1, 400]);
});

test("stuck is judged per stage: the same age is fine in a slow stage and stuck in a fast one", () => {
  // Stage "Quote": most deals have sat 20 days (so the limit is 30, capped). Stage "New": most have sat 2 days (limit 5, the floor).
  const slow = Array.from({ length: 6 }, () => deal({ stageId: "q", stageName: "Quote", stageOrder: 2, stageChangedAt: ago(20), lastActivityAt: ago(10) }));
  const fast = Array.from({ length: 5 }, () => deal({ stageId: "n", stageName: "New", stageOrder: 1, stageChangedAt: ago(2), lastActivityAt: ago(2) }));
  const probeSlow = deal({ stageId: "q", stageName: "Quote", stageOrder: 2, stageChangedAt: ago(22), lastActivityAt: ago(10) });
  const probeFast = deal({ stageId: "n", stageName: "New", stageOrder: 1, stageChangedAt: ago(12), lastActivityAt: ago(10) });
  const limits = stageLimits([...slow, ...fast, probeSlow, probeFast], NOW, 14);
  assert.equal(limits.get("L1|p1|q"), 30);
  assert.equal(limits.get("L1|p1|n"), 5);
  const b = boardOf({ deals: [...slow, ...fast, probeSlow, probeFast], now: NOW, fallbackStaleDays: 14, contacts: none });
  const stuckIds = new Set(b.stuckQueue.map((x) => x.id));
  assert.ok(!stuckIds.has(probeSlow.opportunityId), "22 days in a slow stage is not stuck");
  assert.ok(stuckIds.has(probeFast.opportunityId), "12 days in a fast stage is stuck");
});

test("a deal with recent activity is not stuck, however long it sits in the stage", () => {
  const d = deal({ stageChangedAt: ago(60), lastActivityAt: ago(2) });
  assert.equal(boardOf({ deals: [d], now: NOW, fallbackStaleDays: 14, contacts: none }).headline.stuckCount, 0);
  const e = deal({ stageChangedAt: ago(60), lastActivityAt: ago(30) });
  assert.equal(boardOf({ deals: [e], now: NOW, fallbackStaleDays: 14, contacts: none }).headline.stuckCount, 1);
});

test("no next step: nothing upcoming and quiet for a week", () => {
  const a = deal({ lastActivityAt: ago(20) }), b = deal({ lastActivityAt: ago(20) }), c = deal({ lastActivityAt: ago(1) });
  const contacts = new Map([[b.opportunityId, { contactId: "c2", upcoming: true }]]);
  assert.equal(boardOf({ deals: [a, b, c], now: NOW, fallbackStaleDays: 14, contacts }).headline.noNextStepCount, 1);
});

test("stuck money per client, biggest first, and the queue", () => {
  const mk = (loc: string, v: number) => deal({ locationId: loc, locationName: loc, value: v, stageChangedAt: ago(50), lastActivityAt: ago(40), pipelineId: `p-${loc}` });
  const b = boardOf({ deals: [mk("A", 100), mk("B", 900), mk("B", 100)], now: NOW, fallbackStaleDays: 14, contacts: none });
  assert.deepEqual(b.byClient.map((c) => [c.locationId, c.stuckValue, c.stuckCount]), [["B", 1000, 2], ["A", 100, 1]]);
  assert.equal(b.stuckQueue.length, 3);
});

test("the trend line needs 14 days and a clear change", () => {
  const flat = Array.from({ length: 20 }, () => ({ openValue: 1000 }));
  const moving = Array.from({ length: 20 }, (_, i) => ({ openValue: 1000 + i * 100 }));
  assert.equal(trendWorthDrawing(flat), false);
  assert.equal(trendWorthDrawing(moving.slice(0, 10)), false);
  assert.equal(trendWorthDrawing(moving), true);
});
