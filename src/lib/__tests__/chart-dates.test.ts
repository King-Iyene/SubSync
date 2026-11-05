import assert from "node:assert/strict";
import { test } from "node:test";
import { dayLabel, fullDate } from "../analytics/chart-format.ts";
import { pctChange } from "../analytics/growth.ts";

test("tooltip dates are friendly and axis dates name the month", () => {
  assert.equal(fullDate("2026-10-30"), "Fri 30 Oct 2026");
  assert.equal(fullDate("Mon"), "Mon");
  assert.equal(dayLabel("2026-11-03", 7), "Tue 3 Nov");
  assert.equal(dayLabel("2026-11-03", 30), "3 Nov");
  assert.equal(dayLabel("2026-11-03", 365), "Nov 2026");
});
test("a change needs enough leads in both periods: 0 against 5 is not down 100%", () => {
  assert.equal(pctChange(0, 5), null);
  assert.equal(pctChange(0, 4), null);
  assert.equal(pctChange(5, 10), -50);
});
