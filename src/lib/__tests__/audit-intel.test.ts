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

// ---------------- stage F6 ----------------

import { NAV } from "../../app/app/nav.ts";
import { deriveAccount, type AccountRow } from "../analytics/derive.ts";
import { noShowRecovery, overview, type Appt } from "../analytics/appointment-intel.ts";
import { rateRange } from "../analytics/pipeline-intel.ts";
import { WAITING_WINDOW_DAYS } from "../analytics/waiting.ts";
import {
  AUDIT_NOSHOW_DAYS, AUDIT_UNMARKED_DAYS, AUDIT_UNMARKED_GRACE_HOURS, AUDIT_WAITING_DAYS, auditNotes, fixFirstFinding, fixFirstLine, noteText, openLabel, OPEN_TARGET, type NoteKey,
} from "../analytics/audit-intel.ts";

test("the slow follow-up figure is the account tile's figure: one formula, not two", () => {
  const NOW = Date.parse("2026-10-29T12:00:00Z");
  const row: AccountRow = {
    locationId: "L1", name: "Acme Dental", email: "a@acme.com", phone: "555", website: null, ignored: false, owner: null, contacts: 200, withEmail: 180, withPhone: 160, withTags: 100,
    new30d: 20, active90d: 150, openOpps: 10, openValue: 10_000, staleOpps: 1, staleValue: 500, wonCount: 16, lostCount: 8, wonValue: 32_000, unread: 2, unanswered: 7,
    calendars: 2, pipelines: 1, lastActivityAt: new Date(NOW).toISOString(), syncError: null, contactsSyncedAt: new Date(NOW).toISOString(),
  };
  const d = deriveAccount(row, { staleDays: 30, dormantDays: 30, slaHours: 4 }, [], NOW);
  assert.ok(d.followUpRevenueAtRisk !== null && d.followUpRevenueAtRisk > 0, "this account has 24 closed deals, so it has a win rate");
  const audit = buildAudit([acct({ unanswered: 7, winRate: d.winRate, avgDealValue: d.avgDealValue, wonCount: 16, lostCount: 8 })], null);
  assert.equal(audit.estimatedDollars, d.followUpRevenueAtRisk, "the audit shows the same dollars as the account tile");
  // Under the 20 closed deals minimum neither shows a figure.
  const thin = deriveAccount({ ...row, wonCount: 5, lostCount: 5 }, { staleDays: 30, dormantDays: 30, slaHours: 4 }, [], NOW);
  assert.equal(thin.followUpRevenueAtRisk, null);
  assert.equal(buildAudit([acct({ unanswered: 7, winRate: thin.winRate, avgDealValue: thin.avgDealValue, wonCount: 5, lostCount: 5 })], null).estimatedDollars, null);
});

test("the estimate has a range from the forecast's own function, the point estimate sits inside it, and no range without the closed deals", () => {
  const a = acct({ unanswered: 10, winRate: 0.4, avgDealValue: 3_000, wonCount: 8, lostCount: 12 });
  const audit = buildAudit([a], null);
  assert.equal(audit.estimatedDollars, 12_000, "10 waiting x $3,000 x 40%");
  const r = rateRange(8, 20)!;
  assert.deepEqual(audit.estimateRange, { low: Math.round(10 * 3_000 * r.low), high: Math.round(10 * 3_000 * r.high) });
  assert.ok(audit.estimateRange!.low < 12_000 && 12_000 < audit.estimateRange!.high);
  // Two accounts add, one without a win rate adds nothing, and the range is still a sum of ranges.
  const two = buildAudit([a, acct({ locationId: "L2", unanswered: 4, winRate: null, avgDealValue: 900 }), acct({ locationId: "L3", unanswered: 5, winRate: 0.5, avgDealValue: 1_000, wonCount: 10, lostCount: 10 })], null);
  assert.equal(two.estimatedDollars, 12_000 + 2_500);
  assert.ok(Math.abs(two.estimateRange!.low - (audit.estimateRange!.low + Math.round(5 * 1_000 * rateRange(10, 20)!.low))) <= 1, "a sum of the accounts' ranges (rounding once)");
  // Without the closed-deal counts the estimate stands without a range.
  assert.equal(buildAudit([acct({ unanswered: 10, winRate: 0.4, avgDealValue: 3_000 })], null).estimateRange, null);
  assert.equal(buildAudit([acct({ unanswered: 10 })], null).estimateRange, null, "no estimate, no range");
});

