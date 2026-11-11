import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlStage } from "../analytics/pipeline3-types-interim.ts";
import { allocateParticles, layoutPipes, PIPE_PARTICLE_CAP, ratioOf, speedFor, toneOf, type Rect } from "../design/pipe-layout.ts";

const stage = (i: number, o: Partial<PlStage> = {}): PlStage => ({ id: `s${i}`, name: `Stage ${i}`, order: i, count: 10 + i, valueCents: (50 - i * 3) * 100_000, staleCount: i % 3, staleValueCents: 0, medianDwellDays: 3 + i, normalDwellDays: 4, lostCount: i, lostValueCents: i * 40_000, ...o });
const stages = (n: number) => Array.from({ length: n }, (_, i) => stage(i));
const drains = (k: number) => Array.from({ length: k }, (_, i) => ({ reason: `Reason number ${i} with a long name`, count: 3 + i, valueCents: 100_000 * (k - i) }));
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("labels never overlap and stay inside, wide and phone, few and many stages and reasons", () => {
  for (const n of [1, 3, 5, 6, 8, 12]) for (const w of [390, 768, 1000, 1440]) for (const k of [0, 3, 9]) {
    const l = layoutPipes(stages(n), drains(k), { width: w });
    for (let i = 0; i < l.labels.length; i++) {
      const a = l.labels[i].rect;
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= l.width + 0.5 && a.y + a.h <= l.height + 0.5, `${l.labels[i].id} inside (${n}@${w})`);
      for (let j = i + 1; j < l.labels.length; j++) assert.equal(overlap(a, l.labels[j].rect), false, `${l.labels[i].id} vs ${l.labels[j].id} (${n} stages, ${w}px, ${k} reasons)`);
    }
  }
});

test("a label never sits on a pipe, the vault or the trough", () => {
  for (const w of [390, 1000]) {
    const l = layoutPipes(stages(5), drains(4), { width: w });
    const solids: Rect[] = [...l.segs, l.vault, l.trough];
    for (const lab of l.labels) for (const s of solids) if (lab.kind !== "vault" || s !== l.vault) assert.equal(overlap(lab.rect, s), false, `${lab.id} on a pipe at ${w}`);
  }
});

test("phones go vertical, wide screens horizontal, and more money makes a fatter pipe", () => {
  assert.equal(layoutPipes(stages(5), [], { width: 390 }).vertical, true);
  assert.equal(layoutPipes(stages(5), [], { width: 1200 }).vertical, false);
  const l = layoutPipes(stages(4), [], { width: 1200 });
  assert.ok(l.segs[0].thick > l.segs[3].thick);
});

test("coins: total never passes the cap, money gets coins, nothing gets coins when empty", () => {
  const a = allocateParticles([100_000_000, 5_000, 0, 20_000_000]);
  assert.ok(a.reduce((x, y) => x + y, 0) <= PIPE_PARTICLE_CAP);
  assert.equal(a[2], 0); assert.ok(a[1] >= 1 && a[0] > a[3]);
  assert.deepEqual(allocateParticles([0, 0]), [0, 0]);
  const big = allocateParticles(Array.from({ length: 100_000 }, (_, i) => (i % 7) + 1), 300);
  assert.ok(big.reduce((x, y) => x + y, 0) <= 300);
});

test("pressure: slow stages read hot, no history reads grey, coins slow down where deals sit", () => {
  assert.equal(toneOf(ratioOf({ medianDwellDays: 4, normalDwellDays: 4 })), "green");
  assert.equal(toneOf(ratioOf({ medianDwellDays: 8, normalDwellDays: 4 })), "red");
  assert.equal(toneOf(ratioOf({ medianDwellDays: null, normalDwellDays: 4 })), "grey");
  assert.ok(speedFor(3) < speedFor(1) && speedFor(0.1) <= 1.6 && speedFor(null) === 1);
});
