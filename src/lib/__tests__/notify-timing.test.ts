import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, inQuiet, isHour, localDate, quietText, scheduledDue, validZone, whenText, zoneOf, type Timing } from "../notifications/timing.ts";

// When a message may go out: quiet hours, the chosen hour in the chosen time zone, once a day, and a critical alert never held. Fake clocks across time zones
// and daylight-saving changes (2026: US spring forward on 8 Mar, US fall back on 1 Nov, Europe fall back on 25 Oct).

const base: Timing = { frequency: "immediate", hour: 8, weekday: "Mon", timezone: null, quietOn: true, quietStart: 21, quietEnd: 7, criticalBypass: true };
const at = (iso: string) => new Date(iso);
const QUARTER = 15 * 60_000;

test("quiet hours wrap past midnight; equal start and end means no quiet window", () => {
  for (const h of [21, 22, 23, 0, 1, 6]) assert.equal(inQuiet(h, 21, 7), true, `hour ${h}`);
  for (const h of [7, 8, 12, 20]) assert.equal(inQuiet(h, 21, 7), false, `hour ${h}`);
  assert.equal(inQuiet(3, 1, 5), true);
  assert.equal(inQuiet(5, 1, 5), false);
  assert.equal(inQuiet(0, 1, 5), false);
  assert.equal(inQuiet(23, 9, 9), false);
});

test("a warning in quiet hours is held; a critical alert is sent at once; a warning in the day is sent", () => {
  const zone = "Africa/Lagos"; // UTC+1, no daylight saving
  const night = at("2026-11-02T22:30:00Z"); // 23:30 in Lagos
  assert.deepEqual(decide({ timing: base, severity: "warning", now: night, zone, lastBatchDate: null }), { action: "hold", reason: "quiet_hours" });
  assert.deepEqual(decide({ timing: base, severity: "critical", now: night, zone, lastBatchDate: null }), { action: "send" });
  assert.deepEqual(decide({ timing: base, severity: "warning", now: at("2026-11-03T06:30:00Z"), zone, lastBatchDate: null }), { action: "send" }, "07:30 local");
});

test("the quiet window's edges: 20:59 is day, 21:00 is night, 06:59 is night, 07:00 is day", () => {
  const z = "Africa/Lagos";
  const w = (iso: string) => decide({ timing: base, severity: "warning", now: at(iso), zone: z, lastBatchDate: null }).action;
  assert.equal(w("2026-11-02T19:59:00Z"), "send"); // 20:59
  assert.equal(w("2026-11-02T20:00:00Z"), "hold"); // 21:00
  assert.equal(w("2026-11-03T05:59:00Z"), "hold"); // 06:59
  assert.equal(w("2026-11-03T06:00:00Z"), "send"); // 07:00
});

test("with the critical bypass off, a critical alert waits too; with quiet hours off nothing waits", () => {
  const night = at("2026-11-02T22:30:00Z");
  assert.equal(decide({ timing: { ...base, criticalBypass: false }, severity: "critical", now: night, zone: "Africa/Lagos", lastBatchDate: null }).action, "hold");
  assert.equal(decide({ timing: { ...base, quietOn: false }, severity: "warning", now: night, zone: "Africa/Lagos", lastBatchDate: null }).action, "send");
});

test("the same instant is night in one zone and day in another", () => {
  const now = at("2026-11-02T02:00:00Z");
  const ask = (zone: string) => decide({ timing: base, severity: "warning", now, zone, lastBatchDate: null }).action;
  assert.equal(ask("America/Los_Angeles"), "send"); // 19:00 the evening before
  assert.equal(ask("America/New_York"), "hold"); // 21:00 (EST)
  assert.equal(ask("Asia/Tokyo"), "send"); // 11:00
  assert.equal(ask("Asia/Kolkata"), "send"); // 07:30
  assert.equal(ask("Pacific/Auckland"), "send"); // 15:00
  assert.equal(ask("Australia/Lord_Howe"), "send"); // 13:00 (half-hour zone)
});

// Find the first moment (a quarter hour at a time) a held warning would be released, so daylight-saving days can be checked exactly.
function firstRelease(zone: string, fromIso: string, hours: number): string | null {
  const start = Date.parse(fromIso);
  for (let t = start; t < start + hours * 3_600_000; t += QUARTER) {
    if (decide({ timing: base, severity: "warning", now: new Date(t), zone, lastBatchDate: null }).action === "send") return new Date(t).toISOString();
  }
  return null;
}

