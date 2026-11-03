import assert from "node:assert/strict";
import { test } from "node:test";
import { changeBetween, decodeRange, DEFAULT_RANGE, encodeRange, inWindow, rangeFromHash, rangeIntoHash, rangesOf, resolveRange, shareChange, type RangeSpec } from "../design/range.ts";

const TODAY = "2026-11-01";

test("a preset window ends today and says its dates", () => {
  const r = resolveRange({ preset: "30d", compare: "none" }, TODAY);
  assert.equal(r.current.from, "2026-10-03");
  assert.equal(r.current.to, "2026-11-01");
  assert.equal(r.current.days, 30);
  assert.equal(r.sentence, "Last 30 days, 3 Oct to 1 Nov");
  assert.equal(resolveRange({ preset: "7d", compare: "none" }, TODAY).current.from, "2026-10-26");
  assert.equal(resolveRange({ preset: "90d", compare: "none" }, TODAY).current.days, 90);
});

test("the previous period is the same number of days straight before; same dates last month and year clamp short months", () => {
  const p = resolveRange({ preset: "30d", compare: "previous" }, TODAY);
  assert.deepEqual([p.compare?.from, p.compare?.to, p.compare?.days], ["2026-09-03", "2026-10-02", 30]);
  assert.equal(p.sentence, "Last 30 days, 3 Oct to 1 Nov, compared with 3 Sep to 2 Oct");
  const m = resolveRange({ preset: "custom", from: "2026-03-29", to: "2026-03-31", compare: "month" }, "2026-04-02");
  assert.deepEqual([m.compare?.from, m.compare?.to], ["2026-02-28", "2026-02-28"], "31 Mar minus a month is the end of February");
  const y = resolveRange({ preset: "custom", from: "2024-02-29", to: "2024-03-02", compare: "year" }, "2025-01-10");
  assert.deepEqual([y.compare?.from, y.compare?.to], ["2023-02-28", "2023-03-02"]);
  assert.match(y.sentence, /compared with 28 Feb 2023 to 2 Mar 2023/);
});

test("a bad custom range falls back to the default window and says why", () => {
  for (const [spec, why] of [
    [{ preset: "custom", from: "2026-10-10", to: "2026-10-01", compare: "none" }, /end date is before/],
    [{ preset: "custom", from: "2026-10-10", to: "2026-12-01", compare: "none" }, /in the future/],
    [{ preset: "custom", from: "2024-01-01", to: "2026-10-01", compare: "none" }, /at most 366/],
    [{ preset: "custom", from: "nonsense", to: "2026-10-01", compare: "none" }, /start and an end/],
  ] as Array<[RangeSpec, RegExp]>) {
    const r = resolveRange(spec, TODAY);
    assert.match(r.problem ?? "", why);
    assert.equal(r.current.days, 30);
  }
  assert.equal(resolveRange({ preset: "custom", from: "2026-10-01", to: "2026-10-31", compare: "none" }, TODAY).problem, null);
});

test("the range is carried in the address and read back, keeping everything else in it", () => {
  const spec: RangeSpec = { preset: "custom", from: "2026-10-01", to: "2026-10-30", compare: "year" };
  assert.equal(encodeRange(spec), "custom:2026-10-01~2026-10-30.year");
  assert.deepEqual(decodeRange("custom:2026-10-01~2026-10-30.year"), spec);
  assert.deepEqual(decodeRange("7d.prev"), { preset: "7d", compare: "previous" });
  assert.deepEqual(decodeRange("90d"), { preset: "90d", compare: "none" });
  const h = rangeIntoHash("#speed?owner=Sam&hideTest=1", "speed-trend", { preset: "7d", compare: "previous" });
  assert.equal(h, "#speed?owner=Sam&hideTest=1&r.speed-trend=7d.prev");
  assert.deepEqual(rangeFromHash(h, "speed-trend"), { preset: "7d", compare: "previous" });
  assert.equal(rangeFromHash(h, "other"), null);
  assert.equal(rangeIntoHash(h, "speed-trend", null), "#speed?owner=Sam&hideTest=1");
  assert.equal(rangeIntoHash("#speed", "speed-trend", DEFAULT_RANGE), "#speed?r.speed-trend=30d");
  assert.equal(rangesOf("#speed?owner=Sam&r.a=7d&r.b=custom:2026-10-01~2026-10-02.prev&r.c=junk"), "r.a=7d&r.b=custom:2026-10-01~2026-10-02.prev");
});

test("a hand-edited link cannot break a card: junk is ignored", () => {
  for (const bad of ["", "forever", "30d.sideways", "custom:2026-13-45~2026-10-01", "custom:2026-10-01", "30D", "<script>", "30d.prev.prev"]) assert.equal(decodeRange(bad), null, bad);
  assert.equal(rangeFromHash("#speed?r.a=junk", "a"), null);
  assert.equal(rangeFromHash("#speed?r.A_B=7d", "A_B"), null);
  assert.equal(rangeIntoHash("#speed", "bad key!", DEFAULT_RANGE), "#speed");
});

test("no percentage change on a tiny base: a base of 10 or more gets a percentage, less gets the plain difference, none gets nothing", () => {
  assert.deepEqual(changeBetween(30, 20), { kind: "percent", text: "Up 50% from 20", percent: 50 });
  assert.equal(changeBetween(8, 10, "leads").text, "Down 20% from 10 leads");
  const tiny = changeBetween(3, 1, "bookings");
  assert.equal(tiny.kind, "difference");
  assert.equal(tiny.percent, null);
  assert.equal(tiny.text, "Up 2 from 1 bookings (too few for a percentage)");
  assert.equal(changeBetween(0, 4).text, "Down 4 from 4 (too few for a percentage)");
  assert.equal(changeBetween(5, 5).kind, "same");
  assert.equal(changeBetween(5, null).kind, "none");
  assert.equal(changeBetween(null, 5).kind, "none");
  assert.equal(changeBetween(Number.NaN, 5).kind, "none");
});

test("a share is compared in points, and only when both periods have enough leads", () => {
  assert.equal(shareChange({ n: 30, total: 50 }, { n: 20, total: 50 }).text, "Up 20 points from 40%");
  assert.equal(shareChange({ n: 30, total: 50 }, { n: 25, total: 50 }).text, "Up 10 points from 50%");
  const tiny = shareChange({ n: 3, total: 4 }, { n: 1, total: 4 });
  assert.equal(tiny.percent, null);
  assert.match(tiny.text, /too few leads to call it a change/);
  assert.equal(shareChange({ n: 3, total: 4 }, { n: 0, total: 0 }).kind, "none");
});

test("a weekly bucket belongs to the window it mostly falls in", () => {
  const w = resolveRange({ preset: "30d", compare: "none" }, TODAY).current;
  const start = Date.parse("2026-10-20T00:00:00Z");
  assert.equal(inWindow(start, 7, w), true);
  assert.equal(inWindow(Date.parse("2026-09-01T00:00:00Z"), 7, w), false);
  assert.equal(inWindow(Date.parse("2026-09-28T00:00:00Z"), 7, w), false, "its middle (1 Oct) is before 3 Oct");
  assert.equal(inWindow(Date.parse("2026-10-31T00:00:00Z"), 7, w), false, "its middle is after the window ends");
});
