import assert from "node:assert/strict";
import { test } from "node:test";
import { columnLayout, topColumns, topSeriesWithOther, MIN_COL, MAX_COL } from "../design/column-layout.ts";

test("1 item: one wide capped column, labelled, no scroll", () => {
  const l = columnLayout(1, 1000);
  assert.equal(l.colWidth, MAX_COL); assert.equal(l.scrolls, false); assert.equal(l.labelled, 1);
});
test("8 items: wide columns with room, all labelled, horizontal labels", () => {
  const l = columnLayout(8, 1000);
  assert.ok(l.colWidth > 40); assert.equal(l.labelled, 8); assert.equal(l.scrolls, false); assert.ok(l.contentWidth <= 1000);
});
test("100 items fit 1000px without scrolling, labels only for the top ones", () => {
  const l = columnLayout(100, 1000);
  assert.equal(l.scrolls, false); assert.ok(l.contentWidth <= 1000); assert.ok(l.colWidth >= 5); assert.equal(l.labelled, 12); assert.equal(l.rotate, true);
});
test("200 items fit a 1400px width (the 1440 desktop) in one screen", () => {
  const l = columnLayout(200, 1300);
  assert.equal(l.scrolls, false); assert.ok(l.contentWidth <= 1300); assert.ok(l.colWidth >= MIN_COL);
});
test("200 items in a narrow 500px box scroll instead of vanishing", () => {
  const l = columnLayout(200, 500);
  assert.equal(l.colWidth, MIN_COL); assert.equal(l.scrolls, true); assert.ok(l.contentWidth > 500);
});
test("zero items and absurd widths do not throw", () => {
  assert.equal(columnLayout(0, 800).contentWidth, 0); assert.equal(columnLayout(5, 0).count, 5);
});
test("topColumns sorts biggest first, stable, and counts the hidden", () => {
  const r = topColumns([{ label: "b", total: 2 }, { label: "a", total: 2 }, { label: "c", total: 9 }], 2);
  assert.deepEqual(r.shown.map((x) => x.label), ["c", "a"]); assert.equal(r.hidden, 1);
  assert.equal(topColumns([{ label: "a", total: 1 }], null).hidden, 0);
});
test("topSeriesWithOther keeps 5 and sums the rest per day", () => {
  const s = Array.from({ length: 200 }, (_, i) => ({ label: `s${i}`, points: [{ day: "d1", value: i }, { day: "d2", value: 1 }] }));
  const r = topSeriesWithOther(s, 5);
  assert.equal(r.shown.length, 5); assert.equal(r.shown[0].label, "s199"); assert.equal(r.other?.count, 195);
  assert.equal(r.other?.points[1].value, 195);
  assert.equal(topSeriesWithOther(s.slice(0, 4), 5).other, null);
});
