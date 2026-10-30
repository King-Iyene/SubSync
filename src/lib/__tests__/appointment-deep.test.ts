import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appointmentValue, bestAndWorstSlot, bookingVelocity, calendarHealth, confirmationSummary, doubleBookings, fairness, followUpGaps, funnel, heatmap, localSlot,
  prepBrief, recovery, repeatNoShows, sameDayPerformance, showRateBySource, volumeForecast, type Lead,
} from "../analytics/appointment-deep.ts";
import type { Appt } from "../analytics/appointment-intel.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const DAY = 86_400_000;
let n = 0;
const ap = (daysAgo: number, status: string, o: Partial<Appt> = {}): Appt => ({
  id: `a${n++}`, locationId: "L1", calendarId: "c", calendarName: "Consult", contactId: `p${n}`, status,
  startAt: NOW - daysAgo * DAY, createdAt: NOW - (daysAgo + 2) * DAY, assignedTo: "u1", ...o,
});

test("time of week is read in the account's own time zone", () => {
  assert.deepEqual(localSlot(Date.parse("2026-10-27T15:00:00Z"), "America/New_York"), { weekday: 1, hour: 11 }, "Tuesday 11am in New York");
  assert.deepEqual(localSlot(Date.parse("2026-10-27T15:00:00Z"), "Asia/Tokyo"), { weekday: 2, hour: 0 }, "Wednesday midnight in Tokyo");
  assert.equal(localSlot(1, "Not/AZone"), null);
});

test("the heatmap finds the best and worst slot, but only from enough outcomes", () => {
  const tues10 = (status: string) => ap(3, status, { startAt: Date.parse("2026-10-27T10:00:00Z") }); // a Tuesday
  const fri16 = (status: string) => ap(3, status, { startAt: Date.parse("2026-10-23T16:00:00Z") }); // a Friday
  const list = [...Array(5)].map(() => tues10("showed")).concat([...Array(2)].map(() => tues10("noshow")), [...Array(2)].map(() => fri16("showed")), [...Array(4)].map(() => fri16("noshow")));
  const cells = heatmap(list, () => "UTC", NOW);
  const t = cells.find((c) => c.weekday === 1 && c.hour === 10)!;
  assert.equal(t.booked, 7);
  assert.equal(Math.round((t.showRate as number) * 100), 71);
  const slot = bestAndWorstSlot(cells);
  assert.equal(slot?.best.weekday, 1);
  assert.equal(slot?.worst.weekday, 4);
  assert.equal(bestAndWorstSlot(heatmap([tues10("showed")], () => "UTC", NOW)), null, "one cell with few outcomes says nothing");
});

test("repeat no-shows and recovery", () => {
  const list = [
    ap(40, "noshow", { contactId: "A" }), ap(20, "noshow", { contactId: "A" }),
    ap(30, "noshow", { contactId: "B" }), ap(25, "showed", { contactId: "B" }),
    ap(30, "noshow", { contactId: "C" }),
    ap(50, "noshow", { contactId: "D" }), ap(45, "noshow", { contactId: "D" }), ap(40, "confirmed", { contactId: "D" }),
    ap(35, "noshow", { contactId: "E" }), ap(28, "showed", { contactId: "E" }),
    ap(1, "noshow", { contactId: "F" }),
  ];
  assert.deepEqual(repeatNoShows(list).map((r) => [r.contactId, r.count]), [["A", 2], ["D", 2]], "most recent first when the counts tie");
  const r = recovery(list, NOW);
  assert.equal(r.noShows, 7, "recent no-shows get a few days to rebook and are not counted yet");
  assert.equal(r.rebooked, 4);
  assert.equal(r.showedAgain, 2);
  assert.equal(Math.round((r.rebookRate as number) * 100), 57, "4 of 7 rebooked");
});

test("booking speed by source needs enough leads before it names one", () => {
  const leads: Lead[] = [...Array(4)].map((_, i) => ({ id: `p${i}`, locationId: "L1", createdAt: NOW - 10 * DAY, source: "Facebook Ads" }));
  const list = leads.map((l, i) => ap(2, "showed", { contactId: l.id, createdAt: NOW - 7 * DAY + i }));
  const v = bookingVelocity(leads, list);
  assert.equal(v.booked, 4);
  assert.equal(v.medianDays, 3);
  assert.equal(v.bySource[0].source, "Facebook Ads");
  assert.equal(bookingVelocity(leads.slice(0, 1), list.slice(0, 1)).bySource.length, 0);
});

test("show rate by source", () => {
  const sources: Record<string, string> = { p1: "Referral", p2: "Referral", p3: "Referral", p4: "Ads", p5: "Ads", p6: "Ads" };
  const list = [ap(5, "showed", { contactId: "p1" }), ap(5, "showed", { contactId: "p2" }), ap(5, "showed", { contactId: "p3" }), ap(5, "noshow", { contactId: "p4" }), ap(5, "noshow", { contactId: "p5" }), ap(5, "showed", { contactId: "p6" })];
  const out = showRateBySource(list, (_l, c) => sources[c] ?? null, NOW);
  assert.deepEqual(out.map((o) => o.source).sort(), ["Ads", "Referral"]);
});

