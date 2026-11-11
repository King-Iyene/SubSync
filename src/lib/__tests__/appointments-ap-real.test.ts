import assert from "node:assert/strict";
import { test } from "node:test";
import type { Appt3CompareSide } from "../analytics/appointments3-types.ts";
import { compareRows } from "../design/appt-compare.ts";
import { DEFAULT_FILTERS, filtersFromParams, filtersToParams } from "../design/appt-filters.ts";

const r = (n: number, of: number) => ({ value: of >= 5 ? n / of : null, n, of, enough: of >= 5 });
const side = (o: Partial<Appt3CompareSide>): Appt3CompareSide => ({ userId: "u", name: "U", role: "booker", booked: 0, showed: 0, noshow: 0, cancelled: 0, unmarked: 0, won: 0, wonValue: 0, showRate: r(0, 0), noshowRate: r(0, 0), byCalendar: [], bySource: [], byWeekday: [], ...o });

test("selecting two people renders the comparison rows from real counts", () => {
  const rows = compareRows([side({ userId: "a", name: "Ann", booked: 20, showed: 15, noshow: 5, won: 3, wonValue: 3000, showRate: r(15, 20), noshowRate: r(5, 20) }), side({ userId: "b", name: "Ben", booked: 10, showed: 4, noshow: 6, showRate: r(4, 10), noshowRate: r(6, 10) })]);
  assert.deepEqual(rows.map((x) => x.label), ["Booked", "Showed", "No-show", "Deals won"]);
  assert.equal(rows[0].cells[0], "20"); assert.equal(rows[1].better, 0); assert.equal(rows[2].better, 0); // Ann shows more and misses less
  assert.match(rows[3].cells[0], /3.0k/); assert.equal(rows[1].counts[1]?.outcome, "showed"); // every count opens its appointments
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
