import assert from "node:assert/strict";
import { test } from "node:test";
import { auditSummary, buildAudit, slowFollowUpEstimate, type AuditAccount } from "../analytics/audit-intel.ts";

const acct = (over: Partial<AuditAccount> = {}): AuditAccount => ({
  locationId: "L1", name: "Acme Roofing", staleValue: 0, staleOpps: 0, openValue: 0, openOpps: 0, excludedOpen: 0, unanswered: 0, winRate: null, avgDealValue: null, completenessPct: 80, contacts: 100, ...over,
});

test("stale money is a fact, the slow follow-up figure is an estimate, and they are never added together", () => {
  const a = buildAudit([acct({ staleValue: 40_000, staleOpps: 8, openValue: 60_000, openOpps: 12, unanswered: 5, winRate: 0.5, avgDealValue: 2_000 })], null);
  assert.equal(a.staleDollars, 40_000);
  assert.equal(a.estimatedDollars, 5_000, "5 waiting x $2,000 x 50%");
  const stale = a.findings.find((f) => f.key === "stale")!;
  const slow = a.findings.find((f) => f.key === "slow")!;
  assert.equal(stale.kind, "fact");
  assert.equal(slow.kind, "estimate");
  assert.equal(stale.severity, "critical", "two thirds of the pipeline is stale");
  assert.match(slow.detail, /estimate, not money lost/);
  assert.ok(!a.headline.includes("45,000"), "the headline never adds a fact to an estimate");
});

test("with no win rate there is no dollar figure for slow follow-up, only the count", () => {
  const a = buildAudit([acct({ unanswered: 7 })], null);
  assert.equal(a.estimatedDollars, null);
  const slow = a.findings.find((f) => f.key === "slow")!;
  assert.equal(slow.dollars, null);
  assert.equal(slow.kind, "none");
  assert.equal(slowFollowUpEstimate({ unanswered: 7, winRate: null, avgDealValue: 900 }), null);
  assert.equal(slowFollowUpEstimate({ unanswered: 0, winRate: 0.4, avgDealValue: 900 }), null);
});

test("appointments that cannot be read are said so, never guessed", () => {
  const noPerm = buildAudit([acct()], { readable: 0, total: 3, needPermission: 3, unmarked: 0, noShowsToRecover: 0, unconfirmed48: 0 });
  assert.ok(noPerm.findings.some((f) => f.key === "permission" && /cannot be read/.test(f.title)));
  assert.ok(!noPerm.findings.some((f) => f.key === "unmarked" || f.key === "noshows"));
  const none = buildAudit([acct()], null);
  assert.ok(none.findings.some((f) => f.key === "permission"));
  const partial = buildAudit([acct()], { readable: 2, total: 3, needPermission: 1, unmarked: 12, noShowsToRecover: 6, unconfirmed48: 0 });
  assert.ok(partial.findings.some((f) => f.key === "unmarked" && f.severity === "warning"));
  assert.ok(partial.findings.some((f) => f.key === "noshows"));
  assert.ok(partial.findings.some((f) => f.key === "permission" && /still needs/.test(f.title)));
});

test("findings are ranked most serious first, rows by what is at stake, and a clean account says so", () => {
  const a = buildAudit([
    acct({ locationId: "A", name: "Small", staleValue: 1_000, staleOpps: 1, openValue: 100_000, openOpps: 20 }),
    acct({ locationId: "B", name: "Big", staleValue: 90_000, staleOpps: 9, openValue: 100_000, openOpps: 10, unanswered: 12 }),
  ], null);
  assert.deepEqual(a.rows.map((r) => r.name), ["Big", "Small"]);
  const severities = a.findings.map((f) => f.severity);
  assert.deepEqual([...severities].sort((x, y) => ["critical", "warning", "info"].indexOf(x) - ["critical", "warning", "info"].indexOf(y)), severities, "most serious first");
  const clean = buildAudit([acct(), acct({ locationId: "L2" })], { readable: 2, total: 2, needPermission: 0, unmarked: 0, noShowsToRecover: 0, unconfirmed48: 0 });
  assert.deepEqual(clean.findings, []);
  assert.equal(clean.headline, "Nothing urgent across 2 accounts.");
  assert.equal(clean.rows.length, 0);
});

test("thin data and left-out deals are reported without dollars", () => {
  const a = buildAudit([acct({ name: "Thin", completenessPct: 30, contacts: 400, excludedOpen: 14 }), acct({ locationId: "L2", name: "New", completenessPct: 10, contacts: 5 })], null);
  const data = a.findings.find((f) => f.key === "data")!;
  assert.equal(data.count, 1, "an account with only 5 contacts is not judged");
  assert.match(data.detail, /Thin/);
  const junk = a.findings.find((f) => f.key === "junk")!;
  assert.equal(junk.count, 14);
  assert.equal(junk.dollars, null);
});

test("the pasteable summary labels the estimate and names where to start", () => {
  const a = buildAudit([acct({ name: "Big", staleValue: 90_000, staleOpps: 9, openValue: 100_000, openOpps: 10, unanswered: 12, winRate: 0.5, avgDealValue: 2_000 })], null);
  const text = auditSummary(a, "Your agency");
  assert.match(text, /^Your agency: account audit/);
  assert.match(text, /\(estimate\)/);
  assert.match(text, /Big: \$90,000 stale across 9 deals, 12 waiting/);
  assert.match(text, /not money lost/);
});

test("when one deal is most of the stale figure the headline says so instead of reading as a pattern (UX-04)", () => {
  // The real first screen: $1,000,000 in 1 deal that has not moved, 100% of the counted pipeline.
  const one = buildAudit([acct({ staleValue: 1_000_000, staleOpps: 1, openValue: 1_000_000, openOpps: 1, topStaleDeal: 1_000_000 })], null);
  const f = one.findings.find((x) => f_is(x, "stale"))!;
  assert.match(f.detail, /One deal \(\$1,000,000\) is 100% of this figure, so check that it is a real deal/);
  assert.equal(f.kind, "fact");
  // Eight even deals: no guard, it is a pattern.
  const even = buildAudit([acct({ staleValue: 40_000, staleOpps: 8, openValue: 60_000, openOpps: 12, topStaleDeal: 5_000 })], null);
  assert.ok(!even.findings.find((x) => f_is(x, "stale"))!.detail.includes("One deal"));
  // Two deals, one of them 60%: guard; at 49%: none.
  assert.match(buildAudit([acct({ staleValue: 10_000, staleOpps: 2, openValue: 10_000, openOpps: 2, topStaleDeal: 6_000 })], null).findings[0].detail, /60% of this figure/);
  assert.ok(!buildAudit([acct({ staleValue: 10_000, staleOpps: 2, openValue: 10_000, openOpps: 2, topStaleDeal: 4_900 })], null).findings[0].detail.includes("One deal"));
});
const f_is = (f: { key: string }, key: string) => f.key === key;
