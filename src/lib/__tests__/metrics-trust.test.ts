import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveAccount, MIN_CLOSED_DEALS, type AccountRow, type AccountSettings } from "../analytics/derive.ts";
import { isTestName } from "../analytics/test-data.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const settings: AccountSettings = { staleDays: 30, dormantDays: 30, slaHours: 4 };
const row = (over: Partial<AccountRow> = {}): AccountRow => ({
  locationId: "L1", name: "Acme", email: null, phone: null, website: null, ignored: false, owner: null, contacts: 100, withEmail: 90, withPhone: 80, withTags: 50,
  new30d: 10, active90d: 80, openOpps: 6, openValue: 12_000, staleOpps: 6, staleValue: 12_000, wonCount: 0, lostCount: 0, wonValue: 0, unread: 0, unanswered: 4,
  calendars: 1, pipelines: 1, lastActivityAt: new Date(NOW - 86_400_000).toISOString(), syncError: null, contactsSyncedAt: new Date(NOW).toISOString(), ...over,
});

test("test accounts are recognised by whole words, never by part of a real name", () => {
  for (const yes of ["KD Squares Test", "Demo Clinic", "test", "Acme (sandbox)", "Sample - Dental", "Dummy account 2", "TEST-Roofing", "Acme Testing"]) assert.equal(isTestName(yes), true, yes);
  for (const no of ["Contest Pros", "Samplerate Audio", "Attest Law", "Demonstration Station", "Latest Homes", "Acme Roofing", "", null, undefined]) assert.equal(isTestName(no as string | null), false, String(no));
});

test("with no account holding enough closed deals there is no estimate to show, rather than a made-up one", () => {
  const rows = [row({ wonCount: 5, lostCount: 5 }), row({ locationId: "L2", wonCount: 0, lostCount: 0 })].map((r) => deriveAccount(r, settings, [], NOW));
  assert.ok(rows.every((a) => a.winRate === null && a.expectedRevenue === null && a.followUpRevenueAtRisk === null));
});

test("the two estimates are separate numbers with separate formulas", () => {
  // 30 closed deals, 60% won; 4 conversations waiting; average won deal is 2,000; open value 12,000.
  const a = deriveAccount(row({ wonCount: 18, lostCount: 12, wonValue: 36_000 }), settings, [], NOW);
  assert.equal(MIN_CLOSED_DEALS <= 30, true);
  assert.equal(a.winRate, 0.6);
  assert.equal(a.expectedRevenue, 7_200, "open value x win rate");
  assert.equal(a.followUpRevenueAtRisk, 4800, "waiting x average deal x win rate");
  assert.notEqual(a.expectedRevenue, a.followUpRevenueAtRisk);
  assert.equal(a.revenueAtRisk, 12_000, "stale value is its own fact, not an estimate");
});
