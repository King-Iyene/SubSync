import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAudit, type AuditAccount } from "../analytics/audit-intel.ts";
import { type SeriesPoint } from "../analytics/digest-intel.ts";
import { MIN_BASE_FOR_PERCENT, MIN_MONEY_BASE_FOR_PERCENT } from "../analytics/metrics.ts";
import {
  appointmentsLine, attentionLine, auditPick, chooseFirst, describeRangeChange, leadsLine, portfolioRangeChanges, summaryText, todaySubtitle, validFromDay, validToDay, type FirstInput,
} from "../analytics/today-intel.ts";

// Stage F5: the sentences and numbers on Today. Pure, no database.

// ---------- the three sentences ----------
test("the leads sentence: waiting, never answered, none, loading, failed, and blocked by a missing permission", () => {
  assert.equal(leadsLine({ waiting: 15, never: 42, loading: false }), "15 leads are waiting for a reply, and 42 were never answered.");
  assert.equal(leadsLine({ waiting: 1, never: 1, loading: false }), "1 lead is waiting for a reply, and 1 was never answered.");
  assert.equal(leadsLine({ waiting: 3, never: 0, loading: false }), "3 leads are waiting for a reply.");
  assert.equal(leadsLine({ waiting: 0, never: 4, loading: false }), "0 leads are waiting for a reply, and 4 were never answered.");
  assert.equal(leadsLine({ waiting: 0, never: 0, loading: false }), "No leads are waiting for a reply right now.");
  assert.equal(leadsLine({ waiting: null, never: 0, loading: true }), "Checking for leads waiting for a reply...");
  assert.equal(leadsLine({ waiting: null, never: 0, loading: false }), "Leads waiting for a reply could not be loaded.");
  // A zero that only means "nothing could be read" is never reported as "nothing is waiting".
  assert.equal(leadsLine({ waiting: 0, never: 0, loading: false, blocked: true }), "Leads waiting for a reply cannot be counted yet.");
});

test("the appointments and accounts lines", () => {
  assert.equal(appointmentsLine(0), "Every past appointment has an outcome recorded.");
  assert.match(appointmentsLine(1), /^1 past appointment has no outcome recorded/);
  assert.match(appointmentsLine(1234), /^1,234 past appointments have no outcome recorded/);
  assert.equal(appointmentsLine(null), "Checking appointments...");
  assert.match(appointmentsLine(0, true), /calendar permission has not been approved/);
  assert.equal(attentionLine(0, "all"), "No client account needs you today.");
  assert.equal(attentionLine(1, "all"), "1 client account needs attention today.");
  assert.equal(attentionLine(5, "all"), "5 client accounts need attention today.");
  assert.equal(attentionLine(1, "account"), "1 thing needs attention in this account today.");
  assert.equal(attentionLine(3, "account"), "3 things need attention in this account today.");
  assert.equal(attentionLine(0, "account"), "Nothing else needs this account today.");
  assert.equal(attentionLine(null, "all"), "Checking your accounts...");
});

test("the subtitle says what the screen is for, fits the page template and uses no internal words", () => {
  const all = todaySubtitle("all", null);
  assert.match(all, /leads waiting/);
  assert.match(all, /Start at the top/);
  for (const s of [all, todaySubtitle("account", null), todaySubtitle("account", "Acme Roofing"), todaySubtitle("account", "A very long client account name that would push the sentence over the limit")]) {
    assert.ok(s.length <= 120, `${s.length}: ${s}`);
    assert.doesNotMatch(s, /\b(agenc(y|ies)|sub-?accounts?|locations?|sla|ghl|highlevel)\b/i);
  }
});

// ---------- the one thing to do first ----------
const acct = (o: Partial<AuditAccount> = {}): AuditAccount => ({
  locationId: "L1", name: "Acme", staleValue: 0, staleOpps: 0, openValue: 0, openOpps: 0, excludedOpen: 0, unanswered: 0, winRate: null, avgDealValue: null, completenessPct: 90, contacts: 100, ...o,
});
const auditOf = (accounts: AuditAccount[]) => buildAudit(accounts, { readable: 1, total: 1, needPermission: 0, unmarked: 0, noShowsToRecover: 0, unconfirmed48: 0 });
const input = (o: Partial<FirstInput> = {}): FirstInput => ({ waiting: 0, never: 0, unmarked: 0, attention: 0, scope: "all", audit: null, ...o });

// One deal worth a million is the whole stale figure: this is the exact case that drove Today's headline before (UX-04).
const oneBigDeal = () => auditOf([acct({ staleValue: 1_000_000, staleOpps: 1, openValue: 1_000_000, openOpps: 1, topStaleDeal: 1_000_000 })]);
const manyDeals = () => auditOf([acct({ staleValue: 300_000, staleOpps: 6, openValue: 400_000, openOpps: 8, topStaleDeal: 60_000 })]);

