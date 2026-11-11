import assert from "node:assert/strict";
import test from "node:test";
import { adaptCalendars, adaptFlow, adaptList, adaptOverview, adaptRow, API_PARAM, API_PART } from "../../app/app/views/ap3/adapters.ts";
import { ownMarkers } from "../ghl/appointment-gateway.ts";

const rate = (value: number | null, n = 10) => ({ value, n, of: n, enough: value !== null });
const row = { appointmentId: "a1", locationId: "L1", accountName: "Acme", contactId: "c1", contactName: "Sam", url: null, calendarId: "k", calendarName: "Sales", startAt: "2026-11-01T10:00:00Z", endAt: null, status: "noshow", bucket: "noshow" as const, ownerId: null, ownerName: null, bookerId: "u1", bookerName: "Ada", source: null, dealStatus: null, dealValue: 1200.5, leadToBookedMinutes: null, firstReplyMinutes: null, hasConflict: true, why: null, dnd: false };

test("the API row becomes the screen row: dollars to cents, flags, hours past", () => {
  const r = adaptRow(row, Date.parse("2026-11-01T12:00:00Z"));
  assert.equal(r.id, "a1");
  assert.equal(r.status, "noshow");
  assert.equal(r.dealValueCents, 120050);
  assert.equal(r.dealStatus, "none");
  assert.equal(r.hoursPast, 2);
  assert.deepEqual(r.flags, ["double-booked", "no-deal"]);
});

test("pages count from 1 on screen and 0 in the API; part and filter names map", () => {
  const p = adaptList({ rows: [row], total: 41, page: 1, size: 20, pages: 3, truncated: false });
  assert.equal(p.page, 2);
  assert.equal(p.pageSize, 20);
  assert.equal(API_PART["proof"], "receipt");
  assert.equal(API_PART["no-show-recovery"], "noshow-recovery");
  assert.equal(API_PARAM["booker"], "setter");
  assert.equal(API_PARAM["owner"], "closer");
});

test("flow tree: setter, closer and leaves become outcomes; unknown people keep the id none", () => {
  const badges = (b: number) => ({ bookings: b, showRate: rate(0.8), noshowRate: rate(0.2), closeRate: rate(0.5), wonValue: 10, leadToBookedMedianMinutes: 120 });
  const t = adaptFlow({
    nodes: [
      { id: "root", level: "root", label: "Booked", userId: null, parentId: null, count: 10, health: 1, best: false, badges: null, open: {} },
      { id: "s1", level: "setter", label: "Ada", userId: "u1", parentId: "root", count: 10, health: 1, best: true, badges: badges(10), open: { setter: "u1" } },
      { id: "c1", level: "closer", label: "Not recorded", userId: null, parentId: "s1", count: 10, health: 1, best: false, badges: badges(10), open: { setter: "u1", closer: null } },
      { id: "l1", level: "leaf", label: "Won", userId: null, parentId: "c1", count: 4, health: null, best: false, badges: null, leaf: "won", open: {} },
      { id: "l2", level: "leaf", label: "No-show", userId: null, parentId: "c1", count: 6, health: null, best: false, badges: null, leaf: "noshow", open: {} },
    ],
    period: { from: "a", to: "b" }, totalBooked: 10, topN: 12, hiddenPeople: 0, leak: null,
  });
  assert.equal(t.setters.length, 1);
  assert.equal(t.setters[0].closers[0].id, "none");
  assert.equal(t.setters[0].closers[0].outcomes.won, 4);
  assert.equal(t.totals.noshow, 6);
  assert.equal(t.setters[0].revenueCents, 1000);
  assert.equal(t.setters[0].avgLeadToBookedHours, 2);
});

test("overview: under-minimum rates stay empty and the cards come from the other parts", () => {
  const o = adaptOverview({
    headline: "h", button: null, booked: 12, unmarked: 3, trueShowRate: rate(null), reportedShowRate: rate(0.9), noshowToRecover: 2, recoveredLast30: 0, noDealLinked: 0, upcoming: 0,
    revenueAtRisk: { value: null, low: 100, high: 300, enough: true, estimate: true, formula: "f", minNote: null }, revenueWon: { value: 0, n: 0 }, journey: [], cards: [], trend: [], windowDays: 30, dealWindowDays: 30, accounts: 1,
  }, { health: { rows: [{ locationId: "L9", accountName: "Bad Co", booked: 9, showRate: rate(0.5), cancelRate: rate(0.1), noshowRate: rate(0.4), unmarked: 0, target: 75, belowTarget: true, worstReason: null, vertical: null }], total: 1, page: 0, size: 20, pages: 1, truncated: false, verticals: [] } });
  assert.equal(o.headline.trueShowRate, null);
  assert.equal(o.headline.reportedShowRate, 0.9);
  assert.deepEqual(o.revenueAtRisk, { lowCents: 10000, highCents: 30000, basis: "f" });
  assert.equal(o.cards.worstAccount?.name, "Bad Co");
  assert.equal(o.cards.topSetter, null);
});

test("calendars: conflicts are listed, with no calendar-health guesses", () => {
  const c = adaptCalendars({
    conflicts: { rows: [{ kind: "double_booking", locationId: "L1", accountName: "Acme", calendarName: "Sales", a: row, b: { ...row, appointmentId: "a2" }, overlapMinutes: 30 }], total: 1, page: 0, size: 20, pages: 1, truncated: false },
    trend: [], roundRobin: [], capacity: [], needsPermission: false,
  });
  assert.deepEqual(c.rows.map((r) => r.kind), ["double-booking"]);
  assert.equal(c.rows[0].note, "30 minutes overlap");
});

test("our own writes leave subsync marker rows, so the echo is never team activity", () => {
  const base = { installationId: "i", locationId: "L1", actor: "u", contactId: "c1", optedIn: true, token: async () => "t" };
  const at = Date.parse("2026-11-01T10:00:00Z");
  const m = ownMarkers({ ...base, op: "update", appointmentId: "a1", patch: { status: "showed", startAt: "2026-11-02T09:30:00+01:00", assignedUserId: "u2" } }, at);
  assert.deepEqual(m.map((e) => [e.kind, e.to, e.actorKind]), [["status", "showed", "subsync"], ["time", "2026-11-02T08:30:00.000Z", "subsync"], ["owner", "u2", "subsync"]]);
  assert.equal(ownMarkers({ ...base, op: "delete", appointmentId: "a1" }, at)[0].kind, "deleted");
  assert.equal(ownMarkers({ ...base, op: "create", create: { calendarId: "k", startAt: "x", endAt: "y", assignedTo: null, title: "t", allowOverlap: false } }, at).length, 0);
  assert.equal(new Set(m.map((e) => e.key)).size, 3, "keys are unique per field");
});
