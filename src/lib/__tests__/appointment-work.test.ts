import assert from "node:assert/strict";
import { test } from "node:test";
import { needsOutcome, noShowRecovery, type Appt } from "../analytics/appointment-intel.ts";
import {
  compareBy, headlineOf, inOutcomeBucket, outcomeCounts, OUTCOME_BUCKETS, pageOf, parseSort, reasonFor, selectWork, showRateOf, summaryText, valueOfPeople, workLists,
  type WorkItem,
} from "../analytics/appointment-work.ts";

// docs/METRICS.md, "Appointments, the work lists". Pure cases: unmarked, cancelled, rebooked, tiny samples, one person with two appointments.
const NOW = Date.parse("2026-11-05T12:00:00Z");
const DAY = 86_400_000;
const H = 3_600_000;
let n = 0;
const appt = (daysAgo: number, status: string, o: Partial<Appt> = {}): Appt => ({
  id: `a${n++}`, locationId: "L1", calendarId: "c1", calendarName: "Consult", contactId: `p${n}`, status, startAt: NOW - daysAgo * DAY, createdAt: NOW - (daysAgo + 3) * DAY, assignedTo: "u1", ...o,
});

test("Needs an outcome: past by 3 hours, active, no outcome, in the last 30 days; cancelled, invalid, future and older ones are not on it", () => {
  const list = [
    appt(2, "confirmed"), appt(2, "new"), appt(5, "rescheduled"),
    appt(2, "showed"), appt(2, "noshow"), appt(2, "cancelled"), appt(2, "invalid"),
    appt(31, "confirmed"), // older than 30 days: history, not a job
    { ...appt(0, "confirmed"), startAt: NOW - 2 * H }, // still running or just ended: inside the 3 hour grace
    { ...appt(0, "confirmed"), startAt: NOW + 2 * H }, // in the future
  ];
  const w = workLists(list, NOW);
  assert.equal(w.record.length, 3);
  assert.ok(w.record.every((a) => needsOutcome(a, NOW) && a.startAt >= NOW - 30 * DAY));
});

test("No-shows to recover is exactly the rule Today uses: last 14 days, and not when the person booked again", () => {
  const rebooked = appt(3, "noshow", { contactId: "same" });
  const later = appt(-2, "confirmed", { contactId: "same" }); // booked again, two days ahead
  const cancelledLater = appt(-2, "cancelled", { contactId: "again" });
  const noshowAgain = appt(3, "noshow", { contactId: "again" });
  const list = [rebooked, later, noshowAgain, cancelledLater, appt(5, "noshow"), appt(20, "noshow")];
  const w = workLists(list, NOW);
  assert.deepEqual(w.recover.map((a) => a.id).sort(), [noshowAgain.id, list[4].id].sort(), "a cancelled booking is not a rebooking; 20 days ago is too old");
  assert.deepEqual(w.recover.map((a) => a.id), noShowRecovery(list, NOW, 14).map((a) => a.id), "same function, same rows");
});

test("Coming up that may not show: next 7 days, not confirmed or missed their last one; each reason is said", () => {
  const missed = appt(10, "noshow", { contactId: "m" });
  const list = [
    missed,
    appt(-1, "new", { contactId: "x" }),
    appt(-1, "confirmed", { contactId: "m" }), // confirmed, but missed the last one
    appt(-2, "confirmed", { contactId: "fine" }), // nothing shaky
    appt(-3, "new", { contactId: "m" }), // both reasons
    appt(-8, "new", { contactId: "far" }), // beyond 7 days
    appt(-1, "cancelled", { contactId: "gone" }),
  ];
  const w = workLists(list, NOW);
  assert.equal(w.upcoming.length, 3);
  assert.deepEqual(w.upcoming.map((u) => u.why.slice().sort().join("+")).sort(), ["missed_before", "missed_before+unconfirmed", "unconfirmed"]);
  const both = w.upcoming.find((u) => u.why.length === 2)!;
  assert.match(reasonFor("upcoming", { at: both.a.startAt, now: NOW, calendar: "Consult", why: both.why, lastMissed: both.lastMissed }), /^Not confirmed yet, missed their last one on \w+ \d+ · Consult$/);
  assert.equal(w.upcoming.every((u) => u.a.startAt >= NOW), true);
});

