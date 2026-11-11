import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFlowTree, buildPeople, fairness, findLeak, headlineOf, leadTimeBand, overlapMinutes, parseApptWindow, pickButton, rate, reportedShowRate, revenueAtRisk, speedBand, trueShowRate, type FlowAgg,
} from "../analytics/appointments3-intel.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const agg = (o: Partial<FlowAgg>): FlowAgg => ({ setter: "s1", closer: "c1", booked: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0, upcoming: 0, won: 0, lost: 0, open: 0, wonValue: 0, ltbMedianMin: null, ...o });
const nm = (id: string | null) => id ?? "none";

test("true show rate counts forgotten outcomes; reported does not", () => {
  assert.equal(reportedShowRate(8, 1).value, 8 / 9);
  assert.equal(trueShowRate(8, 1, 3).value, 8 / 12);
  assert.equal(trueShowRate(2, 1, 0).value, null); // under 5 outcomes: not enough data
  assert.equal(rate(3, 4).enough, false);
});

test("window: defaults, caps, bad input", () => {
  const d = parseApptWindow(null, null, NOW);
  assert.equal(d.days, 30);
  assert.equal(parseApptWindow("2026-01-01", "2026-12-31", NOW).days, 365);
  assert.equal(parseApptWindow("2024-01-01", "2026-12-31", NOW).days, 366);
  assert.ok(parseApptWindow("zzz", "2026-01-01", NOW).problem);
  assert.ok(parseApptWindow("2026-05-02", "2026-05-01", NOW).problem);
});

test("headline and the one button follow the biggest money problem", () => {
  const h = headlineOf({ unmarked: 9, trueRate: trueShowRate(71, 10, 9), reportedRate: reportedShowRate(71, 10), noshowToRecover: 2, booked: 100 });
  assert.match(h, /^9 appointments past due with no outcome; true show rate 79%/);
  assert.equal(pickButton({ unmarked: 9, noshowToRecover: 2, noDeal: 4 })?.part, "needs-outcome");
  assert.equal(pickButton({ unmarked: 0, noshowToRecover: 2, noDeal: 4 })?.part, "noshow-recovery");
  assert.equal(pickButton({ unmarked: 0, noshowToRecover: 0, noDeal: 0 }), null);
  assert.equal(headlineOf({ unmarked: 0, trueRate: rate(0, 0), reportedRate: rate(0, 0), noshowToRecover: 0, booked: 0 }), "No appointments in this period yet.");
});

test("revenue at risk is a labelled range, empty when no deals", () => {
  const e = revenueAtRisk({ value: 1000, n: 2 }, { value: 500, n: 1 });
  assert.deepEqual([e.low, e.high, e.estimate, e.enough], [1000, 1500, true, true]);
  assert.equal(revenueAtRisk({ value: 0, n: 0 }, { value: 0, n: 0 }).enough, false);
});

test("flow tree: setters, closers, leaves; counts add up; top N folds the rest", () => {
  const aggs = [
    agg({ setter: "s1", closer: "c1", booked: 20, showed: 16, noshow: 3, unmarked: 1, won: 8, lost: 4, wonValue: 8000 }),
    agg({ setter: "s1", closer: "c2", booked: 20, showed: 8, noshow: 10, unmarked: 2, won: 1, lost: 6 }),
    agg({ setter: "s2", closer: "c1", booked: 5, showed: 5 }), agg({ setter: "s3", closer: null, booked: 3, showed: 1, noshow: 2 }),
  ];
  const t = buildFlowTree(aggs, nm, { from: "a", to: "b" }, 2);
  assert.equal(t.totalBooked, 48);
  assert.equal(t.hiddenPeople, 1);
  const root = t.nodes[0];
  const setters = t.nodes.filter((n) => n.level === "setter");
  assert.equal(setters.reduce((x, n) => x + n.count, 0), root.count);
  const c1 = t.nodes.find((n) => n.id === "s:s1>c:c1")!;
  assert.equal(c1.badges!.closeRate.value, 8 / 12);
  assert.equal(t.nodes.filter((n) => n.parentId === c1.id).reduce((x, n) => (n.leaf === "showed" || n.leaf === "noshow" || n.leaf === "cancelled" || n.leaf === "unmarked" ? x + n.count : x), 0), 20);
  assert.ok(c1.best && !t.nodes.find((n) => n.id === "s:s1>c:c2")!.best);
});

test("leak finder names the closer that loses far more than the account", () => {
  const t = buildFlowTree([agg({ closer: "c1", booked: 40, showed: 36, noshow: 4 }), agg({ closer: "c2", booked: 20, showed: 8, noshow: 12 })], nm, { from: "a", to: "b" });
  const leak = findLeak(t.nodes);
  assert.ok(leak && leak.nodeId.endsWith("c:c2") && leak.lostAppointments >= 2);
  assert.equal(findLeak(buildFlowTree([agg({ booked: 40, showed: 36, noshow: 4 })], nm, { from: "a", to: "b" }).nodes), null);
});