test("what to fix first is the most serious thing a person can do, one sentence, and nothing when nothing is urgent", () => {
  const a = buildAudit([acct({ name: "Big", staleValue: 90_000, staleOpps: 9, openValue: 100_000, openOpps: 10, unanswered: 12, winRate: 0.5, avgDealValue: 2_000, wonCount: 10, lostCount: 10 })], null);
  assert.equal(fixFirstFinding(a)!.severity, "critical");
  assert.equal(a.fixFirst, fixFirstLine(a));
  assert.match(a.fixFirst!, /^\$90,000 is sitting in 9 deals that have not moved\. Open the stale deals/);
  assert.match(auditSummary(a, "Your agency"), /Fix first: \$90,000 is sitting/);
  const clean = buildAudit([acct()], { readable: 1, total: 1, needPermission: 0, unmarked: 0, noShowsToRecover: 0, unconfirmed48: 0 });
  assert.equal(clean.fixFirst, null);
  assert.ok(!auditSummary(clean, "x").includes("Fix first"));
  // A permission note is information, never "first".
  const onlyInfo = buildAudit([acct()], null);
  assert.deepEqual(onlyInfo.findings.map((f) => f.key), ["permission"]);
  assert.equal(onlyInfo.fixFirst, null);
});

test("every number has a definition, written with the settings that were used, and the slow one says when conversations were not all read", () => {
  const a = buildAudit(
    [acct({ staleValue: 40_000, staleOpps: 8, openValue: 60_000, openOpps: 12, excludedOpen: 14, unanswered: 5, winRate: 0.5, avgDealValue: 2_000, completenessPct: 20, contacts: 100 })],
    { readable: 1, total: 1, needPermission: 0, unmarked: 12, noShowsToRecover: 6, unconfirmed48: 0 },
    { staleDays: 45, slaHours: 2, readLimit: "1 of 3 accounts has more than 500 conversations; only the newest 500 are read." },
  );
  const keys = a.notes.map((n) => n.key);
  assert.deepEqual(keys.slice(0, 2), ["stale", "estimate"], "the two headline figures come first");
  for (const f of a.findings) if (f.note) assert.ok(keys.includes(f.note), `${f.key} points at a definition that exists`);
  assert.ok(keys.includes("left_out"), "left-out deals are explained when there are any");
  assert.equal(new Set(keys).size, keys.length, "each definition once");
  assert.match(noteText("stale", { staleDays: 45 }), /for 45 days or more/);
  assert.match(noteText("slow", { slaHours: 2, readLimit: "only the newest 500 are read." }), /more than 2 hours.*only the newest 500 are read/);
  assert.match(noteText("slow", { slaHours: 1 }), /more than 1 hour,/);
  assert.match(a.notes.find((n) => n.key === "estimate")!.text, /Estimate, not a fact/);
  for (const f of a.findings.filter((x) => x.note)) assert.ok(f.window && f.window.length > 10, `${f.key} states the window it counts over`);
  // Nothing wrong, nothing to define beyond the two headline figures.
  assert.deepEqual(auditNotes({ findings: [], leftOut: 0 }).map((n) => n.key), ["stale", "estimate"]);
});

test("the windows the audit states are the windows the appointment and conversation code counts over", () => {
  const NOW = Date.parse("2026-11-01T12:00:00Z");
  const H = 3_600_000, D = 24 * H;
  const appt = (id: string, status: string, startAt: number, contactId = id): Appt => ({ id, locationId: "L", calendarId: "c", calendarName: "Cal", contactId, status, startAt, createdAt: null, assignedTo: null });
  // No-show recovery: inside the stated window is listed, one day outside is not.
  const nos = noShowRecovery([appt("a", "noshow", NOW - (AUDIT_NOSHOW_DAYS - 1) * D), appt("b", "noshow", NOW - (AUDIT_NOSHOW_DAYS + 1) * D)], NOW).map((x) => x.id);
  assert.deepEqual(nos, ["a"]);
  // No outcome: started just over the grace period ago is listed, just under is not; older than the stated days is not.
  const un = overview([
    appt("in", "new", NOW - (AUDIT_UNMARKED_GRACE_HOURS * H + 60_000)), appt("fresh", "new", NOW - (AUDIT_UNMARKED_GRACE_HOURS * H - 60_000)),
    appt("old", "new", NOW - (AUDIT_UNMARKED_DAYS + 1) * D), appt("edge", "new", NOW - (AUDIT_UNMARKED_DAYS - 1) * D),
  ], NOW).unmarked.map((x) => x.id).sort();
  assert.deepEqual(un, ["edge", "in"]);
  assert.equal(AUDIT_WAITING_DAYS, WAITING_WINDOW_DAYS);
});

test("every Open button says where it goes, in the words of the menu (N7)", () => {
  const label = (id: string) => NAV.find((n) => n.id === id)?.label;
  assert.equal(OPEN_TARGET.deals, label("pipeline"), "deals open inside Pipeline and deals");
  assert.equal(OPEN_TARGET.inbox, label("inbox"));
  assert.equal(OPEN_TARGET.appointments, label("appointments"));
  assert.equal(OPEN_TARGET.accounts, label("accounts"));
  assert.equal(OPEN_TARGET.settings, label("settings"));
  assert.equal(openLabel("inbox"), "Open in Unanswered messages");
  const keys: NoteKey[] = ["stale", "slow", "unmarked", "noshows", "estimate", "left_out", "data"];
  for (const k of keys) assert.ok(noteText(k).length > 40, k);
});
