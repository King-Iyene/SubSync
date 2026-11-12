import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assemble, DIRTY_EXEMPT, judge, ROLLUP_FRESH_MS, ROLLUP_STALE_MS, settingsKey, toStored, type StoredRow } from "../analytics/account-rollup.ts";
import { deriveAccount, type AccountRow } from "../analytics/derive.ts";

const settings = { staleDays: 14, dormantDays: 30, slaHours: 24, speedTargetMinutes: 15, dealRulesRevision: 3 };
const row = (id: string, name: string, n: number): AccountRow => ({
  locationId: id, name, email: null, phone: null, website: null, ignored: false, owner: null, contacts: n, withEmail: n - 1, withPhone: n - 2, withTags: 3, new30d: 4, active90d: 5,
  openOpps: 2, openValue: 1500.5, staleOpps: 1, staleValue: 500, wonCount: 1, lostCount: 0, wonValue: 900, excludedOpen: 0, outOfScopeOpen: 0, topDeal: 1000, topStaleDeal: 500,
  unmarkedAppointments: 2, speedWaiting: 1, oldestWaitMinutes: 42, unread: 3, unanswered: 1, calendars: 1, pipelines: 1, lastActivityAt: "2026-11-10T10:00:00.000Z", syncError: null, contactsSyncedAt: "2026-11-12T08:00:00.000Z",
} as AccountRow);
const live = [row("locB", "alpha", 100), row("locA", "Beta", 50), row("locC", "gamma", 20)];
const history = new Map([["locB", { scores: [50, 60], newContacts: [1, 2] }], ["locA", { scores: [], newContacts: [3] }]]);

test("stored numbers come back identical to the live query's (same order, same derived account)", () => {
  const stored = toStored(live, history, settings, 1000);
  // Through JSON like the database column, and shuffled: the stored order wins.
  const back = (JSON.parse(JSON.stringify(stored)) as StoredRow[]).reverse();
  const a = assemble(back);
  assert.deepEqual(a.rows, live);
  const now = Date.now();
  const viaLive = live.map((r) => deriveAccount(r, settings, history.get(r.locationId)?.scores ?? [], now, history.get(r.locationId)?.newContacts ?? []));
  const viaRollup = a.rows.map((r) => deriveAccount(r, settings, a.history.get(r.locationId)?.scores ?? [], now, a.history.get(r.locationId)?.newContacts ?? []));
  assert.deepEqual(viaRollup, viaLive);
});

test("a stored row is used only under the same rules, unchanged, complete and young enough", () => {
  const now = 10_000_000;
  const key = settingsKey(settings);
  const fresh = toStored(live, history, settings, now - 1000);
  assert.equal(judge(fresh, 3, key, now), "fresh");
  assert.equal(judge(toStored(live, history, settings, now - ROLLUP_FRESH_MS - 1), 3, key, now), "stale");
  assert.equal(judge(toStored(live, history, settings, now - ROLLUP_STALE_MS - 1), 3, key, now), "unusable");
  assert.equal(judge(fresh, 4, key, now), "unusable", "a new client account appeared");
  assert.equal(judge(fresh, 2, key, now), "unusable", "a client account was removed");
  assert.equal(judge([], 0, key, now), "unusable");
  assert.equal(judge(fresh, 3, settingsKey({ ...settings, staleDays: 7 }), now), "unusable", "other counting rules");
  assert.equal(judge(fresh, 3, settingsKey({ ...settings, dealRulesRevision: 4 }), now), "unusable");
  assert.equal(judge(fresh, 3, settingsKey({ ...settings, speedTargetMinutes: 30 }), now), "unusable");
  assert.equal(judge([{ ...fresh[0], dirty: true }, fresh[1], fresh[2]], 3, key, now), "unusable", "a change was made");
});

test("changes that cannot move a number do not dirty the rollup; data changes do", () => {
  for (const s of ["notifications", "feedback", "meeting-inbox", "my-connections", "segments"]) assert.ok(DIRTY_EXEMPT.test(s), s);
  for (const s of ["appointments", "pipelines", "settings", "people", "stage-rules", "accounts"]) assert.ok(!DIRTY_EXEMPT.test(s), s);
});

test("every statement of the rollup is scoped to one installation (tenant-safe key)", () => {
  const src = readFileSync(new URL("../analytics/account-rollup-db.ts", import.meta.url), "utf8");
  for (const stmt of src.match(/(select r\.location_id|insert into account_rollup|delete from account_rollup|update account_rollup)[\s\S]*?`/g) ?? []) assert.match(stmt, /installation_id/, stmt.slice(0, 60));
  assert.match(readFileSync(new URL("../../../supabase/migrations/20261229090000_r6_account_rollup.sql", import.meta.url), "utf8"), /primary key \(installation_id, location_id\)/);
});
