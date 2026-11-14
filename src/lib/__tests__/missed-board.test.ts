import assert from "node:assert/strict";
import { test } from "node:test";
import { BUCKETS, bucketOf, followState, isBucket, isChannel, isView, isWaiting, type Followup } from "../analytics/missed-board-rules.ts";

// Missed calls and missed replies (docs/METRICS.md "Missed calls and missed replies"): an automatic text is never a person.
const H = 3_600_000;
const out = (at: number, automated: boolean, kind = "message"): Followup => ({ at, direction: "outbound", automated, kind });

test("aging buckets: under 1h, 1 to 4h, 4 to 24h, over 24h, edges belong to the older bucket", () => {
  assert.equal(bucketOf(0), "lt1h");
  assert.equal(bucketOf(H - 1), "lt1h");
  assert.equal(bucketOf(H), "h1to4");
  assert.equal(bucketOf(4 * H - 1), "h1to4");
  assert.equal(bucketOf(4 * H), "h4to24");
  assert.equal(bucketOf(24 * H - 1), "h4to24");
  assert.equal(bucketOf(24 * H), "gt24h");
  assert.deepEqual([...BUCKETS], ["lt1h", "h1to4", "h4to24", "gt24h"]);
});

test("the live proof case: a missed call, an automatic text-back, no person: still waiting", () => {
  const missed = 1_000_000;
  const later = [out(missed + 25_000, true), out(missed + 145_000, true, "failed")];
  assert.equal(followState(missed, later), "auto");
  assert.equal(isWaiting(followState(missed, later)), true);
});

test("a person calling or texting back clears it, even after an automatic text", () => {
  const missed = 5_000;
  assert.equal(followState(missed, [out(6_000, true), out(9_000, false)]), "person");
  assert.equal(followState(missed, [out(9_000, false, "call")]), "person");
  assert.equal(isWaiting("person"), false);
});

test("a failed send, an earlier message and an inbound message never count", () => {
  const missed = 10_000;
  assert.equal(followState(missed, [out(20_000, false, "failed")]), "none");
  assert.equal(followState(missed, [out(9_000, false)]), "none");
  assert.equal(followState(missed, [{ at: 20_000, direction: "inbound", automated: false, kind: "message" }]), "none");
  assert.equal(followState(missed, []), "none");
});

test("a call result logged in Call mode counts as a person", () => {
  assert.equal(followState(1_000, [], true), "person");
  assert.equal(followState(1_000, [out(2_000, true)], true), "person");
});

test("only known views, buckets and channels are accepted from the address", () => {
  assert.equal(isView("waiting"), true);
  assert.equal(isView("drop table"), false);
  assert.equal(isBucket("gt24h"), true);
  assert.equal(isBucket("x"), false);
  assert.equal(isChannel("email"), true);
  assert.equal(isChannel("call"), false);
});
