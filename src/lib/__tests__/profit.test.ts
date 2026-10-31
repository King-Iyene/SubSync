import assert from "node:assert/strict";
import { test } from "node:test";
import { profit } from "../profit.ts";

test("20 accounts at $18 cost $180 and earn $360, so the agency keeps $180", () => {
  const p = profit(20, 18);
  assert.deepEqual([p.cost, p.revenue, p.margin, p.yearlyMargin], [180, 360, 180, 2160]);
});

test("junk input never produces NaN or negative accounts", () => {
  assert.equal(profit(NaN, 18).margin, 0);
  assert.equal(profit(-5, 18).accounts, 0);
  assert.equal(profit(10, 5).margin, -40, "charging less than the price shows a loss");
});
