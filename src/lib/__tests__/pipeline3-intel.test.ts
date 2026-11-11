import assert from "node:assert/strict";
import { test } from "node:test";
import {
  atRiskEstimate, buildReplay, buildStages, capOutliers, coachingLine, dealForecastRange, dealHealth, eventText, findLeak, forecastEstimate, headlineOf, healthScore, isOutlier, parsePlWindow, percentile,
  pickButton, pressureOf, rate, staleLimitFrom, stageProbability, trackRecord, velocityEstimate, weightedPipeline, bucketOf, stageKey,
} from "../analytics/pipeline3-intel.ts";

test("stale limit: own 75th percentile from 20 stays, else an estimate, bounded 3 to 60 days", () => {
  assert.deepEqual(staleLimitFrom({ stays: 25, p75: 12.34, stageCount: 5, wonN: 30, wonCycleDays: 40 }), { days: 12.3, estimate: false });
  assert.deepEqual(staleLimitFrom({ stays: 25, p75: 0.5, stageCount: 5, wonN: 0, wonCycleDays: null }), { days: 3, estimate: false }, "floor 3");
  assert.deepEqual(staleLimitFrom({ stays: 25, p75: 400, stageCount: 5, wonN: 0, wonCycleDays: null }), { days: 60, estimate: false }, "cap 60");
  assert.deepEqual(staleLimitFrom({ stays: 10, p75: 9, stageCount: 4, wonN: 10, wonCycleDays: 40 }), { days: 20, estimate: true }, "2 x cycle / stages, labelled estimate");
  assert.deepEqual(staleLimitFrom({ stays: 0, p75: null, stageCount: 4, wonN: 2, wonCycleDays: 40 }), { days: 14, estimate: true }, "no basis: the default");
});

test("stage probability shrinks toward the account rate and needs 20 deals to be called enough", () => {
  const few = stageProbability(3, 4, 0.2);
  assert.equal(few.enough, false);
  assert.equal(few.assumed, true);
  assert.ok(few.p !== null && few.p < 0.75 && few.p > 0.2, "pulled toward the prior, not the raw 75%");
  const many = stageProbability(30, 60, 0.2);
  assert.equal(many.enough, true);
  assert.ok(many.low! < many.p! && many.p! < many.high!);
});

test("forecast and weighted pipeline say 'not enough data' under 15 closed deals, never a made-up number", () => {
  assert.equal(dealForecastRange(100_000, 3, 10), null);
  const e = forecastEstimate(100_000, 3, 10, 30);
  assert.equal(e.enough, false);
  assert.equal(e.value, null);
  assert.match(e.minNote ?? "", /Not enough data/);
  const w = weightedPipeline([{ value: 1000, p: stageProbability(1, 2, 0.5) }], 0.5, 10);
  assert.equal(w.enough, false);
  const ok = dealForecastRange(100_000, 10, 30, 60);
  assert.ok(ok && ok.low <= ok.mid && ok.mid <= ok.high);
  assert.ok(ok.mid <= 100_000 * (10 / 30) * 0.5 + 1, "a 60 day cycle halves the 30 day figure");
});

test("weighted pipeline and revenue at risk never produce the same number for different inputs", () => {
  const p = stageProbability(20, 50, 0.4);
  const open = [{ value: 100_000, p }, { value: 50_000, p }];
  const w = weightedPipeline(open, 0.4, 50), r = atRiskEstimate([{ value: 50_000, p }], 0.4, 50);
  assert.ok(w.value! > r.value!);
  assert.match(r.formula, /past the limit/);
});

test("velocity needs a win rate, an average win and a cycle", () => {
  assert.equal(velocityEstimate(10, 0.25, 4000, 40, 40).value, 250);
  assert.equal(velocityEstimate(10, null, 4000, 40, 40).enough, false);
  assert.equal(velocityEstimate(10, 0.25, 4000, 40, 5).enough, false);
});

