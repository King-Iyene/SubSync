import assert from "node:assert/strict";
import { test } from "node:test";
import { particleCounts, pileRows, riverLayout, ribbonPath, type RiverIn } from "../design/river-layout.ts";

const st = (i: number, open: number, lost = 0, stuck = 0): RiverIn => ({ id: `s${i}`, name: `S${i}`, open, stuck, lost });
const O = { length: 800, thick: 300, nodeW: 30, enough: true };

test("reach adds up and conversion is what reached the next step", () => {
  const L = riverLayout([st(0, 600, 100), st(1, 300, 400), st(2, 100)], 200, O);
  assert.deepEqual(L.nodes.map((n) => n.reach), [1700, 1000, 300, 200]);
  assert.ok(Math.abs((L.nodes[0].conv as number) - 1000 / 1700) < 1e-9);
  assert.equal(L.leakIndex, 1);
});
test("works with counts only: no money still draws piles and ribbons, never NaN", () => {
  const L = riverLayout([st(0, 5, 1), st(1, 2, 0)], 0, O);
  assert.equal(L.empty, false);
  for (const n of L.nodes) for (const v of [n.al, n.ac, n.h, n.flowH, n.openH, n.lostH]) assert.ok(Number.isFinite(v));
  assert.equal(L.nodes[0].reach, 8);
});
test("nothing anywhere is empty", () => {
  assert.equal(riverLayout([st(0, 0), st(1, 0)], 0, O).empty, true);
  assert.equal(riverLayout([], 0, O).empty, true);
});
test("pile height is proportional to the measure and fits the chart", () => {
  const L = riverLayout([st(0, 1000), st(1, 500)], 0, { ...O, thick: 200 });
  assert.ok(L.nodes[0].h <= 200 + 1e-6);
  assert.ok(Math.abs(L.nodes[0].openH / L.nodes[1].openH - 2) < 0.2);
});
test("a ribbon is as thick where it leaves as where the next node takes it", () => {
  const L = riverLayout([st(0, 600, 100), st(1, 300, 400)], 200, O);
  for (const l of L.links) assert.ok(Math.abs(l.th - L.nodes[l.to].h) < 1e-6);
});
test("leak is only named with enough closed deals; stuck is clamped inside the pile", () => {
  assert.equal(riverLayout([st(0, 10, 5), st(1, 10, 9)], 3, { ...O, enough: false }).leakIndex, null);
  const L = riverLayout([st(0, 10, 0, 99)], 1, O);
  assert.ok(L.nodes[0].stuckH <= L.nodes[0].openH + 1e-9);
});
test("one lost tail per stage that lost deals, carrying the same amount as the rows", () => {
  const L = riverLayout([st(0, 10, 4), st(1, 10, 0)], 3, O);
  assert.equal(L.tails.length, 1);
  assert.equal(L.tails[0].amount, 4);
});
test("particles never exceed the cap", () => {
  const c = particleCounts(Array.from({ length: 30 }, () => 100), 60);
  assert.ok(c.reduce((a, b) => a + b, 0) <= 60);
  assert.deepEqual(particleCounts([0, 0]), [0, 0]);
});
test("pile rows are bounded and the ribbon path is closed and finite", () => {
  assert.equal(pileRows(0), 0);
  assert.equal(pileRows(1), 1);
  assert.equal(pileRows(9999), 40);
  const d = ribbonPath(0, 0, 10, 100, 20, 10, (a, c) => [a, c]);
  assert.ok(d.endsWith("Z") && !/NaN/.test(d));
});
