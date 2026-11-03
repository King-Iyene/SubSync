import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountBars, accountsNeedingYou, accountsQuery, ageWords, answeredStreak, barTooltip, barsTitle, buildQueue, donutTitle, emptyTotals, headlineOf, KINDS, medianReply, parseTodayAccounts,
  proofLine, proofOf, rankQueue, replyPulse, scopeRows, severityOf, shareText, slicesOf, totalsOf, valueAtRisk, vsUsual, withinTargetShare, withTodayAccounts,
  type AccountFacts, type AlertFact, type Kind, type QueueRow, type TodayItem, type Totals,
} from "../analytics/today-queue.ts";

// The outcome-first Today: ranking, headline wording, scoping and the numbers behind each chart. Pure, no database.
const NOW = Date.parse("2026-11-03T12:00:00Z");
const H = 3_600_000, D = 86_400_000;

const acct = (id: string, name: string, estimate: number | null = null): AccountFacts => ({ id, name, followUpEstimate: estimate, url: `https://crm.example.com/v2/location/${id}/opportunities/list` });
const ACCOUNTS = new Map([acct("aaa", "Maple Dental"), acct("bbb", "Harbor Realty", 900), acct("ccc", "North Roofing")].map((a) => [a.id, a]));
let n = 0;
const item = (kind: Kind, locationId: string, over: Partial<TodayItem> = {}): TodayItem => ({
  id: `i${n++}`, kind, locationId, accountName: ACCOUNTS.get(locationId)!.name, name: "Someone", detail: "", at: NOW - 2 * H, value: null, contactId: "c", url: `https://crm.example.com/${locationId}/c`, ...over,
});
const totalsFrom = (items: TodayItem[]): Totals => {
  const t = emptyTotals();
  for (const k of KINDS) { const m = items.filter((x) => x.kind === k); t[k] = { count: m.length, dollars: k === "stale" && m.length ? m.reduce((s, x) => s + (x.value ?? 0), 0) : null, shown: m.length }; }
  return t;
};
const queueOf = (items: TodayItem[]) => buildQueue({ items, totals: totalsFrom(items), accounts: ACCOUNTS, staleDays: 30, now: NOW });

// ---------- ranking ----------
test("the ranking rule: value at risk first, then how long it has been wrong, then severity", () => {
  const items = [
    item("stale", "aaa", { value: 4000, at: NOW - 40 * D }), item("stale", "aaa", { value: 1000, at: NOW - 35 * D }),   // Maple: $5,000 counted
    item("stale", "ccc", { value: 12000, at: NOW - 31 * D }),                                                          // North: $12,000 counted
    item("leads", "bbb", { at: NOW - 3 * H }),                                                                         // Harbor: leads, no dollars
    item("unanswered", "bbb", { at: NOW - 30 * H }),                                                                   // Harbor: estimate $900
    item("appointments", "ccc", { at: NOW - 10 * D }),                                                                 // no dollars, older than the leads
  ];
  const q = queueOf(items);
  assert.deepEqual(q.map((r) => `${r.accountName}:${r.kind}`), [
    "North Roofing:stale",        // $12,000
    "Maple Dental:stale",         // $5,000
    "Harbor Realty:unanswered",   // about $900 (the existing estimate)
    "North Roofing:appointments", // no money: the one that has been wrong longest (10 days)
    "Harbor Realty:leads",        // no money, 3 hours
  ]);
});

