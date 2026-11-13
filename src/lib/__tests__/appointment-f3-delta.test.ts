import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BUCKETS, bucketOf, capItems, clampTarget, filterAppts, filterOptions, flagsOf, groupIn, historyLines, itemsInBucket, parseFilters, parseWindow, statusCounts, targetState, ITEM_CAP,
} from "../analytics/appointment-f3.ts";
import {
  calendarHealth, CALENDAR_SOURCE_LABEL, funnel, FUNNEL_MIN_BASE, heatmap, heatmapReadiness, showRateBySource, splitSources, type Lead,
} from "../analytics/appointment-deep.ts";
import { headline, rates, type Appt } from "../analytics/appointment-intel.ts";
import { channelWord, EXPLAIN, EXPLAINED, filterFromHash, filterIntoHash, filterQueryOf, hasApptFilter, NO_APPT_FILTER, pathWith, windowQuery } from "../design/appt-ui.ts";
import { resolveRange } from "../design/range.ts";

// F3 delta: the status breakdown, the date window, the filters, the history lines, the targets, the honest health score, the funnel and the best-times grid.
const NOW = Date.parse("2026-11-01T12:00:00Z");
const DAY = 86_400_000;
let n = 0;
const ap = (daysAgo: number, status: string, o: Partial<Appt> = {}): Appt => ({
  id: `g${n++}`, locationId: "L1", calendarId: "c1", calendarName: "Consult", contactId: `p${n}`, status,
  startAt: NOW - daysAgo * DAY, createdAt: NOW - (daysAgo + 3) * DAY, assignedTo: "u1", ...o,
});

// ---------- the status breakdown ----------

test("every status has its own bucket; an unknown one is 'other', never guessed", () => {
  assert.deepEqual(BUCKETS.map((b) => b.key), ["new", "confirmed", "showed", "noshow", "cancelled", "invalid", "other"]);
  assert.equal(bucketOf("noshow"), "noshow");
  assert.equal(bucketOf("rescheduled"), "other");
});

test("the status counts add up, invalid ones are in no total, and the bar count equals the rows of its list", () => {
  const list = [
    ...[...Array(3)].map(() => ap(5, "showed")), ...[...Array(2)].map(() => ap(5, "noshow")), ap(5, "cancelled"), ap(5, "invalid"), ap(5, "invalid"),
    ...[...Array(4)].map(() => ap(5, "confirmed")), ap(5, "rescheduled"), ap(-2, "new"),
  ];
  const c = statusCounts(list, NOW - 30 * DAY, NOW, NOW);
  assert.equal(c.total, 13, "the upcoming one starts after the window");
  assert.equal(c.byBucket.invalid, 2);
  assert.equal(c.scheduled, 11);
  assert.equal(c.scheduled, rates(list, NOW - 30 * DAY, NOW, NOW).booked, "the headline 'booked' is the same number as the rates code");
  assert.equal(c.noOutcome, 5, "4 confirmed + 1 unknown status, all past");
  assert.equal(c.noOutcome, rates(list, NOW - 30 * DAY, NOW, NOW).unmarked);
  // The chart and the list behind it are cut from the same rows: for every bucket, the count equals the rows.
  const inWindow = list.filter((a) => a.startAt >= NOW - 30 * DAY && a.startAt < NOW);
  for (const b of BUCKETS) assert.equal(itemsInBucket(inWindow, b.key).length, c.byBucket[b.key], b.label);
  assert.equal(Object.values(c.byBucket).reduce((s, x) => s + x, 0), c.total);
});

// ---------- the window ----------

test("no dates means the old window: the last 30 days against the 30 before", () => {
  const w = parseWindow({}, NOW);
  assert.equal(w.defaulted, true);
  assert.equal(w.problem, null);
  assert.deepEqual(w.current, { from: NOW - 30 * DAY, to: NOW });
  assert.deepEqual(w.compare, { from: NOW - 60 * DAY, to: NOW - 30 * DAY });
});

test("chosen dates are whole Lagos days with the end date included; the comparison is optional", () => {
  const w = parseWindow({ from: "2026-10-03", to: "2026-11-01", cmpFrom: "2026-09-03", cmpTo: "2026-10-02" }, NOW);
  assert.equal(w.defaulted, false);
  assert.equal(w.current.from, Date.parse("2026-10-02T23:00:00Z"));
  assert.equal(w.current.to, Date.parse("2026-11-01T23:00:00Z"), "the end is the start of the next day, so the last day is in");
  assert.equal(w.compare?.from, Date.parse("2026-09-02T23:00:00Z"));
  assert.equal(parseWindow({ from: "2026-10-03", to: "2026-10-05" }, NOW).compare, null);
});

