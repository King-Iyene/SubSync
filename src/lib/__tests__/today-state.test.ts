import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyView, canAssign, DONE_HOLD_DAYS, heldSpec, isJunk, isSnoozeChoice, junkDaysOf, lanesFor, parseRowKey, resolveEvents, snoozeUntil, type ActionEvent,
} from "../analytics/today-state.ts";
import { briefLines, emptyTotals, headlineOf, KINDS, type AccountFacts, type Kind, type TodayItem, type Totals } from "../analytics/today-queue.ts";

// The working queue (Done, Snooze, Assign, Undo) and the junk control, applied to Today's items. Pure.
const NOW = Date.parse("2026-11-04T12:00:00Z"); // a Wednesday
const H = 3_600_000, D = 86_400_000;
const ACCOUNTS: AccountFacts[] = [{ id: "aaa", name: "Maple Dental", followUpEstimate: null, url: "u" }, { id: "bbb", name: "Harbor Realty", followUpEstimate: null, url: "u" }];
let n = 0;
const item = (kind: Kind, loc: string, over: Partial<TodayItem> = {}): TodayItem => ({ id: `${kind}:${n++}`, kind, locationId: loc, accountName: loc === "aaa" ? "Maple Dental" : "Harbor Realty", name: "Someone", detail: "", at: NOW - 2 * H, value: null, contactId: "c", url: "u", ...over });
const totals = (items: TodayItem[], extra: Partial<Record<Kind, number>> = {}): Totals => {
  const t = emptyTotals();
  for (const k of KINDS) { const m = items.filter((x) => x.kind === k); t[k] = { count: m.length + (extra[k] ?? 0), dollars: k === "stale" && m.length ? m.reduce((s, x) => s + (x.value ?? 0), 0) : null, shown: m.length }; }
  return t;
};
const ev = (over: Partial<ActionEvent>): ActionEvent => ({ id: 1, rowKey: "aaa|replies", locationId: "aaa", kind: "replies", action: "snooze", lane: "team", actorKey: "u1", actorName: "Dana", until: NOW + D, undoes: null, itemIds: [], at: NOW - 60_000, ...over });

test("snooze hides items until it ends, then they come back by themselves", () => {
  const e = ev({ itemIds: ["a", "b"], until: NOW + H });
  assert.deepEqual(Object.keys(resolveEvents([e], NOW, ["team"]).holds).sort(), ["a", "b"]);
  assert.deepEqual(resolveEvents([e], NOW + 2 * H, ["team"]).holds, {});
});

test("done holds for seven days and then returns if the CRM still shows it wrong", () => {
  const e = ev({ action: "done", until: null, itemIds: ["a"], at: NOW });
  assert.ok(resolveEvents([e], NOW + (DONE_HOLD_DAYS - 1) * D, ["team"]).holds.a);
  assert.equal(resolveEvents([e], NOW + (DONE_HOLD_DAYS + 1) * D, ["team"]).holds.a, undefined);
});

test("undo cancels the event it points at and nothing else", () => {
  const events = [ev({ id: 1, itemIds: ["a"] }), ev({ id: 2, itemIds: ["b"] }), ev({ id: 3, action: "undo", undoes: 1, itemIds: [] })];
  assert.deepEqual(Object.keys(resolveEvents(events, NOW, ["team"]).holds), ["b"]);
});

test("the latest active event wins for an item, and an assignment never hides anything", () => {
  const events = [ev({ id: 1, itemIds: ["a"], until: NOW + H }), ev({ id: 2, action: "done", until: null, itemIds: ["a"], actorName: "Priya" }), ev({ id: 3, action: "assign", itemIds: ["a"], actorName: "Dana", at: NOW - 1000 })];
  const r = resolveEvents(events, NOW, ["team"]);
  assert.equal(r.holds.a.action, "done");
  assert.equal(r.holds.a.by, "Priya");
  assert.equal(r.assigned["aaa|replies"].by, "Dana");
});

