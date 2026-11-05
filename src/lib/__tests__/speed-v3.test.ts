import assert from "node:assert/strict";
import { test } from "node:test";
import { bySourceFunnel, digestPreview, fastVsSlow, gapMap, isAfterHours, keyOf, localParts, ownerGaps, pick, setterScorecard, trendVsNormal, type Outcomes } from "../analytics/speed-v3.ts";
import type { LoadedRow } from "../analytics/speed-parts.ts";

const NOW = Date.parse("2026-11-05T12:00:00Z"); // a Thursday
const min = (n: number) => n * 60_000;
const O = { targetMinutes: 15, now: NOW };
let n = 0;
function lead(ago: number, after: number | null, over: Partial<LoadedRow> = {}): LoadedRow {
  n += 1;
  return { locationId: "A", contactId: `c${n}`, leadAt: NOW - min(ago), touchAt: after === null ? null : NOW - min(ago) + min(after), userId: after === null ? null : "u1", name: `L${n}`, assignedTo: "o1", source: "Website", tags: [], timeZone: "UTC", ...over };
}

test("local hour and weekday follow the account's time zone, UTC when unknown", () => {
  const t = Date.parse("2026-11-05T02:30:00Z");
  assert.deepEqual(localParts(t, "UTC"), { hour: 2, dow: 4 });
  assert.deepEqual(localParts(t, "America/New_York"), { hour: 21, dow: 3 });
  assert.deepEqual(localParts(t, "Not/AZone"), { hour: 2, dow: 4 });
  assert.equal(isAfterHours(Date.parse("2026-11-07T12:00:00Z"), "UTC"), true);
  assert.equal(isAfterHours(Date.parse("2026-11-05T12:00:00Z"), "UTC"), false);
});

test("gap map: after-hours leads, missed ones, and the same rows behind every mark", () => {
  const rows = [
    ...Array.from({ length: 6 }, () => lead(60 * 24 * 2 + 600, null)), // Tuesday 02:00 UTC-ish, never answered
    ...Array.from({ length: 5 }, () => lead(30, 2)), // Thursday 11:30, fast
  ];
  const g = gapMap(rows, O);
  assert.equal(g.judged, 11);
  assert.equal(g.afterLeads + g.openLeads, 11);
  assert.ok(g.afterMissed >= 6 || g.openMissed >= 6);
  const sum = g.cells.reduce((s, c) => s + c.leads, 0);
  assert.equal(sum, 11);
  for (const c of g.cells) assert.equal(pick(rows, { kind: "cell", dow: c.dow, hour: c.hour }, O).length, c.leads);
  assert.equal(pick(rows, { kind: "after" }, O).length, g.afterLeads);
});

test("tiny samples give no line and no share", () => {
  const g = gapMap([lead(60 * 30, null), lead(30, 1)], O);
  assert.equal(g.line, null); assert.equal(g.afterShare, null);
});

test("fast against slow: a multiple only from 20 and 20, never from a tiny base", () => {
  const rows: LoadedRow[] = []; const oc = new Map<string, { booked: boolean; showed: boolean; won: boolean }>();
  for (let i = 0; i < 20; i++) { const r = lead(600, 2); rows.push(r); if (i < 8) oc.set(keyOf(r), { booked: true, showed: false, won: false }); }
  for (let i = 0; i < 19; i++) { const r = lead(600, 90); rows.push(r); if (i < 2) oc.set(keyOf(r), { booked: true, showed: false, won: false }); }
  let f = fastVsSlow(rows, oc as Outcomes, O);
  assert.equal(f.enough, false); assert.equal(f.multiple, null); assert.match(f.line, /Not enough data yet/);
  const r = lead(600, 90); rows.push(r); oc.set(keyOf(r), { booked: true, showed: false, won: false });
  f = fastVsSlow(rows, oc as Outcomes, O);
  assert.equal(f.enough, true); assert.equal(f.fast.rate, 0.4); assert.equal(f.slow.rate, 0.15); assert.equal(Math.round((f.multiple as number) * 10), 27);
  assert.equal(f.fast.n, pick(rows, { kind: "fast" }, O).length);
});