test("a bad window is refused with a reason and the default is used", () => {
  for (const [q, text] of [
    [{ from: "2026-10-30", to: "2026-10-01" }, /before the start/], [{ from: "2026-10-01", to: "2026-12-25" }, /future/], [{ from: "2022-01-01", to: "2026-10-01" }, /at most 1096/],
    [{ from: "nonsense", to: "2026-10-01" }, /not understood/], [{ from: "2026-02-31", to: "2026-03-05" }, /not understood/], [{ from: "2026-10-01" }, /not understood/],
  ] as const) {
    const w = parseWindow(q, NOW);
    assert.equal(w.defaulted, true);
    assert.match(w.problem ?? "", text);
  }
  const w = parseWindow({ from: "2026-10-03", to: "2026-10-05", cmpFrom: "bad", cmpTo: "2026-09-01" }, NOW);
  assert.equal(w.compare, null);
  assert.match(w.problem ?? "", /compare/);
});

test("the server window and the card's own range agree on the dates", () => {
  const r = resolveRange({ preset: "30d", compare: "previous" }, "2026-11-01");
  const q = windowQuery(r);
  assert.equal(q, "from=2026-10-03&to=2026-11-01&cmpFrom=2026-09-03&cmpTo=2026-10-02");
  const p = new URLSearchParams(q);
  const w = parseWindow({ from: p.get("from"), to: p.get("to"), cmpFrom: p.get("cmpFrom"), cmpTo: p.get("cmpTo") }, NOW);
  assert.equal((w.current.to - w.current.from) / DAY, r.current.days);
  assert.equal(((w.compare as { from: number; to: number }).to - (w.compare as { from: number; to: number }).from) / DAY, r.compare?.days);
  assert.equal(windowQuery(null), "");
});

// ---------- the filters ----------

test("calendar, person and lead source narrow the appointments; 'unassigned' and 'unknown' are real choices", () => {
  const list = [ap(2, "showed", { calendarId: "c1", assignedTo: "u1", contactId: "a" }), ap(2, "showed", { calendarId: "c2", assignedTo: "u2", contactId: "b" }), ap(2, "noshow", { calendarId: "c2", assignedTo: null, contactId: "c" }), ap(2, "noshow", { calendarId: "c1", assignedTo: "u1", contactId: null })];
  const src: Record<string, string> = { a: "Facebook", b: "facebook", c: "Referral" };
  const sourceOf = (_l: string, c: string) => src[c] ?? null;
  assert.equal(filterAppts(list, { calendar: "c2" }, sourceOf).length, 2);
  assert.equal(filterAppts(list, { user: "u1" }, sourceOf).length, 2);
  assert.equal(filterAppts(list, { user: "unassigned" }, sourceOf).length, 1, "the one with nobody assigned");
  assert.equal(filterAppts(list, { calendar: "c1", user: "u1" }, sourceOf).length, 2, "filters combine");
  assert.equal(filterAppts(list, { source: "facebook" }, sourceOf).length, 2);
});

test("the unassigned filter means appointments with nobody assigned", () => {
  const list = [ap(2, "showed", { assignedTo: "u1" }), ap(2, "showed", { assignedTo: null }), ap(2, "noshow", { assignedTo: null })];
  assert.equal(filterAppts(list, { user: "unassigned" }, () => null).length, 2);
});

test("the source filter ignores capitals and treats a missing source as 'unknown'", () => {
  const list = [ap(2, "showed", { contactId: "a" }), ap(2, "showed", { contactId: "b" }), ap(2, "showed", { contactId: "c" }), ap(2, "showed", { contactId: null })];
  const src: Record<string, string> = { a: "Facebook", b: "facebook" };
  const sourceOf = (_l: string, c: string) => src[c] ?? null;
  assert.equal(filterAppts(list, { source: "FACEBOOK" }, sourceOf).length, 2);
  assert.equal(filterAppts(list, { source: "unknown" }, sourceOf).length, 2);
  assert.equal(filterAppts(list, {}, sourceOf).length, 4);
});

