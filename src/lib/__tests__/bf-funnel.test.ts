import assert from "node:assert/strict";
import { test } from "node:test";
import { biggestLeak, cohortRate, FORMULA, forecastOf, headlineOf, hotspot, leakDollars, leakFinder, reachOf, recoverPhrase, spanText, stepRows, weekStart, ZERO, type Tot } from "../analytics/bf-core.ts";
import { along, depthOf, layoutLadder, pathFor, pointOnLeak } from "../design/booking-ladder.ts";

const tot = (o: Partial<Tot>): Tot => ({ ...ZERO, ...o });
const T = tot({ leads: 1000, answered: 800, booked: 400, showed: 240, deal: 120, won: 60, wonValue: 120_000 });

test("reach is counted down the chain: a step is never bigger than the one before it", () => {
  assert.deepEqual(reachOf({ leads: 100, answered: 120, booked: 50, showed: 60, deal: 10, won: 12 }), [100, 100, 50, 50, 10, 10]);
  assert.deepEqual(reachOf({ leads: 0, answered: 0, booked: 0, showed: 0, deal: 0, won: 0 }), [0, 0, 0, 0, 0, 0]);
});

test("step rows give pass share, leads lost and drop share, and only judge a step whose neighbour is big enough", () => {
  const r = stepRows(T);
  assert.equal(r[1].passPct, 80); assert.equal(r[1].lost, 200); assert.equal(r[3].dropPct, 40); assert.equal(r[3].lost, 160);
  assert.equal(stepRows(tot({ leads: 40, answered: 5, booked: 0 }))[3].enough, false, "5 leads before the step is too few to judge");
});

test("biggest leak: by dollars when there are 5 won deals, else by leads lost; none under 10 leads", () => {
  const leak = biggestLeak(T);
  assert.ok(leak && leak.dollars !== null && leak.dollars > 0);
  assert.equal(biggestLeak(tot({ leads: 9, answered: 3 })), null);
  const noMoney = biggestLeak(tot({ leads: 100, answered: 90, booked: 20, showed: 15, deal: 10, won: 3, wonValue: 3000 }));
  assert.equal(noMoney?.key, "booked"); assert.equal(noMoney?.dollars, null, "3 won deals: no dollar line");
});

test("dollar line is lost x win rate past the step x average won deal, and refuses under 5 won", () => {
  // step 3 (showed): 400 reached booked, 240 showed -> 160 lost; 60 of 240 won = 25%; average 2000 -> 160 x 0.25 x 2000 = 80,000
  assert.equal(leakDollars(T, 3), 80_000);
  assert.equal(leakDollars(tot({ ...T, won: 4 }), 3), null);
  assert.equal(leakDollars(T, 0), null);
});

test("headline names the step in plain words and the hot spot when there is one", () => {
  const h = headlineOf(T);
  assert.match(h, /^Biggest leak: \d+% of /);
  assert.match(headlineOf(tot({ leads: 5 })), /Only 5 leads in these dates/);
  const cs = [{ dow: 2, hour: 9, before: 40, after: 10 }, { dow: 2, hour: 10, before: 40, after: 12 }, { dow: 3, hour: 9, before: 40, after: 36 }, { dow: 4, hour: 15, before: 40, after: 35 }, { dow: 5, hour: 20, before: 40, after: 37 }];
  const hot = hotspot(cs);
  assert.equal(hot?.dow, 2); assert.equal(hot?.part, "morning"); assert.match(hot?.text ?? "", /Tuesday mornings/);
  assert.equal(hotspot([{ dow: 1, hour: 9, before: 5, after: 3 }]), null, "too few to say");
});

test("leak finder lists the worst account first and puts accounts with too few leads last", () => {
  const out = leakFinder([{ id: "a", name: "Small", tot: tot({ leads: 9, answered: 2 }) }, { id: "b", name: "Big", tot: T }, { id: "c", name: "Mid", tot: tot({ leads: 100, answered: 50, booked: 20, showed: 10, deal: 5, won: 2 }) }]);
  assert.equal(out[0].id, "b"); assert.equal(out[out.length - 1].id, "a"); assert.equal(out[out.length - 1].leak, null);
});

test("cohort rate is null until enough leads are old enough, never zero", () => {
  assert.equal(cohortRate(0, 4), null); assert.equal(cohortRate(5, 20), 25);
  assert.equal(weekStart("2026-11-11"), "2026-11-09"); assert.equal(weekStart("2026-11-08"), "2026-11-02");
});

