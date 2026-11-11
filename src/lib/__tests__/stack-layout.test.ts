import assert from "node:assert/strict";
import { test } from "node:test";
import { coinStep, layoutStacks, shareCoins, STACK_COIN_CAP, type Rect, type StackIn } from "../design/stack-layout.ts";

const stage = (i: number, v = (50 - i * 3) * 100_000): StackIn => ({ id: `s${i}`, name: `Stage number ${i} with a long name`, valueCents: v, count: 10 + i, staleCount: i % 3, staleValueCents: Math.round(v * 0.2 * (i % 3)) });
const drains = (k: number) => Array.from({ length: k }, (_, i) => ({ reason: `Reason ${i}`, count: 3 + i, valueCents: 100_000 * (k - i) }));
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const coinRect = (c: { x: number; y: number; w: number; h: number }): Rect => ({ x: c.x, y: c.y, w: c.w, h: c.h });

test("labels never overlap each other or any coin, and stay inside, phone to wide, few to many stages", () => {
  for (const n of [1, 3, 6, 9, 12]) for (const w of [390, 640, 1000, 1440]) for (const k of [0, 4]) {
    const L = layoutStacks(Array.from({ length: n }, (_, i) => stage(i)), 900_000_00, 19, drains(k), { width: w });
    L.cols.forEach((a, i) => {
      assert.ok(a.label.x >= 0 && a.label.y >= 0 && a.label.x + a.label.w <= L.width + 0.5 && a.label.y + a.label.h <= L.height + 0.5, `${a.id} label inside (${n}@${w})`);
      L.cols.forEach((b, j) => { if (j > i) assert.equal(hit(a.label, b.label), false, `label ${a.id} vs ${b.id} (${n}@${w})`); });
      L.cols.forEach((b) => b.coins.forEach((c, ci) => assert.equal(hit(a.label, coinRect(c)), false, `label ${a.id} on a coin of ${b.id}#${ci} (${n}@${w})`)));
    });
  }
});

test("columns do not collide and coins stay inside their own stack box", () => {
  const L = layoutStacks(Array.from({ length: 8 }, (_, i) => stage(i)), 500_000_00, 9, drains(3), { width: 1100 });
  L.cols.forEach((a, i) => { a.coins.forEach((c) => assert.ok(c.x >= a.stack.x - 0.5 && c.x + c.w <= a.stack.x + a.stack.w + 0.5 && c.y >= a.stack.y - 0.5 && c.y + c.h <= a.stack.y + a.stack.h + 0.5, `${a.id} coins inside`)); L.cols.forEach((b, j) => { if (j > i) assert.equal(hit(a.stack, b.stack), false, `${a.id} vs ${b.id}`); }); });
});

test("coin cap: no column passes 40 coins even for 100k deals worth millions; every money column has a coin", () => {
  for (const big of [10_000_00, 5_000_000_00, 900_000_000_00, 3_000_000_000_00]) {
    const L = layoutStacks([stage(0, big), stage(1, big / 3), stage(2, 1_00)], big / 2, 100_000, drains(5), { width: 1000 });
    L.cols.forEach((c) => { assert.ok(c.coins.length <= STACK_COIN_CAP, `${c.id}: ${c.coins.length}`); if (c.valueCents > 0) assert.ok(c.coins.length >= 1); });
  }
  assert.equal(layoutStacks([stage(0, 0)], 0, 0, [], { width: 1000 }).cols[0].coins.length, 0);
});

test("stuck coins are the top of a stack and never more than the stack; lost coins split by reason add up", () => {
  const L = layoutStacks([stage(1), stage(2)], 100_00, 1, drains(4), { width: 1000 });
  for (const c of L.cols.filter((x) => x.kind === "stage")) { assert.ok(c.stuckCoins <= c.coins.length); assert.equal(c.coins.filter((k) => k.kind === "stuck").length, c.stuckCoins); }
  const lost = L.cols.find((c) => c.kind === "lost")!;
  assert.equal(lost.segs.reduce((a, s) => a + Math.round(s.rect.h / 7), 0) > 0, true);
  assert.deepEqual(shareCoins(10, [5, 3, 2]).reduce((a, b) => a + b, 0), 10);
  assert.equal(coinStep(40 * 100_000) , 100_000);
});

test("phones get a vertical list, wide screens columns", () => {
  assert.equal(layoutStacks([stage(0)], 1, 1, [], { width: 390 }).vertical, true);
  assert.equal(layoutStacks([stage(0)], 1, 1, [], { width: 1200 }).vertical, false);
});

test("many stages: columns keep a minimum width and the picture grows wider than its box instead of squeezing", () => {
  const L = layoutStacks(Array.from({ length: 25 }, (_, i) => stage(i)), 1_000_00, 3, [], { width: 1000 });
  assert.ok(L.width > 1000 && !L.vertical);
  for (const c of L.cols) assert.ok(c.stack.w >= 84);
  L.cols.forEach((a, i) => L.cols.forEach((b, j) => { if (j > i) assert.equal(hit(a.label, b.label), false); }));
});
