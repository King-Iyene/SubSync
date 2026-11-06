import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SCRIPT, fillScript, followUpDays, isDialOutcome, isListId, keyOf, nextIndex, noteFor, OUTCOMES, quietWarning, rankQueue, rankScore, sessionSummary, skipReason, statsByUser, taskFor, type QueueItem } from "../dial/dial.ts";

const item = (o: Partial<QueueItem> & { contactId: string }): QueueItem => ({ locationId: "L1", locationName: "Acme", name: "Dana Cole", phone: "+15550001111", dnd: false, timeZone: "America/New_York", openValue: 0, ageHours: 5, priority: 50, reasons: [], url: "https://x", ...o });

test("ranking: more money first, then fresher, then the list's own priority; ties are stable", () => {
  const a = item({ contactId: "a", openValue: 10_000, ageHours: 100 });
  const b = item({ contactId: "b", openValue: 0, ageHours: 0.5 });
  const c = item({ contactId: "c", openValue: 10_000, ageHours: 0.5 });
  assert.deepEqual(rankQueue([b, a, c]).map((x) => x.contactId), ["c", "a", "b"]);
  assert.ok(rankScore({ openValue: 500, ageHours: 1, priority: 0 }) > rankScore({ openValue: 500, ageHours: 200, priority: 0 }), "decay lowers the score");
  assert.deepEqual(rankQueue([item({ contactId: "z" }), item({ contactId: "y" })]).map((x) => x.contactId), ["y", "z"]);
  assert.equal(rankScore({ openValue: -5, ageHours: null, priority: 500 }) >= 0, true);
});

test("every outcome has one shortcut, one local word and a note; only call back later makes a task", () => {
  assert.deepEqual(OUTCOMES.map((o) => o.hot), ["1", "2", "3", "4", "5", "6", "7"]);
  const now = new Date("2026-11-05T12:00:00Z");
  for (const o of OUTCOMES) {
    assert.match(noteFor(o.key), /^Call from SubSync: .+\.$/);
    assert.equal(taskFor(o.key, "Dana Cole", null, now) !== null, o.key === "call_back");
  }
  assert.equal(isDialOutcome("spoke"), true);
  assert.equal(isDialOutcome("dial_the_police"), false);
});

test("call back later: the task is due when the person chose, a day ahead when the time is missing or in the past", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  assert.equal(taskFor("call_back", "Dana", "2026-11-07T15:00:00Z", now)?.dueDate, "2026-11-07T15:00:00.000Z");
  assert.equal(taskFor("call_back", "Dana", null, now)?.dueDate, "2026-11-06T12:00:00.000Z");
  assert.equal(taskFor("call_back", "Dana", "2026-11-01T15:00:00Z", now)?.dueDate, "2026-11-06T12:00:00.000Z");
  assert.equal(taskFor("call_back", "Dana", null, now)?.title, "Call Dana back");
  assert.match(noteFor("call_back", "2026-11-07T15:00:00Z"), /around 2026-11-07 15:00 UTC/);
  assert.equal(followUpDays("2026-11-08T12:00:00Z", now), 3);
  assert.equal(followUpDays(null, now), 1);
});

test("Do Not Disturb and missing numbers are skipped; auto-advance never lands on them", () => {
  const list = [item({ contactId: "1" }), item({ contactId: "2", dnd: true }), item({ contactId: "3", phone: null }), item({ contactId: "4" }), item({ contactId: "5" })];
  assert.equal(skipReason(list[1])?.kind, "dnd");
  assert.equal(skipReason(list[2])?.kind, "no_phone");
  assert.equal(skipReason(list[0]), null);
  assert.equal(nextIndex(list, -1, new Set()), 0);
  assert.equal(nextIndex(list, 0, new Set()), 3, "skips the DND person and the one with no number");
  assert.equal(nextIndex(list, 3, new Set([keyOf(list[4])])), -1, "a person already handled is not offered again");
  assert.equal(nextIndex(list, 4, new Set()), -1);
});

test("quiet hours warn outside 8am to 9pm in the person's zone, and say nothing when the zone is unknown", () => {
  assert.ok(quietWarning("America/New_York", new Date("2026-11-05T06:00:00Z")), "1am in New York");
  assert.equal(quietWarning("America/New_York", new Date("2026-11-05T17:00:00Z")), null, "noon in New York");
  assert.equal(quietWarning(null, new Date()), null);
  assert.equal(quietWarning("Not/AZone", new Date()), null);
});

test("session summary counts calls, people reached, bookings, skips and an honest minutes-saved estimate", () => {
  const t = Date.parse("2026-11-05T12:00:00Z");
  const s = sessionSummary([{ outcome: "no_answer", at: t }, { outcome: "spoke", at: t + 30 * 60_000 }, { outcome: "booked", at: t + 60 * 60_000 }, { outcome: "wrong_number", at: t + 90 * 60_000 }], 2);
  assert.deepEqual({ calls: s.calls, reached: s.reached, booked: s.booked, skipped: s.skipped, minutesSaved: s.minutesSaved, perHour: s.perHour, reachRate: s.reachRate }, { calls: 4, reached: 2, booked: 1, skipped: 2, minutesSaved: 3, perHour: 2, reachRate: 50 });
  const none = sessionSummary([], 0);
  assert.equal(none.reachRate, null);
  assert.equal(none.perHour, null);
});

test("per-person stats: calls, outcome words and calls an hour, never any text", () => {
  const t = Date.parse("2026-11-05T12:00:00Z");
  const r = statsByUser([{ userId: "u1", outcome: "spoke", at: t }, { userId: "u1", outcome: "no_answer", at: t + 30 * 60_000 }, { userId: "u2", outcome: "booked", at: t }]);
  assert.equal(r[0].userId, "u1");
  assert.equal(r[0].calls, 2);
  assert.equal(r[0].perHour, 2);
  assert.equal(r[1].perHour, null, "one call has no rate");
  assert.deepEqual(r[0].outcomes, { spoke: 1, no_answer: 1 });
});

test("script and list ids: the default fills in a first name; list ids are checked", () => {
  assert.equal(fillScript(DEFAULT_SCRIPT, { name: "Dana Cole", me: "Sam", business: "Acme" }).startsWith("Hi Dana, this is Sam from Acme."), true);
  assert.match(fillScript("Hi {name}", { name: "" }), /Hi there/);
  assert.equal(isListId("missed"), true);
  assert.equal(isListId("saved:123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(isListId("saved:x; drop table"), false);
  assert.equal(isListId("anything"), false);
});
