import assert from "node:assert/strict";
import { test } from "node:test";
import type { Appt3CompareSide } from "../analytics/appointments3-types.ts";
import { compareRows, compareSentence } from "../design/appt-compare.ts";
import { DEFAULT_FILTERS, filtersFromParams, filtersToParams } from "../design/appt-filters.ts";

const r = (n: number, of: number) => ({ value: of >= 5 ? n / of : null, n, of, enough: of >= 5 });
const side = (o: Partial<Appt3CompareSide>): Appt3CompareSide => ({ userId: "u", name: "U", role: "booker", booked: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0, won: 0, wonValue: 0, showRate: r(0, 0), noshowRate: r(0, 0), byCalendar: [], bySource: [], byWeekday: [], ...o });

test("selecting two people renders the comparison rows from real counts", () => {
  const sides = [side({ userId: "a", name: "Ann Lee", booked: 20, showed: 15, noshow: 5, won: 3, wonValue: 3000, showRate: r(15, 20), noshowRate: r(5, 20) }), side({ userId: "b", name: "Ben Ray", booked: 10, showed: 4, noshow: 6, showRate: r(4, 10), noshowRate: r(6, 10) })];
  const rows = compareRows(sides);
  assert.deepEqual(rows.map((x) => x.label), ["Booked", "Showed up", "No-show", "No outcome yet", "Closed / won"]);
  assert.equal(rows[0].cells[0].text, "20"); assert.equal(rows[1].cells[0].win, true); assert.equal(rows[2].cells[0].win, true); // Ann shows more and misses less
  assert.match(rows[4].cells[0].text, /3.0k/); assert.equal(rows[1].cells[1].outcome, "showed"); // every count opens its appointments
  assert.equal(rows[4].cells[1].text, "none yet"); assert.equal(rows[3].cells[0].text, "none yet");
  assert.match(compareSentence(sides), /^Ann books more \(20 against 10\), and Ann shows up more often/);
});

test("a tiny sample is never called better, and missing outcomes are said in plain words", () => {
  const sides = [side({ userId: "a", name: "Josh", booked: 4, unmarked: 4, showRate: r(0, 4), noshowRate: r(0, 4) }), side({ userId: "b", name: "Mia", booked: 2, showed: 1, noshow: 1, showRate: r(1, 2), noshowRate: r(1, 2) })];
  const rows = compareRows(sides);
  assert.ok(rows.every((x) => x.cells.every((c) => !c.win) || x.label === "Booked")); // only the plain booked count can lead on small numbers
  assert.equal(rows[1].cells[0].text, "0"); assert.match(rows[1].cells[0].sub ?? "", /needs 5/);
  assert.equal(compareSentence(sides), "Josh books more (4 against 2), but Josh has no outcomes marked yet.");
});

test("filters travel in the address and come back the same", () => {
  assert.deepEqual(filtersToParams(DEFAULT_FILTERS), {});
  const f = { ...DEFAULT_FILTERS, days: 90 as const, locationId: "L1", calendarId: "c-1", userId: "u9", source: "Facebook ads", q: "kim" };
  assert.deepEqual(filtersFromParams(new URLSearchParams(filtersToParams(f))), f);
  assert.deepEqual(filtersFromParams(new URLSearchParams("ap_loc=../etc&ap_days=5")), DEFAULT_FILTERS); // junk ids and odd ranges are dropped
});

test("the worklist filters (dates, owner, booker, status, age, sort) travel in the address and come back the same", () => {
  const f = { ...DEFAULT_FILTERS, from: "2026-10-01", to: "2026-10-31", owner: "none", booker: "u2", status: "confirmed" as const, age: 7 as const, sort: "oldest" as const };
  const p = filtersToParams(f);
  assert.deepEqual(p, { ap_from: "2026-10-01", ap_to: "2026-10-31", ap_bk: "u2", ap_ow: "none", ap_st: "confirmed", ap_age: "7", ap_sort: "oldest" });
  assert.deepEqual(filtersFromParams(new URLSearchParams(p)), f);
  // junk is dropped, a backwards range is dropped, and only the allowed values come through
  assert.deepEqual(filtersFromParams(new URLSearchParams("ap_from=2026-11-05&ap_to=2026-11-01&ap_st=deleted&ap_age=4&ap_sort=drop%20table&ap_bk=../x")), DEFAULT_FILTERS);
});