test("the three lists never share an appointment, so the headline can add them", () => {
  const list = [appt(2, "confirmed"), appt(3, "noshow"), appt(-1, "new"), appt(-2, "confirmed"), appt(9, "showed")];
  const w = workLists(list, NOW);
  const ids = [...w.record, ...w.recover, ...w.upcoming.map((u) => u.a)].map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("true show rate: only marked appointments count, a rate needs 5, and the range says what unmarked ones could still do", () => {
  const tiny = showRateOf([appt(2, "showed"), appt(3, "showed"), appt(4, "noshow")], NOW - 30 * DAY, NOW, NOW);
  assert.equal(tiny.rate, null, "three outcomes: no rate");
  assert.equal(tiny.need, 2);
  const list = [...Array(6)].map(() => appt(4, "showed")).concat([...Array(2)].map(() => appt(5, "noshow")), [...Array(4)].map(() => appt(6, "confirmed")), [appt(6, "cancelled"), appt(6, "invalid")]).flat();
  const r = showRateOf(list, NOW - 30 * DAY, NOW, NOW);
  assert.equal(r.outcomes, 8);
  assert.equal(r.rate, 0.75);
  assert.equal(r.unmarked, 4);
  assert.equal(r.booked, 13, "invalid is in no figure; cancelled counts as booked");
  assert.ok(r.range);
  assert.equal(Math.round(r.range!.low * 100), 50, "6 of 12 if none of the 4 showed");
  assert.equal(Math.round(r.range!.high * 100), 83, "10 of 12 if all 4 showed");
  const quiet = showRateOf([...Array(6)].map(() => appt(4, "showed")).concat(appt(4, "noshow"), appt(4, "confirmed")), NOW - 30 * DAY, NOW, NOW);
  assert.equal(quiet.range, null, "one unmarked appointment is not worth a range");
});

test("a chart bar and its list are the same rows: every outcome bucket count equals the rows of its filter", () => {
  const list = [appt(2, "showed"), appt(2, "showed"), appt(3, "noshow"), appt(4, "confirmed"), appt(4, "new"), appt(5, "cancelled"), appt(5, "invalid"), appt(40, "showed")];
  const counts = outcomeCounts(list, NOW - 30 * DAY, NOW, NOW);
  assert.deepEqual(counts, { showed: 2, noshow: 1, unmarked: 2, cancelled: 1 });
  for (const b of OUTCOME_BUCKETS) assert.equal(list.filter((a) => a.startAt >= NOW - 30 * DAY && inOutcomeBucket(a, b.key, NOW)).length, counts[b.key], b.key);
  assert.equal(list.some((a) => a.status === "invalid" && OUTCOME_BUCKETS.some((b) => inOutcomeBucket(a, b.key, NOW))), false, "invalid is in no bar");
});

const item = (o: Partial<WorkItem>): WorkItem => ({
  key: `L1:${o.id ?? n++}`, kind: "recover", id: String(n), locationId: "L1", locationName: "Acme Dental", contactId: "c", name: "Ada Lovelace", phone: "+15551234567", email: null, dnd: false, timeZone: "UTC",
  calendarId: "c1", calendar: "Consult", at: NOW - DAY, status: "noshow", assignedKey: "u1", assigned: "Dana", source: null, value: 0, reason: "", why: [], ...o,
});

test("who to call first: money first, then the freshest miss; marking goes oldest first; coming up goes soonest first", () => {
  const rec = [item({ id: "1", value: 0, at: NOW - 2 * DAY }), item({ id: "2", value: 5000, at: NOW - 9 * DAY }), item({ id: "3", value: 0, at: NOW - DAY }), item({ id: "4", value: 5000, at: NOW - 3 * DAY })];
  const q = { q: "", sort: "important" as const, location: null, user: null, calendar: null };
  assert.deepEqual(selectWork(rec, "recover", q).map((i) => i.id), ["4", "2", "3", "1"]);
  assert.deepEqual(selectWork(rec.map((i) => ({ ...i, kind: "record" as const })), "record", q).map((i) => i.id), ["2", "4", "1", "3"], "oldest first among equal money");
  const up = [item({ id: "a", kind: "upcoming", at: NOW + 3 * DAY, value: 9000 }), item({ id: "b", kind: "upcoming", at: NOW + DAY })];
  assert.deepEqual(selectWork(up, "upcoming", q).map((i) => i.id), ["b", "a"], "the one that starts first, whatever it is worth");
});

test("search finds a name, a phone, an account; filters narrow by account, person and calendar; an unknown sort falls back", () => {
  const rows = [item({ id: "1", name: "Ada Lovelace", locationId: "L1", locationName: "Acme Dental", phone: "+15551234567" }), item({ id: "2", name: "Grace Hopper", locationId: "L2", locationName: "Bright Roofing", assignedKey: "u2", calendarId: "c2", phone: null })];
  const base = { q: "", sort: "important" as const, location: null, user: null, calendar: null };
  assert.deepEqual(selectWork(rows, "all", { ...base, q: "ada" }).map((i) => i.id), ["1"]);
  assert.deepEqual(selectWork(rows, "all", { ...base, q: "(555) 123-4567" }).map((i) => i.id), ["1"], "a phone matches however it is typed");
  assert.deepEqual(selectWork(rows, "all", { ...base, q: "roofing" }).map((i) => i.id), ["2"]);
  assert.deepEqual(selectWork(rows, "all", { ...base, location: "L2" }).map((i) => i.id), ["2"]);
  assert.deepEqual(selectWork(rows, "all", { ...base, user: "u1" }).map((i) => i.id), ["1"]);
  assert.deepEqual(selectWork(rows, "all", { ...base, calendar: "c2" }).map((i) => i.id), ["2"]);
  assert.equal(parseSort("drop table"), "important");
  assert.equal(selectWork(rows, "all", { ...base, q: "12" }).length, 0, "a short number is not a phone search");
});

test("money counts each person once, even with two appointments", () => {
  const rows = [item({ contactId: "p", value: 1000 }), item({ contactId: "p", value: 1000, id: "x" }), item({ contactId: "q", value: 250 }), item({ contactId: "r", value: 0 }), item({ contactId: null, value: 400 })];
  assert.equal(valueOfPeople(rows), 1250);
});

test("paging: 150 accounts and 5,000 rows never come back in one piece", () => {
  const rows = Array.from({ length: 5000 }, (_, i) => item({ id: String(i), key: `L${i % 150}:${i}`, locationId: `L${i % 150}`, locationName: `Client ${i % 150}`, value: i % 7 }));
  const p = pageOf(rows, 3, 25);
  assert.equal(p.rows.length, 25);
  assert.equal(p.total, 5000);
  assert.equal(p.pages, 200);
  assert.equal(p.from, 76);
  assert.equal(pageOf(rows, 9999, 25).page, 199, "a page past the end is the last page");
  assert.equal(pageOf(rows, 0, 9999).rows.length, 100, "never more than 100 at a time");
  assert.equal(pageOf([], 0, 25).from, 0);
});

test("150 accounts: one line each, most to do first, a rate only from 5 marked, and the to-do equals the three lists", () => {
  const list: Appt[] = [];
  for (let a = 0; a < 150; a++) {
    for (let k = 0; k < 4; k++) list.push(appt(2 + k, k === 0 ? "noshow" : k === 1 ? "confirmed" : "showed", { locationId: `L${a}`, contactId: `c${a}-${k}`, id: `x${a}-${k}` }));
    if (a % 10 === 0) list.push(appt(-1, "new", { locationId: `L${a}`, contactId: `u${a}`, id: `up${a}` }));
  }
  const w = workLists(list, NOW);
  const rows = compareBy(list, "account", NOW - 30 * DAY, NOW, (k) => k, { record: w.record, recover: w.recover, upcoming: w.upcoming.map((u) => u.a) });
  assert.equal(rows.length, 150);
  assert.equal(rows.reduce((s, r) => s + r.todo, 0), w.record.length + w.recover.length + w.upcoming.length);
  assert.equal(rows[0].todo, 3, "accounts with an upcoming appointment first");
  assert.equal(rows.every((r) => r.rate === null), true, "3 marked each: no rate");
});

test("people: the same lists cut by who the appointment is assigned to, and one calendar-less appointment has a line", () => {
  const list = [appt(2, "confirmed", { assignedTo: "u1" }), appt(3, "noshow", { assignedTo: "u2" }), appt(4, "showed", { assignedTo: null, calendarId: null })];
  const w = workLists(list, NOW);
  const rows = compareBy(list, "person", NOW - 30 * DAY, NOW, (k) => k, { record: w.record, recover: w.recover, upcoming: [] });
  assert.deepEqual(rows.map((r) => [r.key, r.todo]).sort(), [["u1", 1], ["u2", 1], ["unassigned", 0]]);
  const cal = compareBy(list, "calendar", NOW - 30 * DAY, NOW, (k) => k, { record: w.record, recover: w.recover, upcoming: [] });
  assert.ok(cal.some((r) => r.key === "none"));
});

test("the headline: one sentence, the most valuable job first, the three add up, a calm all-clear", () => {
  const h = headlineOf({ record: 12, recover: 9, upcoming: 6, recoverValue: 0, value: 48200 });
  assert.equal(h.total, 27);
  assert.equal(h.title, "27 appointments need you.");
  assert.equal(h.action?.label, "Follow up the 9 no-shows");
  assert.match(h.line!, /9 no-shows nobody has followed up, 12 past appointments with no outcome marked and 6 appointments coming up that may not show\. The people behind them have \$48,200 of open deals\.$/);
  assert.equal(headlineOf({ record: 3, recover: 0, upcoming: 0, recoverValue: 0, value: 0 }).action?.label, "Mark 3 past appointments");
  assert.equal(headlineOf({ record: 0, recover: 0, upcoming: 1, recoverValue: 0, value: 0 }).action?.label, "Check 1 appointment coming up");
  assert.equal(headlineOf({ record: 1, recover: 1, upcoming: 0, recoverValue: 0, value: 0 }).title, "2 appointments need you.");
  const clear = headlineOf({ record: 0, recover: 0, upcoming: 0, recoverValue: 0, value: 0 });
  assert.equal(clear.action, null);
  assert.match(clear.title, /accounted for/);
  assert.doesNotMatch(JSON.stringify([h, clear]), /go\s?high\s?level|\bghl\b|sub-?accounts?|\bSLA\b/i);
});

test("the copy summary says what the screen says, and never a percentage under 5 marked", () => {
  const thin = showRateOf([appt(2, "showed")], NOW - 30 * DAY, NOW, NOW);
  const t = summaryText({ counts: { record: 1, recover: 0, upcoming: 0, recoverValue: 0, value: 0 }, rate: thin, windowWords: "the last 30 days" });
  assert.match(t, /not enough marked appointments yet \(1 of 5 needed\)/);
  assert.doesNotMatch(t, /\d+%/);
  const list = [...Array(6)].map(() => appt(4, "showed")).concat([...Array(2)].map(() => appt(5, "noshow")), [...Array(4)].map(() => appt(6, "confirmed"))).flat();
  const full = summaryText({ counts: { record: 4, recover: 2, upcoming: 0, recoverValue: 0, value: 0 }, rate: showRateOf(list, NOW - 30 * DAY, NOW, NOW), windowWords: "the last 30 days", accounts: [{ label: "Acme", record: 4, recover: 2 }] });
  assert.match(full, /True show rate 75% over the last 30 days: 6 showed, 2 no-show, 4 still have no outcome\./);
  assert.match(full, /between 50% and 83%/);
  assert.match(full, /- Acme: 2 no-shows to follow up, 4 to mark/);
});
