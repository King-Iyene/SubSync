import assert from "node:assert/strict";
import { test } from "node:test";
import { clampBaseline, clampDrop, emptyTarget, judgeWeek, fromBuckets, median, titleOf, WEEK_MS } from "../dq/health-core.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const ago = (days: number) => NOW - days * 86_400_000;
const FIRST_OLD = ago(60);

test("median of 4 weeks", () => {
  assert.equal(median([10, 12, 8, 30]), 11);
  assert.equal(median([]), 0);
});

test("fromBuckets: five numbers become the last 7 days and the 4 weeks before; missing is zero", () => {
  assert.deepEqual(fromBuckets([2, 2, 1, 1, 1]), { recent: 2, previous: [2, 1, 1, 1] });
  assert.deepEqual(fromBuckets([3]), { recent: 3, previous: [0, 0, 0, 0] });
});

test("normal week: no alert", () => {
  const h = judgeWeek({ recent: 9, previous: [10, 12, 8, 11] }, FIRST_OLD, NOW);
  assert.equal(h.verdict, "ok");
  assert.equal(h.usual, 10.5);
});

test("a drop of more than 50% is a drop; exactly 50% is not", () => {
  const drop = judgeWeek({ recent: 4, previous: [10, 10, 10, 10] }, FIRST_OLD, NOW);
  assert.equal(drop.verdict, "drop");
  assert.equal(drop.dropPct, 60);
  assert.match(titleOf("Roof quote", "form", drop), /got 4 applications in 7 days, usually 10: down 60%/);
  assert.equal(judgeWeek({ recent: 5, previous: [10, 10, 10, 10] }, FIRST_OLD, NOW).verdict, "ok");
});

test("the threshold is a setting", () => {
  assert.equal(judgeWeek({ recent: 7, previous: [10, 10, 10, 10] }, FIRST_OLD, NOW, { dropPct: 25 }).verdict, "drop");
  assert.equal(judgeWeek({ recent: 7, previous: [10, 10, 10, 10] }, FIRST_OLD, NOW, { dropPct: 50 }).verdict, "ok");
  assert.equal(clampDrop(5), 10);
  assert.equal(clampDrop(500), 90);
  assert.equal(clampDrop("x"), 50);
  assert.equal(clampBaseline(0), 1);
  assert.equal(clampBaseline(undefined), 5);
});

test("not enough data: a form younger than 35 days, or one never seen, says so and never alerts", () => {
  assert.equal(judgeWeek({ recent: 0, previous: [10, 10, 10, 10] }, ago(20), NOW).verdict, "not_enough_data");
  assert.equal(judgeWeek({ recent: 0, previous: [10, 10, 10, 10] }, null, NOW).verdict, "not_enough_data");
  assert.equal(judgeWeek({ recent: 0, previous: [10, 10, 10, 10] }, ago(20), NOW).line, "Not enough data yet");
  // exactly 5 weeks of history is enough
  assert.equal(judgeWeek({ recent: 0, previous: [10, 10, 10, 10] }, NOW - 5 * WEEK_MS, NOW).verdict, "drop");
});

test("zero or tiny baseline never alerts", () => {
  const zero = judgeWeek({ recent: 0, previous: [0, 0, 0, 0] }, FIRST_OLD, NOW);
  assert.equal(zero.verdict, "zero_baseline");
  assert.equal(zero.dropPct, null);
  const tiny = judgeWeek({ recent: 0, previous: [3, 4, 2, 4] }, FIRST_OLD, NOW);
  assert.equal(tiny.verdict, "zero_baseline");
  assert.match(tiny.line, /under 5/);
  // the minimum can be lowered
  assert.equal(judgeWeek({ recent: 0, previous: [3, 4, 2, 4] }, FIRST_OLD, NOW, { minBaseline: 2 }).verdict, "drop");
});

test("a rise is not a drop", () => {
  const h = judgeWeek({ recent: 30, previous: [10, 10, 10, 10] }, FIRST_OLD, NOW);
  assert.equal(h.verdict, "ok");
  assert.equal(h.dropPct, 0);
});

test("links: an empty target is flagged, a real one is not", () => {
  assert.equal(emptyTarget(null), false); // the platform did not say: never flagged
  assert.equal(emptyTarget(""), true);
  assert.equal(emptyTarget("   "), true);
  assert.equal(emptyTarget("https://example.com/book"), false);
  const rows = [{ id: "1", target: "https://example.com" }, { id: "2", target: "" }, { id: "3", target: null }, { id: "4", target: "  " }];
  assert.deepEqual(rows.filter((r) => emptyTarget(r.target)).map((r) => r.id), ["2", "4"]);
});