test("fast against slow: nobody booked slowly gives no multiple (no divide by zero)", () => {
  const rows = [...Array.from({ length: 20 }, () => lead(600, 1)), ...Array.from({ length: 20 }, () => lead(600, 60))];
  const oc = new Map([[keyOf(rows[0]), { booked: true, showed: false, won: false }]]);
  const f = fastVsSlow(rows, oc as Outcomes, O);
  assert.equal(f.multiple, null); assert.match(f.line, /booked/);
});

test("sources: slowest ranked first, a thin source last with no median", () => {
  const rows = [...Array.from({ length: 6 }, () => lead(600, 40, { source: "Zillow" })), ...Array.from({ length: 6 }, () => lead(600, 3, { source: "Website" })), lead(600, 5, { source: "Referral" })];
  const s = bySourceFunnel(rows, new Map(), O);
  assert.deepEqual(s.map((x) => x.source), ["Zillow", "Website", "Referral"]);
  assert.equal(s[2].medianSeconds, null); assert.equal(s[2].hitRate, null);
  assert.equal(pick(rows, { kind: "source", source: "Zillow" }, O).length, 6);
});

test("trend: needs 5 replies this week and 3 earlier weeks; 20 percent either way", () => {
  const mk = (week: number, secs: number, count = 6) => Array.from({ length: count }, (_, i) => lead(week * 7 * 1440 + 60 + i, secs / 60));
  const none = trendVsNormal(mk(0, 600, 3), O); assert.equal(none.verdict, null); assert.match(none.note, /Not enough replies/);
  const young = trendVsNormal([...mk(0, 600), ...mk(1, 600)], O); assert.equal(young.verdict, null); assert.match(young.note, /earlier weeks/);
  const base = [...mk(1, 600), ...mk(2, 600), ...mk(3, 600)];
  assert.equal(trendVsNormal([...mk(0, 300), ...base], O).verdict, "faster");
  assert.equal(trendVsNormal([...mk(0, 1200), ...base], O).verdict, "slower");
  assert.equal(trendVsNormal([...mk(0, 630), ...base], O).verdict, "steady");
});

test("setters: ties by replies then id, thin people unranked, team median needs 5", () => {
  const rows = [...Array.from({ length: 3 }, () => lead(600, 5, { userId: "b" })), ...Array.from({ length: 3 }, () => lead(600, 5, { userId: "a" })), lead(600, 1, { userId: "z" })];
  const s = setterScorecard(rows, new Map(), O);
  assert.deepEqual(s.rows.map((r) => r.userId), ["a", "b", "z"]);
  assert.equal(s.rows[2].ranked, false); assert.equal(s.rows[2].medianSeconds, null); assert.equal(s.teamMedianSeconds, 300);
  assert.equal(setterScorecard([lead(600, 5)], new Map(), O).teamMedianSeconds, null);
});

test("owner gaps: no owner counted, overloaded only with enough leads and two owners", () => {
  const rows = [...Array.from({ length: 12 }, () => lead(600, 2, { assignedTo: "o1" })), lead(600, 2, { assignedTo: "o2" }), lead(600, null, { assignedTo: null })];
  const g = ownerGaps(rows, O);
  assert.equal(g.noOwner, 1); assert.equal(g.owners[0].userId, "o1");
  assert.equal(ownerGaps(rows.slice(0, 5), O).fairShare, null);
  assert.equal(pick(rows, { kind: "noOwner" }, O).length, 1);
});

test("digest preview says it sends nothing", () => {
  const t = digestPreview({ who: "Alpha", waiting: 2, dollars: 1200, typical: "Typical first reply: 4 min.", trend: trendVsNormal([], O), gap: gapMap([], O), word: "daily" });
  assert.match(t, /2 leads are waiting/); assert.match(t, /\$1,200/); assert.match(t, /Nothing was sent/);
});
