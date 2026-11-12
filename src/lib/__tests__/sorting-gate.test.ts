import assert from "node:assert/strict";
import { test } from "node:test";
import { foldLanes, layoutGate, MAX_DOTS_PER_LANE, MAX_LANES, shareDots, type GateLaneIn, type Rect } from "../design/sorting-gate.ts";

const lane = (i: number, leads = 400 - i * 30): GateLaneIn => ({ key: `s${i}`, label: `Source number ${i} with a long name`, leads, dups: Math.round(leads * 0.2), junk: Math.round(leads * 0.1) });
const lanes = (n: number) => Array.from({ length: n }, (_, i) => lane(i));
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, w: number, h: number) => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= w + 0.5 && r.y + r.h <= h + 0.5;

test("labels never overlap each other, a stream or an output, and everything stays inside, phone to wide", () => {
  for (const n of [1, 3, 7, 12]) for (const w of [390, 640, 1000, 1440]) for (const compact of [false, true]) {
    const L = layoutGate({ lanes: lanes(n), groups: 5 }, { width: w, compact });
    L.lanes.forEach((a, i) => {
      assert.ok(inside(a.labelBox, L.width, L.height) && inside(a.stream, L.width, L.height), `lane ${a.key} inside (${n}@${w})`);
      L.lanes.forEach((b, j) => { if (j > i) { assert.equal(hit(a.row, b.row), false, `rows ${a.key}/${b.key} (${n}@${w})`); assert.equal(hit(a.stream, b.stream), false, `streams (${n}@${w})`); } });
      L.lanes.forEach((b) => { if (!L.vertical) assert.equal(hit(a.labelBox, b.stream), false, `label on a stream (${n}@${w})`); });
      for (const o of Object.values(L.outs)) assert.equal(hit(a.stream, o), false, `stream in an output (${n}@${w})`);
    });
    for (const o of Object.values(L.outs)) assert.ok(inside(o, L.width, L.height), `output inside (${n}@${w})`);
    assert.equal(hit(L.outs.merge, L.outs.clean) || hit(L.outs.clean, L.outs.bin) || hit(L.outs.merge, L.outs.bin), false, `outputs apart (${n}@${w})`);
    assert.ok(L.lanes.length <= MAX_LANES);
  }
});

test("stream thickness grows with volume and a lane's parts add up to its leads", () => {
  const L = layoutGate({ lanes: lanes(5), groups: 2 }, { width: 1000 });
  for (let i = 1; i < L.lanes.length; i++) assert.ok(L.lanes[i - 1].stream.h >= L.lanes[i].stream.h, "bigger lane, thicker stream");
  for (const l of L.lanes) assert.equal(l.clean + l.dups + l.junk, l.leads);
  assert.equal(L.totals.clean + L.totals.dups + L.totals.junk, L.totals.leads);
});

test("more than 7 sources fold into one Other lane and no count is lost", () => {
  const input = lanes(12);
  const folded = foldLanes(input);
  assert.equal(folded.length, MAX_LANES);
  assert.equal(folded[folded.length - 1].other, true);
  assert.equal(folded.reduce((s, l) => s + l.leads, 0), input.reduce((s, l) => s + l.leads, 0));
  assert.equal(folded.reduce((s, l) => s + l.dups, 0), input.reduce((s, l) => s + l.dups, 0));
});

test("dots are capped, kinds match the shares, paths are well formed and deterministic", () => {
  const a = layoutGate({ lanes: lanes(7), groups: 9 }, { width: 1100 }), b = layoutGate({ lanes: lanes(7), groups: 9 }, { width: 1100 });
  assert.deepEqual(a.dots, b.dots, "same input, same picture");
  for (const l of a.lanes) {
    const mine = a.dots.filter((d) => d.lane === l.key);
    assert.ok(mine.length >= 3 && mine.length <= MAX_DOTS_PER_LANE);
    assert.ok(mine.filter((d) => d.kind === "dup").length >= 1 && mine.filter((d) => d.kind === "junk").length >= 1, "a lane with duplicates and junk shows both");
  }
  for (const d of a.dots) { assert.match(d.d, /^M[-\d.,]+ L[-\d.,]+ C[-\d.,]+ [-\d.,]+ [-\d.,]+$/); assert.ok(d.begin >= 0 && d.begin < 6 && d.dur > 0); }
  assert.equal(layoutGate({ lanes: lanes(3), groups: 1 }, { width: 390 }).dots.length, 0, "the phone picture is static");
});

test("no leads at all gives an empty, valid layout and shareDots always adds up", () => {
  const L = layoutGate({ lanes: [], groups: 0 }, { width: 900 });
  assert.equal(L.lanes.length, 0); assert.equal(L.dots.length, 0); assert.ok(L.height > 0);
  for (const total of [0, 1, 7, 14]) assert.equal(shareDots(total, [5, 3, 2]).reduce((a, b) => a + b, 0), total);
  assert.deepEqual(shareDots(5, [0, 0, 0]), [0, 0, 0]);
});
