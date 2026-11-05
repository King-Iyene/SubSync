import assert from "node:assert/strict";
import { test } from "node:test";
import { eventsInWeek, weekStart, weeksOf, type ClientEvent } from "../analytics/clients-flow.ts";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0); // Thursday 5 Nov 2026
const DAY = 86_400_000;
const ev = (kind: "added" | "removed", daysAgo: number, id = "x"): ClientEvent => ({ locationId: id, name: id, kind, at: NOW - daysAgo * DAY });

test("weeks start on Monday and the current week is last", () => {
  assert.equal(new Date(weekStart(NOW)).toISOString().slice(0, 10), "2026-11-02");
  const w = weeksOf([], NOW, 12);
  assert.equal(w.length, 12);
  assert.equal(w[11].start, "2026-11-02");
  assert.equal(w[0].start, "2026-08-17");
});

test("clients added and removed are counted in the week they happened, and the list behind a bar matches", () => {
  const events = [ev("added", 0, "a"), ev("added", 1, "b"), ev("removed", 1, "c"), ev("added", 9, "d"), ev("removed", 40, "e"), ev("added", 400, "old")];
  const w = weeksOf(events, NOW, 12);
  assert.deepEqual([w[11].added, w[11].removed], [2, 1]);
  assert.deepEqual([w[10].added, w[10].removed], [1, 0]);
  assert.equal(w.reduce((s, b) => s + b.added, 0), 3); // the arrival 400 days ago is outside the 12 weeks
  assert.equal(eventsInWeek(events, w[11], "added").length, 2);
  assert.equal(eventsInWeek(events, w[11]).length, 3);
});
