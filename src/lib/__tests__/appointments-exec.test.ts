import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  addTot, briefText, delta, decisionsOf, funnelOf, headlineOf, lostToNoShows, paceOf, peopleOf, showRate, slotsOf, topMovers, weekStartOf, ZERO, type Tot,
} from "../analytics/appointments-exec-intel.ts";

const t = (o: Partial<Tot>): Tot => ({ ...ZERO, ...o });
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0); // a Wednesday

test("show rate counts past-due unmarked as not shown, and says not enough data under the minimum", () => {
  assert.equal(showRate(t({ showed: 6, noshow: 2, unmarked: 2 })).value, 0.6);
  assert.equal(showRate(t({ showed: 4, noshow: 2 })).value, null, "6 counted is under the minimum of 10");
});

test("delta: rates in points, counts in percent, null when a side is unknown", () => {
  assert.deepEqual(delta(0.7, 0.6, "rate").points, 10);
  assert.equal(delta(120, 100, "count").pct, 20);
  assert.equal(delta(5, null, "count").pct, null);
  assert.equal(delta(5, 0, "count").pct, null, "no percent from zero");
});

test("revenue lost to no-shows is an estimate from the account's own close rate and deal size, or not enough data", () => {
  const ok = lostToNoShows(t({ showed: 40, noshow: 10, won: 8, wonValue: 16000 }));
  assert.equal(ok.estimate, true);
  assert.equal(ok.value, Math.round(10 * (8 / 40) * 2000));
  assert.match(ok.formula, /won \/ showed/);
  const few = lostToNoShows(t({ showed: 5, noshow: 4, won: 1, wonValue: 900 }));
  assert.equal(few.value, null);
  assert.equal(few.enough, false);
  assert.equal(lostToNoShows(t({ showed: 20 })).value, 0);
});

test("funnel: names the biggest leak in a plain sentence and leaves confirmation out when it is not recorded", () => {
  const f = funnelOf(t({ booked: 100, showed: 40, noshow: 30, cancelled: 10, unmarked: 5, won: 30 }));
  assert.equal(f.leak?.step, "noshow");
  assert.match(f.leak?.sentence ?? "", /30 people booked and did not turn up/);
  assert.equal(f.confirmTracked, false);
  assert.equal(f.steps.find((s) => s.key === "confirmed")?.count, null);
  assert.equal(funnelOf(ZERO).leak, null, "no leak is named on no data");
  assert.equal(f.steps.find((s) => s.key === "won")?.of, 40);
});

test("pace: needs 4 weeks of history, uses the account's own 8-week average, never an outside benchmark", () => {
  const wk = (n: number, b: number) => ({ weekStart: new Date(weekStartOf(NOW) - n * 7 * 86_400_000).toISOString().slice(0, 10), booked: b });
  const few = paceOf([wk(1, 10), wk(0, 3)], 20, NOW, null);
  assert.equal(few.enough, false);
  assert.equal(few.status, "unknown");
  const weeks = [8, 7, 6, 5, 4, 3, 2, 1].map((n) => wk(n, 10)).concat([wk(0, 4)]);
  const p = paceOf(weeks, 28, NOW, null);
  assert.equal(p.enough, true);
  assert.equal(p.avgPerWeek, 10);
  assert.ok((p.projectedMonth ?? 0) > 28);
  assert.equal(paceOf(weeks, 5, NOW, 200).status, "behind");
  assert.equal(paceOf(weeks, 28, NOW, 20).status !== "behind", true);
});

test("heatmap: a slot needs 8 finished appointments to be named best or worst", () => {
  const cells = [{ dow: 1, hour: 9, booked: 10, showed: 9, noshow: 1, unmarked: 0 }, { dow: 5, hour: 16, booked: 12, showed: 5, noshow: 7, unmarked: 0 }, { dow: 2, hour: 10, booked: 3, showed: 0, noshow: 3, unmarked: 0 }];
  const s = slotsOf(cells);
  assert.equal(s.best?.dow, 1);
  assert.equal(s.worst?.dow, 5, "the 3-appointment slot is ignored even though it is worse");
  assert.equal(slotsOf([cells[2]]).enough, false);
});

