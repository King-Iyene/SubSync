import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, burnRate, daily, daysLeft, DAY, isLow, levelOf, planAlerts, rankKey, spikeOf, topupList, whyLine, type Reading } from "../analytics/wg-core.ts";

const T0 = Date.UTC(2026, 10, 1, 12);
// A reading every 6 hours; `bal(i)` gives the balance at reading i.
const series = (n: number, bal: (i: number) => number, start = T0): Reading[] => Array.from({ length: n }, (_, i) => ({ at: start + i * 6 * 3_600_000, balance: bal(i) }));

test("burn rate: spend is the drops between readings, a top-up is not spend, and it needs 4 readings over 3 days", () => {
  const rs = series(16, (i) => 100 - i * 2); // 2 per 6 hours = 8 a day, over 3.75 days
  const now = rs[rs.length - 1].at;
  const b = burnRate(rs, now);
  assert.equal(b.enough, true);
  assert.ok(Math.abs((b.perDay as number) - 8) < 0.01);
  assert.ok(Math.abs((daysLeft(70, b) as number) - 70 / 8) < 0.01);
  assert.equal(burnRate(rs.slice(0, 3), rs[2].at).enough, false, "3 readings: not enough");
  assert.equal(burnRate(series(5, (i) => 50 - i), T0 + 4 * 6 * 3_600_000).enough, false, "5 readings over 1 day: not enough");
  const withTopup = series(16, (i) => (i < 8 ? 100 - i * 2 : 200 - i * 2));
  assert.ok(Math.abs((burnRate(withTopup, withTopup[15].at).perDay as number) - 28 / 3.75) < 0.01, "the 100 top-up is not counted as spend");
});

test("days left: empty is zero, no honest figure is null, a zero burn is null (not infinite)", () => {
  const flat = burnRate(series(16, () => 40), T0 + 16 * 6 * 3_600_000);
  assert.equal(flat.perDay, 0);
  assert.equal(daysLeft(40, flat), null);
  assert.equal(daysLeft(0, flat), 0);
  assert.equal(daysLeft(-3, flat), 0);
  assert.equal(daysLeft(null, flat), null);
});

test("a gap longer than 36 hours is not counted as spend or as days", () => {
  const rs: Reading[] = [{ at: T0, balance: 100 }, { at: T0 + 6 * 3_600_000, balance: 98 }, { at: T0 + 12 * 3_600_000, balance: 96 }, { at: T0 + 5 * DAY, balance: 10 }, { at: T0 + 5 * DAY + 6 * 3_600_000, balance: 9 }];
  const b = burnRate(rs, rs[4].at);
  assert.ok(b.spent < 6, `spent ${b.spent}`);
});

test("daily series: spend per day, top-ups, and a day after a gap is marked not covered", () => {
  const rs: Reading[] = [{ at: T0, balance: 50 }, { at: T0 + 6 * 3_600_000, balance: 45 }, { at: T0 + 12 * 3_600_000, balance: 60 }, { at: T0 + 2 * DAY + 3_600_000, balance: 40 }];
  const d = daily(rs);
  assert.equal(d[0].day, "2026-11-01");
  assert.equal(d[0].spent, 5);
  const day2 = d.find((x) => x.day === "2026-11-02");
  assert.equal(day2?.topups, 1);
  assert.equal(day2?.topupAmount, 15);
  assert.equal(d[d.length - 1].covered, false, "the reading two days later follows a long gap");
  assert.deepEqual(topupList(rs), [{ at: T0 + 12 * 3_600_000, amount: 15 }]);
});

// One spend figure per day, in four equal steps.
const D0 = Date.UTC(2026, 9, 1);
const dayReadings = (spends: number[]): Reading[] => {
  const out: Reading[] = [{ at: D0 - 6 * 3_600_000, balance: 1000 }];
  let bal = 1000;
  spends.forEach((sp, d) => { for (let k = 0; k < 4; k++) { bal -= sp / 4; out.push({ at: D0 + d * DAY + k * 6 * 3_600_000, balance: bal }); } });
  return out;
};

