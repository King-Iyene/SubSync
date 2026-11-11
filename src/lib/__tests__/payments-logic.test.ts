import assert from "node:assert/strict";
import { test } from "node:test";
import { ageBucket, ageDays, csvCell, daysUntil, decodeCursor, disputeAlert, encodeCursor, fmtMoney, headlineWords, isLateInvoice, mapStatus, monthlyOf, normalInvoice, normalTransaction, planPrice, problemOf, rankScore, recoveryStats, reminderTexts, reasonWords, riskFormula, stageFor, todayIn, totalsByCurrency } from "../analytics/payments-logic.ts";

// Fixtures cover: mixed currency, test mode, partial refund, an invoice plus its transaction (never added together), the time zone edge at midnight, an unknown status word.
test("status words: documented ones map, unknown ones stay 'other' (never guessed as failed)", () => {
  assert.equal(mapStatus("transaction", "succeeded"), "paid");
  assert.equal(mapStatus("transaction", "failed"), "failed");
  assert.equal(mapStatus("transaction", "Card Declined"), "failed");
  assert.equal(mapStatus("transaction", "mystery"), "other");
  assert.equal(mapStatus("transaction", null), "other");
  assert.equal(mapStatus("invoice", "partially_paid"), "open");
  assert.equal(mapStatus("subscription", "past_due"), "past_due");
  assert.equal(mapStatus("subscription", "active"), "active");
  assert.equal(mapStatus("plan", "cancelled"), "cancelled");
});

test("late invoice: open and due date before today on the account's own clock", () => {
  assert.equal(isLateInvoice("sent", "2026-11-10", "2026-11-11"), true);
  assert.equal(isLateInvoice("partially_paid", "2026-11-10", "2026-11-11"), true);
  assert.equal(isLateInvoice("sent", "2026-11-11", "2026-11-11"), false, "due today is not late");
  assert.equal(isLateInvoice("paid", "2026-01-01", "2026-11-11"), false);
  assert.equal(isLateInvoice("draft", "2026-01-01", "2026-11-11"), false);
  assert.equal(isLateInvoice("sent", null, "2026-11-11"), false);
});

test("time zone edge at midnight: the same instant is a different day in two accounts", () => {
  const t = Date.parse("2026-11-11T23:30:00Z");
  assert.equal(todayIn("UTC", t), "2026-11-11");
  assert.equal(todayIn("Pacific/Auckland", t), "2026-11-12");
  assert.equal(todayIn("America/Los_Angeles", t), "2026-11-11");
  assert.equal(todayIn("Not/AZone", t), "2026-11-11", "a bad zone falls back to UTC");
  assert.equal(isLateInvoice("sent", "2026-11-11", todayIn("Pacific/Auckland", t)), true);
});

test("normalising: transaction, invoice, test mode and partial refund", () => {
  const t = normalTransaction({ _id: "t1", status: "failed", amount: 120.5, currency: "usd", contactId: "c1", contactName: "Ana", liveMode: false, amountRefunded: 20, createdAt: "2026-11-01T10:00:00Z" });
  assert.equal(t?.mapped, "failed");
  assert.equal(t?.currency, "USD");
  assert.equal(t?.liveMode, false);
  assert.equal(t?.amountRefunded, 20);
  assert.equal(normalTransaction({ status: "failed" }), null, "no id, no row");
  const i = normalInvoice({ _id: "i1", status: "sent", amountDue: 300, total: 500, currency: "EUR", dueDate: "2026-10-01", contactDetails: { id: "c2", name: "Bo", email: "bo@example.com" } });
  assert.equal(i?.amount, 300, "an invoice counts what is still due, not the total");
  assert.equal(i?.contactEmail, "bo@example.com");
  assert.equal(problemOf(i!, "2026-11-11"), "late_invoice");
  assert.equal(problemOf(t!, "2026-11-11"), "failed_payment");
  assert.equal(problemOf({ kind: "transaction", mapped: "paid", statusRaw: "succeeded", dueDate: null }, "2026-11-11"), null);
  assert.equal(problemOf({ kind: "plan", mapped: "past_due", statusRaw: "past_due", dueDate: null }, "2026-11-11"), "past_due_plan");
  assert.equal(problemOf({ kind: "subscription", mapped: "past_due", statusRaw: "unpaid", dueDate: null }, "2026-11-11"), "failed_subscription");
});

test("money is never added across currencies, and an invoice with its payment is counted once by the caller (totals only add what it is given)", () => {
  const t = totalsByCurrency([{ amount: 100, currency: "USD" }, { amount: 50.5, currency: "USD" }, { amount: 70, currency: "EUR" }, { amount: null, currency: "USD" }]);
  assert.deepEqual(t, [{ currency: "USD", amount: 150.5, count: 3 }, { currency: "EUR", amount: 70, count: 1 }]);
  assert.match(fmtMoney(120, "USD"), /\$120/);
  assert.equal(fmtMoney(null, "USD"), "Not available");
});

