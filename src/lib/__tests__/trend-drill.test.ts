import assert from "node:assert/strict";
import { test } from "node:test";
import { judgedInWeek, weekMembers, weeklyTrend, type TouchRow } from "../analytics/speed-intel.ts";

// KF-6: the count on a bar is the number of rows in the list behind it. Both come from judgedInWeek, so this must hold for any data; the test builds a
// messy set (answered fast, answered late, never answered, still inside the target, every week, edges of a week) and checks every week.
const NOW = Date.parse("2026-11-01T12:00:00Z");
const MIN = 60_000, DAY = 86_400_000;
const TARGET = 15;

function fixture(): TouchRow[] {
  const rows: TouchRow[] = [];
  let n = 0;
  for (let week = 0; week < 8; week++) {
    for (let k = 0; k < 9 + week; k++) {
      const leadAt = NOW - week * 7 * DAY - (k + 1) * 7 * MIN - 1; // spread inside the week (never past its far edge), the first never on the boundary
      const kind = k % 4; // 0 fast, 1 late, 2 never answered, 3 touched fast
      rows.push({ locationId: `loc${week % 3}`, contactId: `c${n++}`, leadAt, touchAt: kind === 0 || kind === 3 ? leadAt + 5 * MIN : kind === 1 ? leadAt + 90 * MIN : null, userId: kind === 2 ? null : "u1" });
    }
  }
  rows.push({ locationId: "loc0", contactId: "pending", leadAt: NOW - 2 * MIN, touchAt: null, userId: null }); // inside the target: not judged yet
  rows.push({ locationId: "loc0", contactId: "edge", leadAt: NOW - 7 * DAY, touchAt: null, userId: null }); // exactly on a week boundary: belongs to the earlier week only
  return rows;
}

test("for every week the bar's count equals the rows in its list, and the lists add up to the judged leads", () => {
  const rows = fixture();
  const trend = weeklyTrend(rows, TARGET, NOW);
  assert.equal(trend.length, 8);
  let total = 0;
  trend.forEach((w, k) => {
    const i = trend.length - 1 - k;
    const list = weekMembers(rows, TARGET, NOW, i, 10_000);
    assert.equal(list.length, w.leads, `week ${k}: count on the bar vs rows in the list`);
    assert.equal(list.filter((m) => m.status === "within").length, w.withinTarget, `week ${k}: in-time leads`);
    assert.equal(w.hitRate === null ? null : w.withinTarget / w.leads, w.hitRate);
    total += list.length;
  });
  assert.equal(total, rows.length - 1, "every lead is in exactly one week; only the one still inside its target is not judged");
});

test("the pending lead and a lead on a boundary are placed once, and the list puts what needs attention first", () => {
  const rows = fixture();
  const all = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => judgedInWeek(rows, TARGET, NOW, i));
  assert.equal(all.filter((j) => j.row.contactId === "pending").length, 0);
  assert.equal(all.filter((j) => j.row.contactId === "edge").length, 1);
  const list = weekMembers(rows, TARGET, NOW, 0, 10_000);
  const order = list.map((m) => m.status);
  assert.deepEqual(order, [...order].sort((a, b) => ({ waiting: 0, late: 1, within: 2 })[a] - ({ waiting: 0, late: 1, within: 2 })[b]));
});

test("a cap shortens the list but never changes the count, so the screen can say how many were left out", () => {
  const rows = fixture();
  const trend = weeklyTrend(rows, TARGET, NOW);
  const k = trend.length - 1; // the busiest week
  const capped = weekMembers(rows, TARGET, NOW, 0, 5);
  assert.equal(capped.length, 5);
  assert.ok(trend[k].leads > 5);
  assert.equal(weeklyTrend(rows, TARGET, NOW)[k].leads, trend[k].leads);
});

import { compareWeeks, totalsOf, weekBars, weeksIn, type TrendWeekData } from "../design/trend-bars.ts";
import { resolveRange } from "../design/range.ts";

// The same data the screen gets: trend weeks with their members, as speed-queries builds them.
function payload(cap: number): TrendWeekData[] {
  const rows = fixture();
  return weeklyTrend(rows, TARGET, NOW).map((w, k) => ({
    ...w,
    members: weekMembers(rows, TARGET, NOW, 7 - k, cap).map((m) => ({ locationId: m.row.locationId, locationName: "A", contactId: m.row.contactId, name: "N", status: m.status, minutes: 0, url: "u" })),
  }));
}

test("on the screen's own data: every bar's count equals the rows of its list, and the heading number is that count", () => {
  const trend = payload(10_000);
  const bars = weekBars(trend);
  bars.forEach((b, k) => { assert.equal(b.count, trend[k].members.length, `week ${k}`); assert.equal(b.detail, `${b.count} lead${b.count === 1 ? "" : "s"} that week`); });
});

test("when the list is capped the bar still shows the real count, which is more than the rows sent", () => {
  const trend = payload(5);
  const bars = weekBars(trend);
  assert.ok(bars.every((b, k) => b.count === weeklyTrend(fixture(), TARGET, NOW)[k].leads && trend[k].members.length === Math.min(5, b.count)));
  assert.ok(bars.some((b, k) => b.count > trend[k].members.length));
});

test("a card's window picks the weeks that mostly fall inside it, and its comparison is in points, only on enough leads", () => {
  const trend = payload(10_000);
  const today = "2026-11-01";
  const cur = resolveRange({ preset: "30d", compare: "previous" }, today);
  const inCur = weeksIn(trend, cur.current);
  assert.ok(inCur.length >= 4 && inCur.length <= 5);
  assert.equal(totalsOf(inCur).total, inCur.reduce((s, w) => s + w.members.length, 0), "the window's total is the rows behind its bars");
  const cmp = compareWeeks(trend, cur.current, cur.compare);
  assert.equal(cmp.covered, true);
  assert.ok(cmp.change && cmp.change.text.length > 0);
  const year = resolveRange({ preset: "30d", compare: "year" }, today);
  const noHistory = compareWeeks(trend, year.current, year.compare);
  assert.equal(noHistory.covered, false, "a year ago is not in 8 weeks of history, and the screen says so instead of comparing with nothing");
  assert.equal(noHistory.change, null);
  assert.equal(compareWeeks(trend, cur.current, null).change, null);
});
