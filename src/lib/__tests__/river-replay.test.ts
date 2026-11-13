import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_PILE_CARDS, pileCards, pileUnit } from "../design/river-layout.ts";
import { buildReplayFrames, flyerPlan, nextFrame, replayHasMovement } from "../design/river-replay.ts";
import { sampleRiver } from "../design/river-sample.ts";
import type { PlReplayDay, PlStage } from "../analytics/pipeline3-types-interim.ts";

const stage = (i: number): PlStage => ({ id: `s${i}`, name: `S${i}`, order: i, count: 0, valueCents: 0, staleCount: 3, staleValueCents: 100, medianDwellDays: null, normalDwellDays: null, lostCount: 0, lostValueCents: 0 });
const base = [stage(0), stage(1)];
const day = (date: string, c: [number, number], extra: Partial<PlReplayDay> = {}): PlReplayDay => ({ date, stageCounts: c, stageValueCents: [c[0] * 100, c[1] * 100], wonCents: 0, lostCents: 0, ...extra });

test("one card per deal until a pile would pass the cap: 1 deal draws 1 card, never a stack", () => {
  assert.equal(pileUnit([1, 0, 0]), 1);
  assert.equal(pileCards(1, 1), 1);
  assert.equal(pileCards(0, 1), 0);
  assert.equal(pileCards(30, pileUnit([30, 5])), 30);
});

test("past the cap the ONE scale steps up to a nice number and every pile stays within the cap", () => {
  const counts = [95, 61, 38, 4, 1];
  const u = pileUnit(counts);
  assert.equal(u, 5);
  for (const c of counts) { const cards = pileCards(c, u); assert.ok(cards <= MAX_PILE_CARDS); assert.ok(cards * u >= c); assert.ok(cards >= 1); }
  assert.equal(pileCards(1, u), 1);
  assert.equal(pileUnit([100000]), 5000);
  assert.ok(pileCards(100000, 5000) <= MAX_PILE_CARDS);
});

test("a pile never draws more cards than it has deals while the scale is 1", () => {
  for (let n = 1; n <= MAX_PILE_CARDS; n++) assert.equal(pileCards(n, pileUnit([n])), n);
});

test("no recorded movement means there is nothing real to replay", () => {
  assert.equal(replayHasMovement(null), false);
  assert.equal(replayHasMovement([day("2026-11-01", [3, 0]), day("2026-11-02", [3, 0], { moves: [], wonCount: 0, lostCount: 0 })]), false);
  assert.equal(replayHasMovement([day("2026-11-01", [3, 0], { moves: [{ from: 0, to: 1, status: null, count: 1, valueCents: 100 }] })]), true);
});

test("frames carry each day's piles and add up won and lost from the first day, with the lost deal counted at its own step", () => {
  const days = [
    day("2026-11-01", [3, 0], { moves: [{ from: null, to: 0, status: null, count: 3, valueCents: 300 }] }),
    day("2026-11-02", [2, 1], { moves: [{ from: 0, to: 1, status: null, count: 1, valueCents: 100 }] }),
    day("2026-11-03", [1, 0], { wonCount: 1, lostCount: 1, wonCents: 100, lostCents: 100, moves: [{ from: 1, to: null, status: "won", count: 1, valueCents: 100 }, { from: 0, to: null, status: "lost", count: 1, valueCents: 100 }] }),
  ];
  const f = buildReplayFrames(days, base, false);
  assert.equal(f.length, 3);
  assert.deepEqual(f[1].stages.map((s) => s.count), [2, 1]);
  assert.equal(f[1].stages[0].staleCount, 0);
  assert.deepEqual([f[1].wonCount, f[1].lostCount], [0, 0]);
  assert.deepEqual([f[2].wonCount, f[2].wonCents, f[2].lostCount, f[2].lostCents], [1, 100, 1, 100]);
  assert.equal(f[2].stages[0].lostCount, 1);
  assert.equal(f[2].stages[1].lostCount, 0);
  assert.deepEqual(f[2].movers.map((m) => m.to).sort(), ["lost", "won"]);
  assert.equal(f[0].activity, 3);
});

test("the money view leaves out moves with no value, the deal view keeps them", () => {
  const days = [day("2026-11-01", [1, 0], { moves: [{ from: 0, to: 1, status: null, count: 2, valueCents: 0 }] })];
  assert.equal(buildReplayFrames(days, base, false)[0].movers.length, 0);
  assert.equal(buildReplayFrames(days, base, true)[0].movers[0].n, 2);
});

test("a big day is capped so the picture stays readable, and every move keeps at least one card", () => {
  const plan = flyerPlan([{ from: 0, to: 1, n: 200 }, { from: 1, to: 2, n: 50 }, { from: 2, to: "won", n: 1 }], 14);
  assert.ok(plan.reduce((t, m) => t + m.n, 0) <= 14);
  assert.ok(plan.every((m) => m.n >= 1));
  assert.deepEqual(flyerPlan([{ from: 0, to: 1, n: 3 }]), [{ from: 0, to: 1, n: 3 }]);
  assert.deepEqual(flyerPlan([]), []);
});

test("playing steps one day forward and stops on the last frame", () => {
  assert.deepEqual(nextFrame(0, 3), { index: 1, done: false });
  assert.deepEqual(nextFrame(1, 3), { index: 2, done: true });
  assert.deepEqual(nextFrame(2, 3), { index: 2, done: true });
  assert.deepEqual(nextFrame(0, 0), { index: 0, done: true });
});

test("the sample river is deterministic, fictional, and its last day equals the piles it shows", () => {
  const a = sampleRiver(), b = sampleRiver();
  assert.deepEqual(a, b);
  assert.match(a.periodLabel, /SAMPLE/);
  assert.ok(replayHasMovement(a.replay));
  const last = a.replay![a.replay!.length - 1];
  assert.deepEqual(a.stages.map((s) => s.count), last.stageCounts);
  const f = buildReplayFrames(a.replay!, a.stages, false);
  assert.equal(f[f.length - 1].wonCount, a.won.count);
  assert.equal(f[f.length - 1].wonCents, a.won.valueCents);
});
