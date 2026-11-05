import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGrowth, boundsOf, type GrowthContact } from "../analytics/growth.ts";
import { specDay, specPeriod, specRemoved, specSignUps, specSource } from "../analytics/growth-records.ts";

const HOUR = 3_600_000, DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 5, 20, 0, 0); // Thursday 5 Nov 2026
const accounts = [{ id: "aaa", name: "Bright Smile", zone: "UTC", url: "https://crm/a" }, { id: "bbb", name: "Sunrise", zone: "UTC", url: "https://crm/b" }];
const b = boundsOf(NOW, "UTC");
const mk = (id: string, loc: string, email: string | null, at: number, source = "Facebook Ads", name = `P ${id}`): GrowthContact => ({ id: `${loc}:${id}`, locationId: loc, name, email, source, at });
const contacts = [
  mk("1", "aaa", "ann@gmail.com", b.todayStart + HOUR), mk("2", "aaa", "A.nn@gmail.com", b.todayStart + 2 * HOUR), mk("3", "aaa", "bob@outlook.com", b.todayStart - HOUR),
  mk("4", "aaa", "cy@yahoo.com", b.weekStart + HOUR, "Google Search"), mk("5", "aaa", "info@shop.com", b.todayStart + HOUR), mk("6", "bbb", "dee@outlook.com", b.monthStart + HOUR, "Walk-in"),
  mk("7", "bbb", "ed@icloud.com", NOW - 20 * DAY), mk("8", "bbb", "test@acme.com", NOW - 3 * DAY, "Walk-in", "Test"),
];
const g = buildGrowth({ now: NOW, accounts, contacts, rules: { excludeRoleAddresses: true, internalDomains: [] }, goals: { aaa: 30 }, scope: "agency" });

test("the number on a counter equals the rows it opens, for every period and for one client", () => {
  for (const p of ["today", "week", "month", "all"] as const) {
    const s = specPeriod(g, p);
    assert.equal(s.rows.length, s.count, p);
    assert.equal(s.count, g.changes[p].count, p);
    assert.equal(s.note, null);
  }
  assert.equal(g.changes.today.count, 1, "the copy and the shared mailbox are not today's leads");
  for (const a of accounts) for (const p of ["week", "month"] as const) assert.equal(specPeriod(g, p, a.id).rows.length, specPeriod(g, p, a.id).count);
  assert.ok(specPeriod(g, "week", "aaa").rows.every((r) => r.lead?.locationId === "aaa"));
});

test("a day of the chart opens exactly that day's leads and the count on the bar", () => {
  const today = g.series[g.series.length - 1];
  const s = specDay(g, today.day);
  assert.equal(s.rows.length, today.count);
  assert.equal(s.count, today.count);
  assert.equal(specDay(g, g.series[g.series.length - 2].day).rows.length, g.series[g.series.length - 2].count);
});

test("what was taken out opens its own records with the reason, and the pieces add up to the sign ups", () => {
  assert.equal(specRemoved(g, "duplicate").rows.length, g.gross.removed.duplicate);
  assert.equal(specRemoved(g, "junk").rows.length, g.gross.removed.junk);
  assert.equal(specRemoved(g, "role").rows.length, g.gross.removed.role);
  assert.equal(specRemoved(g, "all").rows.length, specRemoved(g, "all").count);
  assert.ok(specRemoved(g, "duplicate").rows.every((r) => r.cells.why === "Extra copy"));
  assert.equal(specSignUps(g).rows.length, g.gross.signUps);
  assert.equal(g.gross.unique + Object.values(g.gross.removed).reduce((s, n) => s + n, 0), g.gross.signUps);
});

test("a source opens only that source's people of the last 30 days", () => {
  const s = specSource(g, "Walk-in");
  assert.equal(s.rows.length, s.count);
  assert.ok(s.rows.every((r) => r.cells.source === "Walk-in"));
});

test("every row can be opened in the CRM and names its client", () => {
  const s = specPeriod(g, "month");
  assert.ok(s.rows.every((r) => r.url && r.cells.account));
});