test("calendar group, active and booked-on filters travel in the address and come back the same", async () => {
  const f = { ...DEFAULT_FILTERS, groupId: "xtest-g1", active: "inactive" as const, bookedFrom: "2026-10-01", bookedTo: "2026-10-07" };
  const p = filtersToParams(f);
  assert.deepEqual(p, { ap_grp: "xtest-g1", ap_act: "inactive", ap_bf: "2026-10-01", ap_bt: "2026-10-07" });
  assert.deepEqual(filtersFromParams(new URLSearchParams(p)), f);
  assert.deepEqual(filtersFromParams(new URLSearchParams("ap_grp=../x&ap_act=drop&ap_bf=2026-10-09&ap_bt=2026-10-01")), DEFAULT_FILTERS); // junk and a backwards range are dropped
  const { mapCalendar } = await import("../sync/ghl-data.ts");
  const c = mapCalendar({ id: "xtest-c1", name: "Intro call", groupId: "xtest-g1", isActive: false, calendarType: "round_robin", teamMembers: [{ userId: "xtest-u1" }, { userId: "xtest-u1" }, { userId: "xtest-u2" }] });
  assert.deepEqual(c, { id: "xtest-c1", name: "Intro call", groupId: "xtest-g1", isActive: false, calendarType: "round_robin", roundRobin: true, memberIds: ["xtest-u1", "xtest-u2"] });
});

test("date presets give whole, inclusive days (weeks start Monday) and the period before is the same length", async () => {
  const { presetRange, previousRange, rangeKey } = await import("../design/appt-filters.ts");
  const wed = Date.UTC(2026, 10, 11, 15, 0); // Wednesday 11 Nov 2026
  assert.deepEqual(presetRange("this_week", wed), { from: "2026-11-09", to: "2026-11-15" });
  assert.deepEqual(presetRange("last_week", wed), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(presetRange("next7", wed), { from: "2026-11-11", to: "2026-11-17" });
  assert.deepEqual(presetRange("last_month", wed), { from: "2026-10-01", to: "2026-10-31" });
  assert.equal(rangeKey("2026-11-11", "2026-11-11", wed), "today");
  assert.equal(rangeKey("2026-11-03", "2026-11-04", wed), "custom");
  assert.deepEqual(previousRange("2026-11-09", "2026-11-15"), { from: "2026-11-02", to: "2026-11-08" });
});

test("the manager filters travel in the address and junk is dropped", () => {
  const f = { ...DEFAULT_FILTERS, outcome: "noshow_open" as const, deal: "has" as const, stage: "Proposal", leadAge: "7" as const, contact: "returning" as const, attention: true, compare: true };
  const p = filtersToParams(f);
  assert.deepEqual(filtersFromParams(new URLSearchParams(p)), f);
  assert.deepEqual(filtersFromParams(new URLSearchParams("ap_out=drop&ap_deal=x&ap_lead=3&ap_ct=y&ap_att=2")), DEFAULT_FILTERS);
});

test("a team member with no bookings is told apart: none this period, versus never", async () => {
  const { bookingState, teamRoleLabel } = await import("../analytics/appointments3-intel.ts");
  assert.equal(bookingState(3, 3), "booked");
  assert.equal(bookingState(0, 12), "none_this_period"); // has history, nothing in these dates
  assert.equal(bookingState(0, 0), "never");
  assert.equal(teamRoleLabel("account_admin"), "Account admin");
  assert.equal(teamRoleLabel(null), "Team member");
  assert.equal(teamRoleLabel("xtest-odd"), "Team member");
});

test("the date presets reach past 90 days", async () => {
  const { presetRange } = await import("../design/appt-filters.ts");
  const wed = Date.UTC(2026, 10, 11, 15, 0);
  assert.equal(presetRange("last180", wed).from, "2026-05-16");
  assert.equal(presetRange("last365", wed).to, "2026-11-11");
});
