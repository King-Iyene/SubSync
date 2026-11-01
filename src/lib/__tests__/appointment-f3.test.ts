import assert from "node:assert/strict";
import { test } from "node:test";
import { doubleBookings, localSlot } from "../analytics/appointment-deep.ts";
import { headline, needsOutcome, rates, type Appt } from "../analytics/appointment-intel.ts";
import { normaliseAppointmentStatus } from "../sync/ghl-data.ts";

// F3 golden cases (docs/METRICS.md, "Appointments").
const NOW = Date.parse("2026-10-30T12:00:00Z");
const DAY = 86_400_000;
let n = 0;
const appt = (daysAgo: number, status: string, o: Partial<Appt> = {}): Appt => ({
  id: `f${n++}`, locationId: "L1", calendarId: "c1", calendarName: "Consult", contactId: `p${n}`, status,
  startAt: NOW - daysAgo * DAY, createdAt: NOW - (daysAgo + 3) * DAY, assignedTo: "u1", ...o,
});

test("platform status spellings are folded to one form; unknown ones are kept and stay active with no outcome", () => {
  for (const [raw, want] of [["No Show", "noshow"], ["no_show", "noshow"], ["NoShow", "noshow"], ["Showed", "showed"], ["canceled", "cancelled"], ["Cancelled", "cancelled"], ["booked", "new"], ["Confirmed", "confirmed"], ["Invalid", "invalid"], ["rescheduled", "rescheduled"]]) {
    assert.equal(normaliseAppointmentStatus(raw), want, raw);
  }
  assert.equal(needsOutcome(appt(2, "rescheduled"), NOW), true, "an unknown status is active and, once past, has no outcome");
});

test("invalid appointments are in no figure; cancelled ones count as booked but never as an outcome", () => {
  const list = [...Array(5)].map(() => appt(4, "showed")).concat([...Array(5)].map(() => appt(4, "invalid")), [appt(4, "cancelled")]);
  const r = rates(list, NOW - 30 * DAY, NOW, NOW);
  assert.equal(r.booked, 6, "5 showed + 1 cancelled; the 5 invalid ones were never real");
  assert.equal(r.cancelled, 1);
  assert.equal(r.outcomes, 5);
  assert.equal(r.showRate, 1);
  assert.equal(r.unmarked, 0);
});

test("a rescheduled appointment is one appointment, counted once at its current start", () => {
  const moved = appt(40, "showed", { id: "same", startAt: NOW - 5 * DAY }); // booked 40 days ago, moved to 5 days ago
  assert.equal(rates([moved], NOW - 30 * DAY, NOW, NOW).booked, 1);
  assert.equal(rates([moved], NOW - 60 * DAY, NOW - 30 * DAY, NOW).booked, 0, "not counted again at the old date");
});

test("show rate is computed only over appointments with an outcome; unmarked ones are reported, not guessed", () => {
  const list = [...Array(6)].map(() => appt(5, "showed")).concat([...Array(2)].map(() => appt(5, "noshow")), [...Array(12)].map(() => appt(5, "confirmed")));
  const r = rates(list, NOW - 30 * DAY, NOW, NOW);
  assert.equal(r.booked, 20);
  assert.equal(r.outcomes, 8);
  assert.equal(r.showRate, 6 / 8, "the 12 unmarked appointments are not in the rate");
  assert.equal(r.unmarked, 12);
});

test("no alarming claim from a tiny sample: no 'down 100%' and no change claim under 10 outcomes", () => {
  const none = { held: 0, noShow: 0, cancelled: 0, booked: 0, outcomes: 0, unmarked: 0, showRate: null, noShowRate: null, cancelRate: null };
  const four = { held: 3, noShow: 1, cancelled: 0, booked: 4, outcomes: 4, unmarked: 0, showRate: null, noShowRate: null, cancelRate: null };
  assert.deepEqual(headline(none, four), [], "a quiet account that booked 4 then 0 is not 'down 100%'");
  const fiveA = { ...four, held: 5, noShow: 0, outcomes: 5, showRate: 1 };
  const fiveB = { ...four, held: 1, noShow: 4, outcomes: 5, showRate: 0.2, booked: 6 };
  assert.deepEqual(headline(fiveB, fiveA), [], "5 outcomes is enough for a rate on screen but not for a claim about change");
  const prior10 = { held: 9, noShow: 1, cancelled: 0, booked: 10, outcomes: 10, unmarked: 0, showRate: 0.9, noShowRate: 0.1, cancelRate: 0 };
  const last10 = { held: 5, noShow: 5, cancelled: 0, booked: 5, outcomes: 10, unmarked: 0, showRate: 0.5, noShowRate: 0.5, cancelRate: 0 };
  const lines = headline(last10, prior10);
  assert.match(lines[0], /fell 40 points to 50%/);
  assert.match(lines[1], /down 50%/, "10 appointments is the smallest baseline for a bookings claim");
});

test("group events are not double bookings, but one person on two sessions close together is", () => {
  const at = NOW + DAY;
  const group = [1, 2, 3, 4].map((i) => appt(-1, "confirmed", { startAt: at, contactId: `g${i}`, calendarId: "class", assignedTo: "coach" }));
  assert.equal(doubleBookings(group, NOW).filter((d) => d.kind === "person").length, 0, "four people in one class is one session");
  const clash = [appt(-1, "confirmed", { startAt: at, contactId: "a", calendarId: "c1", assignedTo: "u9" }), appt(-1, "confirmed", { startAt: at + 10 * 60_000, contactId: "b", calendarId: "c2", assignedTo: "u9" })];
  assert.equal(doubleBookings(clash, NOW).filter((d) => d.kind === "person").length, 1, "one person on two calendars ten minutes apart");
});

test("'same day' for one contact is judged in the account's time zone, so 23:30 and 00:30 are two days", () => {
  // Lagos is UTC+1: 22:30Z is 23:30 and 23:30Z is 00:30 the next day, but in UTC both are the same date.
  const a = appt(-1, "confirmed", { contactId: "x", startAt: Date.parse("2026-10-31T22:30:00Z"), assignedTo: "u1", calendarId: "c1" });
  const b = appt(-1, "confirmed", { contactId: "x", startAt: Date.parse("2026-10-31T23:30:00Z"), assignedTo: "u2", calendarId: "c2" });
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(doubleBookings([a, b], now, 30 * 60_000, () => "Africa/Lagos").filter((d) => d.kind === "contact").length, 0);
  assert.equal(doubleBookings([a, b], now, 30 * 60_000, () => "UTC").filter((d) => d.kind === "contact").length, 1);
});

test("time of week is the account's local time, across midnight and a daylight-saving change", () => {
  // Weekdays are numbered Monday 0 to Sunday 6. Midnight in Lagos (UTC+1): Sunday 23:30Z is Monday 00:30 local.
  assert.deepEqual(localSlot(Date.parse("2026-11-01T23:30:00Z"), "Africa/Lagos"), { weekday: 0, hour: 0 });
  // New York clocks went back on Sunday 1 Nov 2026: the same wall clock 09:00 is 13:00Z before and 14:00Z after.
  assert.deepEqual(localSlot(Date.parse("2026-10-31T13:00:00Z"), "America/New_York"), { weekday: 5, hour: 9 }, "Saturday 09:00 EDT");
  assert.deepEqual(localSlot(Date.parse("2026-11-02T14:00:00Z"), "America/New_York"), { weekday: 0, hour: 9 }, "Monday 09:00 EST");
});
