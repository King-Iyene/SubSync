import assert from "node:assert/strict";
import { test } from "node:test";
import { breakdown, headline, needsOutcome, noShowRecovery, overview, rates, type Appt } from "../analytics/appointment-intel.ts";
import { mapAppointment, mapUser, isPermissionError } from "../sync/ghl-data.ts";
import { GhlError } from "../ghl/client.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const DAY = 86_400_000;
let n = 0;
const appt = (daysAgo: number, status: string, o: Partial<Appt> = {}): Appt => ({
  id: `a${n++}`, locationId: "L1", calendarId: "c1", calendarName: "Consult", contactId: `p${n}`, status,
  startAt: NOW - daysAgo * DAY, createdAt: NOW - (daysAgo + 3) * DAY, assignedTo: "u1", ...o,
});

test("show rate counts recorded outcomes only and needs enough of them", () => {
  const few = [appt(2, "showed"), appt(3, "noshow")];
  assert.equal(rates(few, NOW - 30 * DAY, NOW, NOW).showRate, null);
  const list = [...Array(6)].map(() => appt(5, "showed")).concat([...Array(4)].map(() => appt(6, "noshow")));
  const r = rates(list, NOW - 30 * DAY, NOW, NOW);
  assert.equal(r.showRate, 0.6);
  assert.equal(r.noShowRate, 0.4);
  assert.equal(r.booked, 10);
});

test("a past appointment still marked new or confirmed has no outcome", () => {
  assert.equal(needsOutcome(appt(1, "confirmed"), NOW), true);
  assert.equal(needsOutcome(appt(1, "new"), NOW), true);
  assert.equal(needsOutcome(appt(1, "showed"), NOW), false);
  assert.equal(needsOutcome(appt(1, "cancelled"), NOW), false);
  assert.equal(needsOutcome(appt(-1, "confirmed"), NOW), false, "a future appointment is not overdue");
  assert.equal(needsOutcome({ ...appt(0, "confirmed"), startAt: NOW - 3_600_000 }, NOW), false, "give it a few hours");
});

test("the overview finds unconfirmed appointments in the next two days and unmarked past ones", () => {
  const list = [appt(-1, "new"), appt(-1, "confirmed"), appt(-5, "new"), appt(2, "confirmed"), appt(40, "confirmed"), appt(-1, "cancelled")];
  const o = overview(list, NOW);
  assert.equal(o.unconfirmed48.length, 1);
  assert.equal(o.upcoming7, 3);
  assert.equal(o.unmarked.length, 1, "only the last 30 days count");
});

test("no-show recovery lists people not booked again, once each", () => {
  const list = [
    appt(3, "noshow", { contactId: "A" }),
    appt(5, "noshow", { contactId: "A" }),
    appt(4, "noshow", { contactId: "B" }), appt(-2, "confirmed", { contactId: "B" }),
    appt(30, "noshow", { contactId: "C" }),
    appt(2, "noshow", { contactId: "D" }), appt(1, "showed", { contactId: "D" }),
  ];
  const recover = noShowRecovery(list, NOW);
  assert.deepEqual(recover.map((a) => a.contactId), ["A"]);
});

test("breakdowns group by calendar and person with their own show rates", () => {
  const list = [...Array(5)].map(() => appt(4, "showed", { assignedTo: "u1", calendarId: "c1" })).concat([...Array(5)].map(() => appt(4, "noshow", { assignedTo: "u2", calendarId: "c2", calendarName: "Demo" })));
  const people = breakdown(list, NOW, "person");
  assert.equal(people.length, 2);
  assert.equal(people.find((p) => p.key === "u1")?.showRate, 1, "five recorded outcomes is enough to give a rate");
  assert.equal(people.find((p) => p.key === "u2")?.showRate, 0);
  const cals = breakdown(list, NOW, "calendar");
  assert.equal(cals.find((c) => c.key === "c2")?.label, "Demo");
});

test("the headline leads with what moved", () => {
  const last = { held: 6, noShow: 4, cancelled: 0, booked: 20, outcomes: 10, unmarked: 3, showRate: 0.6, noShowRate: 0.4, cancelRate: 0 };
  const prior = { held: 8, noShow: 2, cancelled: 0, booked: 10, outcomes: 10, unmarked: 0, showRate: 0.8, noShowRate: 0.2, cancelRate: 0 };
  const lines = headline(last, prior);
  assert.match(lines[0], /fell 20 points to 60%/);
  assert.match(lines[1], /up 100%/);
  assert.match(lines[2], /3 past appointments have no outcome/);
});

test("platform appointments, users and permission errors are read defensively", () => {
  const a = mapAppointment({ id: "e1", calendarId: "c", contactId: "p", appointmentStatus: "NoShow", startTime: "2026-10-29T10:00:00Z", assignedUserId: "u" });
  assert.equal(a?.status, "noshow");
  assert.equal(a?.assignedTo, "u");
  assert.equal(mapAppointment({ title: "x" }), null);
  assert.equal(mapUser({ id: "u1", firstName: "Dana", lastName: "Brooks" })?.name, "Dana Brooks");
  assert.equal(mapUser({ id: "u2", name: "Lee" })?.name, "Lee");
  assert.equal(isPermissionError(new GhlError(403, "x")), true);
  assert.equal(isPermissionError(new GhlError(401, "x")), true);
  assert.equal(isPermissionError(new GhlError(500, "x")), false);
  assert.equal(isPermissionError(new Error("x")), false);
});
