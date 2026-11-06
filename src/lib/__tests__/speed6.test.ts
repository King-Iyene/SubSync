import assert from "node:assert/strict";
import { test } from "node:test";
import { dayCounts, daysWaiting, delayReason, delayReasons, flowDots, moreCardsNote, nextStepNone, personTable, readyScore, reasonBars, velocity } from "../analytics/speed6.ts";

const DAY = 86_400_000;
const lead = (o: Record<string, unknown> = {}) => ({ locationId: "L", contactId: "c" + Math.random(), status: "waiting" as const, unassigned: false, owner: { label: "Ana" }, leadAt: Date.UTC(2026, 10, 4, 12), timeZone: "UTC", phone: "+1555", dnd: false, ...o });

test("delay reason: first match wins in a fixed order", () => {
  const base = { unassigned: false, leadAt: Date.UTC(2026, 10, 4, 12), timeZone: "UTC", phone: "+1555", dnd: false, duplicate: false, ownerWaiting: 1, busyAt: 3 };
  assert.equal(delayReason(base), null);
  assert.equal(delayReason({ ...base, unassigned: true, phone: null }), "no_owner");
  assert.equal(delayReason({ ...base, dnd: true, unassigned: true }), "dnd");
  assert.equal(delayReason({ ...base, ownerWaiting: 5 }), "owner_busy");
  assert.equal(delayReason({ ...base, leadAt: Date.UTC(2026, 10, 4, 2) }), "after_hours");
  assert.equal(delayReason({ ...base, duplicate: true, phone: null }), "duplicate");
  assert.equal(delayReason({ ...base, phone: null }), "no_phone");
});

test("delay reasons for a list: busy owner is relative to the team, answered-in-time leads get none, bars add up to the rows", () => {
  const rows = [
    ...Array.from({ length: 5 }, () => lead({ owner: { label: "Busy" } })),
    lead({ owner: { label: "Calm" } }), lead({ owner: { label: "Calm2" } }),
    lead({ unassigned: true, owner: null }), lead({ status: "within" }), lead({ owner: { label: "Calm" }, phone: null }),
  ];
  const m = delayReasons(rows);
  assert.equal(m.size, rows.length);
  assert.equal(m.get(`${rows[0].locationId}:${rows[0].contactId}`), "owner_busy");
  assert.equal(m.get(`${rows[8].locationId}:${rows[8].contactId}`), null);
  const bars = reasonBars(new Map([...m].filter(([k]) => k !== `${rows[8].locationId}:${rows[8].contactId}`)));
  assert.equal(bars.reduce((s, b) => s + b.n, 0), rows.length - 1);
  assert.equal(bars[0].key, "owner_busy"); assert.equal(bars[0].n, 5);
});

test("journey dots: the buckets plus the last step add up to the leads, every non-empty bucket keeps a dot, the dots never exceed the cap by much", () => {
  const steps = [{ step: "arrived", label: "Arrived", count: 200 }, { step: "touched", label: "First touch", count: 120 }, { step: "replied", label: "Replied", count: 60 }, { step: "booked", label: "Booked", count: 2 }, { step: "showed", label: "Showed", count: 2 }, { step: "won", label: "Won", count: 0 }];
  const f = flowDots(steps, 48);
  assert.equal(f.ends.reduce((a, b) => a + b, 0), 200);
  assert.deepEqual(f.ends, [80, 60, 58, 0, 2, 0]);
  assert.deepEqual(f.buckets.map((b) => b.n), [80, 60, 58, 2]);
  assert.ok(f.buckets.every((b) => f.dots.some((d) => d.endIdx === b.afterIdx)));
  assert.ok(f.dots.length <= 60);
  assert.equal(flowDots([{ step: "arrived", label: "Arrived", count: 0 }]).dots.length, 0);
});

test("day counts fill gaps with zeros and count each stamp once", () => {
  const from = Date.UTC(2026, 10, 1); const to = Date.UTC(2026, 10, 5);
  const d = dayCounts([from + 5, from + 7, from + 2 * DAY + 1, from - 1, to + 1], from, to);
  assert.deepEqual(d.map((x) => x.n), [2, 0, 1, 0]); assert.equal(d[0].day, "2026-11-01");
});

test("velocity: median days to booking, five bookings needed, a booking before the lead is ignored", () => {
  const t = Date.UTC(2026, 10, 1);
  const pairs = [1, 2, 2, 3, 10].map((d) => ({ leadAt: t, bookedAt: t + d * DAY }));
  assert.deepEqual(velocity(pairs), { days: 2, n: 5 });
  assert.deepEqual(velocity(pairs.slice(0, 4)), { days: null, n: 4 });
  assert.equal(velocity([...pairs, { leadAt: t, bookedAt: t - 5 * DAY }, { leadAt: t, bookedAt: null }]).n, 5);
});

test("person table: counts add up to the leads, an Unassigned row is always last, a rate needs 5 leads", () => {
  const mk = (owner: string | null, replied: boolean, booked: boolean, showed = false) => ({ owner, ownerLabel: owner ? owner.toUpperCase() : null, replied, booked, showed });
  const leads = [...Array.from({ length: 5 }, (_, i) => mk("a", i < 4, i < 2, i < 1)), mk(null, false, false), mk(null, true, true), mk("b", true, false)];
  const t = personTable(leads);
  assert.deepEqual(t.map((r) => r.name), ["A", "B", "Unassigned"]);
  assert.equal(t.reduce((s, r) => s + r.leads, 0), leads.length);
  assert.deepEqual([t[0].leads, t[0].replied, t[0].booked, t[0].showed, t[0].rate], [5, 4, 2, 1, 40]);
  assert.equal(t[1].rate, null); assert.equal(t[2].rate, null);
});

test("ready to act: money and days waiting rank, no next step is flagged when untouched and unbooked", () => {
  assert.ok(readyScore({ dollars: 10_000, waitedMinutes: 60 }) > readyScore({ dollars: 100, waitedMinutes: 60 }));
  assert.ok(readyScore({ dollars: 0, waitedMinutes: 3 * 1440 }) > readyScore({ dollars: 0, waitedMinutes: 10 }));
  assert.equal(daysWaiting(3 * 1440 + 5), 3);
  assert.equal(nextStepNone({ touched: false, booked: false }), true); assert.equal(nextStepNone({ touched: true, booked: false }), false); assert.equal(nextStepNone({ touched: false, booked: true }), false);
  assert.equal(moreCardsNote(0), null); assert.equal(moreCardsNote(1), "1 more card needs more data"); assert.equal(moreCardsNote(3), "3 more cards need more data");
});

test("one date and time reading: weekday, day, month, 12-hour time and the zone abbreviation", async () => {
  const { fmtWhen } = await import("../analytics/speed6.ts");
  assert.equal(fmtWhen(Date.UTC(2026, 10, 3, 12), "Africa/Lagos"), "Tue 3 Nov, 1:00 pm GMT+1");
  assert.match(fmtWhen(Date.UTC(2026, 10, 3, 18), "America/New_York"), /^Tue 3 Nov, 1:00 pm E[SD]T$/);
  assert.equal(fmtWhen(Date.UTC(2026, 10, 3, 12), null), "Tue 3 Nov, 12:00 pm UTC");
});
