import assert from "node:assert/strict";
import { test } from "node:test";
import {
  avgDealOf, bucketOf, churnOf, cplOf, csvCell, decodeKey, encodeKey, factOf, headlineOf, lineAmount, lineKey, money, pageDesc, playbookOf, rateFor, roasOf, spendInRange, statementCsv, totalsOf, trendOf, waterfallOf, winRateOf,
  type ChurnInput, type EnteredPrice, type PlanFact, type SnapRow,
} from "../analytics/finance-core.ts";

const entered = new Map<string, EnteredPrice>([["starter", { planKey: "starter", amount: 1200, currency: "USD", billingInterval: "year" }]]);
const fact = (id: string, pay: string, monthly: number | null, currency = "USD", source: PlanFact["source"] = monthly === null ? "none" : "platform"): PlanFact => ({ locationId: id, planKey: "p", planName: "P", pay, monthly, currency, source });

test("a plan price from the platform wins; else the price the agency typed (a year divided by 12); else none", () => {
  const base = { locationId: "a", planId: "starter", planName: "Starter", pay: "paid", currency: null };
  assert.deepEqual([factOf({ ...base, monthly: 99, currency: "USD" }, entered).monthly, factOf({ ...base, monthly: 99, currency: "USD" }, entered).source], [99, "platform"]);
  const e = factOf({ ...base, monthly: null }, entered);
  assert.deepEqual([e.monthly, e.currency, e.source], [100, "USD", "entered"]);
  assert.equal(factOf({ ...base, planId: "other", planName: "Other", monthly: null }, entered).source, "none");
});

test("MRR counts paid accounts with a price, at risk counts past due, and currencies are never added together", () => {
  const t = totalsOf([fact("a", "paid", 100), fact("b", "paid", 50), fact("c", "paid", 80, "EUR"), fact("d", "past_due", 30), fact("e", "cancelled", 500), fact("f", "paid", null), fact("g", "none", null)]);
  assert.deepEqual(t.mrr, [{ currency: "USD", amount: 150, accounts: 2 }, { currency: "EUR", amount: 80, accounts: 1 }].sort((x, y) => y.amount - x.amount));
  assert.deepEqual(t.atRisk, [{ currency: "USD", amount: 30, accounts: 1 }]);
  assert.equal(t.noPrice.accounts, 1);
  assert.deepEqual(t.accounts, { total: 7, paid: 4, unpaid: 2, noPlan: 1, unknown: 0 });
});

test("a trend needs a week of our own record and says when the record started; no flat fake line", () => {
  assert.equal(trendOf([], "USD", null).enough, false);
  assert.match(trendOf([], "USD", "2026-11-01").message, /2026-11-01/);
  const few = trendOf([{ day: "2026-11-01", amount: 1 }, { day: "2026-11-02", amount: 1 }], "USD", "2026-11-01");
  assert.equal(few.enough, false);
  assert.equal(few.points.length, 0);
  assert.match(few.message, /2 of 7/);
  const days = Array.from({ length: 7 }, (_, i) => ({ day: `2026-11-0${i + 1}`, amount: 10 + i }));
  assert.equal(trendOf(days, "USD", "2026-11-01").enough, true);
});

test("the waterfall splits new, expansion, contraction and churned, and start plus the moves equals the end", () => {
  const row = (id: string, pay: string, m: number | null, day: string): SnapRow => ({ locationId: id, day, pay, monthly: m, currency: "USD" });
  const a = [row("stay", "paid", 100, "d1"), row("up", "paid", 100, "d1"), row("down", "paid", 100, "d1"), row("gone", "paid", 100, "d1"), row("late", "none", null, "d1")];
  const b = [row("stay", "paid", 100, "d2"), row("up", "paid", 150, "d2"), row("down", "paid", 60, "d2"), row("gone", "cancelled", 100, "d2"), row("late", "paid", 80, "d2"), row("fresh", "paid", 40, "d2")];
  const { w, moves } = waterfallOf(a, b, "USD", "d1", "d2", "d1");
  assert.deepEqual([w.start, w.new, w.expansion, w.contraction, w.churned, w.end], [400, 120, 50, 40, 100, 430]);
  assert.equal(w.start + w.new + w.expansion - w.contraction - w.churned, w.end);
  assert.deepEqual(w.counts, { new: 2, expansion: 1, contraction: 1, churned: 1 });
  assert.equal(moves.length, 5);
  assert.equal(waterfallOf(a, a, "USD", "d1", "d1", "d1").w.enough, false);
});