test("equal value and age fall back to severity, then to the name, so the order never flickers", () => {
  const base = { dollars: null, estimate: null, ageMinutes: 120, since: NOW, url: "u", itemIds: [], partial: false, count: 1, text: "t" } as const;
  const rows: QueueRow[] = [
    { ...base, key: "1", kind: "appointments", locationId: "a", accountName: "Zed", severity: "info" },
    { ...base, key: "2", kind: "leads", locationId: "b", accountName: "Bee", severity: "critical" },
    { ...base, key: "3", kind: "noshows", locationId: "c", accountName: "Ann", severity: "warning" },
    { ...base, key: "4", kind: "noshows", locationId: "d", accountName: "Abe", severity: "warning" },
  ];
  assert.deepEqual(rankQueue(rows).map((r) => r.key), ["2", "4", "3", "1"]);
  assert.deepEqual(rankQueue([...rows].reverse()).map((r) => r.key), ["2", "4", "3", "1"]);
});

test("the estimate counts as value at risk only where it exists, and never as counted dollars", () => {
  const q = queueOf([item("unanswered", "bbb"), item("unanswered", "aaa")]);
  const bbb = q.find((r) => r.locationId === "bbb")!;
  assert.equal(bbb.estimate, 900);
  assert.equal(bbb.dollars, null);
  assert.equal(valueAtRisk(bbb), 900);
  assert.equal(valueAtRisk(q.find((r) => r.locationId === "aaa")!), 0);
});

test("one row per account and kind; the count is the rows behind it; the age is the oldest item", () => {
  const q = queueOf([item("leads", "aaa", { at: NOW - 5 * H }), item("leads", "aaa", { at: NOW - 20 * 60_000 }), item("leads", "bbb")]);
  assert.equal(q.length, 2);
  const maple = q.find((r) => r.locationId === "aaa")!;
  assert.equal(maple.count, 2);
  assert.equal(maple.itemIds.length, 2);
  assert.equal(maple.ageMinutes, 300);
  assert.equal(maple.text, "2 leads waiting past the reply target");
  assert.equal(maple.severity, "critical", "a lead waiting an hour or more is critical");
});

test("row wording is six to ten words and names the stale window", () => {
  for (const k of KINDS) {
    const r = queueOf([item(k, "aaa")])[0];
    const words = r.text.split(/\s+/).length;
    assert.ok(words >= 5 && words <= 10, `${k}: "${r.text}" has ${words} words`);
    assert.ok(!/—|–| - /.test(r.text), "no dashes in the wording");
  }
  assert.match(queueOf([item("stale", "aaa", { value: 10 })])[0].text, /no movement in 30\+ days/);
});

test("severity thresholds", () => {
  assert.equal(severityOf("leads", 1, 10, false), "warning");
  assert.equal(severityOf("leads", 1, 10, true), "critical");
  assert.equal(severityOf("unanswered", 5, 0, false), "critical");
  assert.equal(severityOf("stale", 9, 0, false), "warning");
  assert.equal(severityOf("appointments", 2, 0, false), "info");
});

test("a capped list is marked partial so the screen says so", () => {
  const items = [item("leads", "aaa")];
  const totals = totalsFrom(items);
  totals.leads = { count: 250, dollars: null, shown: 1 };
  const q = buildQueue({ items, totals, accounts: ACCOUNTS, staleDays: 30, now: NOW });
  assert.equal(q[0].partial, true);
});

// ---------- headline ----------
test("the headline: clients and counted dollars, built from existing figures", () => {
  const items = [item("leads", "aaa"), item("leads", "bbb"), item("stale", "ccc", { value: 48_200 })];
  const h = headlineOf({ scope: "all", rows: queueOf(items), totals: totalsFrom(items) });
  assert.equal(h.text, "3 clients need you today. $48,200 is at risk.");
  assert.equal(h.breakdown, "2 leads waiting and 1 stale deal worth $48,200.");
  assert.equal(h.allClear, false);
  const one = headlineOf({ scope: "all", rows: queueOf([item("leads", "aaa")]), totals: totalsFrom([item("leads", "aaa")]) });
  assert.equal(one.text, "1 client needs you today.", "no dollars, no dollar sentence");
});

test("the headline never counts an estimate as money at risk", () => {
  const items = [item("unanswered", "bbb")];
  const h = headlineOf({ scope: "all", rows: queueOf(items), totals: totalsFrom(items) });
  assert.doesNotMatch(h.text, /\$/);
});

