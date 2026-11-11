import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApFlowTree, ApOutcome } from "../analytics/appointments3-types-interim.ts";
import { closerTotals, findLeak, healthTone, layoutFlow, nextLead, ratesFromOutcomes } from "../design/appt-flow-layout.ts";

const oc = (o: Partial<Record<ApOutcome, number>>): Record<ApOutcome, number> => ({ won: 0, lost: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0, ...o });
const stats = (o: Record<ApOutcome, number>) => ({ bookings: Object.values(o).reduce((a, b) => a + b, 0), ...ratesFromOutcomes(o, 5), burned: o.noshow, revenueCents: o.won * 100_000, avgLeadToBookedHours: 4 });
const closer = (id: string, o: Partial<Record<ApOutcome, number>>) => ({ id, name: `Closer ${id}`, outcomes: oc(o), ...stats(oc(o)) });
function tree(nSetters: number, nClosers: number): ApFlowTree {
  const setters = Array.from({ length: nSetters }, (_, i) => {
    const closers = Array.from({ length: nClosers }, (_, j) => closer(`c${j}`, { won: 3 + j, showed: 4, lost: 2, noshow: i + j, unmarked: j, cancelled: 1 }));
    return { id: `s${i}`, name: `Setter ${i}`, closers, hiddenClosers: 0, bookings: closers.reduce((a, c) => a + c.bookings, 0), showRate: 0.7, noShowRate: 0.2, closeRate: 0.4, burned: 5, revenueCents: 1, avgLeadToBookedHours: 3 };
  });
  const booked = setters.reduce((a, s) => a + s.bookings, 0);
  return { booked, periodLabel: "Last 30 days", setters, hiddenSetters: 0, totals: oc({}), overall: { showRate: 0.75, noShowRate: 0.15, closeRate: 0.4 }, minBookings: 5 };
}
type R = { x: number; y: number; w: number; h: number };
const overlap = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("no two nodes ever overlap, at desktop, tablet and many people", () => {
  for (const [s, c, w] of [[1, 1, 1000], [5, 3, 1000], [6, 5, 700], [12, 4, 1200]] as const) {
    const l = layoutFlow(tree(s, c), { width: w, maxClosers: 4 });
    for (let i = 0; i < l.nodes.length; i++) for (let j = i + 1; j < l.nodes.length; j++) assert.equal(overlap(l.nodes[i], l.nodes[j]), false, `${l.nodes[i].id} vs ${l.nodes[j].id} (${s}x${c}@${w})`);
    for (const n of l.nodes) assert.ok(n.x >= 0 && n.x + n.w <= l.width + 0.5 && n.y >= -0.5 && n.y + n.h <= l.height + 0.5, `${n.id} inside`);
  }
});

test("links join a parent to its child and are wider for more appointments", () => {
  const l = layoutFlow(tree(2, 2), { width: 1000 });
  const ids = new Set(l.nodes.map((n) => n.id));
  for (const k of l.links) assert.ok(ids.has(k.from) && ids.has(k.to));
  const wide = l.links.find((k) => k.id.startsWith("root>s:s0"))!, thin = l.links.find((k) => k.id.endsWith(":cancelled"))!;
  assert.ok(wide.width > thin.width);
});

test("health is relative to the agency's own rates and grey under the minimum", () => {
  const o = { showRate: 0.75, closeRate: 0.4 };
  assert.equal(healthTone({ bookings: 4, showRate: 0.9, closeRate: 0.6 }, o, 5), "grey");
  assert.equal(healthTone({ bookings: 20, showRate: null, closeRate: 0.6 }, o, 5), "grey");
  assert.equal(healthTone({ bookings: 20, showRate: 0.85, closeRate: 0.45 }, o, 5), "green");
  assert.equal(healthTone({ bookings: 20, showRate: 0.74, closeRate: 0.4 }, o, 5), "amber");
  assert.equal(healthTone({ bookings: 20, showRate: 0.6, closeRate: 0.4 }, o, 5), "red");
  assert.equal(healthTone({ bookings: 20, showRate: 0.8, closeRate: 0.2 }, o, 5), "red");
});

test("rates from outcomes follow the written definitions", () => {
  assert.deepEqual(ratesFromOutcomes(oc({ won: 2, showed: 6, noshow: 2 }), 5), { showRate: 0.8, noShowRate: 0.2, closeRate: 0.25 });
  assert.equal(ratesFromOutcomes(oc({ won: 1, noshow: 1 }), 5).showRate, null);
});

test("leak finder points at the largest no-show excess, or nothing", () => {
  const t = tree(2, 2);
  t.setters[1].closers[1] = closer("c1", { won: 2, showed: 3, noshow: 12 });
  const leak = findLeak(t);
  assert.ok(leak && leak.setterId === "s1" && leak.closerId === "c1" && leak.excess >= 3);
  const flat = tree(2, 2); flat.overall.noShowRate = 0.6;
  assert.equal(findLeak(flat), null);
});

test("closer totals add up across setters; next-lead needs two closers with enough data", () => {
  const t = tree(3, 2);
  const tot = closerTotals(t);
  assert.equal(tot.length, 2);
  assert.equal(tot.reduce((a, c) => a + c.bookings, 0), t.booked);
  assert.ok(nextLead(t));
  assert.equal(nextLead(tree(1, 1)), null);
});

import { coachingNote, money, pct, riskOf } from "../design/appt-coach.ts";
test("coaching note, risk flag and formatting", () => {
  const base = { bookings: 20, showRate: 0.5, noShowRate: 0.5, closeRate: 0.4, burned: 2, revenueCents: 0, avgLeadToBookedHours: 3, name: "Ben" };
  const o = { showRate: 0.75, noShowRate: 0.2, closeRate: 0.4 };
  assert.equal(coachingNote(base, o).tone, "red");
  assert.equal(coachingNote({ ...base, bookings: 2 }, o).tone, "grey");
  assert.equal(coachingNote({ ...base, showRate: 0.9, noShowRate: 0.1 }, o).tone, "green");
  assert.equal(riskOf({ reminderState: "none", hoursToStart: 20, flags: [], status: "booked" }).level, "high");
  assert.equal(riskOf({ reminderState: "confirmed", hoursToStart: 20, flags: [], status: "confirmed" }).level, "low");
  assert.equal(pct(null), "n/a"); assert.equal(pct(0.714), "71%"); assert.equal(money(4_800_000), "$48k"); assert.equal(money(95_000), "$950");
});
