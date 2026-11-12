import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCustom, historyLimitNote, pageCompareFromHash, pageParamsOf, pageSpecOf, addressWithRange, windowQuery, isDefaultRange } from "../design/page-range.ts";
import { resolveRange } from "../design/range.ts";
import { MAX_RANGE_DAYS } from "../design/range-limits.ts";
import { windowOf } from "../analytics/payments-window.ts";

const TODAY = "2026-11-11";
test("the range King typed (15 Dec 2023 to 11 Nov 2026) is valid and applied, not silently replaced", () => {
  assert.equal(checkCustom("2023-12-15", "2026-11-11", TODAY), null);
  const r = resolveRange({ preset: "custom", from: "2023-12-15", to: "2026-11-11", compare: "none" }, TODAY);
  assert.equal(r.problem, null);
  assert.equal(r.current.from, "2023-12-15");
  assert.equal(windowQuery(r), "from=2023-12-15&to=2026-11-11");
});
test("typed dates are checked with a plain reason", () => {
  assert.match(checkCustom("", "2026-11-01", TODAY) ?? "", /Pick a start/);
  assert.match(checkCustom("2026-11-05", "2026-11-01", TODAY) ?? "", /before the start/);
  assert.match(checkCustom("2026-11-01", "2026-12-01", TODAY) ?? "", /future/);
  assert.match(checkCustom("2020-01-01", "2026-11-01", TODAY) ?? "", new RegExp(`at most ${MAX_RANGE_DAYS}`));
  assert.match(checkCustom("2026-02-31", "2026-03-01", TODAY) ?? "", /real date/);
});
test("the address wins, then this tab, then a remembered preset; a custom range is never remembered past the tab", () => {
  const none = { session: null, local: null };
  assert.equal(pageSpecOf("#speed", none).from, "default");
  assert.equal(pageSpecOf("#speed?r.page=7d&pc=prev", none).spec.compare, "previous");
  assert.equal(pageSpecOf("#speed", { session: "custom:2026-10-01~2026-10-30", local: "7d" }).spec.preset, "custom");
  assert.equal(pageSpecOf("#speed", { session: null, local: "custom:2026-10-01~2026-10-30" }).from, "default");
  assert.equal(pageSpecOf("#speed", { session: null, local: "90d" }).spec.preset, "90d");
  assert.equal(isDefaultRange({ preset: "30d", compare: "none" }), true);
});
test("range and comparison travel in the address and to another page", () => {
  const h = addressWithRange("#speed?hideTest=1", { preset: "custom", from: "2026-10-01", to: "2026-10-30", compare: "previous" });
  assert.equal(h, "#speed?hideTest=1&r.page=custom:2026-10-01~2026-10-30&pc=prev");
  assert.equal(pageCompareFromHash(h), "previous");
  assert.equal(pageParamsOf(h), "r.page=custom:2026-10-01~2026-10-30&pc=prev");
  assert.equal(addressWithRange(h, null), "#speed?hideTest=1");
});
test("a screen whose record starts late says so in one line", () => {
  const r = resolveRange({ preset: "custom", from: "2023-12-15", to: "2026-11-11", compare: "none" }, TODAY);
  assert.match(historyLimitNote("2026-10-28", r) ?? "", /starts 28 Oct 2026/);
  assert.equal(historyLimitNote("2023-01-01", r), null);
  assert.equal(historyLimitNote(null, r), null);
});
test("payments window: valid dates are used, bad ones fall back to the last 30 days", () => {
  const now = Date.parse("2026-11-11T12:00:00Z");
  const w = windowOf({ wfrom: "2026-10-01", wto: "2026-10-31" }, 30, now);
  assert.deepEqual([w.from, w.to, w.next, w.days, w.asked], ["2026-10-01", "2026-10-31", "2026-11-01", 31, true]);
  const d = windowOf({ wfrom: "2026-10-31", wto: "2026-10-01" }, 30, now);
  assert.equal(d.asked, false);
  assert.equal(d.days, 30);
});