test("the filter menus list everything, most used first, with the account named only when there are several", () => {
  const list = [ap(1, "showed", { calendarId: "c1", calendarName: "Consult", assignedTo: "u1" }), ap(2, "showed", { calendarId: "c1", calendarName: "Consult", assignedTo: "u1" }), ap(3, "showed", { calendarId: "c2", calendarName: "Estimate", assignedTo: null })];
  const o = filterOptions(list, (id) => (id === "u1" ? "Dana" : "Not assigned"), () => null, () => "Acme", true);
  assert.deepEqual(o.calendars.map((c) => [c.key, c.label, c.count]), [["c1", "Consult (Acme)", 2], ["c2", "Estimate (Acme)", 1]]);
  assert.deepEqual(o.users.map((c) => c.label), ["Dana", "Not assigned"]);
  assert.equal(filterOptions(list, () => "x", () => null, () => "Acme", false).calendars[0].label, "Consult");
  assert.deepEqual(parseFilters({ calendar: "x".repeat(81), user: "u1" }), { calendar: null, user: "u1", source: null });
});

test("the filters travel in the address and in the query, and a damaged address falls back to none", () => {
  const f = { calendar: "c1", user: "u1", source: "Facebook ads" };
  const h = filterIntoHash("#appointments?r.appointments=30d", f);
  assert.deepEqual(filterFromHash(h), f);
  assert.ok(h.includes("r.appointments=30d"), "the card range is kept");
  assert.equal(filterIntoHash(h, NO_APPT_FILTER), "#appointments?r.appointments=30d");
  assert.deepEqual(filterFromHash("#appointments"), NO_APPT_FILTER);
  assert.deepEqual(filterFromHash(`#appointments?ap.calendar=${"x".repeat(200)}`), NO_APPT_FILTER);
  assert.equal(filterQueryOf(f), "calendar=c1&user=u1&source=Facebook%20ads");
  assert.equal(hasApptFilter(NO_APPT_FILTER), false);
  assert.equal(pathWith("appointments", ""), "appointments");
  assert.equal(pathWith("appointments", "a=1"), "appointments?a=1");
});

// ---------- groups, history, targets ----------

test("a calendar or person line counts the same appointments the list behind it shows", () => {
  const list = [ap(3, "showed", { calendarId: "c1" }), ap(3, "showed", { calendarId: "c1" }), ap(3, "noshow", { calendarId: "c1" }), ap(3, "invalid", { calendarId: "c1" }), ap(3, "showed", { calendarId: "c2", assignedTo: null })];
  const cal = groupIn(list, NOW - 30 * DAY, NOW, NOW, "calendar");
  const c1 = cal.find((g) => g.key === "c1")!;
  assert.equal(c1.booked, 3, "the invalid one is not counted");
  assert.equal(list.filter((a) => a.calendarId === "c1" && a.status !== "invalid" && a.startAt >= NOW - 30 * DAY).length, c1.booked);
  assert.equal(c1.showRate, null, "3 outcomes is under 5: no rate");
  assert.equal(groupIn(list, NOW - 30 * DAY, NOW, NOW, "person").find((g) => g.key === "unassigned")?.booked, 1);
});

test("history lines say what SubSync recorded in plain words, oldest first", () => {
  const lines = historyLines([
    { kind: "status", from: "confirmed", to: "noshow", at: 3 }, { kind: "created", from: null, to: "new", at: 1 },
    { kind: "time", from: "2026-10-30T10:00:00.000Z", to: "2026-10-31T11:30:00.000Z", at: 2 },
  ]);
  assert.deepEqual(lines.map((l) => l.at), [1, 2, 3]);
  assert.equal(lines[0].text, "First seen as booked.");
  assert.match(lines[1].text, /Moved from Oct 30, 10:00 AM UTC to Oct 31, 11:30 AM UTC/);
  assert.equal(lines[2].text, "Status changed from confirmed to no-show.");
  assert.deepEqual(historyLines([]), []);
});

test("the show-rate target: a whole number from 30 to 100, and nothing said without a rate", () => {
  assert.equal(clampTarget(80), 80);
  for (const bad of [29, 101, 80.5, "80", null, undefined, NaN]) assert.equal(clampTarget(bad), null, String(bad));
  assert.match(targetState(null, 75).text, /Shown once at least 5 outcomes/);
  assert.equal(targetState(0.8, 75).state, "met");
  assert.match(targetState(0.7, 75).text, /5 points below your 75% target/);
  assert.match(targetState(0.74, 75).text, /1 point below/);
});