test("lanes: a client's staff read only their own events, and never the team's", () => {
  const team = ev({ id: 1, lane: "team", itemIds: ["a"] });
  const mine = ev({ id: 2, lane: "user:u9", itemIds: ["b"] });
  const theirs = ev({ id: 3, lane: "user:u8", itemIds: ["c"] });
  assert.deepEqual(lanesFor("client", "u9"), ["user:u9"]);
  assert.deepEqual(lanesFor("agency", "u9"), ["team"]);
  assert.deepEqual(Object.keys(resolveEvents([team, mine, theirs], NOW, lanesFor("client", "u9")).holds), ["b"]);
  assert.deepEqual(Object.keys(resolveEvents([team, mine, theirs], NOW, lanesFor("business", "u1")).holds), ["a"]);
  assert.equal(canAssign("client"), false);
  assert.equal(canAssign("agency"), true);
  assert.equal(canAssign("business"), true);
});

test("snooze choices: one day is 24 hours, Monday is the next Monday 08:00 in the account's own time", () => {
  assert.equal(snoozeUntil("day", NOW, "UTC"), NOW + D);
  assert.equal(new Date(snoozeUntil("monday", NOW, "UTC")).toISOString(), "2026-11-09T08:00:00.000Z");
  // 08:00 Monday in Lagos (UTC+1) is 07:00 UTC; an unreadable zone counts as UTC.
  assert.equal(new Date(snoozeUntil("monday", NOW, "Africa/Lagos")).toISOString(), "2026-11-09T07:00:00.000Z");
  assert.equal(new Date(snoozeUntil("monday", NOW, "Not/AZone")).toISOString(), "2026-11-09T08:00:00.000Z");
  assert.equal(isSnoozeChoice("day"), true);
  assert.equal(isSnoozeChoice("monday"), true);
  assert.equal(isSnoozeChoice("forever"), false);
});

test("a row key is a well-formed account id and one of the five kinds, nothing else", () => {
  assert.deepEqual(parseRowKey("aaa|replies"), { locationId: "aaa", kind: "replies", person: null });
  assert.deepEqual(parseRowKey("aaa|replies|c-1"), { locationId: "aaa", kind: "replies", person: "c-1" }, "one person of a replies row");
  assert.equal(parseRowKey("aaa|stale|c-1"), null, "only a replies row can name one person");
  for (const bad of ["aaa|other", "aaa", "../x|replies", "aaa|leads|x", "a|replies", "", 5, null, undefined, "aaa |replies"]) assert.equal(parseRowKey(bad), null, String(bad));
});

test("holds take items out of the totals, the queue and the headline, by exactly the rows removed (a cut list stays honest)", () => {
  const items = [item("replies", "aaa"), item("replies", "aaa"), item("replies", "bbb"), item("stale", "bbb", { value: 1000, at: NOW - 40 * D }), item("stale", "bbb", { value: 2000, at: NOW - 35 * D })];
  const t = totals(items, { replies: 10 }); // the server counted 13 leads but sent 3
  const open = applyView({ items, totals: t, accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: false });
  assert.equal(open.totals.replies.count, 13);
  assert.equal(headlineOf({ scope: "all", rows: open.queue, totals: open.totals }).accounts, 2);
  const hold = { eventId: 1, action: "snooze" as const, until: NOW + D, by: "Dana", at: NOW, rowKey: "aaa|replies" };
  const holds = { [items[0].id]: hold, [items[1].id]: hold };
  const v = applyView({ items, totals: t, accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds, excludeJunk: false });
  assert.equal(v.totals.replies.count, 11);
  assert.equal(v.held.length, 2);
  assert.ok(!v.queue.some((r) => r.key === "aaa|replies"));
  assert.equal(v.queue.find((r) => r.key === "bbb|replies")?.count, 1);
  // Every queue row's count is the number of items behind it.
  for (const r of v.queue) assert.equal(r.itemIds.length, r.count);
  assert.equal(v.totals.stale.dollars, 3000);
  const all = applyView({ items, totals: t, accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: Object.fromEntries(items.map((i) => [i.id, hold])), excludeJunk: false });
  assert.equal(all.queue.length, 0);
  assert.equal(headlineOf({ scope: "all", rows: all.queue, totals: all.totals }).allClear, false); // 10 more leads exist beyond the rows sent
});

