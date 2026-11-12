import assert from "node:assert/strict";
import { test } from "node:test";
import { callerLabel, keyOf, skipReason, type QueueItem } from "../dial/dial.ts";
import { classifyQueue, DEFAULT_CADENCE, planSession, startState, waitingLine } from "../dial/dial6.ts";

// Regression (11 Nov 2026): Call mode said "1 person ready to call", the person pressed Start calling and landed on "Session ended, 0 calls". The count only left out people who
// asked not to be contacted or had no number; calling hours (their own clock) were applied later, inside Start, which then moved the one person to "waits for a better time".
// The count, the Start button and the session must come from one rule, so they can never disagree.

const NOW = Date.UTC(2026, 10, 12, 3, 0); // 22:00 the evening before in New York, 12:00 noon in Tokyo
const item = (o: Partial<QueueItem> & { contactId: string }): QueueItem => ({ locationId: "L1", locationName: "Acme", name: "Dana Cole", phone: "+15550001111", dnd: false, timeZone: "America/New_York", openValue: 0, ageHours: 5, priority: 50, reasons: [], url: "https://x", ...o });
const base = { now: NOW, cadence: DEFAULT_CADENCE, states: new Map(), callbacks: [] as Array<{ key: string; at: number }> };

const afterHours = item({ contactId: "night", name: "Night Owl" }); // New York, 22:00: outside calling hours
const callable = item({ contactId: "noon", name: "Noon Person", timeZone: "Asia/Tokyo" }); // Tokyo, 12:00: callable now
const unknown = item({ contactId: "who", name: callerLabel({ name: null, email: null, phone: null }), phone: null, noRecord: true }); // a missed call from a number SubSync holds no record of

test("one lead outside calling hours + one callable + one unknown caller: the count is 1, the other two are accounted for and Start is on", () => {
  const c = classifyQueue([afterHours, callable, unknown], base);
  assert.deepEqual(c.ready.map((x) => x.contactId), ["noon"], "only the person who can be called NOW is ready");
  assert.deepEqual(c.waiting.map((x) => [x.contactId, x.kind]), [["night", "hours"]], "the after-hours lead waits for calling hours, shown apart");
  assert.equal(c.waiting[0].why, "opens 9:00 their time");
  assert.equal(c.waiting[0].at, Date.UTC(2026, 10, 12, 14), "9:00 in New York");
  assert.deepEqual(c.skipped.map((x) => x.contactId), ["who"], "the unknown caller has no number to dial: skipped with its own reason");
  assert.equal(c.skipped[0].block.kind, "no_phone");
  assert.match(c.skipped[0].block.text, /no record of this caller/);
  assert.equal(c.ready.length + c.waiting.length + c.skipped.length + c.texts.length, 3, "nobody is lost");
  assert.equal(startState(c).enabled, true);
  const plan = planSession([afterHours, callable, unknown], base);
  assert.equal(plan.started, true);
  if (plan.started) {
    assert.deepEqual(plan.items.map((x) => x.contactId), ["noon"], "the session holds exactly the people counted as ready");
    assert.deepEqual(plan.waiting.map((x) => x.contactId), ["night"]);
    assert.equal(plan.skipped, 1);
  }
});

test("the reported bug: the only person is outside calling hours, so nothing is ready, Start is off and no session opens (it can never end instantly)", () => {
  const c = classifyQueue([afterHours], base);
  assert.equal(c.ready.length, 0);
  const s = startState(c);
  assert.equal(s.enabled, false);
  assert.equal(s.reason, "Nobody can be called right now. 1 person is waiting for calling hours: opens 9:00 their time.");
  assert.equal(waitingLine(c.waiting), "1 person is waiting for calling hours: opens 9:00 their time.");
  const plan = planSession([afterHours], base);
  assert.equal(plan.started, false);
  if (!plan.started) assert.match(plan.reason, /Nobody can be called right now/);
  // The same person is callable once their hours open (14:00 UTC is 9:00 in New York).
  assert.equal(classifyQueue([afterHours], { ...base, now: Date.UTC(2026, 10, 12, 14, 5) }).ready.length, 1);
});

