import assert from "node:assert/strict";
import { test } from "node:test";
import { channelKeys, cleanView, escapeLike, readListParams, searchTerms, toQuery } from "../analytics/unanswered-params.ts";

// The address of a list on the Unanswered screen is checked and clamped before any query runs (docs/METRICS.md "Unanswered messages, round 3").
const read = (q: string, seePeople = true) => readListParams(new URLSearchParams(q), { seePeople });

test("an empty address means the defaults: waiting for us, 20 a page, longest wait first", () => {
  const r = read("");
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.p, { tab: "us", sort: "wait", state: "active", size: 20, quiet: 24, minValue: 0, account: null, owner: null, channel: null, bucket: null, q: "", page: 0 });
});

test("only 20, 50 and 100 are page sizes; unknown choices are refused, not guessed", () => {
  for (const bad of ["size=25", "size=1000", "tab=other", "sort=drop", "state=x", "bucket=h7", "minValue=3", "quiet=5", "owner=a b", "account=../x", "channel=%3Cb%3E"]) assert.equal(read(bad).ok, false, bad);
  const r = read("size=100&tab=them&quiet=72&minValue=5000&bucket=h24&owner=mine_free&sort=value");
  assert.ok(r.ok);
});

test("a client's staff cannot narrow to a colleague, but can to 'mine', 'no owner' and 'mine and unassigned'", () => {
  assert.equal(read("owner=uSam123", false).ok, false);
  for (const o of ["me", "none", "mine_free"]) assert.equal(read(`owner=${o}`, false).ok, true);
  assert.equal(read("owner=uSam123", true).ok, true);
});

test("the page is never negative or huge; the search is cut to 80 characters", () => {
  const r = read(`page=-4&q=${"a".repeat(200)}`);
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.p.page, 0); assert.equal(r.p.q.length, 80); }
});

test("a search turns percent and underscore into letters and finds phone numbers by their digits", () => {
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
  const t = searchTerms("Ava  (555) 010");
  assert.equal(t.length, 3);
  assert.equal(t[0].digits, null);
  assert.equal(t[1].digits, "555");
  assert.equal(t[2].digits, "010");
  assert.equal(searchTerms("x ".repeat(20)).length, 6);
});

test("a channel in words maps to the platform's message types", () => {
  assert.deepEqual(channelKeys("Text message"), ["sms"]);
  assert.deepEqual(channelKeys("Facebook"), ["fb", "facebook"]);
  assert.deepEqual(channelKeys("Some New Thing"), ["some_new_thing"]);
});

test("a view keeps only known choices and never the page; the address is short and round-trips", () => {
  const v = cleanView({ tab: "them", owner: "none", page: 9, evil: "x", size: 50, q: "ava" }, { seePeople: true });
  assert.deepEqual(v, { tab: "them", sort: "wait", state: "active", size: 50, quiet: 24, minValue: 0, account: null, owner: "none", channel: null, bucket: null, q: "ava" });
  assert.deepEqual(cleanView({ size: 7 }, { seePeople: true }), {});
  assert.equal(toQuery({ tab: "us", owner: "none", size: 20 }), "owner=none");
  const back = read(toQuery(v));
  assert.ok(back.ok);
  if (back.ok) assert.deepEqual({ ...back.p, page: undefined }, { ...v, page: undefined });
});
