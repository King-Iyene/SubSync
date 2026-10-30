import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abandonedDeals, agingBuckets, avgCycleDays, coverage, deadPipeline, forecast, riskScore, riskyDeals, stageTable, valueDistribution,
  winLossByMonth, winRate, type Deal,
} from "../analytics/pipeline-intel.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => NOW - d * DAY;

function deal(over: Partial<Deal> = {}): Deal {
  return {
    opportunityId: "o" + Math.random().toString(36).slice(2), locationId: "L1", locationName: "Acme", pipelineId: "p1", pipelineName: "Sales",
    stageId: "s1", stageName: "New", stageOrder: 1, name: "Deal", contactName: "Sam", value: 1000, status: "open",
    createdAt: ago(10), stageChangedAt: ago(5), statusChangedAt: null, lastActivityAt: ago(2), ...over,
  };
}

const won = (cycle: number, value = 1000) => deal({ status: "won", value, createdAt: ago(cycle + 10), statusChangedAt: ago(10) });
const lost = (value = 500, when = 10) => deal({ status: "lost", value, statusChangedAt: ago(when) });

test("win rate needs five closed deals", () => {
  assert.equal(winRate([won(5), won(5), lost(), lost()]), null);
  assert.equal(winRate([won(5), won(5), won(5), lost(), lost()]), 0.6);
});

test("average sales cycle uses won deals only", () => {
  assert.equal(avgCycleDays([won(10), won(20), lost(), deal()]), 15);
  assert.equal(avgCycleDays([lost()]), null);
});

test("win and loss are grouped by the month they closed", () => {
  const rows = winLossByMonth([won(5), won(5), lost(700)], NOW, 3);
  assert.equal(rows.length, 3);
  const last = rows[2];
  assert.equal(last.month, "2026-10");
  assert.equal(last.won, 2);
  assert.equal(last.lost, 1);
  assert.equal(last.lostValue, 700);
  assert.equal(last.winRate, 2 / 3);
  assert.equal(rows[0].winRate, null);
});

test("aging buckets split open deals by age and report the share older than 60 days", () => {
  const a = agingBuckets([deal({ createdAt: ago(10), value: 100 }), deal({ createdAt: ago(45), value: 100 }), deal({ createdAt: ago(75), value: 100 }), deal({ createdAt: ago(200), value: 100 }), won(5)], NOW);
  assert.deepEqual(a.buckets.map((b) => b.count), [1, 1, 1, 1]);
  assert.equal(a.valueOlderThan60Pct, 50);
});

test("value distribution gives buckets, average and median", () => {
  const d = valueDistribution([deal({ value: 500 }), deal({ value: 2000 }), deal({ value: 3000 }), deal({ value: 30000 }), deal({ value: 0 })]);
  assert.deepEqual(d.buckets.map((b) => b.count), [1, 2, 0, 0, 1]);
  assert.equal(d.average, 8875);
  assert.equal(d.median, 2500);
  assert.equal(d.largest[0].value, 30000);
});

test("stage table flags a bottleneck and estimates conversion from current positions", () => {
  const opens = [
    ...Array.from({ length: 4 }, () => deal({ stageName: "New", stageOrder: 1, stageChangedAt: ago(2) })),
    ...Array.from({ length: 4 }, () => deal({ stageName: "Proposal", stageOrder: 2, stageChangedAt: ago(30) })),
  ];
  const rows = stageTable([...opens, won(5)], NOW);
  const proposal = rows.find((r) => r.stageName === "Proposal")!;
  assert.equal(proposal.bottleneck, true);
  assert.equal(proposal.avgDwellDays, 30);
  const first = rows.find((r) => r.stageName === "New")!;
  assert.equal(first.bottleneck, false);
  assert.equal(first.reached, 9); // 8 open at or past stage 1, plus the won deal
  assert.equal(first.conversionToNext, round3(5 / 9)); // 4 open at stage 2 plus 1 won
});
const round3 = (n: number) => Math.round(n * 1000) / 1000;

test("risk score grows with inactivity, stage dwell, age and missing value, and explains itself", () => {
  const calm = riskScore(deal({ lastActivityAt: ago(1) }), NOW, { stageAvgDays: 5, avgWonCycle: 30 });
  assert.equal(calm.score, 0);
  const bad = riskScore(deal({ lastActivityAt: ago(60), stageChangedAt: ago(60), createdAt: ago(90), value: 0 }), NOW, { stageAvgDays: 10, avgWonCycle: 30 });
  assert.ok(bad.score >= 80, `got ${bad.score}`);
  assert.ok(bad.reasons.some((r) => r.includes("No activity for 60 days")));
  assert.ok(bad.reasons.includes("No deal value set"));
  assert.ok(bad.score <= 100);
});

test("risky deals are sorted most at risk first and only list open deals", () => {
  const list = riskyDeals([deal({ lastActivityAt: ago(1) }), deal({ lastActivityAt: ago(80), stageChangedAt: ago(80), createdAt: ago(85), name: "Old" }), won(5)], NOW, 5);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, "Old");
});

test("forecast: likely, best and worst bands, with the not-enough-data case", () => {
  const closed = [won(10), won(10), won(10), lost(), lost()];
  const f = forecast([...closed, deal({ value: 10_000 }), deal({ value: 10_000 })], NOW);
  assert.equal(f.winRate, 0.6);
  assert.equal(f.likely, 12_000);
  assert.equal(f.best, 18_000);
  assert.equal(f.worst, 6_000);
  const none = forecast([deal()], NOW);
  assert.equal(none.winRate, null);
  assert.equal(none.likely, 0);
});

test("forecast horizons count overdue deals in the first window", () => {
  const f = forecast([won(60), won(60), won(60), lost(), lost(), deal({ value: 1000, createdAt: ago(50) }), deal({ value: 1000, createdAt: ago(1) })], NOW);
  assert.ok(f.horizons);
  assert.equal(f.horizons![0].likely, 600); // the 50 day old deal is due within 30 days; the new one is not
  assert.equal(f.horizons![2].likely, 1200); // both are due within 90 days
});

test("coverage ratio needs three times the target", () => {
  assert.equal(coverage(98_000, null), null);
  const c = coverage(98_000, 50_000)!;
  assert.equal(c.needed, 150_000);
  assert.equal(c.gap, 52_000);
  assert.equal(c.healthy, false);
  assert.equal(coverage(160_000, 50_000)!.healthy, true);
});

test("abandoned deals are recent lost deals with value, biggest first", () => {
  const a = abandonedDeals([lost(100, 5), lost(900, 20), lost(500, 120), lost(0, 3), deal()], NOW);
  assert.equal(a.total, 2);
  assert.equal(a.value, 1000);
  assert.equal(a.deals[0].value, 900);
});

test("dead pipeline catches stale, valueless and contactless deals", () => {
  const d = deadPipeline([deal({ lastActivityAt: ago(120), stageChangedAt: ago(120), createdAt: ago(130) }), deal({ value: 0, contactName: null }), deal()], NOW);
  assert.equal(d.total, 2);
});