test("win rate needs 10 closed deals, average deal 3 won, cost per lead 10 leads: otherwise 'not enough data'", () => {
  assert.equal(winRateOf(4, 5).rate, null);
  assert.match(winRateOf(4, 5).note ?? "", /9 of 10/);
  assert.equal(winRateOf(6, 4).rate, 60);
  assert.equal(avgDealOf(2, 5000), null);
  assert.equal(avgDealOf(4, 5000), 1250);
  assert.equal(cplOf(500, 9), null);
  assert.equal(cplOf(500, 20), 25);
  assert.equal(cplOf(null, 20), null);
  assert.equal(roasOf(null, 5000), null);
  assert.equal(roasOf(1000, 4000), 4);
});

test("ad spend typed per month is spread over the days of that month that fall in the range", () => {
  assert.equal(spendInRange([{ month: "2026-11", amount: 3000 }], "2026-11-01", "2026-12-01"), 3000);
  assert.equal(spendInRange([{ month: "2026-11", amount: 3000 }], "2026-11-01", "2026-11-11"), 1000);
  assert.equal(spendInRange([{ month: "2026-10", amount: 3100 }, { month: "2026-11", amount: 3000 }], "2026-10-16", "2026-11-11"), 1600 + 1000);
  assert.equal(spendInRange([{ month: "2026-09", amount: 900 }], "2026-11-01", "2026-12-01"), 0);
});

const quiet: ChurnInput = {
  plan: { pay: "paid", monthly: 300, currency: "USD" }, historyDays: 90, leads: { recent: 12, base: 36 }, booked: { recent: 5, base: 15 }, staff: { recent: 40, base: 120 },
  reply: { recentAnswered: 30, recentWithin: 25, baseAnswered: 90, baseWithin: 75 }, wins: { recent56: 3, prior56: 3 },
};
test("a healthy account scores zero and is steady", () => {
  const c = churnOf(quiet);
  assert.deepEqual([c.level, c.points, c.evidence.length], ["steady", 0, 0]);
});
test("churn evidence: leads down, no bookings, slower replies, quiet team and a failing plan add up, each with a plain reason", () => {
  const c = churnOf({ ...quiet, plan: { pay: "past_due", monthly: 300, currency: "USD" }, leads: { recent: 4, base: 36 }, booked: { recent: 0, base: 15 }, reply: { recentAnswered: 30, recentWithin: 15, baseAnswered: 90, baseWithin: 75 }, staff: { recent: 0, base: 120 }, wins: { recent56: 0, prior56: 3 } });
  assert.deepEqual(c.evidence.map((e) => e.key).sort(), ["leads_down", "no_bookings", "no_wins", "plan", "reply_slow", "team_quiet"]);
  assert.equal(c.points, 3 + 3 + 2 + 2 + 2 + 1);
  assert.equal(c.level, "high");
  assert.deepEqual(c.mrr, { amount: 300, currency: "USD" });
  assert.ok(c.evidence.every((e) => e.detail.length > 10));
});
test("churn needs 28 days of record for the activity checks; a failing plan still counts; a cancelled plan is 'already left'", () => {
  const young = churnOf({ ...quiet, historyDays: 10, leads: { recent: 0, base: 60 } });
  assert.equal(young.level, "not_enough_data");
  assert.equal(churnOf({ ...quiet, historyDays: 10, plan: { pay: "past_due", monthly: null, currency: null } }).points, 3);
  assert.equal(churnOf({ ...quiet, plan: { pay: "cancelled", monthly: 300, currency: "USD" } }).level, "left");
  assert.equal(churnOf({ ...quiet, leads: { recent: 0, base: 30 } }).evidence[0].key, "no_leads");
  assert.equal(churnOf({ ...quiet, leads: { recent: 1, base: 12 } }).evidence.length, 0, "a normal under 10 leads is too small to judge a fall");
});
test("the save-this-account playbook follows the evidence and never promises to contact the client", () => {
  const p = playbookOf([{ key: "plan", label: "x", points: 3, detail: "d" }, { key: "reply_slow", label: "y", points: 2, detail: "d" }]);
  assert.equal(p[0].go, "payments");
  assert.ok(p.some((s) => s.go === "speed"));
  assert.ok(p.every((s) => !/we will (send|email|text|call)/i.test(s.text)));
});