test("an account's own headline counts things, and says all clear plainly", () => {
  const items = [item("leads", "aaa"), item("appointments", "aaa"), item("appointments", "aaa")];
  assert.equal(headlineOf({ scope: "account", rows: queueOf(items), totals: totalsFrom(items) }).text, "3 things need you today.");
  assert.equal(headlineOf({ scope: "account", rows: [], totals: emptyTotals() }).text, "You are all caught up today.");
  assert.equal(headlineOf({ scope: "all", rows: [], totals: emptyTotals() }).text, "Every client account is on track today.");
  assert.equal(headlineOf({ scope: "all", rows: [], totals: emptyTotals() }).allClear, true);
});

// ---------- scoping ----------
test("the account filter narrows rows and totals; no account picked means all", () => {
  const items = [item("leads", "aaa"), item("leads", "bbb"), item("stale", "bbb", { value: 700 }), item("appointments", "ccc")];
  const q = queueOf(items);
  assert.equal(scopeRows(q, { accounts: [], kind: null }).length, 4);
  assert.deepEqual(scopeRows(q, { accounts: ["bbb"], kind: null }).map((r) => r.kind).sort(), ["leads", "stale"]);
  assert.deepEqual(scopeRows(q, { accounts: ["bbb", "ccc"], kind: "leads" }).map((r) => r.locationId), ["bbb"]);
  const t = totalsOf(items, totalsFrom(items), ["bbb"]);
  assert.equal(t.leads.count, 1);
  assert.equal(t.stale.dollars, 700);
  assert.equal(t.appointments.count, 0);
});

test("Today's own address parameter: parsed, cleaned, written back and sent as the existing accounts query", () => {
  assert.deepEqual(parseTodayAccounts("#today?ta=aaa,bbb&r.x=1"), ["aaa", "bbb"]);
  assert.deepEqual(parseTodayAccounts("#today?ta=aaa,../etc,b b,bbb"), ["aaa", "bbb"], "ids that are not well formed are dropped");
  assert.deepEqual(parseTodayAccounts("#today"), []);
  assert.equal(withTodayAccounts("#today", ["aaa", "bbb"]), "#today?ta=aaa,bbb");
  assert.equal(withTodayAccounts("#today?ta=aaa&r.today-changes=30d", ["ccc"]), "#today?ta=ccc&r.today-changes=30d");
  assert.equal(withTodayAccounts("#today?ta=aaa", []), "#today");
  assert.equal(accountsQuery(["aaa", "bad id", "bbb"]), "accounts=aaa,bbb");
  assert.equal(accountsQuery([]), "");
});

// ---------- the donut ----------
test("donut slices: one per kind with something in it, shares add up to 100, the count equals the rows behind it", () => {
  const items = [...[0, 1, 2, 3, 4, 5, 6].map(() => item("leads", "aaa")), item("stale", "aaa", { value: 1 }), item("stale", "bbb", { value: 2 }), item("appointments", "ccc")];
  const t = totalsFrom(items);
  const s = slicesOf(t);
  assert.deepEqual(s.map((x) => x.kind), ["leads", "appointments", "stale"]);
  assert.equal(s.reduce((a, x) => a + x.share, 0), 100);
  for (const slice of s) assert.equal(slice.count, scopeRows(queueOf(items), { accounts: [], kind: slice.kind }).reduce((a, r) => a + r.itemIds.length, 0), `${slice.kind}: the slice count is the number of rows in its list`);
  assert.equal(slicesOf(emptyTotals()).length, 0);
  assert.match(donutTitle(t), /^10 things need attention, most of them leads waiting \(7\)$/);
});

test("slice shares use largest remainder so thirds still add up", () => {
  const items = [item("leads", "aaa"), item("appointments", "aaa"), item("noshows", "aaa")];
  const s = slicesOf(totalsFrom(items));
  assert.equal(s.reduce((a, x) => a + x.share, 0), 100);
});