test("forecast refuses without history and labels its formula", () => {
  const base = { leads28: 280, mature30: 600, booked30: 240, showed30: 144, won30: 36, wonValue: 72_000, wonN: 36, liveDays: 60 };
  const f = forecastOf(base);
  assert.equal(f.enough, true); assert.equal(f.bookings, 120); assert.equal(f.shows, 72); assert.equal(f.won, 18); assert.equal(f.formula, FORMULA.forecast);
  assert.equal(f.revenue, 36_000);
  assert.equal(forecastOf({ ...base, liveDays: 5 }).enough, false);
  assert.equal(forecastOf({ ...base, wonN: 3 }).revenue, null);
});

test("times and the recover phrase read plainly", () => {
  assert.equal(spanText(null), "not enough data"); assert.equal(spanText(30), "under a minute"); assert.equal(spanText(600), "10 min"); assert.equal(spanText(7200), "2.0 h"); assert.equal(spanText(86400 * 3), "3.0 d");
  assert.equal(recoverPhrase(1, "Ann  Lee"), "recover Ann Lee"); assert.equal(recoverPhrase(12), "recover 12 leads");
});

// ------------------------------------------------------------------ the ladder
const steps = [{ key: "lead", label: "Lead came in", count: 1000 }, { key: "answered", label: "First reply", count: 800 }, { key: "booked", label: "Booked", count: 400 }, { key: "showed", label: "Showed up", count: 240 }, { key: "deal", label: "Deal opened", count: 120 }, { key: "won", label: "Won", count: 60 }];

test("ledge widths follow the counts, never grow going down, and everything stays inside the picture", () => {
  for (const width of [360, 390, 768, 1200]) {
    const L = layoutLadder(steps, { width });
    for (let i = 1; i < L.steps.length; i++) assert.ok(L.steps[i].w <= L.steps[i - 1].w, `width ${width} step ${i}`);
    for (const s of L.steps) assert.ok(s.x >= 0 && s.x + s.w <= width && s.y + s.h <= L.height);
    for (const k of L.leaks) assert.ok(k.basin.x + k.basin.w <= width && k.basin.x >= 0);
    assert.equal(L.leaks.length, 5); assert.equal(L.chutes.length, 5);
    assert.equal(L.leaks[0].lost, 200);
  }
  const L = layoutLadder(steps, { width: 900 });
  assert.ok(Math.abs(L.steps[2].w / L.steps[0].w - 0.4) < 0.02);
  assert.equal(layoutLadder(steps, { width: 400 }).narrow, true);
  assert.equal(layoutLadder([{ key: "lead", label: "a", count: 0 }, { key: "b", label: "b", count: 0 }], { width: 600 }).steps[1].w, 8, "zero leads still draw a thin ledge, no NaN");
});

test("little leads stop at each step in proportion to the real counts", () => {
  const counts = steps.map((s) => s.count), n = 1000, depths = new Array(6).fill(0);
  for (let j = 0; j < n; j++) depths[depthOf(j, counts)]++;
  const reached = depths.map((_, i) => depths.slice(i).reduce((a, b) => a + b, 0));
  counts.forEach((c, i) => assert.ok(Math.abs(reached[i] - c) <= 4, `step ${i}: ${reached[i]} against ${c}`));
});

test("a lead's path goes down, ends in the basin when it falls and on the last ledge when it wins", () => {
  const L = layoutLadder(steps, { width: 900 });
  const fall = pathFor(L, 5, 2), end = fall[fall.length - 1], basin = L.leaks[2].basin;
  assert.ok(end.x >= basin.x && end.x <= basin.x + basin.w && end.y >= basin.y && end.y <= basin.y + basin.h);
  const win = pathFor(L, 5, 5), last = L.steps[5];
  assert.ok(win[win.length - 1].y >= last.y && win[win.length - 1].y <= last.y + last.h);
  for (let i = 1; i < win.length; i++) assert.ok(win[i].y >= win[i - 1].y - 0.001, "never moves up");
  const a = along(fall, 0), b = along(fall, 1);
  assert.deepEqual(a, fall[0]); assert.deepEqual(b, end);
  const mid = pointOnLeak(L.leaks[0], 0.5);
  assert.ok(mid.x >= L.leaks[0].x0 && mid.y >= L.leaks[0].y0);
});