test("leads waiting always come first, with the button to Speed to lead", () => {
  const f = chooseFirst(input({ waiting: 4, never: 2, unmarked: 9, attention: 3, audit: manyDeals() }));
  assert.equal(f?.key, "leads");
  assert.equal(f?.view, "speed");
  assert.equal(f?.button, "Open Speed to lead");
  assert.match(f!.text, /^Reply to 4 waiting leads/);
  assert.match(chooseFirst(input({ waiting: 0, never: 3 }))!.text, /^Look at 3 leads that nobody ever answered/);
});

test("with no leads waiting the first thing is the account audit's own pick, with its definition", () => {
  const audit = manyDeals();
  const f = chooseFirst(input({ audit, unmarked: 5, attention: 2 }));
  assert.equal(f?.key, "stale");
  assert.match(f!.text, /^\$300,000 is sitting in 6 deals that have not moved\./);
  assert.equal(f?.view, "deals");
  assert.match(f!.note ?? "", /^Counted from your CRM\. An open deal with a value above \$0 and an owner/);
  // It is the pick the Account audit page makes: one calculation, not a second one.
  assert.equal(auditPick(audit)?.text, `${audit.findings[0].title}.`);
});

test("one outlier deal never leads the screen: it comes after appointments and accounts, and is worded as a check", () => {
  const audit = oneBigDeal();
  assert.ok(audit.outlier, "fixture: one deal is the whole figure");
  assert.equal(audit.findings[0].key, "stale");
  assert.equal(chooseFirst(input({ audit, unmarked: 3 }))?.key, "appointments");
  assert.equal(chooseFirst(input({ audit, attention: 2 }))?.key, "accounts");
  const last = chooseFirst(input({ audit }));
  assert.equal(last?.key, "outlier");
  assert.match(last!.text, /^Check one deal worth \$1,000,000\. It is 100% of the money in deals that have not moved\.$/);
  assert.doesNotMatch(last!.text, /is sitting in/);
  assert.match(last!.detail ?? "", /real deal/);
  // And leads still beat everything.
  assert.equal(chooseFirst(input({ audit, waiting: 1 }))?.key, "leads");
});

test("in one account's view the accounts-needing-attention step does not exist; nothing to do gives the calm all-clear (null)", () => {
  assert.equal(chooseFirst(input({ scope: "account", attention: 4 })), null);
  assert.equal(chooseFirst(input({ audit: auditOf([acct()]) })), null);
  assert.equal(chooseFirst(input({ audit: null })), null);
});

test("information-only audit findings are never the first thing", () => {
  const audit = auditOf([acct({ contacts: 100, completenessPct: 20 })]);
  assert.equal(audit.findings[0].key, "data");
  assert.equal(audit.findings[0].severity, "info");
  assert.equal(chooseFirst(input({ audit })), null);
});

test("the pick on Today is the same one the account audit page shows as 'what to fix first'", () => {
  for (const audit of [manyDeals(), auditOf([acct({ unanswered: 12 })])]) {
    const pick = auditPick(audit);
    assert.ok(pick);
    assert.equal(pick.text, `${audit.findings.find((f) => f.severity !== "info")!.title}.`);
    assert.ok(audit.fixFirst?.startsWith(pick.text));
  }
});

// ---------- change over time ----------
const pt = (day: string, o: Partial<SeriesPoint> = {}): SeriesPoint => ({ day, contacts: 100, new30: 40, openOpps: 20, openValue: 50_000, stale: 12, unread: 20, completeness: 80, score: 70, dealsOk: true, ...o });
const days = (from: number, to: number, f: (d: number) => Partial<SeriesPoint> = () => ({})) => Array.from({ length: to - from + 1 }, (_, i) => pt(`2026-10-${String(from + i).padStart(2, "0")}`, f(from + i)));
const byKey = (c: ReturnType<typeof portfolioRangeChanges>, key: string) => c.find((x) => x.key === key)!;

test("a change is measured from the day before the window to the last day, summed over the accounts", () => {
  const a = days(1, 14, (d) => ({ stale: d }));
  const b = days(1, 14, (d) => ({ stale: 2 * d }));
  const c = byKey(portfolioRangeChanges([a, b], "2026-10-08"), "stale");
  assert.equal(c.now, 14 + 28);
  assert.equal(c.then, 7 + 14, "the figure on 7 Oct, the day before the window starts");
  assert.equal(c.thenDay, "2026-10-07");
  assert.equal(c.coversWindow, true);
  assert.equal(c.diff, 21);
  assert.equal(c.percent, 100);
  assert.equal(c.points.length, 8, "7 Oct as the start, then 8 to 14 Oct");
});

