import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMessage, DEFAULT_DIGEST, destination, isDue, mayReallySend, sanitizeDigest, scheduleKey } from "../analytics/speed-digest.ts";

const N = { who: "Acme Roofing", waiting: 3, typicalSeconds: 600, inTimePct: 72, leaked: 5, noOwner: 1 };

test("message: only the chosen lines, numbers only, editable intro and sign-off, 'not enough data' for a missing figure", () => {
  const m = buildMessage({ ...DEFAULT_DIGEST, intro: "Hello team.", outro: "Thanks.", lines: ["waiting", "typical", "inTime", "leaked", "noOwner"] }, N);
  assert.equal(m.subject, "Acme Roofing: daily speed to lead summary");
  assert.equal(m.text, "Hello team.\n\n- 3 leads are waiting for a first reply.\n- Typical first reply: 10 minutes.\n- Answered in time: 72%.\n- 5 leads got no reply from a person, or a slow one.\n- 1 lead has no owner.\n\nThanks.");
  const few = buildMessage({ ...DEFAULT_DIGEST, lines: ["typical", "inTime"] }, { ...N, typicalSeconds: null, inTimePct: null });
  assert.deepEqual(few.lines, ["Typical first reply: not enough data yet.", "Answered in time: not enough data yet."]);
  assert.equal(buildMessage({ ...DEFAULT_DIGEST, lines: [] }, N).lines.length, 0);
});
test("settings are made safe: bad addresses, hours, zones and unknown lines are dropped; text is capped", () => {
  const s = sanitizeDigest({ enabled: true, recipients: ["Ben@Example.com", "ben@example.com", "nope", "a@b"], schedule: { cadence: "weekly", hour: 99, weekday: 9, tz: "Mars/Base" }, intro: "x".repeat(900), lines: ["waiting", "bogus"], evil: 1 });
  assert.deepEqual(s.recipients, ["ben@example.com"]); assert.equal(s.schedule.hour, 8); assert.equal(s.schedule.weekday, 1); assert.equal(s.schedule.tz, "UTC");
  assert.equal(s.schedule.cadence, "weekly"); assert.equal(s.intro.length, 500); assert.deepEqual(s.lines, ["waiting"]); assert.equal(s.enabled, true);
  assert.deepEqual(sanitizeDigest(null), DEFAULT_DIGEST);
});
test("schedule: due at the chosen local hour or later, once per key, weekly only on its weekday, in the account's own zone", () => {
  const daily = { cadence: "daily" as const, hour: 8, weekday: 1, tz: "Africa/Lagos" }; // UTC+1
  assert.equal(isDue(Date.UTC(2026, 10, 3, 6, 59), daily, null), false);  // 07:59 in Lagos
  assert.equal(isDue(Date.UTC(2026, 10, 3, 7, 0), daily, null), true);    // 08:00
  assert.equal(isDue(Date.UTC(2026, 10, 3, 15, 0), daily, null), true);   // a late cron still delivers
  assert.equal(isDue(Date.UTC(2026, 10, 3, 15, 0), daily, scheduleKey(Date.UTC(2026, 10, 3, 7, 0), daily)), false); // already sent today
  assert.equal(isDue(Date.UTC(2026, 10, 4, 7, 0), daily, scheduleKey(Date.UTC(2026, 10, 3, 7, 0), daily)), true);   // next day
  const weekly = { cadence: "weekly" as const, hour: 8, weekday: 1, tz: "UTC" };                                      // Monday
  assert.equal(isDue(Date.UTC(2026, 10, 2, 9), weekly, null), true);       // Mon 2 Nov
  assert.equal(isDue(Date.UTC(2026, 10, 3, 9), weekly, null), false);      // Tue
  assert.equal(isDue(Date.UTC(2026, 10, 2, 23), { ...weekly, tz: "Pacific/Auckland" }, null), false); // Tue 12:00 in Auckland
});
test("where it goes is said plainly, and sending is off until the switch is on; a switch off never really sends", () => {
  const s = sanitizeDigest({ enabled: true, email: true, recipients: ["ben@example.com"], schedule: { cadence: "weekly", hour: 8, weekday: 1, tz: "Africa/Lagos" } });
  assert.equal(destination(s, { email: false, slack: false }), "Goes to ben@example.com by email at 8:00 every Monday (Africa/Lagos). Sending email is off until it is enabled: nothing is sent yet.");
  assert.equal(destination(s, { email: true, slack: false }), "Goes to ben@example.com by email at 8:00 every Monday (Africa/Lagos).");
  assert.match(destination({ ...s, email: false, slack: false }, { email: true, slack: true }), /goes nowhere/);
  assert.match(destination({ ...s, enabled: false }, { email: true, slack: true }), /switched off/);
  assert.equal(mayReallySend("email", { email: false, slack: true }), false); assert.equal(mayReallySend("slack", { email: true, slack: false }), false);
  assert.equal(mayReallySend("email", { email: true, slack: false }), true);
});

test("the morning message adds the one proof sentence only when it is given", async () => {
  const { buildMessage, DEFAULT_DIGEST } = await import("../analytics/speed-digest.ts");
  const n = { who: "Acme", waiting: 1, typicalSeconds: null, inTimePct: null, leaked: 0, noOwner: 0 };
  assert.ok(!buildMessage(DEFAULT_DIGEST, n).text.includes("Last week"));
  assert.ok(buildMessage(DEFAULT_DIGEST, { ...n, proofLine: "Last week: 3 of 4 alerted leads got a reply." }).text.includes("Last week: 3 of 4"));
});
