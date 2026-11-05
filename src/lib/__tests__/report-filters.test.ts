import assert from "node:assert/strict";
import { test } from "node:test";
import { dayLabel, fmtAxis, fmtStat, fmtStatMoney, monotonePath, niceTicks, thinLabels } from "../analytics/chart-format.ts";
import { isDefaultState, parseReportParams, rangeOf, readReportState, writeReportState } from "../analytics/report-filter.ts";
import { filterProof, proofHeadline, proofSummary } from "../analytics/proof-view.ts";
import { resolveFlowRange } from "../analytics/lead-flow.ts";
import type { Proof } from "../analytics/today-queue.ts";

test("cards: whole numbers up to 999,999, then 1.2M with the full value elsewhere", () => {
  assert.equal(fmtStat(50546), "50,546");
  assert.equal(fmtStat(999_999), "999,999");
  assert.equal(fmtStat(1_234_567), "1.2M");
  assert.equal(fmtStat(12_345_678), "12.3M");
  assert.equal(fmtStat(123_456_789), "123M");
  assert.equal(fmtStat(1_500_000_000), "1.5B");
  assert.equal(fmtStatMoney(12_345_678), "$12.3M");
  assert.equal(fmtStat(0), "0");
  assert.equal(fmtStat(Number.NaN), "0");
});
test("axis labels are 12k, never 12000", () => {
  assert.deepEqual([0, 250, 1200, 12_000, 150_000, 2_500_000, 40_000_000].map(fmtAxis), ["0", "250", "1.2k", "12k", "150k", "2.5M", "40M"]);
});
test("ticks are round and cover the largest value, whatever its size", () => {
  for (const max of [0, 1, 3, 7, 13, 99, 1234, 12_000, 87_654, 1_234_567]) {
    const t = niceTicks(max);
    assert.equal(t[0], 0);
    assert.ok(t[t.length - 1] >= max, `${max}`);
    assert.ok(t.length <= 8, `${max} has ${t.length} ticks`);
    const step = t[1] - t[0];
    t.forEach((v, i) => assert.ok(Math.abs(v - i * step) < 1e-6));
  }
  assert.ok(niceTicks(12_000).map(fmtAxis).every((s) => s.length <= 4));
});
test("labels are thinned to fit and keep the first and last, never touching", () => {
  for (const [n, max] of [[7, 7], [30, 8], [90, 8], [365, 9], [24, 8]] as const) {
    const idx = thinLabels(n, max);
    assert.ok(idx.length <= max + 1, `${n}/${max}: ${idx.length}`);
    assert.equal(idx[0], 0); assert.equal(idx[idx.length - 1], n - 1);
    const gaps = idx.slice(1).map((v, i) => v - idx[i]);
    assert.ok(Math.min(...gaps) >= Math.floor((n - 1) / max / 2), `${n}: gaps ${gaps}`);
  }
  assert.deepEqual(thinLabels(0, 5), []);
});
test("day labels fit the range", () => {
  assert.equal(dayLabel("2026-11-03", 7), "Tue 3");
  assert.equal(dayLabel("2026-11-03", 90), "3 Nov");
  assert.equal(dayLabel("2026-11-03", 365), "Nov 26");
});
test("the line passes through every point and never overshoots (no control point beyond the data's range)", () => {
  const pts: Array<[number, number]> = [[0, 100], [10, 100], [20, 10], [30, 10], [40, 90], [50, 20]];
  const d = monotonePath(pts);
  assert.ok(d.startsWith("M0,100"));
  const ys = [...d.matchAll(/C[\d.-]+,([\d.-]+) [\d.-]+,([\d.-]+) /g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(ys.every((y) => y >= 10 - 1e-6 && y <= 100 + 1e-6));
  assert.equal(monotonePath([]), ""); assert.equal(monotonePath([[1, 2]]), "M1,2");
});

test("the filter lives in the address and keeps everything else", () => {
  const h = writeReportState("#today?ta=abc,def", "g", { preset: "90d", client: "xyz123" });
  assert.deepEqual(readReportState(h, "g"), { preset: "90d", from: "", to: "", client: "xyz123" });
  assert.ok(h.includes("ta=abc,def"));
  const c = writeReportState(h, "g", { preset: "custom", from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(readReportState(c, "g"), { preset: "custom", from: "2026-10-01", to: "2026-10-31", client: "xyz123" });
  const back = writeReportState(c, "g", { preset: "7d" });
  assert.equal(readReportState(back, "g").from, "");
  assert.equal(readReportState(back, "l").preset, null, "another tab's choice is separate");
  assert.equal(readReportState("#today?gr=evil&gc=a%20b&gf=2026-13-40", "g").preset, null);
  assert.equal(readReportState("#today?gc=a%20b", "g").client, null);
  assert.equal(readReportState("#today?gc=all", "g").client, "all");
});
test("a tab that has not been changed follows the header", () => {
  assert.equal(isDefaultState({ preset: null, from: "", to: "", client: null }, "30d"), true);
  assert.equal(isDefaultState({ preset: "30d", from: "", to: "", client: null }, "30d"), true);
  assert.equal(isDefaultState({ preset: "7d", from: "", to: "", client: null }, "30d"), false);
  assert.equal(isDefaultState({ preset: null, from: "", to: "", client: "all" }, "30d"), false);
  assert.equal(rangeOf({ preset: null, from: "", to: "", client: null }, "90d", "2026-11-05").from, "2026-08-08");
  assert.equal(resolveFlowRange("90d", "2026-11-05").label, "Last 90 days");
});
test("the server refuses a client the caller may not read and bad dates", () => {
  const permits = (id: string) => id === "mine1";
  assert.equal(parseReportParams(new URL("http://x/a?from=2026-10-01&to=2026-10-31&client=mine1"), permits).ok, true);
  const bad = parseReportParams(new URL("http://x/a?client=theirs1"), permits);
  assert.equal(bad.ok ? null : bad.status, 404);
  assert.equal(parseReportParams(new URL("http://x/a?client=../etc"), permits).ok, false);
  assert.equal(parseReportParams(new URL("http://x/a?from=2026-10-31&to=2026-10-01"), permits).ok, false);
  assert.equal(parseReportParams(new URL("http://x/a?from=2020-01-01&to=2026-10-01"), permits).ok, false);
  assert.equal(parseReportParams(new URL("http://x/a"), permits).ok, true);
});

const A = (id: string, loc: string, c: number, r: number | null) => ({ id, locationId: loc, accountName: loc, title: id, severity: "warning" as const, createdAt: c, resolvedAt: r });
test("Proof in plain words, recounted for one client", () => {
  const x = A("a", "L1", 1, null), y = A("b", "L1", 2, 3), z = A("c", "L2", 2, null);
  const days = [{ day: "d1", label: "Mon", raised: [x, y, z], cleared: [y] }];
  const p: Proof = { raised: 3, cleared: 1, open: 2, days, openAlerts: [x, z] };
  assert.equal(proofHeadline(p), "This week SubSync found 3 problems. 1 is fixed. 2 still need you.");
  const one = filterProof(p, "L1");
  assert.deepEqual([one.raised, one.cleared, one.open], [2, 1, 1]);
  assert.equal(proofHeadline(one), "This week SubSync found 2 problems. 1 is fixed. 1 still needs you.");
  assert.ok(!proofSummary(one, "Acme").includes("L2"));
  assert.equal(proofHeadline({ raised: 0, cleared: 0, open: 0, days: [], openAlerts: [] }), "This week SubSync found no problems.");
});
