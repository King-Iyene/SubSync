import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketsOf, historyText, todayLine } from "../analytics/cl3-money-core.ts";

const base = { plan: { name: "Pro", pay: "paid", payLabel: "Paid up", statusRaw: "active", monthly: 100, currency: "USD", interval: "month", daysInStatus: 3, since: null, state: "ok", explain: "" }, wallet: { balance: 5, state: "ok" }, subsync: "installed" as const };
const counts = (o: Record<string, number> = {}) => ({ all: 0, unpaid: 0, failing: 0, no_plan: 0, paid: 0, empty_wallet: 0, app_missing: 0, ...o });

test("a paid account with SubSync is only paid", () => {
  assert.deepEqual(bucketsOf(base), ["all", "paid"]);
});
test("past due is both unpaid and failing", () => {
  assert.deepEqual(bucketsOf({ ...base, plan: { ...base.plan, pay: "past_due" } }), ["all", "unpaid", "failing"]);
});
test("a cancelled plan is unpaid but not failing; no plan is its own bucket", () => {
  assert.ok(bucketsOf({ ...base, plan: { ...base.plan, pay: "cancelled" } }).includes("unpaid"));
  assert.ok(!bucketsOf({ ...base, plan: { ...base.plan, pay: "cancelled" } }).includes("failing"));
  assert.ok(bucketsOf({ ...base, plan: { ...base.plan, pay: "none" } }).includes("no_plan"));
});
test("empty wallet needs a read value at or under zero; an unread wallet is not empty", () => {
  assert.ok(bucketsOf({ ...base, wallet: { balance: 0, state: "ok" } }).includes("empty_wallet"));
  assert.ok(!bucketsOf({ ...base, wallet: { balance: null, state: null } }).includes("empty_wallet"));
});
test("SubSync missing only when the platform said so", () => {
  assert.ok(bucketsOf({ ...base, subsync: "missing" }).includes("app_missing"));
  assert.ok(!bucketsOf({ ...base, subsync: "unknown" }).includes("app_missing"));
});
test("history sentences are plain", () => {
  assert.equal(historyText("status", "active", "past_due"), "Payment status changed from active to past due.");
  assert.equal(historyText("app_removed", null, null), "SubSync was removed.");
});
test("today line goes failing, then unpaid, then calm; the estimate is labelled by wording", () => {
  assert.equal(todayLine(counts({ failing: 2, unpaid: 2 }), [{ currency: "USD", monthly: 594 }]).bucket, "failing");
  assert.match(todayLine(counts({ failing: 1 }), [{ currency: "USD", monthly: 297 }]).headline, /about \$297 a month at the plan price/);
  assert.equal(todayLine(counts({ unpaid: 1 }), []).bucket, "unpaid");
  assert.equal(todayLine(counts(), []).bucket, null);
  assert.match(todayLine(counts(), [], "ok").headline, /paid up/);
});
test("today line never says paid up when plans cannot be read", () => {
  const a = todayLine(counts(), [], "needs_permission").headline;
  assert.match(a, /Not known: needs permission/);
  assert.doesNotMatch(a, /paid up. Nothing/);
  assert.match(todayLine(counts(), [], "not_checked").headline, /Not known yet/);
});
