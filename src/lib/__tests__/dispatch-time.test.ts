import assert from "node:assert/strict";
import { test } from "node:test";
import { dueNow, localClock } from "../analytics/digest-intel.ts";
import { weeklyDue } from "../analytics/weekly-email.ts";

// "Send at 08:00" in a chosen time zone, checked with fake clocks. The scheduler runs the dispatcher every hour on the hour (daily brief) or five
// past (Monday email). Each helper below plays the dispatcher over a stretch of real calendar time and records every send.

const HOUR = 3_600_000;
type Send = { at: string; localDate: string; localHour: number; weekday: string };

function playDaily(zone: string, hour: number, fromIso: string, hours: number, minuteOfHour = 0, skip: (t: number) => boolean = () => false): Send[] {
  const sends: Send[] = [];
  let lastOn: string | null = null;
  const start = Date.parse(fromIso);
  for (let t = start; t < start + hours * HOUR; t += HOUR) {
    if (skip(t)) continue;
    const now = new Date(t + minuteOfHour * 60_000);
    if (dueNow(now, zone, hour, lastOn)) {
      const c = localClock(now, zone)!;
      sends.push({ at: now.toISOString(), localDate: c.date, localHour: c.hour, weekday: c.weekday });
      lastOn = c.date;
    }
  }
  return sends;
}

function playWeekly(zone: string, hour: number, fromIso: string, hours: number): Send[] {
  const sends: Send[] = [];
  let lastOn: string | null = null;
  const start = Date.parse(fromIso);
  for (let t = start; t < start + hours * HOUR; t += HOUR) {
    const now = new Date(t + 5 * 60_000);
    const c = localClock(now, zone);
    if (weeklyDue(c, hour, lastOn)) { sends.push({ at: now.toISOString(), localDate: c!.date, localHour: c!.hour, weekday: c!.weekday }); lastOn = c!.date; }
  }
  return sends;
}

test("a daily brief at 08:00 in Lagos goes out once a day, at 08:00 local, which is 07:00 UTC", () => {
  const sends = playDaily("Africa/Lagos", 8, "2026-10-30T00:00:00Z", 72);
  assert.equal(sends.length, 3);
  for (const s of sends) { assert.equal(s.localHour, 8); assert.match(s.at, /T07:00:00/); }
});

test("the same chosen hour lands at different UTC hours in different time zones", () => {
  // Start at 12:00 UTC, so no zone begins inside its own send window (that would be a late catch-up, tested separately).
  const ny = playDaily("America/New_York", 8, "2026-10-28T12:00:00Z", 60);
  const tokyo = playDaily("Asia/Tokyo", 8, "2026-10-28T12:00:00Z", 60);
  const la = playDaily("America/Los_Angeles", 8, "2026-10-28T12:00:00Z", 60);
  assert.ok(ny.length >= 2 && tokyo.length >= 2 && la.length >= 2);
  assert.ok(ny.every((s) => s.localHour === 8) && ny.every((s) => /T12:00:00/.test(s.at)), "New York in October (summer time) is UTC-4");
  assert.ok(tokyo.every((s) => s.localHour === 8) && tokyo.every((s) => /T23:00:00/.test(s.at)), "Tokyo is UTC+9, so 08:00 is 23:00 the evening before in UTC");
  assert.ok(la.every((s) => s.localHour === 8) && la.every((s) => /T15:00:00/.test(s.at)), "Los Angeles in October is UTC-7");
});

test("half-hour zones: the hourly run lands at :30 local, still inside the chosen hour", () => {
  const india = playDaily("Asia/Kolkata", 8, "2026-10-29T00:00:00Z", 48);
  assert.equal(india.length, 2);
  for (const s of india) assert.equal(s.localHour, 8, "sent inside the 08:00 hour (08:30 local, 03:00 UTC)");
  const lordHowe = playDaily("Australia/Lord_Howe", 8, "2026-10-29T00:00:00Z", 72);
  assert.equal(lordHowe.length, 3);
  assert.ok(lordHowe.every((s) => s.localHour === 8));
});