test("no percentage is shown when the earlier figure is below the minimum base; the plain difference is, and says why", () => {
  const small = days(1, 10, (d) => ({ unread: d < 10 ? 4 : 1 }));
  const c = byKey(portfolioRangeChanges([small], "2026-10-05"), "unread");
  assert.equal(c.then, 4);
  assert.ok(c.then! < MIN_BASE_FOR_PERCENT);
  assert.equal(c.percent, null, "-75% on 4 conversations says nothing");
  assert.equal(c.smallBase, true);
  assert.equal(describeRangeChange(c), "Down 3 from 4 (too small a base for a percentage)");
  // The same shape of change on a base that is big enough gets its percentage.
  const big = byKey(portfolioRangeChanges([days(1, 10, (d) => ({ unread: d < 10 ? 40 : 10 }))], "2026-10-05"), "unread");
  assert.equal(big.percent, -75);
  assert.equal(describeRangeChange(big), "Down 75% from 40");
});

test("dollar figures use the dollar minimum: $4,000 is too small a base for a percentage, $50,000 is not", () => {
  const tiny = byKey(portfolioRangeChanges([days(1, 10, (d) => ({ openValue: d < 10 ? 4000 : 9000 }))], "2026-10-05"), "openValue");
  assert.ok(tiny.then! < MIN_MONEY_BASE_FOR_PERCENT);
  assert.equal(tiny.percent, null);
  assert.equal(describeRangeChange(tiny, (n) => `$${n}`), "Up $5000 from $4000 (too small a base for a percentage)");
  const ok = byKey(portfolioRangeChanges([days(1, 10, (d) => ({ openValue: d < 10 ? 50_000 : 60_000 }))], "2026-10-05"), "openValue");
  assert.equal(ok.percent, 20);
});

test("when SubSync has not been watching for the whole window the earliest day is used and the card says so", () => {
  const c = byKey(portfolioRangeChanges([days(10, 14, (d) => ({ stale: d }))], "2026-09-01"), "stale");
  assert.equal(c.coversWindow, false);
  assert.equal(c.thenDay, "2026-10-10");
  assert.equal(c.then, 10);
  assert.equal(c.now, 14);
});

test("one day of history, or none, has nothing to compare with", () => {
  const one = byKey(portfolioRangeChanges([days(14, 14)], "2026-10-08"), "stale");
  assert.equal(one.then, null);
  assert.equal(describeRangeChange(one), "No earlier day to compare with yet");
  assert.deepEqual(portfolioRangeChanges([[], []], "2026-10-08"), []);
});

test("days counted under older deal rules are not compared for deal figures, but are for contacts and conversations", () => {
  const s = [...days(1, 6, () => ({ dealsOk: false, stale: 500, unread: 7 })), ...days(7, 10, () => ({ dealsOk: true, stale: 10, unread: 8 }))];
  const stale = byKey(portfolioRangeChanges([s], "2026-10-03"), "stale");
  assert.equal(stale.coversWindow, false, "the older-rules days are skipped, so the first day that counts is 7 Oct");
  assert.equal(stale.thenDay, "2026-10-07");
  assert.equal(stale.then, 10);
  const unread = byKey(portfolioRangeChanges([s], "2026-10-03"), "unread");
  assert.equal(unread.then, 7);
  assert.equal(unread.thenDay, "2026-10-02");
});

test("a window that ends earlier ignores later days", () => {
  const c = byKey(portfolioRangeChanges([days(1, 14, (d) => ({ stale: d }))], "2026-10-04", "2026-10-09"), "stale");
  assert.equal(c.now, 9);
  assert.equal(c.then, 3);
});

test("no change is said as no change", () => {
  assert.equal(describeRangeChange(byKey(portfolioRangeChanges([days(1, 10)], "2026-10-05"), "stale")), "No change from 12");
});

test("the dates a caller may ask for are checked: real, before today, within a year; the end not before the start or in the future", () => {
  const today = "2026-11-01";
  assert.equal(validFromDay("2026-10-25", today), "2026-10-25");
  for (const bad of ["2026-11-01", "2026-11-02", "2022-10-01", "2026-02-30", "yesterday", "", null, 5, "2026-1-5"]) assert.equal(validFromDay(bad, today), null, String(bad));
  assert.equal(validFromDay("2025-11-02", today), "2025-11-02");
  assert.equal(validToDay(undefined, "2026-10-25", today), today);
  assert.equal(validToDay("", "2026-10-25", today), today);
  assert.equal(validToDay("2026-10-30", "2026-10-25", today), "2026-10-30");
  for (const bad of ["2026-10-24", "2026-11-02", "nope", "2026-13-01"]) assert.equal(validToDay(bad, "2026-10-25", today), null, bad);
});

test("the copy-able summary is the three lines and the first thing, in plain words", () => {
  const first = chooseFirst(input({ waiting: 2 }));
  const text = summaryText({ who: "Your client accounts", leads: leadsLine({ waiting: 2, never: 0, loading: false }), appointments: appointmentsLine(0), attention: attentionLine(1, "all"), first });
  assert.deepEqual(text.split("\n"), ["Your client accounts: today", "2 leads are waiting for a reply.", "Every past appointment has an outcome recorded.", "1 client account needs attention today.", "", "Do this first: Reply to 2 waiting leads, the longest wait first."]);
  assert.equal(summaryText({ who: "X", leads: "a", appointments: "b", attention: "c", first: null }).includes("Do this first"), false);
});
