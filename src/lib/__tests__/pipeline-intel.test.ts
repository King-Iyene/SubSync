import assert from "node:assert/strict";
import { test } from "node:test";
import {
  abandonedDeals, agingBuckets, avgCycleDays, coverage, deadPipeline, forecast, riskScore, riskyDeals, stageTable, valueDistribution,
  winLossByMonth, winRate, rateRange, type Deal,
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

// One minimum for the whole product: 20 closed deals (metrics.ts). `closed(12, 8)` is 12 won and 8 lost.
const closed = (w: number, l: number, age = 10) => [...Array.from({ length: w }, () => won(age)), ...Array.from({ length: l }, () => lost())];

test("win rate needs twenty closed deals", () => {
  assert.equal(winRate(closed(2, 2)), null);
  assert.equal(winRate(closed(3, 3)), null, "3 won and 3 lost is never shown as 50%");
  assert.equal(winRate(closed(10, 9)), null, "19 closed is not enough");
  assert.equal(winRate(closed(12, 8)), 0.6);
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

test("forecast with history: a range with a stated confidence, never a single number (N37)", () => {
  const f = forecast([...closed(12, 8), deal({ value: 10_000 }), deal({ value: 10_000 })], NOW);
  assert.equal(f.method, "history");
  assert.equal(f.winRate, 0.6);
  assert.ok(f.range);
  assert.equal(f.range!.likely, 12_000, "open value x the win rate");
  assert.ok(f.range!.low < f.range!.likely && f.range!.likely < f.range!.high, "a range around the likely figure");
  // Worked by hand: 12 of 20 won, an 80% interval for the rate is about 45.7% to 72.8%, so 20,000 converts to about 9,145 to 14,553.
  assert.ok(f.range!.low >= 9_140 && f.range!.low <= 9_150, "low " + f.range!.low);
  assert.ok(f.range!.high >= 14_548 && f.range!.high <= 14_558, "high " + f.range!.high);
  assert.ok(f.basis.includes("80%"), "the confidence is stated in words");
  assert.ok(f.explain.inputs.some((i) => i.label.startsWith("Closed deals") && i.value.startsWith("20")), "the sample size is shown");
  assert.ok(f.explain.excluded.length >= 2 && f.explain.included.length > 20, "what was included and excluded is written out");
});

test("a bigger sample gives a narrower range", () => {
  const small = rateRange(12, 20)!;
  const big = rateRange(120, 200)!;
  assert.ok(big.high - big.low < small.high - small.low);
  assert.equal(rateRange(0, 0), null);
});

test("forecast with no history and no stage probabilities says what unlocks it (N37)", () => {
  const none = forecast([deal(), ...closed(3, 3)], NOW);
  assert.equal(none.method, "none");
  assert.equal(none.winRate, null);
  assert.equal(none.range, null);
  assert.equal(none.horizons, null);
  assert.ok(none.basis.includes("20 closed deals") && none.basis.includes("14 more"), none.basis);
});

test("forecast from the owner's stage probabilities is labelled as an assumption, with a band and no confidence figure (N37)", () => {
  const rules = [{ pipelineKey: "sales", stageKey: "new", cls: null, winProbability: 20 }];
  const f = forecast([deal({ value: 1000 }), deal({ value: 3000 }), deal({ value: 5000, stageName: "Proposal" })], NOW, rules);
  assert.equal(f.method, "owner");
  assert.deepEqual(f.range, { low: 400, likely: 800, high: 1200 }, "4,000 at 20 percent, 10 points either way");
  assert.equal(f.ownerUnsetDeals, 1, "the deal in a stage with no probability is left out, not guessed");
  assert.ok(f.basis.startsWith("Your own assumptions"));
  assert.ok(!/% sure/.test(f.basis), "no confidence is claimed for an assumption");
});

test("with history the owner's assumption is shown beside it, not instead of it", () => {
  const rules = [{ pipelineKey: "sales", stageKey: "new", cls: null, winProbability: 50 }];
  const f = forecast([...closed(12, 8), deal({ value: 10_000 })], NOW, rules);
  assert.equal(f.method, "history");
  assert.equal(f.ownerRange!.likely, 5000);
});

test("timing comes from the pipeline's own won deals, and a deal older than any won deal is not placed (N37)", () => {
  const f = forecast([...closed(12, 8, 60), deal({ value: 1000, createdAt: ago(50) }), deal({ value: 1000, createdAt: ago(1) }), deal({ value: 1000, createdAt: ago(400) })], NOW);
  assert.ok(f.horizons);
  // Won deals all took 60 days. The 50 day old deal is inside 30 more days; the 1 day old one is not until day 61; the 400 day old one is older than any won deal.
  assert.equal(f.untimedDeals, 1);
  const scale = f.range!.likely / f.openValue;
  assert.equal(f.horizons![0].likely, Math.round(1000 * scale));
  assert.equal(f.horizons![1].likely, Math.round(2000 * scale));
  assert.equal(f.horizons![2].likely, Math.round(2000 * scale));
  assert.ok(f.horizons![0].low <= f.horizons![0].likely && f.horizons![0].likely <= f.horizons![0].high);
  assert.ok(f.horizons![2].likely > f.horizons![0].likely, "the three horizons are not the same number repeated");
});

test("too few won deals in a pipeline means no timing at all, and the screen says why", () => {
  const f = forecast([...closed(9, 11, 60), ...Array.from({ length: 3 }, () => won(60)), deal({ value: 1000 })], NOW);
  // 12 won in total in the one pipeline (>= 10), so timing exists; now break the pipeline name so each has fewer than 10.
  assert.ok(f.horizons);
  const split = forecast([...Array.from({ length: 6 }, () => won(60)), ...Array.from({ length: 6 }, () => ({ ...won(60), pipelineName: "Other" })), ...Array.from({ length: 8 }, () => lost()), deal({ value: 1000 })], NOW);
  assert.equal(split.method, "history");
  assert.equal(split.horizons, null);
  assert.ok(split.explain.caveats.some((c) => c.includes("at least 10 won deals")));
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