test("people are compared with what we expect for the same lead sources, with a minimum sample", () => {
  const nm = (id: string | null) => `Person ${id}`;
  // xtest-a gets mostly easy leads, xtest-b mostly hard ones: b's lower raw rate is not b's fault.
  const rows = peopleOf([
    { id: "xtest-a", source: "easy", t: t({ booked: 40, showed: 36, noshow: 4 }) }, { id: "xtest-a", source: "hard", t: t({ booked: 10, showed: 5, noshow: 5 }) },
    { id: "xtest-b", source: "easy", t: t({ booked: 10, showed: 9, noshow: 1 }) }, { id: "xtest-b", source: "hard", t: t({ booked: 40, showed: 20, noshow: 20 }) },
    { id: "xtest-c", source: "easy", t: t({ booked: 3, showed: 0, noshow: 3 }) },
  ], [], nm);
  const a = rows.find((r) => r.id === "xtest-a")!, b = rows.find((r) => r.id === "xtest-b")!, c = rows.find((r) => r.id === "xtest-c")!;
  assert.ok(a.showRate.value! > b.showRate.value!);
  assert.ok(Math.abs((a.vsExpectedPoints ?? 0)) <= 6 && Math.abs((b.vsExpectedPoints ?? 0)) <= 6, "same mix of sources: neither is far from expected");
  assert.equal(c.showRate.value, null, "3 appointments is not enough for a rate");
  assert.equal(c.vsExpectedPoints, null);
  assert.equal(a.name, "Person xtest-a");
});

test("movers need a rate in both periods", () => {
  const nm = (id: string | null) => `P ${id}`;
  const now = [{ id: "u1", source: "s", t: t({ showed: 16, noshow: 4 }) }, { id: "u2", source: "s", t: t({ showed: 5, noshow: 15 }) }, { id: "u3", source: "s", t: t({ showed: 10, noshow: 10 }) }];
  const before = [{ id: "u1", source: "s", t: t({ showed: 10, noshow: 10 }) }, { id: "u2", source: "s", t: t({ showed: 12, noshow: 8 }) }];
  const m = topMovers(peopleOf(now, before, nm));
  assert.deepEqual(m.up.map((x) => x.id), ["u1"]);
  assert.deepEqual(m.down.map((x) => x.id), ["u2"]);
});

test("decisions: only what a minimum sample supports, each with evidence and rows to open, at most five", () => {
  const nm = (id: string | null) => `P ${id}`;
  const people = peopleOf([{ id: "u1", source: "s", t: t({ booked: 30, showed: 12, noshow: 18 }) }, { id: "u2", source: "s", t: t({ booked: 30, showed: 26, noshow: 4 }) }], [], nm);
  const pace = paceOf([], 0, NOW, null);
  const d = decisionsOf({ unmarked: 12, showRate: showRate(t({ showed: 38, noshow: 22 })), people, slots: slotsOf([]), sources: [], accounts: [], pace, leak: null, calendars: [] });
  assert.ok(d.length <= 5 && d.length >= 2);
  assert.ok(d.some((x) => x.key === "coach" && /expected for the same kinds of leads/.test(x.evidence)));
  for (const x of d) { assert.ok(x.evidence.length > 10); assert.ok(x.open?.params); }
  assert.equal(decisionsOf({ unmarked: 2, showRate: showRate(ZERO), people: [], slots: slotsOf([]), sources: [], accounts: [], pace, leak: null, calendars: [] }).length, 0, "no data, no advice");
});

test("brief and headline use no vendor words and carry the estimate formula", () => {
  const cur = t({ booked: 80, showed: 40, noshow: 15, unmarked: 5, won: 10, wonValue: 20000, lost: 6 });
  const f = funnelOf(cur), lost = lostToNoShows(cur);
  const text = briefText({ title: "Appointments: weekly leadership brief", period: "x", cur, prev: addTot(ZERO, t({ booked: 60, showed: 30, noshow: 12 })), funnel: f, pace: paceOf([], 0, NOW, null), decisions: [], lost });
  assert.doesNotMatch(text + headlineOf(cur, null, f), /GoHighLevel|HighLevel|GHL|sub-?account/i);
  assert.match(text, /estimate/i);
});

test("the Leadership files carry no vendor words in anything a person reads", () => {
  for (const f of ["src/app/app/views/ap3/exec/exec-tab.tsx", "src/app/app/views/ap3/exec/exec-bits.tsx", "src/app/app/views/ap3/exec/exec-fixtures.ts", "src/lib/analytics/appointments-exec-intel.ts", "src/lib/analytics/appointments-exec-queries.ts"]) {
    const src = readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
    const strings = src.match(/"[^"\n]{4,}"|`[^`\n]{4,}`|>[^<>{}\n]{4,}</g) ?? [];
    for (const s of strings) assert.doesNotMatch(s, /GoHighLevel|HighLevel|\bGHL\b|sub-?account/i, `${f}: ${s}`);
  }
});
