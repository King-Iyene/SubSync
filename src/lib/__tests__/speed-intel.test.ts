import assert from "node:assert/strict";
import { test } from "node:test";
import { fmtDuration, isHumanTouch, leadFromMessages, mapMessage, rankPeople, responseSeconds, summarise, type Msg, type TouchRow } from "../analytics/speed-intel.ts";

const T0 = Date.parse("2026-10-30T10:00:00Z");
const min = (n: number) => n * 60_000;
const msg = (offsetMin: number, direction: Msg["direction"], over: Partial<Msg> = {}): Msg => ({ at: T0 + min(offsetMin), direction, userId: null, source: null, type: "SMS", ...over });
const person = (offsetMin: number, userId = "u1"): Msg => msg(offsetMin, "outbound", { userId, source: "app" });
const robot = (offsetMin: number, source = "workflow"): Msg => msg(offsetMin, "outbound", { source });

test("a message is read from the platform's shape, and one with no time is dropped", () => {
  assert.deepEqual(mapMessage({ dateAdded: "2026-10-30T10:00:00Z", direction: "Inbound", userId: "u1", source: "App", messageType: "TYPE_SMS" }), { at: T0, direction: "inbound", userId: "u1", source: "app", type: "TYPE_SMS" });
  assert.equal(mapMessage({ direction: "inbound" }), null);
  assert.equal(mapMessage(null), null);
  assert.equal(mapMessage({ dateAdded: "nonsense" }), null);
  assert.equal(mapMessage({ dateAdded: T0 / 1000, direction: "outbound" })?.at, T0, "seconds are accepted");
  assert.equal(mapMessage({ dateAdded: T0, direction: "weird" })?.direction, null);
});

test("only a person using the app counts as a human touch, unless the account counts automation", () => {
  assert.equal(isHumanTouch(person(1), false), true);
  assert.equal(isHumanTouch(robot(1, "workflow"), false), false, "an automatic text is not a reply");
  assert.equal(isHumanTouch(robot(1, "campaign"), false), false);
  assert.equal(isHumanTouch(robot(1, "bulk_actions"), false), false);
  assert.equal(isHumanTouch(msg(1, "outbound", { source: "api", userId: "u1" }), false), false, "an API send is not a person");
  assert.equal(isHumanTouch(msg(1, "outbound", { source: "app" }), false), false, "no user attached");
  assert.equal(isHumanTouch(msg(1, "inbound", { userId: "u1", source: "app" }), false), false, "inbound is never a touch");
  assert.equal(isHumanTouch(robot(1), true), true, "when the account counts automation, it does");
});

test("a lead starts at the earlier of contact created and first inbound, and ends at the first human reply", () => {
  const l = leadFromMessages([msg(2, "inbound"), robot(3), person(9, "u7"), person(20, "u2")], null);
  assert.deepEqual(l, { leadAt: T0 + min(2), touchAt: T0 + min(9), touchUserId: "u7" });
  assert.equal(responseSeconds(l!), 7 * 60, "the automatic text at minute 3 did not stop the clock");
  const created = leadFromMessages([msg(10, "inbound"), person(14)], T0 + min(4));
  assert.equal(created!.leadAt, T0 + min(4), "contact creation came first");
  assert.equal(responseSeconds(created!), 10 * 60);
  const none = leadFromMessages([msg(1, "inbound"), robot(2)], null);
  assert.equal(none!.touchAt, null, "only automation so far: still waiting");
  assert.equal(leadFromMessages([], null), null, "nothing to measure");
  assert.deepEqual(leadFromMessages([], T0), { leadAt: T0, touchAt: null, touchUserId: null }, "a new contact with no messages is waiting");
  const early = leadFromMessages([person(-30), msg(1, "inbound"), person(6)], null);
  assert.equal(early!.touchAt, T0 + min(6), "a message sent before the lead existed is not its reply");
  assert.equal(leadFromMessages([robot(1), person(5)], T0, true)!.touchAt, T0 + min(1), "counting automation");
});

const row = (leadMin: number, touchMin: number | null, userId: string | null = "u1", loc = "L1"): TouchRow => ({ locationId: loc, contactId: "c" + leadMin + (touchMin ?? "x"), leadAt: T0 + min(leadMin), touchAt: touchMin === null ? null : T0 + min(touchMin), userId });

test("the summary counts late replies and leads still waiting as misses, and leaves fresh leads alone", () => {
  const now = T0 + min(200);
  const rows = [row(0, 5), row(0, 8), row(0, 10), row(0, 14), row(0, 40), row(0, null), row(195, null)];
  const s = summarise(rows, 15, now);
  assert.equal(s.leads, 6, "the lead from five minutes ago is still inside its window and is not judged");
  assert.deepEqual([s.answered, s.withinTarget, s.answeredLate, s.stillWaiting], [5, 4, 1, 1]);
  assert.equal(s.hitRate, 4 / 6);
  assert.equal(s.medianSeconds, 10 * 60);
  assert.equal(s.p90Seconds, 40 * 60);
});

test("no median or hit rate from a handful of leads", () => {
  const s = summarise([row(0, 3), row(0, 4)], 15, T0 + min(500));
  assert.equal(s.medianSeconds, null);
  assert.equal(s.hitRate, null);
  assert.equal(s.answered, 2);
});

test("people are ranked fastest first, and only with enough replies", () => {
  const rows = [
    row(0, 2, "fast"), row(0, 3, "fast"), row(0, 4, "fast"),
    row(0, 30, "slow"), row(0, 40, "slow"), row(0, 50, "slow"),
    row(0, 1, "lucky"),
    row(0, 5, null), row(0, null, "ghost"),
  ];
  const r = rankPeople(rows);
  assert.deepEqual(r.map((x) => x.userId), ["fast", "slow"], "a single reply is not a ranking, and an unnamed sender is not a person");
  assert.equal(r[0].medianSeconds, 3 * 60);
});

test("durations read like a person would say them", () => {
  assert.equal(fmtDuration(null), "none");
  assert.equal(fmtDuration(45), "45 sec");
  assert.equal(fmtDuration(300), "5 min");
  assert.equal(fmtDuration(3600), "1 h");
  assert.equal(fmtDuration(3600 + 600), "1 h 10 min");
  assert.equal(fmtDuration(86_400), "1 d");
  assert.equal(fmtDuration(86_400 + 3 * 3600), "1 d 3 h");
});
