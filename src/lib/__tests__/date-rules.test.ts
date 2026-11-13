import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { addDays, dayStartMs, localDay, mondayOfDay, offsetMs, utcDayAfterToday, windowMs } from "../design/zone.ts";
import { BAR_PRESETS, decodeRange, encodeRange, resolveRange, todayOf, type RangeSpec } from "../design/range.ts";
import { checkCustom } from "../design/page-range.ts";

// docs/DATE_RULES.md: ONE set of date rules. Days are days in the account zone (Africa/Lagos, no daylight saving), weeks start on Monday.
const lagos = (iso: string) => Date.parse(`${iso}+01:00`); // an instant written as Lagos wall-clock time

test("Lagos is a fixed +1 hour, and the local day changes at local midnight, not at UTC midnight", () => {
  assert.equal(offsetMs(lagos("2026-11-13T12:00:00"), "Africa/Lagos"), 3_600_000);
  assert.equal(localDay(Date.parse("2026-11-12T22:59:59Z")), "2026-11-12");
  assert.equal(localDay(Date.parse("2026-11-12T23:00:00Z")), "2026-11-13"); // 00:00 in Lagos
  assert.equal(todayOf(lagos("2026-11-13T00:30:00")), "2026-11-13"); // the UTC day would still say the 12th
  assert.equal(dayStartMs("2026-11-13"), Date.parse("2026-11-12T23:00:00Z"));
  assert.equal(dayStartMs("2026-02-30"), null);
  assert.equal(dayStartMs("nonsense"), null);
});

test("a window is [start of the first local day, start of the day after the last)", () => {
  const w = windowMs("2026-11-13", "2026-11-13") as { fromMs: number; toMs: number };
  assert.equal(w.toMs - w.fromMs, 86_400_000);
  assert.ok(lagos("2026-11-13T00:00:00") >= w.fromMs && lagos("2026-11-13T23:59:59") < w.toMs);
  assert.ok(lagos("2026-11-12T23:59:59") < w.fromMs && lagos("2026-11-14T00:00:00") >= w.toMs);
});

test("the lunch-hour edge: at 12:30 Lagos 'Today' is today; just after local midnight it is already the new day", () => {
  const now = lagos("2026-11-13T12:30:00");
  const r = resolveRange({ preset: "today", compare: "none" }, todayOf(now));
  assert.deepEqual([r.current.from, r.current.to, r.current.days], ["2026-11-13", "2026-11-13", 1]);
  assert.equal(utcDayAfterToday(now), Date.parse("2026-11-14T00:00:00Z"));
  const late = lagos("2026-11-13T00:20:00"); // the UTC clock still says the 12th
  assert.equal(resolveRange({ preset: "today", compare: "none" }, todayOf(late)).current.from, "2026-11-13");
  assert.equal(utcDayAfterToday(late), Date.parse("2026-11-14T00:00:00Z"));
});

const spec = (preset: RangeSpec["preset"]): RangeSpec => ({ preset, compare: "none" });
const win = (preset: RangeSpec["preset"], today: string) => { const r = resolveRange(spec(preset), today).current; return [r.from, r.to]; };

test("every preset resolves in the account's days, weeks start on Monday", () => {
  // Friday 13 Nov 2026
  assert.deepEqual(win("today", "2026-11-13"), ["2026-11-13", "2026-11-13"]);
  assert.deepEqual(win("yday", "2026-11-13"), ["2026-11-12", "2026-11-12"]);
  assert.deepEqual(win("7d", "2026-11-13"), ["2026-11-07", "2026-11-13"]);
  assert.deepEqual(win("30d", "2026-11-13"), ["2026-10-15", "2026-11-13"]); // the bar's own example: 15 Oct to 13 Nov
  assert.deepEqual(win("90d", "2026-11-13"), ["2026-08-16", "2026-11-13"]);
  assert.deepEqual(win("week", "2026-11-13"), ["2026-11-09", "2026-11-13"]); // Monday to today, never the future
  assert.deepEqual(win("lweek", "2026-11-13"), ["2026-11-02", "2026-11-08"]);
  assert.deepEqual(win("month", "2026-11-13"), ["2026-11-01", "2026-11-13"]);
  assert.deepEqual(win("lmonth", "2026-11-13"), ["2026-10-01", "2026-10-31"]);
});

test("month, year, week and leap-day boundaries", () => {
  assert.deepEqual(win("month", "2026-12-01"), ["2026-12-01", "2026-12-01"]);
  assert.deepEqual(win("lmonth", "2027-01-05"), ["2026-12-01", "2026-12-31"]); // across the year
  assert.deepEqual(win("lmonth", "2028-03-10"), ["2028-02-01", "2028-02-29"]); // leap February
  assert.deepEqual(win("lmonth", "2027-03-10"), ["2027-02-01", "2027-02-28"]);
  assert.deepEqual(win("yday", "2028-03-01"), ["2028-02-29", "2028-02-29"]); // the leap day itself
  assert.deepEqual(win("week", "2027-01-01"), ["2026-12-28", "2027-01-01"]); // a week that spans the new year
  assert.deepEqual(win("lweek", "2027-01-04"), ["2026-12-28", "2027-01-03"]);
  assert.equal(mondayOfDay("2026-11-15"), "2026-11-09"); // Sunday belongs to the week that began on Monday
  assert.equal(mondayOfDay("2026-11-09"), "2026-11-09");
  assert.equal(addDays("2028-02-28", 2), "2028-03-01");
});