test("ranking: amount times an age weight; older and bigger first; no amount sorts by age", () => {
  assert.equal(ageBucket(0), "0-3"); assert.equal(ageBucket(4), "4-7"); assert.equal(ageBucket(15), "15-30"); assert.equal(ageBucket(31), "31+");
  assert.ok(rankScore(100, 20) > rankScore(100, 2));
  assert.ok(rankScore(500, 1) > rankScore(100, 1));
  assert.ok(rankScore(null, 40) > rankScore(null, 1));
  assert.equal(ageDays("2026-11-01T00:00:00Z", Date.parse("2026-11-11T12:00:00Z")), 10);
});

test("plan price per month: weekly and yearly are converted, unknown intervals are not guessed", () => {
  assert.equal(monthlyOf(100, "month"), 100);
  assert.equal(monthlyOf(1200, "year"), 100);
  assert.equal(monthlyOf(100, "week"), 433.33);
  assert.equal(monthlyOf(100, "fortnight"), null);
  assert.equal(monthlyOf(null, "month"), null);
  assert.deepEqual(planPrice({ pricing: [{ amount: 97, currency: "usd", billingInterval: "month" }] }), { amount: 97, currency: "USD", interval: "month" });
  assert.deepEqual(planPrice({ title: "x" }), { amount: null, currency: null, interval: null });
});

test("disputes: due-date alerts at 3 days, 1 day, today and overdue; finished ones are quiet", () => {
  assert.equal(daysUntil("2026-11-14", "2026-11-11"), 3);
  assert.equal(disputeAlert("open", 3), "soon");
  assert.equal(disputeAlert("open", 1), "tomorrow");
  assert.equal(disputeAlert("open", 0), "today");
  assert.equal(disputeAlert("open", -2), "overdue");
  assert.equal(disputeAlert("open", 9), null);
  assert.equal(disputeAlert("won", -2), null);
  assert.equal(disputeAlert("evidence_sent", 0), null);
  assert.equal(disputeAlert("open", null), null);
});

test("reminder text: three tones, plain, no threat, names nobody it does not know", () => {
  const m = reminderTexts({ name: "Ana Lopez", amount: 120, currency: "USD", what: "invoice", business: "Acme" });
  assert.deepEqual(m.map((x) => x.tone), ["friendly", "neutral", "firm"]);
  assert.ok(m.every((x) => x.text.startsWith("Hi Ana,")));
  assert.ok(m.every((x) => !/legal|lawyer|collections|sue/i.test(x.text)));
  assert.match(reminderTexts({ name: null, amount: null, currency: null, what: "payment", business: null })[0].text, /^Hi,/);
});

test("recovery stats and words", () => {
  const D = 86_400_000;
  assert.deepEqual(recoveryStats([{ since: 0, resolved: 4 * D }, { since: 0, resolved: 2 * D }, { since: 0, resolved: null }]), { avgDays: 3, rate: 67, flagged: 3, fixed: 2 });
  assert.deepEqual(recoveryStats([]), { avgDays: null, rate: null, flagged: 0, fixed: 0 });
  assert.equal(headlineWords({ needAction: 0, accountsWithProblems: 0 }), "No payment needs action right now.");
  assert.equal(headlineWords({ needAction: 4, accountsWithProblems: 2 }), "4 payments need action, across 2 client accounts.");
  assert.match(riskFormula({ failed: 1, late: 2, plans: 0 }), /1 failed payment \+ 2 late invoices/);
  assert.match(reasonWords("failed_payment", "declined"), /does not tell us the exact reason/);
});

test("export cells: a leading = + - @ is neutralised and quotes are escaped", () => {
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+1 555"), "'+1 555");
  assert.equal(csvCell("a,b"), "\"a,b\"");
  assert.equal(csvCell(null), "");
});

test("cursor: round trip, and garbage is refused", () => {
  const c = { r: 12.5, l: "loc1", k: "invoice", i: "abc" };
  assert.deepEqual(decodeCursor(encodeCursor(c)), c);
  assert.equal(decodeCursor("not-a-cursor"), null);
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(Buffer.from(JSON.stringify({ r: "x", l: 1 })).toString("base64url")), null);
});

test("dispute reminders fire at 3 days, 1 day, the day and every day overdue, only for open disputes", () => {
  assert.equal(stageFor("open", 3), "three_days");
  assert.equal(stageFor("open", 2), null);
  assert.equal(stageFor("open", 1), "one_day");
  assert.equal(stageFor("open", 0), "today");
  assert.equal(stageFor("open", -5), "overdue");
  assert.equal(stageFor("won", 0), null);
  assert.equal(stageFor("open", null), null);
});
