import assert from "node:assert/strict";
import { test } from "node:test";
import { atRiskOf, decodeCursor, explainPlan, matches, monthlyOf, pageAfter, payStatus, planOf, sortRows, todayOf } from "../analytics/clients2-core.ts";
import type { Cl2Row } from "../analytics/clients2-types.ts";

const now = Date.parse("2026-11-11T00:00:00Z");
type Over = Partial<Cl2Row> & { pay?: string; monthly?: number | null; cur?: string };
const row = (id: string, name: string, over: Over = {}): Cl2Row => {
  const { pay, monthly, cur, ...rest } = over;
  return {
    locationId: id, name, email: `${id}@x.test`, vertical: null, verticalLabel: null, manager: null,
    plan: planOf({ state: "ok", plan_name: "Pro", subscription_status: pay ?? "active", price_amount: monthly === undefined ? 100 : monthly, price_currency: cur ?? "USD", billing_interval: "month" }, now),
    level: "ok", summary: null, waiting: 0, openValue: 0, lastActivityAt: null, quietDays: null, quiet: false, people: 0, peopleQuiet: 0, url: null, ...rest,
  };
};

test("maps the raw subscription status and never hides an unknown one", () => {
  assert.equal(payStatus("active", "ok").label, "Paid up");
  assert.equal(payStatus("trialing", "ok").key, "paid");
  assert.equal(payStatus("past_due", "ok").key, "past_due");
  assert.equal(payStatus("unpaid", "ok").key, "past_due");
  assert.equal(payStatus("canceled", "ok").key, "cancelled");
  assert.equal(payStatus("paused", "ok").key, "paused");
  assert.deepEqual(payStatus("weird_new", "ok"), { key: "other", label: "Other: weird_new" });
  assert.equal(payStatus(null, "no_plan").label, "Not on a paid plan from you");
});

test("needs permission only when the stored state says so; other failures say not available", () => {
  assert.equal(planOf({ state: "needs_permission" }, now).payLabel, "Needs permission: reconnect");
  assert.equal(planOf({ state: "needs_permission" }, now).state, "needs_permission");
  assert.equal(planOf({ state: "not_available", http_status: 500 }, now).payLabel, "Not available for this kind of app");
  assert.match(explainPlan("not_available", "unknown", 500, null), /company-level apps/);
  assert.equal(planOf(undefined, now).state, "not_checked");
});

test("monthly price: yearly divided by 12, null without a price", () => {
  assert.equal(monthlyOf(120, "year"), 10);
  assert.equal(monthlyOf(97, "month"), 97);
  assert.equal(monthlyOf(null, "month"), null);
  assert.equal(monthlyOf(-1, "month"), null);
});

test("money at risk is per currency and only for plans that need a look", () => {
  const r = atRiskOf([row("a", "A", { pay: "past_due", monthly: 100 }), row("b", "B", { pay: "past_due", monthly: 50, cur: "EUR" }), row("c", "C", { pay: "cancelled", monthly: 25 }), row("d", "D", { pay: "active", monthly: 999 })]);
  assert.deepEqual(r, [{ currency: "USD", monthly: 125, accounts: 2 }, { currency: "EUR", monthly: 50, accounts: 1 }]);
});

test("filters: status, attention, plan, vertical, manager, quiet, search by name and email", () => {
  const a = row("a1", "Alpha Roofing", { pay: "past_due", manager: "Sam", vertical: "solar", quiet: true });
  assert.ok(matches(a, { status: "past_due" }) && matches(a, { status: "attention" }) && !matches(a, { status: "paid" }));
  assert.ok(matches(a, { q: "ALPHA" }) && matches(a, { q: "a1@x" }) && !matches(a, { q: "zzz" }));
  assert.ok(matches(a, { manager: "Sam" }) && !matches(a, { manager: "none" }) && matches(a, { vertical: "solar" }) && matches(a, { quiet: true }));
  assert.ok(!matches(row("p", "P"), { status: "attention" }) && matches(row("p", "P"), { manager: "none", vertical: "none" }));
});

test("keyset paging never repeats or skips, even when the data changes between pages", () => {
  const rows = Array.from({ length: 23 }, (_, i) => row(`id${String(i).padStart(2, "0")}`, `Name ${i % 5}`, { pay: i % 4 === 0 ? "past_due" : "active" }));
  for (const sort of ["attention", "name", "status"] as const) {
    const sorted = sortRows(rows, sort), seen: string[] = [];
    let cursor = null as ReturnType<typeof decodeCursor>, guard = 0;
    for (;;) {
      const p = pageAfter(sorted, sort, cursor, 5);
      seen.push(...p.rows.map((r) => r.locationId));
      if (!p.next) break;
      cursor = decodeCursor(p.next);
      assert.ok(cursor && ++guard < 10);
    }
    assert.deepEqual(seen, sorted.map((r) => r.locationId));
  }
  const sorted = sortRows(rows, "name"), first = pageAfter(sorted, "name", null, 5);
  const gone = sorted.filter((r) => r.locationId !== first.rows[4].locationId); // the cursor row disappears
  const second = pageAfter(gone, "name", decodeCursor(first.next), 5);
  assert.ok(second.rows.every((r) => !first.rows.some((f) => f.locationId === r.locationId)));
  assert.equal(decodeCursor("not-a-cursor"), null);
});

test("today line: past due first, then act now, then a calm sentence; counts equal the rows they open", () => {
  const rows = [row("a", "A", { pay: "past_due" }), row("b", "B", { pay: "past_due" }), row("c", "C", { level: "act", summary: "9 leads waiting" })];
  const t = todayOf({ rows, planAccess: "ok" });
  assert.match(t.headline, /2 clients' paid plans are past due/);
  assert.equal(t.button?.count, rows.filter((r) => matches(r, { status: "past_due" })).length);
  assert.match(todayOf({ rows: [row("a", "A")], planAccess: "ok" }).headline, /look fine/);
  assert.match(todayOf({ rows: [row("a", "A", { level: "act", summary: "x" })], planAccess: "ok" }).headline, /needs you now/);
  assert.equal(todayOf({ rows: [], planAccess: "no_data" }).button, null);
});