test("list flags and the row cap", () => {
  assert.deepEqual(flagsOf(ap(2, "confirmed"), NOW), { needsOutcome: true, unconfirmedSoon: false });
  assert.deepEqual(flagsOf(ap(-1, "new"), NOW), { needsOutcome: false, unconfirmedSoon: true });
  assert.deepEqual(flagsOf(ap(-3, "new"), NOW), { needsOutcome: false, unconfirmedSoon: false }, "three days away is not 'soon'");
  const many = [...Array(ITEM_CAP + 20)].map((_, i) => i);
  assert.equal(capItems(many).length, ITEM_CAP);
  assert.equal(capItems([1, 2, 3]).length, 3);
});

// ---------- honest numbers ----------

test("a quiet account never reads 'down 100%', and a change claim names what it is compared with", () => {
  const quiet = headline(rates([], NOW - 30 * DAY, NOW, NOW), rates([ap(40, "showed"), ap(41, "showed"), ap(42, "showed"), ap(43, "showed")], NOW - 60 * DAY, NOW - 30 * DAY, NOW));
  assert.equal(quiet.some((l) => /down|100%/.test(l)), false);
  const prior = [...Array(12)].map((_, i) => ap(35 + (i % 20), "showed"));
  const now = [...Array(4)].map(() => ap(3, "showed"));
  const lines = headline(rates(now, NOW - 30 * DAY, NOW, NOW), rates(prior, NOW - 60 * DAY, NOW - 30 * DAY, NOW), "the same dates last month");
  assert.ok(lines.some((l) => /Bookings are down 67% on the same dates last month\./.test(l)), lines.join(" | "));
});

test("the health score earns no points for missing data and is n/a without at least 3 of its 4 checks", () => {
  const none = calendarHealth({ showRate: null, confirmedShare: null, unmarkedShare: null, fairnessSkewed: null });
  assert.equal(none.score, null);
  assert.equal(none.band, null);
  assert.equal(none.used, 0);
  assert.ok(none.parts.every((p) => p.points === null && /^n\/a/.test(p.note)), "every check says n/a and why");
  const two = calendarHealth({ showRate: 0.8, confirmedShare: null, unmarkedShare: 0.5, fairnessSkewed: null });
  assert.equal(two.score, null, "two checks are not enough");
  // The case the review caught: no show rate, nothing upcoming, 0% unmarked used to score 40+ points from nothing.
  const sparse = calendarHealth({ showRate: null, confirmedShare: null, unmarkedShare: 0, fairnessSkewed: false });
  assert.equal(sparse.score, null);
  const three = calendarHealth({ showRate: 0.8, confirmedShare: null, unmarkedShare: 0, fairnessSkewed: false });
  assert.equal(three.used, 3);
  assert.equal(three.score, Math.round(((32 + 20 + 15) / (40 + 20 + 15)) * 100), "scaled to the checks that have data");
  assert.equal(three.parts.find((p) => p.label === "Confirmations")?.points, null);
  assert.equal(three.parts.find((p) => p.label === "Outcomes recorded")?.note, "every past appointment has an outcome");
  assert.match(calendarHealth({ showRate: 0.8, confirmedShare: 0.9, unmarkedShare: 0.25, fairnessSkewed: false, unmarked: 3, past: 12 }).parts[2].note, /3 of 12 past appointments have no outcome recorded/);
});

test("the funnel defines a customer, names a leak only from 10 leads, and never says 100% on tiny data", () => {
  const lead = (i: number): Lead => ({ id: `l${i}`, locationId: "L1", createdAt: NOW - 5 * DAY, source: null });
  const small = funnel([lead(0), lead(1), lead(2)], [ap(2, "confirmed", { contactId: "l0" }), ap(2, "confirmed", { contactId: "l1" })], new Set(), NOW);
  assert.equal(small.biggestLeak, null, "three leads: no leak is named");
  const leads = [...Array(FUNNEL_MIN_BASE)].map((_, i) => lead(i));
  const booked = [...Array(6)].map((_, i) => ap(2, "confirmed", { contactId: `l${i}` }));
  const big = funnel(leads, booked, new Set(), NOW);
  assert.match(big.biggestLeak ?? "", /^40% \(4 of 10\) are lost before "Booked"\.$/);
  assert.ok(!/100%/.test(big.biggestLeak ?? ""));
  assert.equal(big.steps[4].step, "Became customers (won a deal)");
  assert.equal(big.steps[1].members.length, 6, "the leads behind a step are listed");
  assert.equal(big.steps[1].members.length, big.steps[1].count);
  // 12 booked, none showed (outcomes never marked), so the "worst" step is Showed: named, with real numbers, not "100% of everything".
  const l12 = [...Array(12)].map((_, i) => lead(i));
  const f12 = funnel(l12, l12.map((_, i) => ap(2, "confirmed", { contactId: `l${i}` })), new Set(), NOW);
  assert.equal(f12.biggestLeak, "None of the 12 leads before it reached \"Showed\".", "a real count, and no 100% lost");
  assert.ok(!/100%/.test(f12.biggestLeak ?? ""));
});