test("daylight saving: a warning held overnight goes out at 07:00 LOCAL on the fall-back day, the spring-forward day and an ordinary day", () => {
  // US fall back, 1 Nov 2026 (01:00 happens twice; clocks go from EDT to EST at 06:00 UTC). Night from 21:00 EDT on 31 Oct.
  assert.equal(firstRelease("America/New_York", "2026-11-01T01:00:00Z", 24), "2026-11-01T12:00:00.000Z", "07:00 EST is 12:00 UTC");
  // US spring forward, 8 Mar 2026 (02:00 does not exist). 07:00 EDT is 11:00 UTC.
  assert.equal(firstRelease("America/New_York", "2026-03-08T03:00:00Z", 24), "2026-03-08T11:00:00.000Z", "07:00 EDT is 11:00 UTC");
  // An ordinary winter day: 07:00 EST is 12:00 UTC.
  assert.equal(firstRelease("America/New_York", "2026-12-10T03:00:00Z", 24), "2026-12-10T12:00:00.000Z");
  // Europe falls back a week earlier (25 Oct, 01:00 UTC): a warning that arrives at 21:00 BST on the 24th is held until 07:00 GMT, which is 07:00 UTC.
  assert.equal(firstRelease("Europe/London", "2026-10-24T20:00:00Z", 24), "2026-10-25T07:00:00.000Z");
  // And it is quiet (held) from the very first quarter hour after 21:00 BST.
  assert.equal(decide({ timing: base, severity: "warning", now: at("2026-10-24T20:00:00Z"), zone: "Europe/London", lastBatchDate: null }).action, "hold");
  assert.equal(decide({ timing: base, severity: "warning", now: at("2026-10-24T19:45:00Z"), zone: "Europe/London", lastBatchDate: null }).action, "send");
});

test("once a day: a warning waits for the chosen hour, goes out in one message, and a second batch the same local date is not sent", () => {
  const t: Timing = { ...base, frequency: "daily", hour: 8 };
  const zone = "America/New_York";
  const ask = (iso: string, last: string | null) => decide({ timing: t, severity: "warning", now: at(iso), zone, lastBatchDate: last }).action;
  assert.equal(ask("2026-11-03T12:00:00Z", null), "hold", "07:00 EST is before the hour");
  assert.equal(ask("2026-11-03T13:00:00Z", null), "send", "08:00 EST");
  assert.equal(ask("2026-11-03T15:30:00Z", null), "send", "10:30 EST is still inside the three-hour catch-up");
  assert.equal(ask("2026-11-03T16:00:00Z", null), "hold", "11:00 EST: too late, wait for tomorrow");
  assert.equal(ask("2026-11-03T13:00:00Z", "2026-11-03"), "hold", "already sent today");
  assert.equal(ask("2026-11-04T13:00:00Z", "2026-11-03"), "send", "the next day");
  assert.deepEqual(decide({ timing: t, severity: "warning", now: at("2026-11-03T20:00:00Z"), zone, lastBatchDate: null }), { action: "hold", reason: "daily_batch" });
});

test("once a day: a critical alert still goes at once (unless the bypass is off)", () => {
  const t: Timing = { ...base, frequency: "daily", hour: 8 };
  assert.equal(decide({ timing: t, severity: "critical", now: at("2026-11-03T20:00:00Z"), zone: "America/New_York", lastBatchDate: "2026-11-03" }).action, "send");
  assert.equal(decide({ timing: { ...t, criticalBypass: false }, severity: "critical", now: at("2026-11-03T20:00:00Z"), zone: "America/New_York", lastBatchDate: null }).action, "hold");
});

test("once a week: only on the chosen day, from the chosen hour", () => {
  const t: Timing = { ...base, frequency: "weekly", hour: 9, weekday: "Mon" };
  const zone = "Africa/Lagos";
  const ask = (iso: string, last: string | null = null) => decide({ timing: t, severity: "warning", now: at(iso), zone, lastBatchDate: last });
  assert.equal(ask("2026-11-02T08:00:00Z").action, "send", "Monday 09:00 in Lagos");
  assert.deepEqual(ask("2026-11-03T08:00:00Z"), { action: "hold", reason: "weekly_batch" }, "Tuesday");
  assert.equal(ask("2026-11-02T08:00:00Z", "2026-11-02").action, "hold", "already sent this Monday");
  assert.equal(ask("2026-11-02T07:00:00Z").action, "hold", "Monday 08:00 is before the hour");
});

