import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAuditV2, type AuditAccount, type V2Input } from "../analytics/audit-v2.ts";
import { AUDIT_RULES_VERSION, SAMPLE_HISTORY, buildHistory, changeSentence, comparePairs, monthlyMessage, runsFromAudit, shareThenNow, type RunRow, type Stored } from "../analytics/au-history.ts";
import type { TodayItem } from "../analytics/today-queue.ts";

// Account audit history (docs/METRICS.md, "Account audit history"): the day-one baseline, the rules that stop a bad comparison, and the sentences.
const NOW = Date.parse("2026-11-11T09:00:00Z");
const D = 86_400_000;
const acct = (id: string, over: Partial<AuditAccount> = {}): AuditAccount => ({ id, name: `Client ${id}`, winRate: 0.25, avgDeal: 4000, won: 10, lost: 30, ...over });
const item = (kind: TodayItem["kind"], loc: string, n: number, value: number | null = null): TodayItem => ({ id: `${kind}:${loc}:${n}`, kind, locationId: loc, accountName: `Client ${loc}`, name: `Person ${n}`, detail: "", at: NOW - 40 * D, value, contactId: `c${n}`, url: "" });
const input = (over: Partial<V2Input> = {}): V2Input => ({
  now: NOW, staleDays: 30, slaHours: 4, scope: "all", accounts: [acct("a"), acct("b", { won: 2, lost: 3 })],
  stale: { items: [], total: 0, totalValue: 0 }, waiting: { leads: [], leadsTotal: 0, conversations: [], conversationsTotal: 0 }, noshows: { items: [], total: 0 }, appointments: { items: [], total: 0 }, ...over,
});
const run = (loc: string, day: string, over: Partial<RunRow> = {}): RunRow => ({
  locationId: loc, runDay: day, rulesVersion: AUDIT_RULES_VERSION, baseline: false, counts: { replies: 5, stale: 3, noshows: 2, appointments: 1 }, staleDollars: 9000,
  estimate: 3000, estLow: 2000, estHigh: 4000, closedDeals: 40, partial: false, ...over,
});

test("runsFromAudit: per account counts equal the rows of the findings, and an unreadable calendar is null, never zero", () => {
  const a = buildAuditV2(input({
    stale: { items: [item("stale", "a", 1, 5000), item("stale", "a", 2, 1000), item("stale", "b", 3, 700)], total: 3, totalValue: 6700 },
    waiting: { leads: [{ locationId: "a", accountName: "Client a", contactId: "c9", name: "P9", at: NOW - 5 * 3_600_000, never: false, url: "", owner: null, source: null, detail: "" }], leadsTotal: 1, conversations: [], conversationsTotal: 0 },
    noshows: null, appointments: null,
  }));
  const runs = runsFromAudit(a, [acct("a"), acct("b", { won: 2, lost: 3 })], false);
  const ra = runs.find((r) => r.locationId === "a")!, rb = runs.find((r) => r.locationId === "b")!;
  assert.equal(ra.counts.stale, 2);
  assert.equal(ra.counts.replies, 1);
  assert.equal(ra.counts.noshows, null, "calendars not read means not checked");
  assert.equal(ra.staleDollars, 6000);
  assert.equal(rb.counts.stale, 1);
  assert.equal(rb.estimate, null, "an account with under 20 closed deals gets no estimate");
  assert.equal(ra.estimate !== null, true);
  const total = runs.reduce((s, r) => s + (r.counts.stale ?? 0), 0);
  assert.equal(total, a.findings.find((f) => f.key === "stale")!.count, "counts add up to the finding");
});

test("comparison rules: same rules version only, never a cut count, at least 7 days apart", () => {
  const then = run("a", "2026-11-01"), now = run("a", "2026-11-11", { counts: { replies: 1, stale: 3, noshows: 2, appointments: 1 } });
  const ok = comparePairs([{ then, now }], 7);
  assert.equal(ok.accounts, 1);
  assert.equal(ok.lines.find((l) => l.key === "replies")!.change, -4);
  assert.equal(ok.lines.find((l) => l.key === "replies")!.tone, "better");
  assert.equal(comparePairs([{ then: run("a", "2026-11-08"), now }], 7).accounts, 0, "3 days apart is too soon");
  assert.equal(comparePairs([{ then: { ...then, rulesVersion: AUDIT_RULES_VERSION - 1 }, now }], 7).accounts, 0, "older rules are not subtracted");
  assert.equal(comparePairs([{ then: { ...then, partial: true }, now }], 7).accounts, 0, "a cut count is not compared");
  assert.equal(comparePairs([{ then, now: { ...now, partial: true } }], 7).accounts, 0);
});

test("a finding that was not checked on one side is skipped, not treated as zero", () => {
  const c = comparePairs([{ then: run("a", "2026-11-01", { counts: { replies: 5, stale: 3, noshows: null, appointments: null } }), now: run("a", "2026-11-11") }], 7);
  const ns = c.lines.find((l) => l.key === "noshows")!;
  assert.equal(ns.then, null);
  assert.equal(ns.tone, "unknown");
  assert.equal(ns.change, null);
});