test("outliers: one deal over 40% of a total needs 3 deals; the 95th percentile cap needs 20", () => {
  assert.equal(isOutlier(500, 1000, 5), true);
  assert.equal(isOutlier(500, 1000, 2), false);
  assert.equal(isOutlier(400, 1000, 5), false, "exactly 40% is not over");
  const small = capOutliers([{ id: "a", value: 1 }, { id: "b", value: 1e6 }]);
  assert.equal(small.cap, null);
  const vals = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, value: 1000 + i }));
  vals.push({ id: "big", value: 900_000 });
  const c = capOutliers(vals);
  assert.ok(c.cap !== null && c.capped.some((x) => x.id === "big") && c.capped.every((x) => x.cappedTo === c.cap));
});

test("deal health explains itself and a closed deal has none", () => {
  assert.equal(dealHealth({ status: "won", value: 1, ownerId: "u", isTest: false, daysInStage: 1, staleLimitDays: 5, daysSinceActivity: 1, hasAppointment: false, dnd: false }).score, null);
  const good = dealHealth({ status: "open", value: 5000, ownerId: "u", isTest: false, daysInStage: 2, staleLimitDays: 10, daysSinceActivity: 1, hasAppointment: true, dnd: false });
  assert.equal(good.score, 100);
  const bad = dealHealth({ status: "open", value: 0, ownerId: null, isTest: false, daysInStage: 30, staleLimitDays: 10, daysSinceActivity: 40, hasAppointment: false, dnd: false });
  assert.ok(bad.score! < 40);
  assert.match(bad.why ?? "", /nobody owns it/);
  assert.match(bad.why ?? "", /30 days in this stage, the usual limit is 10/);
});

test("the leak is the stage that loses the most money, in plain words, and null when nothing is lost", () => {
  assert.equal(findLeak([{ stageId: "a", stageName: "New", nextStageId: "b", reachedValue: 1000, reachedCount: 10, lostValue: 0, lostCount: 0 }]), null);
  const l = findLeak([
    { stageId: "a", stageName: "New", nextStageId: "b", reachedValue: 100_000, reachedCount: 50, lostValue: 5000, lostCount: 5 },
    { stageId: "b", stageName: "Proposal", nextStageId: null, reachedValue: 60_000, reachedCount: 20, lostValue: 30_000, lostCount: 8 },
  ]);
  assert.equal(l?.fromStageId, "b");
  assert.match(l?.text ?? "", /Most money is lost at Proposal: \$30,000 across 8 deals \(50% of the money that reached it\)/);
});

test("pressure compares with the account's own normal and needs 20 completed stays", () => {
  assert.equal(pressureOf(10, 5, 30), 2);
  assert.equal(pressureOf(10, 5, 19), null);
  assert.equal(pressureOf(null, 5, 30), null);
});

test("stages are merged by key and velocity is relative", () => {
  const meta = [{ key: stageKey("Sales", "New"), name: "New", order: 1, pipelineName: "Sales" }, { key: stageKey("Sales", "Won call"), name: "Won call", order: 2, pipelineName: "Sales" }];
  const st = buildStages(meta, [
    { key: meta[0].key, openCount: 5, openValue: 5000, staleCount: 1, staleValue: 900, medianDays: 2, normalDays: 2, staysN: 30 },
    { key: meta[1].key, openCount: 2, openValue: 9000, staleCount: 0, staleValue: 0, medianDays: 20, normalDays: 10, staysN: 5 },
  ], "sales");
  assert.equal(st[0].velocity, 1);
  assert.ok(st[1].velocity! < 0.2);
  assert.equal(st[1].dwell.pressure, null, "under 20 stays");
  assert.equal(st[0].dwell.pressure, 1);
  assert.equal(st[0].clog.count, 1);
});

test("replay rewinds the current stock through the daily moves and never goes negative", () => {
  const frames = buildReplay(["2026-11-01", "2026-11-02", "2026-11-03"], [{ stageId: "b", count: 2, value: 200 }], [
    { day: "2026-11-03", from: "a", to: "b", status: null, count: 1, value: 100 },
    { day: "2026-11-02", from: null, to: "a", status: null, count: 2, value: 150 },
    { day: "2026-11-03", from: "b", to: null, status: "won", count: 1, value: 80 },
  ]);
  assert.equal(frames.length, 3);
  assert.equal(frames[2].stages.find((s) => s.stageId === "b")?.count, 2);
  assert.equal(frames[2].wonValue, 80);
  assert.deepEqual(frames[2].moved, [{ from: "a", to: "b", count: 1, value: 100 }]);
  assert.ok(frames.every((f) => f.stages.every((s) => s.count >= 0 && s.value >= 0)));
});