test("when the clocks go back (New York, 1 November 2026) the brief still goes out once and at 08:00 local on both sides", () => {
  const sends = playDaily("America/New_York", 8, "2026-10-30T00:00:00Z", 96);
  assert.deepEqual(sends.map((s) => s.localDate), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.ok(sends.every((s) => s.localHour === 8));
  assert.deepEqual(sends.map((s) => s.at.slice(11, 13)), ["12", "12", "13", "13"], "the UTC hour moves by one when the clocks change; the local hour does not");
});

test("the repeated 01:00 hour on the fall-back night does not send twice", () => {
  const sends = playDaily("America/New_York", 1, "2026-10-31T12:00:00Z", 48);
  assert.deepEqual(sends.map((s) => s.localDate), ["2026-11-01", "2026-11-02"]);
});

test("when the clocks go forward (New York, 8 March 2026) a brief chosen for the missing 02:00 goes out at 03:00 local, once", () => {
  const sends = playDaily("America/New_York", 2, "2026-03-07T00:00:00Z", 72);
  assert.deepEqual(sends.map((s) => s.localDate), ["2026-03-07", "2026-03-08", "2026-03-09"]);
  assert.equal(sends[1].localHour, 3, "02:00 did not exist that night, so the first hour inside the window is 03:00");
  assert.ok(sends[0].localHour === 2 && sends[2].localHour === 2);
});

test("a run that is a little late still sends the same morning, one that is too late skips the day, and the next day is normal", () => {
  // Lagos, 08:00. The dispatcher misses 07:00, 08:00 and 09:00 UTC (08:00, 09:00, 10:00 local): the next run is at 11:00 local, outside the window.
  const skip = (t: number) => ["2026-10-30T07:00:00.000Z", "2026-10-30T08:00:00.000Z", "2026-10-30T09:00:00.000Z"].includes(new Date(t).toISOString());
  const sends = playDaily("Africa/Lagos", 8, "2026-10-29T00:00:00Z", 72, 0, skip);
  assert.deepEqual(sends.map((s) => s.localDate), ["2026-10-29", "2026-10-31"], "30 October is skipped, not sent at 11:00 as a morning brief");
  // Missing only the 08:00 run (one hour late) still sends the same morning.
  const late = playDaily("Africa/Lagos", 8, "2026-10-29T00:00:00Z", 48, 0, (t) => new Date(t).toISOString() === "2026-10-30T07:00:00.000Z");
  assert.deepEqual(late.map((s) => s.localDate), ["2026-10-29", "2026-10-30"]);
  assert.equal(late[1].localHour, 9);
});

test("turning the brief on in the afternoon waits for tomorrow's chosen hour, it does not send at once", () => {
  const sends = playDaily("Africa/Lagos", 8, "2026-10-30T14:00:00Z", 24);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].localDate, "2026-10-31");
  assert.equal(sends[0].localHour, 8);
});

test("an invalid time zone never sends", () => {
  assert.equal(playDaily("Not/AZone", 8, "2026-10-30T00:00:00Z", 48).length, 0);
});

test("the Monday email goes out on Monday local time only, once, at the chosen hour (Sydney's Monday starts on Sunday in UTC)", () => {
  const sends = playWeekly("Australia/Sydney", 8, "2026-10-25T00:00:00Z", 24 * 15);
  assert.ok(sends.length >= 2);
  assert.ok(sends.every((s) => s.weekday === "Mon" && s.localHour === 8));
  const sunday = sends.find((s) => s.at.startsWith("2026-11-01"));
  assert.ok(sunday, "08:05 Monday in Sydney (summer time, UTC+11) is Sunday 21:05 UTC");
  assert.equal(new Set(sends.map((s) => s.localDate)).size, sends.length, "never twice on the same day");
});

test("the Monday email across New York's clock change: still Monday 08:00 local", () => {
  const sends = playWeekly("America/New_York", 8, "2026-10-26T00:00:00Z", 24 * 14);
  assert.deepEqual(sends.map((s) => s.localDate), ["2026-10-26", "2026-11-02"]);
  assert.deepEqual(sends.map((s) => s.at.slice(11, 13)), ["12", "13"]);
});

test("the Monday email is not sent on other days even if the brief window is open", () => {
  const sends = playWeekly("Europe/London", 8, "2026-10-26T00:00:00Z", 24 * 7);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].weekday, "Mon");
});