test("people: a user in two accounts, a user in one, and an unlisted booker", () => {
  const members = [
    { locationId: "L1", userId: "u2", name: "Two Accounts" }, { locationId: "L2", userId: "u2", name: "Two Accounts" },
    { locationId: "L1", userId: "u1", name: "One Account" },
  ];
  const accounts = new Map<string, string | null>([["L1", "Acme"], ["L2", "Beta"]]);
  const rows = buildPeople(members, [{ locationId: "L1", userId: "u2", n: 4, lastAt: "2026-11-01T10:00:00Z" }, { locationId: "L2", userId: "ghost", n: 3, lastAt: null }], accounts, (id) => `Team member ${id}`);
  const by = new Map(rows.map((r) => [r.userId, r]));
  // u2 booked in Acme only: idle in Beta (a member there), but not idle everywhere
  assert.equal(by.get("u2")?.bookings, 4); assert.deepEqual(by.get("u2")?.idleIn, ["Beta"]); assert.equal(by.get("u2")?.idleEverywhere, false); assert.equal(by.get("u2")?.accounts.length, 2);
  // u1 is idle in their one account, zero everywhere
  assert.equal(by.get("u1")?.idleEverywhere, true); assert.deepEqual(by.get("u1")?.idleIn, ["Acme"]);
  // an unlisted booker is shown but never called idle and is marked as not in the team list
  assert.equal(by.get("ghost")?.inTeamList, false); assert.equal(by.get("ghost")?.idleEverywhere, false); assert.deepEqual(by.get("ghost")?.idleIn, []);
  // one account chosen: only that account's rows are passed in, so u2 is a single-account person and u1 is the only idle one
  const one = buildPeople(members.filter((m) => m.locationId === "L1"), [{ locationId: "L1", userId: "u2", n: 4, lastAt: null }], accounts, (id) => id);
  assert.equal(one.find((r) => r.userId === "u2")?.accounts.length, 1); assert.equal(one.filter((r) => r.idleEverywhere).length, 1);
});

test("adapts without code changes: a new user, calendar-less booking or setter changes the output", () => {
  const before = buildPeople([{ locationId: "L1", userId: "a", name: "A" }], [{ locationId: "L1", userId: "a", n: 2, lastAt: null }], new Map([["L1", "Acme"]]), (i) => i);
  const after = buildPeople([{ locationId: "L1", userId: "a", name: "A" }, { locationId: "L1", userId: "new", name: "New Hire" }], [{ locationId: "L1", userId: "a", n: 2, lastAt: null }], new Map([["L1", "Acme"]]), (i) => i);
  assert.equal(before.length, 1); assert.equal(after.length, 2);
  assert.equal(after.find((r) => r.userId === "new")?.bookings, 0); // appears with zero bookings until they book
  const tA = buildFlowTree([agg({ setter: "a", booked: 5, showed: 5 })], nm, { from: "a", to: "b" });
  const tB = buildFlowTree([agg({ setter: "a", booked: 5, showed: 5 }), agg({ setter: "new", closer: "c9", booked: 3, showed: 2, noshow: 1 })], nm, { from: "a", to: "b" });
  assert.equal(tA.nodes.filter((n) => n.level === "setter").length, 1);
  assert.equal(tB.nodes.filter((n) => n.level === "setter").length, 2); assert.equal(tB.totalBooked, 8);
});

test("flow tree pages through many people (top N, See all) without losing anyone", () => {
  const aggs = Array.from({ length: 40 }, (_, i) => agg({ setter: `s${i}`, booked: 100 - i, showed: 50 }));
  const p1 = buildFlowTree(aggs, nm, { from: "a", to: "b" }, 12, null, 0), p2 = buildFlowTree(aggs, nm, { from: "a", to: "b" }, 12, null, 12);
  const ids = (t: typeof p1) => t.nodes.filter((n) => n.level === "setter" && n.id !== "s:others").map((n) => n.userId);
  assert.equal(ids(p1).length, 12); assert.equal(ids(p2).length, 12); assert.equal(p1.hiddenPeople, 28); assert.equal(p2.hiddenPeople, 16);
  assert.equal(new Set([...ids(p1), ...ids(p2)]).size, 24); assert.equal(ids(p1)[0], "s0"); assert.equal(ids(p2)[0], "s12");
});

test("overlap, fairness and bands", () => {
  const t = (h: number, m = 0) => Date.UTC(2026, 10, 10, h, m);
  assert.equal(overlapMinutes({ start: t(9), end: t(10) }, { start: t(9, 30), end: t(10, 30) }), 30);
  assert.equal(overlapMinutes({ start: t(9), end: t(10) }, { start: t(10), end: t(11) }), 0);
  assert.equal(fairness([30, 5]).maxSharePct, 86);
  assert.equal(fairness([3, 2]).enough, false);
  assert.deepEqual([speedBand(null), speedBand(2), speedBand(10), speedBand(90), speedBand(500)], ["none", "under_5m", "5_to_30m", "30m_to_2h", "over_2h"]);
  assert.equal(leadTimeBand(0.2), "Same day");
  assert.equal(leadTimeBand(10), "A week or more");
});
