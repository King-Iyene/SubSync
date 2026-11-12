import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { trendPeriods } from "../analytics/appointments3-intel.ts";
import { searchSettings, SEARCH_INDEX } from "../settings2.ts";

// Walk-through 3 findings 1, 2, 3 and 20.

test("trendPeriods: the last period is the real current week (Monday start), never the latest week with data", () => {
  // Thursday 12 Nov 2026 in the account's zone: its Monday is 9 Nov.
  const w = trendPeriods("2026-11-09", "week", 8);
  assert.equal(w.starts.length, 9);
  assert.equal(w.starts.at(-1), "2026-11-09");
  assert.equal(w.starts[0], "2026-09-14");
  assert.equal(w.endOf("2026-11-09"), "2026-11-15"); // Sunday, inclusive
  // 22-23 Sep (a Tuesday and Wednesday) is the week of 21 Sep, 7 weeks back, never "this week".
  assert.ok(w.starts.includes("2026-09-21") && w.starts.indexOf("2026-09-21") < w.starts.length - 2);
  for (const s of w.starts) assert.equal(new Date(`${s}T00:00:00Z`).getUTCDay(), 1, `${s} is a Monday`);
});

test("trendPeriods: months start on the 1st and end on the last day, across a year end and a leap February", () => {
  const m = trendPeriods("2027-01-01", "month", 3);
  assert.deepEqual(m.starts, ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"]);
  assert.equal(m.endOf("2026-11-01"), "2026-11-30");
  assert.equal(m.endOf("2028-02-01"), "2028-02-29");
});

test("the list header and the list rows read the same bucket (no 36 vs 35)", () => {
  const src = readFileSync(new URL("../analytics/appointments3-queries.ts", import.meta.url), "utf8");
  const uses = src.match(/bucketCond\(o\.f\.bucket \?\? "booked"\)/g) ?? [];
  assert.equal(uses.length, 2, "rows and count must use the same default (invalid bookings are left out unless asked for)");
  assert.ok(!/bucketCond\(o\.f\.bucket\)/.test(src));
});

test("the week drill-down counts and opens the same local-day window", () => {
  const src = readFileSync(new URL("../analytics/appointments3-queries.ts", import.meta.url), "utf8");
  assert.match(src, /f\.local \?/);
  assert.match(src, /at time zone l\.tz\)::date >= /);
  const ui = readFileSync(new URL("../../app/app/views/ap3/trends-panel.tsx", import.meta.url), "utf8");
  assert.match(ui, /to: res\.data!\.currentTo, local: 1/);
});

test("Settings search finds how a sale is counted by sale, sold, closer, deal and payment", () => {
  for (const w of ["sale", "sold", "closer", "deal", "payment"]) assert.ok(searchSettings(w).some((h) => h.id === "sale"), w);
  const e = SEARCH_INDEX.find((x) => x.id === "sale");
  assert.equal(e?.section, "targets");
});