test("the estimate compares only with 20 closed deals on both sides, and stays a range", () => {
  const few = comparePairs([{ then: run("a", "2026-11-01", { closedDeals: 12 }), now: run("a", "2026-11-11") }], 7);
  assert.equal(few.estimate, null);
  const ok = comparePairs([{ then: run("a", "2026-11-01"), now: run("a", "2026-11-11", { estLow: 500, estHigh: 900 }) }], 7);
  assert.deepEqual(ok.estimate, { thenLow: 2000, thenHigh: 4000, nowLow: 500, nowHigh: 900, accounts: 1 });
  assert.equal(ok.staleDollars?.then, 9000, "counted money is its own line");
});

test("changeSentence says fewer and more in plain words, and says so when nothing changed", () => {
  const c = comparePairs([{ then: run("a", "2026-11-01"), now: run("a", "2026-11-11", { counts: { replies: 1, stale: 4, noshows: 2, appointments: 1 } }) }], 7);
  assert.equal(changeSentence(c, "2026-11-01", "baseline"), "Since the baseline on 1 Nov: 4 fewer people waiting for a reply; 1 more deal gone quiet.");
  const same = comparePairs([{ then: run("a", "2026-11-01"), now: run("a", "2026-11-11") }], 7);
  assert.equal(changeSentence(same, "2026-11-01", "last"), "Nothing has changed since the last audit on 1 Nov.");
  assert.equal(changeSentence(comparePairs([], 7), "2026-11-01", "last"), null);
});

const stored = (first: Record<string, RunRow | null>, before: Record<string, RunRow | null> = {}): Stored => ({ runs: new Map(Object.keys(first).map((id) => [id, { first: first[id], before: before[id] ?? null }])), series: [] });
const names = new Map([["a", "Client a"], ["b", "Client b"]]);

test("buildHistory states: recording, baseline only (with the day it will compare), ready, rules changed", () => {
  const now = [run("a", "2026-11-11")];
  const rec = buildHistory({ today: "2026-11-11", now, stored: stored({ a: null }), names });
  assert.equal(rec.state, "recording");
  assert.equal(rec.waiting, 1);
  assert.match(rec.why ?? "", /History starts with this audit/);
  const base = buildHistory({ today: "2026-11-11", now, stored: stored({ a: run("a", "2026-11-09", { baseline: true }) }), names });
  assert.equal(base.state, "baseline_only");
  assert.match(base.why ?? "", /Baseline taken 9 Nov\. The comparison appears in 5 days/);
  assert.equal(base.thenNow, null);
  const ready = buildHistory({ today: "2026-11-11", now, stored: stored({ a: run("a", "2026-11-01", { baseline: true }) }, { a: run("a", "2026-11-08") }), names });
  assert.equal(ready.state, "ready");
  assert.equal(ready.thenNow?.accounts, 1);
  assert.ok(ready.since);
  assert.equal(ready.startsOn, "2026-11-01");
  const old = buildHistory({ today: "2026-11-11", now, stored: stored({ a: run("a", "2026-10-01", { baseline: true, rulesVersion: 0 }) }), names });
  assert.equal(old.state, "rules_changed");
});

test("new accounts are listed with their baseline, newest first, and only for 30 days", () => {
  const now = [run("a", "2026-11-11"), run("b", "2026-11-11")];
  const h = buildHistory({ today: "2026-11-11", now, stored: stored({ a: run("a", "2026-11-10", { baseline: true }), b: run("b", "2026-09-01", { baseline: true }) }), names });
  assert.deepEqual(h.newAccounts.map((n) => n.id), ["a"]);
  assert.equal(h.newAccounts[0].things, 11);
});

test("the one-pager carries counts only: no names, nothing else", () => {
  const c = comparePairs([{ then: run("a", "2026-11-01"), now: run("a", "2026-11-11") }], 7);
  const s = shareThenNow(c, 1)!;
  assert.deepEqual(Object.keys(s).sort(), ["accounts", "estimate", "from", "lines", "staleDollars", "to"]);
  assert.doesNotMatch(JSON.stringify(s), /Client|Person|c1/);
  assert.equal(shareThenNow(null, 1), null);
  assert.equal(shareThenNow(comparePairs([], 7), 0), null);
});

test("the monthly message lists what got better and worse, labels the estimate, and is plain words", () => {
  const m = monthlyMessage({ who: "Acme Agency", fromDay: "2026-10-10", toDay: "2026-11-09", link: "https://x.test/app#audit", accounts: [{ name: "Client a", then: 20, now: 5 }, { name: "Client b", then: 3, now: 9 }, { name: "Client c", then: 4, now: 4 }], estimate: { thenLow: 100, thenHigh: 200, nowLow: 50, nowHigh: 90, accounts: 2 } })!;
  assert.match(m.subject, /1 client got better, 1 got worse/);
  assert.match(m.text, /Got better:\n- Client a: 20 to 5/);
  assert.match(m.text, /Got worse:\n- Client b: 3 to 9/);
  assert.match(m.text, /Estimate \(not a fact\)/);
  assert.equal(monthlyMessage({ who: "x", fromDay: "a", toDay: "b", accounts: [], link: "" }), null);
});

test("no vendor words in anything a person can read from this module", () => {
  const texts = [JSON.stringify(SAMPLE_HISTORY), monthlyMessage({ who: "Acme", fromDay: "2026-10-10", toDay: "2026-11-09", link: "", accounts: [{ name: "A", then: 2, now: 1 }] })?.text ?? "", changeSentence(SAMPLE_HISTORY.thenNow!, "2026-10-12", "baseline") ?? ""];
  for (const t of texts) assert.doesNotMatch(t, /gohighlevel|highlevel|\bghl\b|sub-?account/i);
});