// ---------- the per-account bars ----------
test("bars: top accounts by things to fix, with the tooltip in words", () => {
  const items = [...[1, 2, 3, 4].map(() => item("leads", "bbb")), item("stale", "bbb", { value: 6300 }), item("leads", "aaa"), item("appointments", "ccc"), item("appointments", "ccc")];
  const q = queueOf(items);
  const b = accountBars(q, 2);
  assert.deepEqual(b.bars.map((x) => x.name), ["Harbor Realty", "North Roofing"]);
  assert.equal(b.accounts, 3);
  assert.equal(barTooltip(b.bars[0], q), "Harbor Realty: 4 leads waiting, 1 stale deal, $6,300 at stake");
  assert.equal(barsTitle(b), "Harbor Realty has the most to fix: 5 things, out of 3 accounts needing you");
  assert.equal(accountBars([]).bars.length, 0);
});

test("accounts needing you: one row each, worst first, with the one reason and plain health words", () => {
  const q = queueOf([item("leads", "aaa", { at: NOW - 3 * H }), item("appointments", "aaa"), item("stale", "ccc", { value: 9000 })]);
  const r = accountsNeedingYou(q, ACCOUNTS, 5);
  assert.deepEqual(r.rows.map((x) => [x.name, x.state]), [["North Roofing", "Needs a look"], ["Maple Dental", "Needs you now"]]);
  assert.equal(r.rows[1].reason, "1 lead waiting past the reply target");
  assert.equal(r.total, 2);
});

// ---------- vs your usual ----------
test("better or worse than usual only above the minimum sample, else 'not enough history yet'", () => {
  const f = (s: number | null) => (s === null ? "none" : `${s}s`);
  assert.equal(vsUsual({ now: 300, usual: 600, nNow: 8, nUsual: 9, minN: 5, lowerIsBetter: true, fmt: f }).verdict, "better");
  assert.equal(vsUsual({ now: 900, usual: 600, nNow: 8, nUsual: 9, minN: 5, lowerIsBetter: true, fmt: f }).verdict, "worse");
  assert.equal(vsUsual({ now: 620, usual: 600, nNow: 8, nUsual: 9, minN: 5, lowerIsBetter: true, fmt: f }).verdict, "same");
  const thin = vsUsual({ now: 300, usual: 600, nNow: 4, nUsual: 9, minN: 5, lowerIsBetter: true, fmt: f });
  assert.equal(thin.verdict, "not_enough");
  assert.equal(thin.text, "Not enough history yet to compare with your usual.");
  assert.equal(vsUsual({ now: 5, usual: null, nNow: 8, nUsual: 0, minN: 5, lowerIsBetter: true, fmt: f }).verdict, "not_enough");
});

test("reply pulse: this week's typical reply against the week before, a point only where there were enough replies", () => {
  const rows: Array<{ leadAt: number; touchAt: number | null }> = [];
  for (let i = 0; i < 12; i++) rows.push({ leadAt: NOW - (i % 6) * D - 3 * H, touchAt: NOW - (i % 6) * D - 3 * H + 10 * 60_000 }); // this week: 10 minutes
  for (let i = 0; i < 8; i++) rows.push({ leadAt: NOW - 7 * D - (i % 6) * D - 3 * H, touchAt: NOW - 7 * D - (i % 6) * D - 3 * H + 40 * 60_000 }); // the week before: 40 minutes
  const p = replyPulse(rows, NOW);
  assert.equal(p.current.seconds, 600);
  assert.equal(p.usual.seconds, 2400);
  assert.equal(p.verdict.verdict, "better");
  assert.ok(p.points.length >= 1 && p.points.every((x) => x.value > 0));
  const thin = replyPulse(rows.slice(0, 3), NOW);
  assert.equal(thin.current.seconds, null);
  assert.equal(thin.verdict.verdict, "not_enough");
  assert.equal(thin.points.length, 0, "no point is drawn from fewer replies than the minimum for a median");
  assert.equal(medianReply(rows, NOW, 7).answered, 12);
});