test("the most specific commission rate wins, and a percentage applies only when paid on won", () => {
  const rates = [
    { personId: "", locationId: "", role: "setter" as const, pct: 0, flat: 25 }, { personId: "", locationId: "L1", role: "setter" as const, pct: 0, flat: 30 },
    { personId: "u1", locationId: "", role: "setter" as const, pct: 0, flat: 40 }, { personId: "u1", locationId: "L1", role: "setter" as const, pct: 0, flat: 50 }, { personId: "", locationId: "", role: "closer" as const, pct: 8, flat: 0 },
  ];
  assert.equal(rateFor(rates, "u2", "L2", "setter").flat, 25);
  assert.equal(rateFor(rates, "u2", "L1", "setter").flat, 30);
  assert.equal(rateFor(rates, "u1", "L2", "setter").flat, 40);
  assert.deepEqual([rateFor(rates, "u1", "L1", "setter").flat, rateFor(rates, "u1", "L1", "setter").from], [50, "person_account"]);
  assert.equal(rateFor(rates, "u1", "L1", "closer").pct, 8);
  assert.equal(rateFor([], "u1", "L1", "closer").from, "none");
  assert.equal(lineAmount("won", 5000, { pct: 8, flat: 10 }), 410);
  assert.equal(lineAmount("booked", 5000, { pct: 8, flat: 10 }), 10);
  assert.equal(lineAmount("showed", null, { pct: 8, flat: 0 }), 0);
  assert.equal(lineKey("won", "L1", "opp1", "closer"), "won:L1:opp1:closer");
});

test("a spreadsheet cell that starts with a formula character is kept as text", () => {
  for (const bad of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=x", "\r=x"]) assert.ok(csvCell(bad).startsWith("'") || csvCell(bad).startsWith('"\''), bad);
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('a "q", b'), '"a ""q"", b"');
  const csv = statementCsv([{ at: "2026-11-02T10:00:00Z", person: "=HYPERLINK(1)", role: "setter", account: "A, B", kind: "won", ref: "o1", value: 100, amount: 8, disputed: false }], "USD");
  assert.equal(csv.split("\r\n").length, 3);
  assert.ok(csv.includes("'=HYPERLINK(1)"));
  assert.ok(csv.includes('"A, B"'));
});

test("billing notes: overdue, due this week, later, paid", () => {
  assert.equal(bucketOf("unpaid", "2026-11-01", "2026-11-11"), "overdue");
  assert.equal(bucketOf("unpaid", "2026-11-11", "2026-11-11"), "due_soon");
  assert.equal(bucketOf("unpaid", "2026-11-18", "2026-11-11"), "due_soon");
  assert.equal(bucketOf("unpaid", "2026-11-19", "2026-11-11"), "upcoming");
  assert.equal(bucketOf("paid", "2026-10-01", "2026-11-11"), "paid");
});

test("the money headline puts failing money first, then overdue notes, then accounts about to leave, and names one thing", () => {
  const none = { atRisk: null, failing: 0, highRisk: 0, highRiskMrr: null, overdue: { count: 0, total: null }, dueSoon: 0, disputes: 0, mrr: { amount: 2780, currency: "USD" }, noPrice: 0 };
  assert.match(headlineOf(none).line, /\$2,780 a month/);
  assert.equal(headlineOf(none).target, null);
  const all = { ...none, atRisk: { amount: 398, currency: "USD" }, failing: 2, highRisk: 3, overdue: { count: 1, total: { amount: 100, currency: "USD" } }, dueSoon: 1, disputes: 1, noPrice: 4 };
  assert.match(headlineOf(all).today, /2 clients have a payment/);
  assert.equal(headlineOf({ ...all, failing: 0 }).target, "ledger");
  assert.equal(headlineOf({ ...all, failing: 0, overdue: { count: 0, total: null } }).target, "churn");
  assert.equal(headlineOf({ ...all, failing: 0, overdue: { count: 0, total: null }, highRisk: 0 }).target, "payouts");
  assert.equal(headlineOf({ ...all, failing: 0, overdue: { count: 0, total: null }, highRisk: 0, disputes: 0 }).target, "setup");
  assert.equal(headlineOf({ ...none, mrr: null }).line, "No plan prices to add up yet.");
});

test("keyset paging resumes after the cursor without repeating or skipping a row, ties broken by id", () => {
  const rows = [{ id: "a", v: 5 }, { id: "b", v: 5 }, { id: "c", v: 9 }, { id: "d", v: 1 }, { id: "e", v: 5 }];
  const seen: string[] = [];
  let cursor = null as ReturnType<typeof decodeKey>;
  for (let i = 0; i < 10; i++) {
    const p = pageDesc(rows, (r) => r.v, (r) => r.id, cursor, 2);
    seen.push(...p.rows.map((r) => r.id));
    if (!p.next) break;
    cursor = decodeKey(p.next);
  }
  assert.deepEqual(seen, ["c", "e", "b", "a", "d"]);
  assert.equal(decodeKey("not a cursor"), null);
  assert.deepEqual(decodeKey(encodeKey({ k: 3, id: "x" })), { k: 3, id: "x" });
});

test("money is written per currency in plain words", () => {
  assert.equal(money(2780, "USD"), "$2,780");
  assert.equal(money(12.5, "USD"), "$12.50");
});