test("only an unknown caller with no number: nothing starts, the reason is plain, and the person keeps a reason of their own", () => {
  const c = classifyQueue([unknown], base);
  assert.equal(startState(c).enabled, false);
  assert.match(startState(c).reason ?? "", /cannot be called from here/);
  assert.equal(planSession([unknown], base).started, false);
});

test("an unknown caller whose number IS known is named by the number and is callable; the name rule is shared", () => {
  assert.equal(callerLabel({ name: null, email: null, phone: "+15550002222" }), "+15550002222");
  assert.equal(callerLabel({ name: null, email: "a@b.co", phone: "+1555" }), "a@b.co");
  assert.equal(callerLabel({ name: "Ada", email: "a@b.co", phone: "+1555" }), "Ada");
  assert.equal(callerLabel({ name: null, email: null, phone: null }), "Unknown caller");
  const known = item({ contactId: "n", name: callerLabel({ name: null, email: null, phone: "+15550002222" }), phone: "+15550002222", timeZone: "Asia/Tokyo" });
  assert.deepEqual(classifyQueue([known], base).ready.map((x) => x.contactId), ["n"]);
});

test("do not contact, snoozed callbacks, waiting redials, used-up tries and already-reached people are never counted as ready", () => {
  const dnd = item({ contactId: "dnd", dnd: true, timeZone: "Asia/Tokyo" });
  const snoozed = item({ contactId: "snz", timeZone: "Asia/Tokyo" });
  const redial = item({ contactId: "red", timeZone: "Asia/Tokyo" });
  const spent = item({ contactId: "spent", timeZone: "Asia/Tokyo" });
  const reached = item({ contactId: "done", timeZone: "Asia/Tokyo" });
  const states = new Map([
    [keyOf(redial), { attempts: 1, lastAt: NOW - 3_600_000, reached: false }], // tried an hour ago, the plan waits 4 hours
    [keyOf(spent), { attempts: 4, lastAt: NOW - 99 * 3_600_000, reached: false }],
    [keyOf(reached), { attempts: 1, lastAt: NOW - 99 * 3_600_000, reached: true }],
  ]);
  const o = { ...base, states, callbacks: [{ key: keyOf(snoozed), at: NOW + 6 * 3_600_000 }] };
  const c = classifyQueue([dnd, snoozed, redial, spent, reached, callable], { ...o, skipReached: true });
  assert.deepEqual(c.ready.map((x) => x.contactId), ["noon"]);
  assert.deepEqual(c.skipped.map((x) => [x.contactId, x.block.kind]).sort(), [["dnd", "dnd"], ["done", "done"]]);
  assert.deepEqual(c.waiting.map((x) => [x.contactId, x.kind]).sort(), [["red", "redial"], ["snz", "callback"]]);
  assert.deepEqual(c.texts.map((x) => x.contactId), ["spent"]);
  // A person picked by name from Today's callbacks is not held back by their own saved callback.
  assert.equal(classifyQueue([snoozed], { ...o, ignoreSnooze: true }).ready.length, 1);
  // The missed-call list does not drop someone because an old call reached them: a newer missed call is a fresh reason.
  assert.equal(classifyQueue([reached], { ...o, skipReached: false }).ready.length, 1);
  assert.equal(skipReason(dnd)?.kind, "dnd");
});

test("the waiting sentence names the reason and the opening time, in plain words", () => {
  const w = (kind: "hours" | "redial" | "callback", why = "opens 9:00 their time") => ({ kind, why });
  assert.equal(waitingLine([]), "");
  assert.equal(waitingLine([w("hours"), w("hours")]), "2 people are waiting for calling hours: opens 9:00 their time.");
  assert.equal(waitingLine([w("hours"), w("redial", "x"), w("callback", "y")]), "1 person is waiting for calling hours: opens 9:00 their time; 1 person is waiting for their next try; 1 asked for a call later.");
});
