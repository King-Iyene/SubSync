import assert from "node:assert/strict";
import { test } from "node:test";
import { agoWords, autoKinds, chooseMode, FULL_EVERY_MS, isSortedNewestFirst, liveStatus, mayCheck, nextWatermark, orderAccounts, quietRefreshDelay, QUIET_REFRESH_GAP_MS, SKEW_MS, takeFresh } from "../sync/incremental.ts";
import { emitDataChanged, noteVersion, onDataChanged, resetDataChangedForTests } from "../../app/app/data-changed.ts";

const NOW = 1_800_000_000_000;

test("the first read of an account, and a read after a day, are full; otherwise incremental", () => {
  assert.equal(chooseMode({ watermarkMs: null, lastFullMs: null, nowMs: NOW }), "full");
  assert.equal(chooseMode({ watermarkMs: NOW - 1000, lastFullMs: null, nowMs: NOW }), "full");
  assert.equal(chooseMode({ watermarkMs: NOW - 1000, lastFullMs: NOW - 3600_000, nowMs: NOW }), "incremental");
  assert.equal(chooseMode({ watermarkMs: NOW - 1000, lastFullMs: NOW - FULL_EVERY_MS - 1, nowMs: NOW }), "full");
  assert.equal(chooseMode({ watermarkMs: NOW - 1000, lastFullMs: NOW - 1000, nowMs: NOW, force: true }), "full");
});

test("the watermark sits a safety margin behind the start of the read", () => {
  assert.equal(nextWatermark(NOW), NOW - SKEW_MS);
});

test("paging stops at the first record older than the watermark and keeps the newer ones", () => {
  const wm = 1000;
  const rows = [{ u: 3000 }, { u: 2000 }, { u: 1000 }, { u: 999 }, { u: 500 }];
  const r = takeFresh(rows, (x) => x.u, wm);
  assert.deepEqual(r.fresh.map((x) => x.u), [3000, 2000, 1000]);
  assert.equal(r.reachedOld, true);
  const all = takeFresh([{ u: 5000 }, { u: 4000 }], (x) => x.u, wm);
  assert.equal(all.fresh.length, 2); assert.equal(all.reachedOld, false);
  // a record with no change time cannot be judged old: it is kept
  assert.equal(takeFresh([{ u: null as number | null }, { u: 10 }], (x) => x.u, wm).reachedOld, true);
  assert.equal(takeFresh([{ u: null as number | null }], (x) => x.u, wm).fresh.length, 1);
});

test("a page that is not newest-first is not trusted (the caller reads everything instead)", () => {
  assert.equal(isSortedNewestFirst([5, 4, null, 3, 3]), true);
  assert.equal(isSortedNewestFirst([3, 5, 4]), false);
  assert.equal(isSortedNewestFirst([]), true);
});

test("the account on screen is first, then the ones checked longest ago, at most the cap", () => {
  const checked = new Map<string, number | null>([["a", 500], ["b", null], ["c", 100], ["d", 900], ["e", 50], ["f", 10], ["g", 20]]);
  const order = orderAccounts(["a", "b", "c", "d", "e", "f", "g"], "d", checked, 5);
  assert.deepEqual(order, ["d", "b", "f", "g", "e"]);
  assert.deepEqual(orderAccounts(["a", "b"], "zzz", new Map(), 5).sort(), ["a", "b"]); // a focus that is not allowed is ignored
  assert.deepEqual(orderAccounts(["a", "b", "c"], null, new Map([["a", 3], ["b", 1], ["c", 2]]), 2), ["b", "c"]);
});

test("one account is never checked twice at once, nor within the gap", () => {
  assert.equal(mayCheck({ lastCheckedMs: null, nowMs: NOW, busy: false }), true);
  assert.equal(mayCheck({ lastCheckedMs: NOW - 5_000, nowMs: NOW, busy: false }), false);
  assert.equal(mayCheck({ lastCheckedMs: NOW - 25_000, nowMs: NOW, busy: false }), true);
  assert.equal(mayCheck({ lastCheckedMs: NOW - 25_000, nowMs: NOW, busy: true }), false);
});

test("the automatic check reads contacts and deals every time, the heavier kinds only now and then", () => {
  assert.deepEqual(autoKinds({ nowMs: NOW, conversationsSyncedMs: NOW - 30_000 }), ["contacts", "opportunities"]);
  assert.equal(autoKinds({ nowMs: NOW, conversationsSyncedMs: NOW - 10 * 60_000 }).length, 5);
  assert.equal(autoKinds({ nowMs: NOW, conversationsSyncedMs: null }).length, 5);
});

test("the header status and the age words", () => {
  assert.equal(liveStatus({ hidden: true, pending: 3, failed: false }), "paused");
  assert.equal(liveStatus({ hidden: false, pending: 3, failed: false }), "catching");
  assert.equal(liveStatus({ hidden: false, pending: 0, failed: false }), "live");
  assert.equal(liveStatus({ hidden: false, pending: 0, failed: true }), "trouble");
  assert.equal(agoWords(2_000), "just now"); assert.equal(agoWords(12_000), "12 seconds ago"); assert.equal(agoWords(150_000), "3 minutes ago");
});

test("the data-changed signal: the first version is only noted, a later one reaches every subscriber once, a manual sync always does", () => {
  resetDataChangedForTests();
  const seen: number[] = []; const seen2: number[] = [];
  const off = onDataChanged((d) => seen.push(d.version)); onDataChanged((d) => seen2.push(d.version));
  assert.equal(noteVersion(100), false);          // first answer: nothing changed from this screen's point of view
  assert.equal(noteVersion(100), false);          // same version again
  assert.equal(noteVersion(200), true);           // moved: announced
  assert.equal(noteVersion(200), false);          // announced once only
  assert.equal(emitDataChanged({ version: 5, force: true }), true); // a person pressed Sync: always, even for an old number
  assert.deepEqual(seen, [200, 5]); assert.deepEqual(seen2, [200, 5]);
  assert.equal(noteVersion(150), false);           // the manual one did not move the background version backwards
  off();
  noteVersion(300);
  assert.deepEqual(seen, [200, 5]);                // an unsubscribed screen is not called
  assert.deepEqual(seen2, [200, 5, 300]);
});

test("a subscriber that throws does not stop the others", () => {
  resetDataChangedForTests();
  let ok = 0;
  onDataChanged(() => { throw new Error("boom"); }); onDataChanged(() => { ok++; });
  emitDataChanged({ version: 1 });
  assert.equal(ok, 1);
});

test("a background change re-reads a screen at most once a minute, spread out; a person's sync is immediate", () => {
  assert.equal(quietRefreshDelay({ force: true, nowMs: NOW, lastReadMs: NOW, spread01: 0.5 }), null);
  assert.equal(quietRefreshDelay({ force: false, nowMs: NOW, lastReadMs: NOW - QUIET_REFRESH_GAP_MS - 1, spread01: 0 }), 0);
  assert.equal(quietRefreshDelay({ force: false, nowMs: NOW, lastReadMs: NOW - 10_000, spread01: 0 }), QUIET_REFRESH_GAP_MS - 10_000);
  const spread = quietRefreshDelay({ force: false, nowMs: NOW, lastReadMs: 0, spread01: 1 }) as number;
  assert.ok(spread > 0 && spread <= 3_000);
});