test("every bar preset is carried in the address and read back", () => {
  for (const p of BAR_PRESETS) { const s = { preset: p.key, compare: "previous" } as RangeSpec; assert.deepEqual(decodeRange(encodeRange(s)), s, p.key); }
  assert.equal(decodeRange("tomorrow"), null);
  assert.equal(resolveRange({ preset: "week", compare: "previous" }, "2026-11-13").compare?.from, "2026-11-04"); // the same number of days straight before
});

test("a custom range is checked in the account's days: not in the future, not backwards, real dates only", () => {
  assert.equal(checkCustom("2026-11-01", "2026-11-13", "2026-11-13"), null);
  assert.ok(checkCustom("2026-11-01", "2026-11-14", "2026-11-13"));
  assert.ok(checkCustom("2026-11-10", "2026-11-01", "2026-11-13"));
  assert.ok(checkCustom("2026-02-30", "2026-03-01", "2026-11-13"));
  assert.equal(checkCustom("2028-02-29", "2028-02-29", "2028-03-01"), null);
});

// ---- narrowing the range changes the filtered figures, never the "as of now" ones ----
type Row = { createdAt: number; status: "open" | "won"; value: number };
const rows: Row[] = [
  { createdAt: lagos("2026-11-13T12:10:00"), status: "open", value: 100 }, // today, lunch hour
  { createdAt: lagos("2026-11-13T00:05:00"), status: "open", value: 50 }, // today, just after midnight (the UTC day is still the 12th)
  { createdAt: lagos("2026-11-12T23:59:00"), status: "open", value: 25 }, // yesterday, last minute
  { createdAt: lagos("2026-11-10T09:00:00"), status: "won", value: 10 }, // this week
  { createdAt: lagos("2026-11-03T09:00:00"), status: "open", value: 5 }, // last week
  { createdAt: lagos("2026-10-20T09:00:00"), status: "won", value: 1 }, // last month
];
const inRange = (r: Row, from: string, to: string) => { const w = windowMs(from, to) as { fromMs: number; toMs: number }; return r.createdAt >= w.fromMs && r.createdAt < w.toMs; };
const created = (preset: RangeSpec["preset"], today: string) => { const [f, t] = win(preset, today); return rows.filter((r) => inRange(r, f, t)).length; };
const openMoneyNow = (rs: Row[]) => rs.filter((r) => r.status === "open").reduce((a, r) => a + r.value, 0); // "as of now": takes no range at all

test("narrowing the range narrows the filtered counts, and the as-of-now figure never moves", () => {
  const today = "2026-11-13";
  assert.equal(created("today", today), 2); // both of today's, including the one just after local midnight
  assert.equal(created("yday", today), 1);
  assert.equal(created("week", today), 4);
  assert.equal(created("lweek", today), 1);
  assert.equal(created("month", today), 5);
  assert.equal(created("lmonth", today), 1);
  assert.equal(created("30d", today), 6);
  assert.ok(created("today", today) < created("week", today) && created("week", today) < created("month", today) && created("month", today) <= created("30d", today));
  const before = openMoneyNow(rows);
  for (const p of BAR_PRESETS) created(p.key, today);
  assert.equal(openMoneyNow(rows), before); // it never takes a range, so no preset can change it
  assert.equal(before, 180);
});

// ---- the source-level guard: no query builds its own date window outside the shared modules ----
// The shared modules are src/lib/design/zone.ts (days and windows), range.ts and page-range.ts (presets). A file that works out "today" or a window as UTC days on its own is listed in
// date-guard-baseline.json: the baseline may only SHRINK. A new file with one of these patterns, or a file with more of them than listed, fails here (docs/DATE_RULES.md, "known gaps").
const OWN_WINDOW = /% DAY\b|% 86_?400_?000|Math\.floor\(now \/ (DAY|86_?400_?000)\)|new Date\(now \+ (DAY|86_?400_?000)\)|new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)|new Date\(Date\.now\(\)\)\.toISOString\(\)\.slice\(0, ?10\)/g;
const EXEMPT = /(__tests__|\.test\.|fixture|sample|design[\\/](zone|range|page-range)\.ts$)/i;
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(n)) out.push(p); }
  return out;
}
test("no screen or query works out its own 'today' or day window outside the shared date module (shrink-only baseline)", () => {
  const root = join(import.meta.dirname, "..", "..");
  const baseline = JSON.parse(readFileSync(join(import.meta.dirname, "date-guard-baseline.json"), "utf8")) as Record<string, number>;
  const found: Record<string, number> = {};
  for (const f of walk(root)) {
    const rel = relative(root, f).replace(/\\/g, "/");
    if (EXEMPT.test(rel)) continue;
    const n = (readFileSync(f, "utf8").match(OWN_WINDOW) ?? []).length;
    if (n) found[rel] = n;
  }
  const worse = Object.entries(found).filter(([f, n]) => n > (baseline[f] ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${baseline[f] ?? 0})`);
  assert.deepEqual(worse, [], `These files build their own date window. Use src/lib/design/zone.ts (localDay, windowMs, utcDayAfterToday) or the date bar (usePageRange):\n${worse.join("\n")}`);
});