test("junk control: a test-named or very old stale deal leaves the dollar figure, and nothing else does", () => {
  assert.equal(junkDaysOf(30), 90);
  const items = [
    item("stale", "aaa", { value: 5000, at: NOW - 40 * D }),                               // real
    item("stale", "aaa", { value: 7000, at: NOW - 120 * D }),                              // very old
    item("stale", "aaa", { value: 900, at: NOW - 40 * D, name: "Test deal (ignore)" }),    // test name
    item("replies", "aaa", { name: "Test Lead", at: NOW - 200 * D }),                        // never junk: only stale deals are
  ];
  assert.equal(isJunk(items[1], 90, NOW), true);
  assert.equal(isJunk(items[2], 90, NOW), true);
  assert.equal(isJunk(items[3], 90, NOW), false);
  const t = totals(items);
  assert.equal(t.stale.dollars, 12900);
  const on = applyView({ items, totals: t, accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: true });
  assert.equal(on.totals.stale.dollars, 5000);
  assert.equal(on.totals.stale.count, 1);
  assert.equal(on.junk.items.length, 2);
  assert.equal(on.junk.dollars, 7900);
  assert.equal(on.totals.replies.count, 1);
  const off = applyView({ items, totals: t, accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: false });
  assert.equal(off.totals.stale.dollars, 12900);
  assert.equal(off.junk.items.length, 0);
});

test("the list behind 'N snoozed' has exactly N rows, and the brief says what the headline says", () => {
  const items = [item("replies", "aaa"), item("replies", "aaa")];
  const hold = { eventId: 1, action: "done" as const, until: NOW + D, by: "Dana", at: NOW, rowKey: "aaa|replies" };
  const v = applyView({ items, totals: totals(items), accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: { [items[0].id]: hold }, excludeJunk: false });
  const s = heldSpec(v.held);
  assert.equal(s.count, 1);
  assert.equal(s.rows.length, 1);
  assert.equal(s.rows[0].cells.hold, "Done");
  assert.equal(s.rows[0].ref, 1); // the id of the action that set it aside: what "Bring back" undoes
  // Once that action is undone the row is back in the list and the counts.
  const back = applyView({ items, totals: totals(items), accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: false });
  assert.equal(back.held.length, 0);
  assert.equal(back.queue.reduce((n, r) => n + r.count, 0), 2);
  const headline = headlineOf({ scope: "all", rows: v.queue, totals: v.totals });
  const lines = briefLines({ headline, rows: v.queue, setAside: v.held.length });
  assert.equal(lines[0], headline.text);
  assert.ok(lines.some((l) => l.startsWith("1. Maple Dental")));
  assert.ok(lines.some((l) => /1 item is snoozed or marked done/.test(l)));
});

test("the one-deal sentence is worked out from the deals still counted: a junk or set-aside deal is never named as most of the money", () => {
  const items = [item("stale", "aaa", { value: 1_000_000, at: NOW - 200 * D }), item("stale", "aaa", { value: 8000, at: NOW - 40 * D }), item("stale", "aaa", { value: 6000, at: NOW - 35 * D })];
  const t = totals(items);
  const off = applyView({ items, totals: t, accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: false });
  assert.deepEqual(off.outlier, { value: 1_000_000, share: 0.99 });
  const on = applyView({ items, totals: t, accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: true });
  assert.equal(on.totals.stale.dollars, 14000);
  assert.deepEqual(on.outlier, { value: 8000, share: 0.57 }, "the $1,000,000 deal is left out, so it is never named; 8,000 of 14,000 is over half, so the guard names that one");
  const even = [item("stale", "aaa", { value: 5000, at: NOW - 40 * D }), item("stale", "aaa", { value: 5000, at: NOW - 40 * D }), item("stale", "aaa", { value: 4000, at: NOW - 40 * D })];
  assert.equal(applyView({ items: even, totals: totals(even), accounts: ACCOUNTS, staleDays: 30, now: NOW }, { holds: {}, excludeJunk: true }).outlier, null);
});
