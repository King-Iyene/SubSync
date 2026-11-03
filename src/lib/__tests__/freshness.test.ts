import assert from "node:assert/strict";
import { test } from "node:test";
import { agoText, DEMO_TEXT, freshnessOf, plainReason, type AccountFreshnessInput, type FreshnessInput } from "../sync/freshness.ts";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const acct = (id: string, min: number | null, problem: string | null = null): AccountFreshnessInput => ({ locationId: id, name: `Account ${id}`, lastSuccessAt: min === null ? null : ago(min), problem });
const input = (accounts: AccountFreshnessInput[], o: Partial<FreshnessInput> = {}): FreshnessInput => ({ now: NOW, demo: false, accounts, pendingJobs: 0, oldestPendingMinutes: null, connectionProblem: null, ...o });

test("one account, fresh: the exact sentence", () => {
  const f = freshnessOf(input([acct("A", 7)]));
  assert.equal(f.text, "Updated 7 min ago");
  assert.equal(f.state, "fresh");
  assert.equal(f.detail, null);
  assert.equal(f.syncingNote, null);
  assert.equal(f.ageMinutes, 7);
});

test("the one value is the OLDEST account, never the freshest", () => {
  const f = freshnessOf(input([acct("A", 3), acct("B", 12), acct("C", 1)]));
  assert.equal(f.text, "Updated 12 min ago");
  assert.equal(f.updatedAt, ago(12));
  assert.deepEqual(f.accounts.map((a) => a.text), ["Updated 3 min ago", "Updated 12 min ago", "Updated 1 min ago"], "per account underneath");
});

test("stale after 30 minutes changes the wording and says why", () => {
  assert.equal(freshnessOf(input([acct("A", 30)])).state, "fresh", "30 minutes exactly is still fine");
  const f = freshnessOf(input([acct("A", 45)]));
  assert.equal(f.text, "Updated 45 min ago, refresh is delayed");
  assert.equal(f.state, "delayed");
  assert.match(f.detail ?? "", /try again on its own/);
  assert.equal(freshnessOf(input([acct("A", 130)])).text, "Updated 2 hours ago, refresh is delayed");
});

test("a failed refresh is said plainly, with the account's own reason", () => {
  const f = freshnessOf(input([acct("A", 5), acct("B", 9, "The CRM did not answer in time. It will try again on its own.")]));
  assert.equal(f.state, "failing");
  assert.equal(f.text, "Updated 9 min ago, but the latest refresh failed for 1 account");
  assert.match(f.detail ?? "", /did not answer/);
  const both = freshnessOf(input([acct("A", 50, "x"), acct("B", 90, "y")]));
  assert.equal(both.text, "Updated 1 hour ago, refresh is failing");
});

test("a failure of the whole connection is stated and wins", () => {
  const f = freshnessOf(input([acct("A", 10)], { connectionProblem: "SubSync could not reach your CRM to list your accounts." }));
  assert.equal(f.state, "failing");
  assert.match(f.detail ?? "", /could not reach/);
});

test("the sync-running note appears only for a first sync or a long-running one", () => {
  // A normal 15 minute refresh: jobs queued for a minute or two. No note (UX-06).
  assert.equal(freshnessOf(input([acct("A", 14)], { pendingJobs: 6, oldestPendingMinutes: 1.2 })).syncingNote, null);
  assert.equal(freshnessOf(input([acct("A", 14)], { pendingJobs: 6, oldestPendingMinutes: 9.9 })).syncingNote, null);
  // A long-running one.
  assert.match(freshnessOf(input([acct("A", 14)], { pendingJobs: 6, oldestPendingMinutes: 14 })).syncingNote ?? "", /has been running for 14 minutes/);
  // The first sync: nothing has ever finished.
  const first = freshnessOf(input([acct("A", null)], { pendingJobs: 3, oldestPendingMinutes: 0.5 }));
  assert.equal(first.state, "first_sync");
  assert.equal(first.text, "First sync in progress");
  assert.match(first.syncingNote ?? "", /first sync is running/i);
  assert.equal(freshnessOf(input([], { pendingJobs: 1, oldestPendingMinutes: 0 })).state, "first_sync", "no accounts listed yet, first sync on its way");
});

test("nothing synced and nothing queued is stated, not hidden", () => {
  const f = freshnessOf(input([acct("A", null)]));
  assert.equal(f.state, "never");
  assert.equal(f.text, "Not synced yet");
  assert.match(f.detail ?? "", /Sync now/);
});

test("a new account in an agency that is otherwise fine does not turn the whole line red", () => {
  const f = freshnessOf(input([acct("A", 4), acct("B", null)], { pendingJobs: 2, oldestPendingMinutes: 1 }));
  assert.equal(f.state, "fresh");
  assert.equal(f.text, "Updated 4 min ago");
  assert.match(f.detail ?? "", /1 account is still being read for the first time/);
});

test("demo data says so and shows no time", () => {
  const f = freshnessOf(input([acct("A", 3000)], { demo: true }));
  assert.equal(f.state, "demo");
  assert.equal(f.text, DEMO_TEXT);
  assert.equal(f.updatedAt, null);
});

test("the same input always gives the same sentence (no clock of its own)", () => {
  const i = input([acct("A", 7), acct("B", 11)]);
  assert.deepEqual(freshnessOf(i), freshnessOf(structuredClone(i)));
});

test("agoText wording", () => {
  assert.equal(agoText(0), "just now");
  assert.equal(agoText(0.9), "just now");
  assert.equal(agoText(1), "1 min ago");
  assert.equal(agoText(59), "59 min ago");
  assert.equal(agoText(60), "1 hour ago");
  assert.equal(agoText(125), "2 hours ago");
  assert.equal(agoText(47 * 60), "47 hours ago");
  assert.equal(agoText(72 * 60), "3 days ago");
});

test("failure reasons are plain words and never carry a raw message", () => {
  assert.match(plainReason("/contacts/ returned 401"), /access to this account was refused/);
  assert.match(plainReason("/conversations/search returned 403"), /Reconnect/);
  assert.match(plainReason("/x returned 429"), /slow down/);
  assert.match(plainReason("/x returned 503"), /did not answer/);
  assert.match(plainReason("fetch failed"), /did not answer/);
  assert.match(plainReason("Token refresh conflict"), /overlapped/);
  assert.match(plainReason("Missing environment variable GHL_APP_ID"), /not fully set up/);
  assert.match(plainReason("something odd with Key (...)=(...)"), /Reading this account failed/);
  assert.match(plainReason(null), /Reading this account failed/);
  for (const raw of ["/x returned 401", "Missing environment variable GHL_APP_ID", "boom"]) assert.ok(!plainReason(raw).includes(raw), "the raw text is never repeated");
});

test("no sentence names the platform or says agency, location or sub-account", () => {
  const all = [
    freshnessOf(input([acct("A", 45, plainReason("401"))])), freshnessOf(input([acct("A", null)], { pendingJobs: 1, oldestPendingMinutes: 40 })),
    freshnessOf(input([], { connectionProblem: "SubSync's access to your CRM has not renewed" })), freshnessOf(input([acct("A", 5)], { demo: true })),
  ];
  // Only the words a person reads (not the field names, which include locationId).
  const words = all.flatMap((f) => [f.text, f.detail, f.syncingNote, ...f.accounts.flatMap((a) => [a.text, a.problem])]).join(" | ").toLowerCase();
  for (const bad of ["gohighlevel", "highlevel", "ghl", "sub-account", "location", "agency"]) assert.ok(!words.includes(bad), `no "${bad}"`);
});