test("a scheduled brief is due from the chosen hour until three hours later, once per local date", () => {
  const t: Timing = { ...base, frequency: "daily", hour: 8, timezone: "Africa/Lagos" };
  const due = (iso: string, last: string | null = null) => scheduledDue(t, at(iso), "Africa/Lagos", last);
  assert.deepEqual(due("2026-11-02T06:59:00Z"), { due: false, date: "2026-11-02" });
  assert.deepEqual(due("2026-11-02T07:00:00Z"), { due: true, date: "2026-11-02" });
  assert.equal(due("2026-11-02T09:59:00Z").due, true, "10:59 local");
  assert.equal(due("2026-11-02T10:00:00Z").due, false, "11:00 local: the day is skipped, never a morning message in the evening");
  assert.equal(due("2026-11-02T07:00:00Z", "2026-11-02").due, false, "already sent");
  assert.equal(due("2026-11-03T07:00:00Z", "2026-11-02").due, true);
});

test("a weekly summary is due only on its day", () => {
  const t: Timing = { ...base, frequency: "weekly", hour: 8, weekday: "Mon" };
  assert.equal(scheduledDue(t, at("2026-11-02T07:00:00Z"), "Africa/Lagos", null).due, true);
  assert.equal(scheduledDue(t, at("2026-11-03T07:00:00Z"), "Africa/Lagos", null).due, false);
  // Sydney's Monday morning is still Sunday in UTC.
  assert.equal(scheduledDue(t, at("2026-11-01T21:30:00Z"), "Australia/Sydney", null).due, true, "08:30 Monday in Sydney");
});

test("daylight saving never loses or doubles a scheduled brief", () => {
  const sends = (zone: string, hour: number, fromIso: string, hours: number) => {
    const t: Timing = { ...base, frequency: "daily", hour };
    const out: string[] = [];
    let last: string | null = null;
    for (let ms = Date.parse(fromIso); ms < Date.parse(fromIso) + hours * 3_600_000; ms += 3_600_000) {
      const d = scheduledDue(t, new Date(ms), zone, last);
      if (d.due && d.date) { out.push(`${d.date}@${new Date(ms).toISOString().slice(11, 13)}Z`); last = d.date; }
    }
    return out;
  };
  // Spring forward: 02:00 does not exist on 8 Mar. A brief chosen for 02:00 still goes out once that day, at 03:00 EDT (07:00 UTC).
  // 02:00 EST is 07:00 UTC on the 7th, 03:00 EDT (the first hour that exists) is 07:00 UTC on the 8th, and 02:00 EDT is 06:00 UTC on the 9th.
  assert.deepEqual(sends("America/New_York", 2, "2026-03-07T00:00:00Z", 72), ["2026-03-07@07Z", "2026-03-08@07Z", "2026-03-09@06Z"]);
  // Fall back: 01:00 happens twice on 1 Nov. A brief chosen for 01:00 goes out ONCE, at the first 01:00 (05:00 UTC).
  const fall = sends("America/New_York", 1, "2026-10-31T12:00:00Z", 48);
  assert.deepEqual(fall, ["2026-11-01@05Z", "2026-11-02@06Z"]);
});

test("zone and wording helpers", () => {
  assert.equal(validZone("Africa/Lagos"), true);
  assert.equal(validZone("Mars/Olympus"), false);
  assert.equal(validZone(""), false);
  assert.equal(validZone(5), false);
  assert.equal(zoneOf({ timezone: "Asia/Tokyo" }, "Africa/Lagos"), "Asia/Tokyo");
  assert.equal(zoneOf({ timezone: null }, "Africa/Lagos"), "Africa/Lagos");
  assert.equal(zoneOf({ timezone: "Nowhere/Land" }, null), "UTC");
  assert.equal(isHour(0), true);
  assert.equal(isHour(23), true);
  assert.equal(isHour(24), false);
  assert.equal(isHour(7.5), false);
  assert.equal(localDate(at("2026-11-02T23:30:00Z"), "Africa/Lagos"), "2026-11-03");
  assert.equal(whenText({ ...base, frequency: "daily", hour: 8 }), "8:00 your time");
  assert.equal(whenText({ ...base, frequency: "weekly", hour: 14, weekday: "Mon" }), "Monday 14:00 your time");
  assert.equal(whenText(base), "as it happens");
  assert.match(quietText(base), /Between 21:00 and 07:00 in your time zone, warnings wait until 07:00\. Critical alerts are still sent at once\./);
  assert.match(quietText({ ...base, criticalBypass: false }), /Critical alerts wait too/);
  assert.match(quietText({ ...base, quietOn: false }), /No quiet hours/);
});