test("track record needs 6 old forecasts; coverage and bias are plain ratios", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ day: `2026-0${i + 1}-01`, low: 80, mid: 100, high: 120, actual: i < 4 ? 100 : 500 }));
  const t = trackRecord(rows);
  assert.equal(t.enough, true);
  assert.equal(t.coverage.n, 4);
  assert.equal(t.coverage.of, 6);
  assert.equal(trackRecord(rows.slice(0, 3)).enough, false);
  assert.equal(trackRecord(rows.slice(0, 3)).coverage.value, null);
});

test("the overview headline and button put the biggest money problem first and stay honest under the minimum", () => {
  assert.equal(headlineOf({ openCount: 0, staleCount: 0, staleValue: 0, winRate: rate(0, 0), won30: 0, noOwner: 0 }), "No deals in play yet.");
  const h = headlineOf({ openCount: 40, staleCount: 6, staleValue: 42_000, winRate: rate(3, 10), won30: 2, noOwner: 3 });
  assert.match(h, /6 deals are stuck \(\$42,000\)/);
  assert.match(h, /not enough closed deals for a win rate/);
  assert.equal(pickButton({ staleCount: 2, staleValue: 3000, noOwner: 5, noReason: 1 })?.part, "attention");
  assert.equal(pickButton({ staleCount: 0, staleValue: 0, noOwner: 5, noReason: 1 })?.bucket, "no_owner");
  assert.equal(pickButton({ staleCount: 0, staleValue: 0, noOwner: 0, noReason: 0 }), null);
});

test("account health score is the share of open deals with no flag, null under 5 deals", () => {
  assert.equal(healthScore(4, 0), null);
  assert.equal(healthScore(10, 3), 70);
  assert.equal(healthScore(10, 99), 0);
});

test("coaching lines come from the person's own numbers and stay silent on small samples", () => {
  assert.match(coachingLine({ winRate: rate(1, 3, 10), burned: 0, lost: 2, staleCount: 6, open: 10, teamWinRate: 0.3 }) ?? "", /6 of 10 open deals are stuck/);
  assert.equal(coachingLine({ winRate: rate(1, 3, 10), burned: 0, lost: 2, staleCount: 1, open: 10, teamWinRate: 0.3 }), null);
  assert.match(coachingLine({ winRate: rate(2, 20, 10), burned: 0, lost: 18, staleCount: 0, open: 3, teamWinRate: 0.4 }) ?? "", /below the team's 40%/);
});

test("buckets and timeline text", () => {
  assert.equal(bucketOf({ status: "open", stale: true, outlier: false, isTest: false, ownerId: "u", value: 5, counted: true }), "stale");
  assert.equal(bucketOf({ status: "open", stale: false, outlier: false, isTest: false, ownerId: null, value: 5, counted: false }), "no_owner");
  assert.equal(bucketOf({ status: "open", stale: false, outlier: false, isTest: true, ownerId: "u", value: 5, counted: false }), "test");
  assert.equal(bucketOf({ status: "lost", stale: false, outlier: false, isTest: false, ownerId: "u", value: 5, counted: true }), "lost");
  assert.equal(eventText("stage", "New", "Proposal"), "Moved from New to Proposal");
  assert.equal(eventText("value", "1000", "2500"), "Value changed from $1,000 to $2,500");
  assert.equal(eventText("status", "open", "won"), "Marked won");
});

test("windows default to the last 30 days and refuse nonsense", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  assert.equal(parsePlWindow(null, null, now).days, 30);
  assert.ok(parsePlWindow("2026-13-99", "x", now).problem);
  assert.ok(parsePlWindow("2026-11-05", "2026-11-01", now).problem);
  assert.equal(parsePlWindow("2026-11-01", "2026-11-07", now).days, 7);
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
});
