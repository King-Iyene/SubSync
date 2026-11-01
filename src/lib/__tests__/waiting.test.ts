import assert from "node:assert/strict";
import { test } from "node:test";
import { channelCounts, channelLabel, waitingState, WAITING_WINDOW_DAYS } from "../analytics/waiting.ts";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const H = 3_600_000;
const conv = (direction: string | null, hoursAgo: number | null, type: string | null = "TYPE_SMS") => ({ direction, at: hoursAgo === null ? null : NOW - hoursAgo * H, type });

test("a customer message past the reply target is waiting; inside it is pending", () => {
  assert.equal(waitingState(conv("inbound", 5), NOW, 4), "waiting");
  assert.equal(waitingState(conv("inbound", 3), NOW, 4), "pending");
  assert.equal(waitingState(conv("inbound", 4), NOW, 4), "pending", "exactly at the target is not yet over it");
  assert.equal(waitingState(conv("inbound", 4.01), NOW, 4), "waiting");
});

test("one window: older than 30 days is stale, not waiting, everywhere", () => {
  assert.equal(WAITING_WINDOW_DAYS, 30);
  assert.equal(waitingState(conv("inbound", 29 * 24), NOW, 4), "waiting");
  assert.equal(waitingState(conv("inbound", 31 * 24), NOW, 4), "stale");
});

test("a reply, an auto-reply, an internal note or a call we placed after the customer means answered (not waiting)", () => {
  assert.equal(waitingState(conv("outbound", 2), NOW, 4), "answered");
  assert.equal(waitingState(conv("outbound", 10, "TYPE_SMS"), NOW, 4), "answered", "an automatic reply looks like a reply: known limit, see METRICS.md");
  assert.equal(waitingState(conv(null, 10, "TYPE_INTERNAL_COMMENT"), NOW, 4), "answered", "an internal note is never the customer waiting");
  assert.equal(waitingState(conv("outbound", 10, "TYPE_CALL"), NOW, 4), "answered");
});

test("missing or broken data is not guessed", () => {
  assert.equal(waitingState(conv("inbound", null), NOW, 4), "none");
  assert.equal(waitingState({ direction: "inbound", at: Number.NaN, type: null }, NOW, 4), "none");
  assert.equal(waitingState(conv("inbound", -2), NOW, 4), "pending", "a time slightly in the future (clock skew) is pending, not waiting");
});

test("channels are named in words, and counted most first", () => {
  assert.equal(channelLabel("TYPE_SMS"), "Text message");
  assert.equal(channelLabel("TYPE_EMAIL"), "Email");
  assert.equal(channelLabel("TYPE_FB"), "Facebook");
  assert.equal(channelLabel("TYPE_IG"), "Instagram");
  assert.equal(channelLabel("TYPE_LIVE_CHAT"), "Live chat");
  assert.equal(channelLabel("TYPE_SOMETHING_NEW"), "Something new");
  assert.equal(channelLabel(null), "Message");
  assert.deepEqual(channelCounts(["TYPE_SMS", "TYPE_EMAIL", "TYPE_SMS", "TYPE_FB", "TYPE_SMS", "TYPE_EMAIL"]), [{ channel: "Text message", count: 3 }, { channel: "Email", count: 2 }, { channel: "Facebook", count: 1 }]);
  assert.deepEqual(channelCounts([]), []);
});
