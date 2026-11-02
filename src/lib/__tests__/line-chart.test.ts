import assert from "node:assert/strict";
import { test } from "node:test";
import { dayLabel, layoutLines, nearestDay, segments, stepDay, valuesOn, type LineSeries } from "../design/line-chart.ts";

const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const series = (values: Array<number | null>, from = "2026-10-01"): LineSeries => ({ label: "Health", points: days(from, values.length).map((day, i) => ({ day, value: values[i] })) });

test("the scale starts at zero and ends on a round number above the largest value, with ticks on both axes", () => {
  const l = layoutLines([series([40, 55, 70, 84])]);
  assert.equal(l.yTicks[0], 0);
  assert.equal(l.top, 100, "84 rounds up to 100 in steps of 25");
  assert.deepEqual(l.yTicks, [0, 25, 50, 75, 100]);
  assert.equal(l.yOf(0), 0);
  assert.equal(l.yOf(l.top), 1);
  assert.equal(l.xTicks.length, 4);
  assert.equal(l.xTicks[0].day, "2026-10-01");
  assert.equal(l.xTicks[l.xTicks.length - 1].day, "2026-10-04");
  assert.equal(l.xOf("2026-10-01"), 0);
  assert.equal(l.xOf("2026-10-04"), 1);
  assert.equal(l.withYear, false);
});

test("a fixed ceiling is honoured (a health score is always out of 100) and a floor moves the scale", () => {
  const l = layoutLines([series([20, 30])], { ceiling: 100 });
  assert.equal(l.top, 100);
  assert.deepEqual(l.yTicks, [0, 25, 50, 75, 100]);
  const f = layoutLines([series([60, 80])], { floor: 50, ceiling: 100 });
  assert.equal(f.yOf(50), 0);
  assert.equal(f.yOf(100), 1);
  assert.equal(f.yOf(75), 0.5);
});

test("a gap is a gap: a missing day breaks the line and is never drawn as a value, and days with no value are not on the axis", () => {
  const s = series([10, 20, null, null, 30, 40]);
  assert.deepEqual(segments(s.points).map((seg) => seg.map((p) => p.value)), [[10, 20], [30, 40]]);
  const l = layoutLines([s]);
  assert.equal(l.days.length, 4);
  assert.equal(l.n, 4);
  assert.deepEqual(segments(series([null, null]).points), []);
  assert.deepEqual(valuesOn([s], "2026-10-03"), [null]);
  assert.deepEqual(valuesOn([s], "2026-10-05"), [30]);
});

test("several series share one pair of axes, and a series missing on a day has no value there", () => {
  const a = series([10, 20, 30]);
  const b: LineSeries = { label: "Average", tone: "muted", dashed: true, points: [{ day: "2026-10-02", value: 50 }, { day: "2026-10-03", value: 60 }] };
  const l = layoutLines([a, b]);
  assert.ok(l.top >= 60);
  assert.deepEqual(valuesOn([a, b], "2026-10-01"), [10, null]);
  assert.deepEqual(valuesOn([a, b], "2026-10-02"), [20, 50]);
});

test("the pointer and the arrow keys land on days that have a value", () => {
  const l = layoutLines([series([10, null, null, 40, 50])]);
  assert.deepEqual(l.days, ["2026-10-01", "2026-10-04", "2026-10-05"]);
  assert.equal(nearestDay(l, 0), "2026-10-01");
  assert.equal(nearestDay(l, 0.5), "2026-10-04", "the gap days are not stops");
  assert.equal(nearestDay(l, 1), "2026-10-05");
  assert.equal(nearestDay(l, Number.NaN), null);
  assert.equal(nearestDay(layoutLines([]), 0.5), null);
  assert.equal(stepDay(l.days, null, 1), "2026-10-01");
  assert.equal(stepDay(l.days, null, -1), "2026-10-05");
  assert.equal(stepDay(l.days, "2026-10-01", 1), "2026-10-04");
  assert.equal(stepDay(l.days, "2026-10-05", 1), "2026-10-05", "stays on the last day");
  assert.equal(stepDay(l.days, "2026-10-01", -1), "2026-10-01", "stays on the first day");
  assert.equal(stepDay([], null, 1), null);
});

test("dates read like a person writes them, and the year appears when the chart spans years or more than ten months", () => {
  assert.equal(dayLabel("2026-10-03"), "3 Oct");
  assert.equal(dayLabel("2026-10-03", true), "3 Oct 2026");
  assert.equal(layoutLines([series(Array.from({ length: 60 }, (_, i) => i), "2026-12-01")]).withYear, true, "crosses New Year");
  assert.equal(layoutLines([series(Array.from({ length: 330 }, (_, i) => i), "2025-12-01")]).withYear, true);
  assert.equal(layoutLines([series(Array.from({ length: 90 }, (_, i) => i), "2026-08-01")]).withYear, false);
});

test("an empty chart has no axis to draw", () => {
  const l = layoutLines([series([null, null, null])]);
  assert.deepEqual([l.days.length, l.n, l.xTicks.length], [0, 0, 0]);
  assert.ok(Number.isFinite(l.top));
});
