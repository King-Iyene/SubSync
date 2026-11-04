import assert from "node:assert/strict";
import { test } from "node:test";
import { arcsOf, labelAt, pointAt, sectorPath } from "../design/donut.ts";
import { keptParams } from "../design/route.ts";

// The donut's arcs and the address Today keeps. Pure.
test("arcs cover the circle in proportion to the counts, with a gap between neighbours and none for a single slice", () => {
  const arcs = arcsOf([50, 25, 25], 2);
  assert.equal(arcs.length, 3);
  assert.ok(Math.abs(arcs[0].to - arcs[0].from - 178) < 0.01, "half of the circle minus the gap");
  assert.ok(Math.abs(arcs[1].from - arcs[0].to - 2) < 0.01, "a 2 degree gap between neighbours");
  assert.ok(arcs[2].to <= 360, "the last arc stays inside the circle");
  const one = arcsOf([7]);
  assert.equal(one.length, 1);
  assert.ok(one[0].to - one[0].from > 359);
  assert.deepEqual(arcsOf([0, 0]), []);
  assert.deepEqual(arcsOf([3, 0, 2]).map((a) => a.index), [0, 2], "a kind with nothing in it gets no arc and keeps its index");
});

test("a point on the ring: 0 degrees is the top, 90 is the right", () => {
  const top = pointAt(100, 100, 50, 0), right = pointAt(100, 100, 50, 90);
  assert.ok(Math.abs(top.x - 100) < 1e-9 && Math.abs(top.y - 50) < 1e-9);
  assert.ok(Math.abs(right.x - 150) < 1e-9 && Math.abs(right.y - 100) < 1e-9);
});

test("a sector path is closed and a label sits on the side its slice is on", () => {
  assert.match(sectorPath(100, 100, 40, 60, 10, 80), /^M[\d. -]+A60 60 0 0 1 [\d. -]+L[\d. -]+A40 40 0 0 0 [\d. -]+Z$/);
  assert.match(sectorPath(100, 100, 40, 60, 0, 200), /A60 60 0 1 1/, "more than half a turn uses the large arc");
  assert.equal(labelAt(100, 100, 70, 90).anchor, "start");
  assert.equal(labelAt(100, 100, 70, 270).anchor, "end");
  assert.equal(labelAt(100, 100, 70, 0).anchor, "middle");
});

test("the shell keeps Today's own accounts and the card ranges when it rewrites an address, and drops anything else", () => {
  assert.equal(keptParams("#today?ta=abc,def&r.today-changes=30d"), "r.today-changes=30d&ta=abc,def");
  assert.equal(keptParams("#today?ta=../x,abc"), "ta=abc");
  assert.equal(keptParams("#today?hideTest=1&industry=clinic"), "");
  assert.equal(keptParams("#today"), "");
});
