import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAlerts, deriveAccount, type AccountRow, type AccountSettings } from "../analytics/derive.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const settings: AccountSettings = { staleDays: 30, dormantDays: 30, slaHours: 4, speedTargetMinutes: 15 };
const row = (over: Partial<AccountRow> = {}): AccountRow => ({
  locationId: "L1", name: "Acme Roofing", email: null, phone: null, website: null, ignored: false, owner: null, contacts: 100, withEmail: 90, withPhone: 80, withTags: 50,
  new30d: 10, active90d: 80, openOpps: 6, openValue: 12_000, staleOpps: 0, staleValue: 0, wonCount: 0, lostCount: 0, wonValue: 0, unread: 0, unanswered: 0,
  calendars: 1, pipelines: 1, lastActivityAt: new Date(NOW - 86_400_000).toISOString(), syncError: null, contactsSyncedAt: new Date(NOW).toISOString(), ...over,
});
const alertsFor = (over: Partial<AccountRow>, s: AccountSettings = settings) => computeAlerts([deriveAccount(row(over), s, [], NOW)], [], s).filter((a) => a.kind === "speed");

test("one or two slow leads are not an alert; three is a warning; eight is critical", () => {
  assert.equal(alertsFor({ speedWaiting: 0 }).length, 0);
  assert.equal(alertsFor({ speedWaiting: 2, oldestWaitMinutes: 90 }).length, 0, "two missed texts is not a pattern");
  const warn = alertsFor({ speedWaiting: 3, oldestWaitMinutes: 90 });
  assert.equal(warn.length, 1);
  assert.equal(warn[0].severity, "warning");
  assert.equal(alertsFor({ speedWaiting: 8, oldestWaitMinutes: 600 })[0].severity, "critical");
  assert.equal(alertsFor({}).length, 0, "an account with no speed data raises nothing");
});

test("the alert says how many, against which target, and how long the longest waited", () => {
  const [a] = alertsFor({ speedWaiting: 5, oldestWaitMinutes: 200 });
  assert.match(a.title, /Acme Roofing: 5 new leads have waited more than 15 minutes for a reply \(longest 3 h 20 min\)/);
  assert.deepEqual(a.detail, { waiting: 5, targetMinutes: 15, oldestWaitMinutes: 200 });
  assert.equal(a.dedupeKey, "speed:L1", "one open alert per account, so a rerun never duplicates it");
  assert.equal(a.locationId, "L1");
  const [b] = alertsFor({ speedWaiting: 4, oldestWaitMinutes: 45 }, { ...settings, speedTargetMinutes: 30 });
  assert.match(b.title, /more than 30 minutes/);
});

test("an ignored account raises no speed alert, and a missing target falls back to fifteen minutes", () => {
  assert.equal(alertsFor({ speedWaiting: 9, ignored: true }).length, 0);
  const [a] = alertsFor({ speedWaiting: 3, oldestWaitMinutes: 20 }, { staleDays: 30, dormantDays: 30, slaHours: 4 });
  assert.match(a.title, /more than 15 minutes/);
});