test("spike: 3 times the account's own normal and at least 5 more; needs 7 normal days first", () => {
  const spikeDays = dayReadings([...Array(10).fill(4), 30]);
  const s = spikeOf(daily(spikeDays));
  assert.equal(s.enough, true);
  assert.equal(s.spike, true);
  assert.equal(s.baseline, 4);
  const calm = spikeOf(daily(dayReadings([...Array(10).fill(4), 8])));
  assert.equal(calm.spike, false, "8 is not 3 times 4");
  const smallBase = spikeOf(daily(dayReadings([...Array(10).fill(1), 4])));
  assert.equal(smallBase.spike, false, "4 is 4 times 1 but only 3 more: under the 5 dollar floor");
  const young = spikeOf(daily(dayReadings([4, 4, 4, 30])));
  assert.equal(young.enough, false, "under 7 normal days: not enough data, never a spike");
  assert.equal(young.spike, false);
  const zeroBase = spikeOf(daily(dayReadings([...Array(10).fill(0), 12])));
  assert.equal(zeroBase.spike, true, "normal zero: 10 dollars in a day is a spike");
});

test("levels: empty beats low beats spike; low by amount or by days left; unknown has no balance", () => {
  const r = { lowAmount: 10, lowDays: 3 };
  assert.equal(levelOf({ balance: 0, daysLeft: null, spike: false }, r), "empty");
  assert.equal(levelOf({ balance: 8, daysLeft: null, spike: true }, r), "low");
  assert.equal(levelOf({ balance: 50, daysLeft: 2, spike: false }, r), "low");
  assert.equal(levelOf({ balance: 50, daysLeft: 20, spike: true }, r), "spike");
  assert.equal(levelOf({ balance: 50, daysLeft: null, spike: false }, r), "ok");
  assert.equal(levelOf({ balance: null, daysLeft: null, spike: false }, r), "unknown");
  assert.equal(isLow(10, null, r), true, "at the limit is low");
});

test("the watchlist order: empty, then fewest days left, then lowest balance, then no estimate, then unknown", () => {
  const rows = [{ n: "unknown", balance: null, daysLeft: null }, { n: "noest", balance: 30, daysLeft: null }, { n: "d5", balance: 100, daysLeft: 5 }, { n: "d2", balance: 400, daysLeft: 2 }, { n: "empty", balance: 0, daysLeft: 0 }];
  const sorted = rows.slice().sort((a, b) => { const x = rankKey(a), y = rankKey(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  assert.deepEqual(sorted.map((x) => x.n), ["empty", "d2", "d5", "noest", "unknown"]);
});

test("alerts: one per episode, none without a balance, a spike only for today", () => {
  const rules = { lowAmount: 10, lowDays: 3 };
  const none = { enough: false, spike: false, day: null, spent: null, baseline: null };
  assert.deepEqual(planAlerts({ name: "A", balance: null, daysLeft: null, spike: none, lastTopup: null }, rules, "2026-11-10"), []);
  const empty = planAlerts({ name: "A", balance: 0, daysLeft: 0, spike: none, lastTopup: "2026-11-03" }, rules, "2026-11-10");
  assert.equal(empty.length, 1);
  assert.equal(empty[0].kind, "wg_empty");
  assert.equal(empty[0].episode, "2026-11-03", "the episode is the last top-up, so the next day does not alert again");
  const low = planAlerts({ name: "A", balance: 9, daysLeft: null, spike: none, lastTopup: null }, rules, "2026-11-10");
  assert.equal(low[0].kind, "wg_low");
  assert.match(low[0].title, /\$9/);
  const spike = { enough: true, spike: true, day: "2026-11-10", spent: 30, baseline: 4 };
  assert.equal(planAlerts({ name: "A", balance: 500, daysLeft: 40, spike, lastTopup: null }, rules, "2026-11-10")[0].kind, "wg_spike");
  assert.equal(planAlerts({ name: "A", balance: 500, daysLeft: 40, spike, lastTopup: null }, rules, "2026-11-11").length, 0, "yesterday's spike is not today's alert");
});

test("analyze: ties the pieces together and says why in plain words, labelled as an estimate", () => {
  const rs = dayReadings([...Array(10).fill(4), 30]);
  const a = analyze(rs, rs[rs.length - 1].at);
  assert.equal(a.spike.spike, true);
  assert.ok(a.burn.enough);
  const why = whyLine({ balance: 12, daysLeft: 2.2, burnPerDay: 5, spike: false, spikeSpent: null, spikeBaseline: null, lowAmount: 10, state: "ok" });
  assert.match(why, /about 2 days left/i);
  assert.match(why, /estimate/);
  assert.match(whyLine({ balance: null, daysLeft: null, burnPerDay: null, spike: false, spikeSpent: null, spikeBaseline: null, lowAmount: 10, state: "needs_permission" }), /Needs permission: reconnect/);
  assert.match(whyLine({ balance: null, daysLeft: null, burnPerDay: null, spike: false, spikeSpent: null, spikeBaseline: null, lowAmount: 10, state: "not_available" }), /Not available from the platform yet/);
});
