import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DENSITY, DEFAULT_DENSITY as D, DENSITIES, PHONE_ROW_HEIGHT, parseDensity, ROW_HEIGHT } from "../design/list-density.ts";
import { DEFAULT_SIZE, LIST_SIZES } from "../analytics/unanswered-params.ts";

// The dense list promises a row of about 40px on a desktop, two small lines (at least the 44px tap height) on a phone, and a page of 50 with 20 and 100 still a choice.
test("compact is the default and an unknown value is compact", () => {
  assert.equal(D, "compact");
  for (const v of [undefined, null, "", "huge", 3]) assert.equal(parseDensity(v), DEFAULT_DENSITY);
  assert.equal(parseDensity("comfortable"), "comfortable");
  assert.deepEqual([...DENSITIES], ["compact", "comfortable"]);
});
test("the promised row heights: compact about 40px, comfortable taller, a phone row never under the 44px tap height", () => {
  assert.ok(ROW_HEIGHT.compact.min <= 40 && 40 <= ROW_HEIGHT.compact.max);
  assert.ok(ROW_HEIGHT.comfortable.min > ROW_HEIGHT.compact.max - 1);
  assert.ok(PHONE_ROW_HEIGHT.min >= 44);
});
test("the default page is 50 and 20 and 100 stay a choice", () => {
  assert.equal(DEFAULT_SIZE, 50);
  assert.deepEqual([...LIST_SIZES], [20, 50, 100]);
});