test("the answered streak counts days in a row where every lead was answered in time; empty days neither extend nor break it", () => {
  const ok = (daysBack: number) => ({ leadAt: NOW - daysBack * D, touchAt: NOW - daysBack * D + 5 * 60_000 });
  const late = (daysBack: number) => ({ leadAt: NOW - daysBack * D, touchAt: NOW - daysBack * D + 90 * 60_000 });
  assert.equal(answeredStreak([ok(1), ok(2), ok(4)], 15, NOW), 3);
  assert.equal(answeredStreak([ok(1), late(2), ok(3)], 15, NOW), 1);
  assert.equal(answeredStreak([ok(1), ok(1), { leadAt: NOW - D, touchAt: null }], 15, NOW), 0);
  assert.equal(answeredStreak([], 15, NOW), 0);
});

test("share answered in target needs the minimum number of judged leads", () => {
  const rows = [0, 1, 2, 3, 4, 5].map((i) => ({ leadAt: NOW - (i + 1) * H, touchAt: i < 4 ? NOW - (i + 1) * H + 60_000 : null }));
  const s = withinTargetShare(rows, 15, NOW, 7);
  assert.equal(s.judged, 6);
  assert.ok(Math.abs((s.share ?? 0) - 4 / 6) < 1e-9);
  assert.equal(withinTargetShare(rows.slice(0, 3), 15, NOW, 7).share, null);
});

// ---------- proof ----------
test("what SubSync caught: raised, cleared and still open over 7 days, said with the word cleared", () => {
  const a = (id: string, created: number, resolved: number | null): AlertFact => ({ id, locationId: "aaa", accountName: "Maple Dental", title: id, severity: "warning", createdAt: created, resolvedAt: resolved });
  const p = proofOf([a("x", NOW - D, NOW - 1 * H), a("y", NOW - 2 * D, null), a("z", NOW - 20 * D, NOW - 2 * D)], NOW);
  assert.equal(p.days.length, 7);
  assert.equal(p.raised, 2, "z was raised before the window");
  assert.equal(p.cleared, 2, "z was cleared inside the window");
  assert.equal(p.open, 1);
  assert.equal(proofLine(p), "Last 7 days: 2 alerts raised, 2 cleared, 1 still open.");
  assert.equal(p.days[6].cleared.length, 1);
  assert.equal(p.days.reduce((s, d) => s + d.raised.length, 0), p.raised, "each day's list adds up to the total");
});

// ---------- share ----------
test("share text is the headline and the top three, in plain words", () => {
  const items = [item("stale", "ccc", { value: 12000, at: NOW - 40 * D }), item("leads", "aaa"), item("appointments", "bbb"), item("noshows", "bbb"), item("unanswered", "aaa")];
  const q = queueOf(items);
  const text = shareText({ who: "Your client accounts", headline: headlineOf({ scope: "all", rows: q, totals: totalsFrom(items) }), rows: q });
  const lines = text.split("\n");
  assert.equal(lines[0], "Your client accounts: Today");
  assert.match(lines[1], /^3 clients need you today\. \$12,000 is at risk\.$/);
  assert.equal(lines.filter((l) => /^\d\. /.test(l)).length, 3);
  assert.match(text, /1\. North Roofing: 1 open deal with no movement in 30\+ days, \$12,000 at stake, wrong for 40 days/);
});

test("ages in words", () => {
  assert.equal(ageWords(12), "12 min");
  assert.equal(ageWords(135), "2 h 15 min");
  assert.equal(ageWords(60 * 30), "30 h");
  assert.equal(ageWords(60 * 24 * 9), "9 days");
});