test("confirmations: the reminder sentence appears only when something is unconfirmed", () => {
  const list = [ap(-1, "confirmed"), ap(-1, "confirmed"), ap(-1, "new"), ap(-1, "new"), ap(-5, "new")];
  const c = confirmationSummary(list, NOW);
  assert.equal(c.next48, 4);
  assert.equal(c.unconfirmed, 2);
  assert.match(c.tomorrowAdvice ?? "", /4 appointments in the next 2 days, 2 confirmed, 2 not/);
  assert.equal(confirmationSummary([ap(-1, "confirmed")], NOW).tomorrowAdvice, null);
});

test("same-day bookings are compared with the rest", () => {
  const sameDay = [...Array(5)].map(() => ap(3, "showed", { createdAt: NOW - 3 * DAY - 3_600_000 }));
  const later = [...Array(5)].map(() => ap(3, "noshow", { createdAt: NOW - 8 * DAY }));
  const s = sameDayPerformance([...sameDay, ...later], NOW);
  assert.equal(s.sameDay.showRate, 1);
  assert.equal(s.later.showRate, 0);
});

test("fairness flags a person with far more than an even share", () => {
  const list = [...Array(24)].map(() => ap(5, "showed", { assignedTo: "mike" })).concat([...Array(6)].map(() => ap(5, "showed", { assignedTo: "lisa" })));
  const f = fairness(list, NOW);
  assert.equal(f.skewed, true);
  assert.match(f.note ?? "", /24 appointments went to one person and 6 to another/);
  const even = [...Array(10)].map(() => ap(5, "showed", { assignedTo: "mike" })).concat([...Array(10)].map(() => ap(5, "showed", { assignedTo: "lisa" })));
  assert.equal(fairness(even, NOW).skewed, false);
  assert.equal(fairness([ap(1, "showed")], NOW).note, null, "too little data to judge");
});

test("double bookings: one person two at once, one contact twice in a day", () => {
  const t = NOW + DAY;
  const list = [ap(0, "confirmed", { assignedTo: "u9", startAt: t }), ap(0, "confirmed", { assignedTo: "u9", startAt: t + 10 * 60_000 }), ap(0, "confirmed", { contactId: "X", startAt: t + 3_600_000 }), ap(0, "confirmed", { contactId: "X", startAt: t + 5 * 3_600_000 })];
  const d = doubleBookings(list, NOW);
  assert.ok(d.some((x) => x.kind === "person"));
  assert.ok(d.some((x) => x.kind === "contact"));
  assert.equal(doubleBookings([ap(0, "confirmed", { startAt: t }), ap(0, "confirmed", { startAt: t + 3 * 3_600_000 })], NOW).length, 0);
});

test("the funnel counts where leads are lost and names the biggest leak", () => {
  const leads: Lead[] = [...Array(10)].map((_, i) => ({ id: `l${i}`, locationId: "L1", createdAt: NOW - 10 * DAY, source: null }));
  const list = [
    ...[0, 1, 2, 3, 4, 5].map((i) => ap(5, i < 4 ? "showed" : "confirmed", { contactId: `l${i}` })),
  ];
  const f = funnel(leads, list, new Set(["L1:l0"]), NOW);
  assert.deepEqual(f.steps.map((s) => s.count), [10, 6, 6, 4, 1]);
  assert.match(f.biggestLeak ?? "", /lost before "Became customers"|lost before "Booked"/);
});

test("appointment value, forecast, health and follow-up gaps", () => {
  const showed = [...Array(10)].map((_, i) => ap(10 + i, "showed", { contactId: `w${i}` }));
  const val = appointmentValue(showed, new Map(showed.slice(0, 5).map((a) => [`L1:${a.contactId}`, 1000])), NOW);
  assert.equal(val.perAppointment, 500);
  const weekly = [...Array(8)].flatMap((_, w) => [...Array(4 + (w % 2))].map(() => ap(w * 7 + 2, "showed")));
  const fc = volumeForecast(weekly, NOW);
  assert.ok(fc && fc.low <= fc.expected && fc.expected <= fc.high);
  assert.equal(volumeForecast([ap(1, "showed")], NOW), null);
  assert.equal(calendarHealth({ showRate: 0.8, confirmedShare: 0.9, unmarkedShare: 0, fairnessSkewed: false }).band, "healthy");
  assert.equal(calendarHealth({ showRate: 0.3, confirmedShare: 0.2, unmarkedShare: 0.6, fairnessSkewed: true }).band, "needs work");
  const held = [...Array(6)].map((_, i) => ap(5, "showed", { contactId: `f${i}` }));
  const out = new Map([["L1:f0", NOW - 4 * DAY], ["L1:f1", NOW - 5 * DAY - 3 * 3_600_000]]);
  const gaps = followUpGaps(held, out, NOW);
  assert.equal(gaps.held, 6);
  assert.equal(gaps.withoutFollowUp, 5, "only the one contacted after the appointment counts as followed up");
});

test("the prep brief is plain sentences from known facts", () => {
  const text = prepBrief({ name: "Sarah Johnson", at: Date.parse("2026-10-31T14:00:00Z"), calendar: "Kitchen consult", source: "Facebook Ads", leadAddedAt: NOW - 3 * DAY, openDeals: 1, openValue: 45000, wonBefore: 0, previousAppointments: 0, lastReplyHours: 5, tags: ["high-value"] }, NOW);
  assert.match(text, /You are meeting Sarah Johnson/);
  assert.match(text, /first appointment/);
  assert.match(text, /Facebook Ads, 3 days ago/);
  assert.match(text, /\$45,000/);
  assert.match(text, /messaged you in the last day/);
  assert.match(text, /high-value/);
});
