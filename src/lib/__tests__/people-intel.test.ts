import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntilBirthday, sourceConversion, teamLabel, teamWinRate } from "../analytics/people-intel.ts";

const today = new Date(Date.UTC(2026, 9, 31)); // 31 Oct 2026

test("days until a birthday count forward, including today and next year", () => {
  assert.equal(daysUntilBirthday("1990-10-31", today), 0);
  assert.equal(daysUntilBirthday("1985-11-02", today), 2);
  assert.equal(daysUntilBirthday("2000-01-01", today), 62);
  assert.equal(daysUntilBirthday("1990-10-30", today), 364);
});

test("29 February is celebrated on 28 February in a common year", () => {
  assert.equal(daysUntilBirthday("2000-02-29", new Date(Date.UTC(2027, 1, 20))), 8);
  assert.equal(daysUntilBirthday("2000-02-29", new Date(Date.UTC(2028, 1, 20))), 9);
});

test("a value that is not a date gives null", () => {
  assert.equal(daysUntilBirthday("nope", today), null);
  assert.equal(daysUntilBirthday("1990-13-40", today), null);
});

test("source conversion needs enough contacts", () => {
  assert.equal(sourceConversion({ contacts: 4, won: 4 }), null);
  assert.equal(sourceConversion({ contacts: 20, won: 5 }), 0.25);
});

test("team win rate needs five closed deals", () => {
  assert.equal(teamWinRate({ wonCount: 3, lostCount: 1 }), null);
  assert.equal(teamWinRate({ wonCount: 3, lostCount: 2 }), null, "5 closed deals is below the one shared minimum of 20");
  assert.equal(teamWinRate({ wonCount: 12, lostCount: 8 }), 0.6);
});

test("people we only know by id get a plain label that says why, never the id (N21, S3-a)", () => {
  assert.equal(teamLabel("abcdef123456", null, "ok"), "Former team member");
  assert.equal(teamLabel("abcdef123456", null, "needs_permission"), "Needs permission: reconnect");
  assert.equal(teamLabel("abcdef123456", null), "Name not loaded yet");
  assert.ok(!/3456|abcdef/.test(teamLabel("abcdef123456", null, "ok") + teamLabel("abcdef123456", null)), "no part of the id is shown");
  assert.equal(teamLabel("abcdef123456", "Dana"), "Dana");
  assert.equal(teamLabel("unassigned", null), "Unassigned");
});
