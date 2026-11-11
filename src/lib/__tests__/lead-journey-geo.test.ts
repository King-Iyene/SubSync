import assert from "node:assert/strict";
import { test } from "node:test";
import { fitFont, flowSpeed, journeyGeometry, overlaps, sampleParticles, thicknessAt, warmth } from "../analytics/lead-journey-geo.ts";

const STEPS = [40, 30, 20, 8, 5, 2].map((count, i, a) => ({ count, dropped: i ? a[i - 1] - count : 0 }));
const BIG = [1234567, 800000, 500000, 120000, 60000, 1234].map((count, i, a) => ({ count, dropped: i ? a[i - 1] - count : 0 }));
const TINY = [1, 1, 1, 1, 0, 0].map((count, i, a) => ({ count, dropped: i ? a[i - 1] - count : 0 }));

test("river is as wide as the count, and never thinner than 3px for a real count", () => {
  const g = journeyGeometry(STEPS, 1100, false);
  assert.equal(g.thick[0], g.T);
  assert.ok(Math.abs(g.thick[1] - (30 / 40) * g.T) < 1e-9);
  const t = journeyGeometry(TINY, 1100, false);
  assert.ok(t.thick[0] >= 3 && t.thick[3] >= 3);
  assert.equal(t.thick[4], 0);
});

test("thickness eases from one station to the next and meets both ends", () => {
  assert.equal(thicknessAt(80, 40, 0), 80);
  assert.equal(thicknessAt(80, 40, 1), 40);
  const mid = thicknessAt(80, 40, 0.55);
  assert.ok(mid < 80 && mid > 40);
});

test("a drop-off branch exists exactly where leads were lost, and its width is the number lost", () => {
  const g = journeyGeometry(STEPS, 1100, false);
  assert.equal(g.branches[0], null);
  for (let i = 1; i < STEPS.length; i++) {
    const b = g.branches[i]; assert.ok(b);
    assert.ok(Math.abs((b?.d ?? 0) - (g.thick[i - 1] - g.thick[i])) < 1e-9);
  }
  const none = journeyGeometry([{ count: 5, dropped: 0 }, { count: 5, dropped: 0 }], 1100, false);
  assert.equal(none.branches[1], null);
});

for (const [name, steps] of [["normal", STEPS], ["long numbers", BIG], ["tiny counts", TINY]] as const) {
  for (const width of [1440, 1024, 768, 560, 390, 320]) {
    test(`text layer never meets the river layer (${name}, ${width}px)`, () => {
      const g = journeyGeometry(steps, width);
      const texts = [...g.cards, ...g.drops.filter((r): r is NonNullable<typeof r> => r !== null)];
      for (const r of texts) {
        assert.equal(overlaps(r, g.riverRect), false, `a label sits inside the river zone at ${width}px`);
        assert.ok(r.x >= -0.5 && r.x + r.w <= g.width + 0.5, "label inside the stage horizontally");
        assert.ok(r.y >= -0.5 && r.y + r.h <= g.height + 0.5, "label inside the stage vertically");
      }
      for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) assert.equal(overlaps(texts[a], texts[b]), false, `labels ${a} and ${b} overlap at ${width}px`);
    });
  }
}

test("phones re-flow vertically", () => {
  assert.equal(journeyGeometry(STEPS, 390).vertical, true);
  assert.equal(journeyGeometry(STEPS, 1000).vertical, false);
  const g = journeyGeometry(STEPS, 390);
  const p = g.pt(10, 20); assert.deepEqual(g.toAbstract(p.x, p.y), { m: 10, c: 20 });
});

test("particles: never more than the cap, even for huge volumes, and the lost share follows the drop-off", () => {
  const huge = [100000, 60000, 30000, 9000, 4000, 1000].map((count, i, a) => ({ count, dropped: i ? a[i - 1] - count : 0 }));
  const p = sampleParticles(huge, 300);
  assert.ok(p.length <= 300 && p.length > 100);
  assert.ok(sampleParticles(BIG, 300).length <= 300);
  const seg0 = p.filter((x) => x.seg === 0), lost0 = seg0.filter((x) => x.lost).length;
  assert.ok(Math.abs(lost0 / seg0.length - 0.4) < 0.08);
  assert.equal(p.filter((x) => x.seg === 4 && x.lost).length > 0, true);
  assert.deepEqual(sampleParticles([{ count: 0, dropped: 0 }, { count: 0, dropped: 0 }], 300), []);
});

test("quick replies flow fast and look cool, slow ones flow slowly and look warm", () => {
  assert.ok(flowSpeed(30) > flowSpeed(3600 * 24));
  assert.ok(warmth(30) < warmth(3600 * 24));
  assert.ok(warmth(null) >= 0 && warmth(1e9) <= 1);
});

test("numbers shrink to fit and never below the readable minimum", () => {
  assert.ok(fitFont(9, 90) < fitFont(2, 90));
  assert.equal(fitFont(50, 40), 11);
});