test("the best-times grid needs 30 recorded outcomes and 3 slots with their own rate; a grid of 1s says nothing", () => {
  const tz = () => "UTC";
  const ones = [...Array(20)].map((_, i) => ap(i + 1, i % 2 ? "showed" : "noshow", { startAt: Date.parse("2026-10-05T10:00:00Z") + i * DAY + (i % 9) * 3_600_000 }));
  const cells1 = heatmap(ones, tz, NOW);
  assert.equal(heatmapReadiness(cells1).ready, false);
  assert.ok(cells1.every((c) => c.showRate === null || c.held + c.noShow >= 5));
  // Thirty-six appointments in three slots, twelve in each: ready.
  const dense: Appt[] = [];
  for (const [wd, h] of [[0, 10], [1, 14], [2, 9]] as const) for (let k = 0; k < 12; k++) dense.push(ap(0, k < 8 ? "showed" : "noshow", { startAt: Date.parse("2026-10-05T00:00:00Z") + (wd + 7 * (k % 4)) * DAY + h * 3_600_000 }));
  const cells = heatmap(dense, tz, NOW);
  const r = heatmapReadiness(cells);
  assert.equal(r.outcomes, 36);
  assert.equal(r.ratedCells, 3);
  assert.equal(r.ready, true);
  assert.equal(heatmapReadiness([]).ready, false);
});

test("a source that is really a calendar name is grouped on its own line, not listed next to real sources", () => {
  const sources: Record<string, string> = {};
  const list: Appt[] = [];
  const add = (src: string, count: number, status: string) => { for (let i = 0; i < count; i++) { const a = ap(5, status); sources[a.contactId as string] = src; list.push(a); } };
  add("Facebook", 4, "showed"); add("Free consultation", 3, "showed"); add("free  Consultation", 3, "noshow"); add("Estimate visit", 3, "showed");
  const rows = showRateBySource(list, (_l, c) => sources[c] ?? null, NOW);
  const out = splitSources(rows, new Set(["Free consultation", "Estimate visit"]));
  assert.deepEqual(out.map((r) => r.source).sort(), [CALENDAR_SOURCE_LABEL, "Facebook"].sort());
  const cal = out.find((r) => r.isCalendar)!;
  assert.equal(cal.booked, 9);
  assert.equal(cal.outcomes, 9);
  assert.equal(cal.showRate, 6 / 9);
  assert.equal(cal.ids?.length, 9, "the rows behind the line are all there");
  assert.equal(out.find((r) => r.source === "Facebook")?.showRate, null, "4 outcomes: no rate");
  assert.equal(showRateBySource([ap(5, "invalid", { contactId: "x" }), ap(5, "showed", { contactId: "x" }), ap(5, "showed", { contactId: "x" }), ap(5, "showed", { contactId: "x" })], () => "Ads", NOW)[0].booked, 3, "an invalid booking is not a booking");
});

// ---------- the words ----------

test("every chart and card carries all three lines: what it shows, how to read it, what to do", () => {
  assert.ok(EXPLAINED.length >= 17);
  for (const id of EXPLAINED) {
    const e = EXPLAIN[id];
    for (const part of ["shows", "read", "todo"] as const) {
      assert.ok(e[part].trim().length >= 20, `${id}.${part} is empty or too short`);
      assert.ok(e[part].length <= 330, `${id}.${part} is too long for a short note`);
    }
  }
  for (const id of ["health", "funnel", "heat", "recovery", "repeat", "source", "velocity", "confirm", "fair", "value", "followup", "double", "briefs"]) assert.ok(id in EXPLAIN, id);
});

test("no appointment screen opens the phone's own dialer (KF-3)", () => {
  for (const f of ["appointments.tsx", "appointment-insights.tsx", "appointment-parts.tsx"]) {
    const text = readFileSync(new URL(`../../app/app/views/${f}`, import.meta.url), "utf8");
    assert.ok(!/tel:/.test(text), `${f} has a tel: link`);
  }
});

test("how a booking was made is said in words, and 'not recorded' when the CRM did not say", () => {
  assert.equal(channelWord(null), "Not recorded by your CRM");
  assert.equal(channelWord("calendar_page"), "Calendar page");
  assert.equal(channelWord("third-party"), "Third party");
});
