import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_COUNTS, accountRow, cursorOf, filterRows, gapAlertDrafts, gapsFor, pageOf, parseCursor, rankRows, todayLine, totalsOf, type OutcomeCounts } from "../workflows/outcomes.ts";
import { BULK_CAP, planRow, preview } from "../workflows-setup/library.ts";
import { NOSHOW_TASK, SPEED_TASK, TEMPLATES } from "../workflows-setup/templates.ts";
import { hasVendorWord } from "../workflows-setup/naming.ts";

const counts = (o: Partial<OutcomeCounts>): OutcomeCounts => ({ ...EMPTY_COUNTS, value: { ...EMPTY_COUNTS.value }, ...o });
const acc = (id: string, o: Partial<OutcomeCounts>, have: string[] | null) => accountRow({ locationId: id, name: `Acc ${id}` }, counts(o), { known: have !== null, have: have ?? [] });

test("a gap opens at three people; fewer is only watched", () => {
  const g = gapsFor(counts({ noTouch: 2, newLeads: 10 }), { known: true, have: [] }).find((x) => x.id === "no_touch")!;
  assert.equal(g.state, "watching");
  assert.equal(gapsFor(counts({ noTouch: 3 }), { known: true, have: [] }).find((x) => x.id === "no_touch")!.state, "open_missing");
  assert.equal(gapsFor(counts({ noTouch: 3 }), { known: true, have: ["new_lead"] }).find((x) => x.id === "no_touch")!.state, "open_present");
  assert.equal(gapsFor(counts({ noTouch: 3 }), { known: false, have: [] }).find((x) => x.id === "no_touch")!.state, "open_unknown");
  assert.equal(gapsFor(counts({}), { known: true, have: [] }).every((x) => x.state === "ok"), true);
});

test("levels, ranking and totals equal the rows", () => {
  const rows = [acc("a", { noTouch: 5, atRiskValue: 100 }, []), acc("b", { noshowOpen: 4, atRiskValue: 900 }, ["no_show"]), acc("c", {}, []), acc("d", { noTouch: 4, atRiskValue: 500 }, [])];
  assert.deepEqual(rows.map((r) => r.level), ["critical", "warning", "ok", "critical"]);
  const ranked = rankRows(rows);
  assert.deepEqual(ranked.map((r) => r.locationId), ["d", "a", "b", "c"]);
  const t = totalsOf(rows);
  assert.equal(t.people, 13); assert.equal(t.attention, 3); assert.equal(t.value, 1500);
  assert.equal(t.byGap.find((g) => g.id === "no_touch")!.people, 9);
  assert.equal(filterRows(rows, { q: "", level: "attention", gap: "all" }).length, t.attention);
  assert.equal(filterRows(rows, { q: "acc c", level: "all", gap: "all" }).length, 1);
});

test("keyset paging never repeats or skips a row", () => {
  const rows = rankRows(Array.from({ length: 23 }, (_, i) => acc(`x${String(i).padStart(2, "0")}`, i % 3 === 0 ? { noTouch: 3 + i } : {}, [])));
  const seen: string[] = [];
  let cur: string | null = null;
  for (let n = 0; n < 10; n++) {
    const p = pageOf(rows, parseCursor(cur), 5);
    seen.push(...p.rows.map((r) => r.locationId));
    if (!p.next) break;
    cur = p.next;
  }
  assert.deepEqual(seen, rows.map((r) => r.locationId));
  assert.equal(parseCursor("not base64 !!"), null);
  assert.equal(parseCursor(cursorOf(rows[0]))?.i, rows[0].locationId);
});

test("the Today line and the alerts only appear for real gaps, one alert per account and gap", () => {
  assert.equal(todayLine(totalsOf([acc("a", {}, [])])), null);
  const rows = [acc("a", { noTouch: 5, noshowOpen: 3, atRiskValue: 2000 }, [])];
  const l = todayLine(totalsOf(rows))!;
  assert.match(l.line, /1 client account has a lead-handling gap/);
  const d = gapAlertDrafts(rows);
  assert.equal(d.length, 2);
  assert.deepEqual(new Set(d.map((x) => x.dedupeKey)).size, 2);
  assert.ok(d.every((x) => x.dedupeKey.startsWith("wf:gap:a:") && x.severity === "critical"));
  assert.equal(gapAlertDrafts([acc("b", { noTouch: 2 }, [])]).length, 0);
});

test("install plan: exists, blocked, rehearsal, live, and the cap", () => {
  const base = { locationId: "L", name: "A", existing: null, sameNameSeen: false, canWrite: true, optedIn: true };
  assert.equal(planRow(NOSHOW_TASK, { ...base, existing: { status: "active", workflowId: "w" } }, true).state, "exists");
  assert.equal(planRow(NOSHOW_TASK, { ...base, sameNameSeen: true }, true).state, "exists");
  assert.equal(planRow(NOSHOW_TASK, { ...base, canWrite: false }, true).state, "blocked");
  assert.equal(planRow(NOSHOW_TASK, { ...base, optedIn: false }, true).state, "rehearse");
  assert.equal(planRow(NOSHOW_TASK, base, false).state, "rehearse");
  assert.equal(planRow(NOSHOW_TASK, base, true).state, "would_create");
  const many = Array.from({ length: BULK_CAP + 5 }, (_, i) => ({ ...base, locationId: `L${i}` }));
  const p = preview(SPEED_TASK, many, true);
  assert.equal(p.rows.length, BULK_CAP); assert.equal(p.capped, true);
});

test("templates are plain: unique keys, no vendor words, task only (never a message)", () => {
  assert.equal(new Set(TEMPLATES.map((t) => t.key)).size, TEMPLATES.length);
  for (const t of TEMPLATES) { assert.equal(hasVendorWord(t.name + t.summary + t.defaultTag), false); assert.match(t.summary, /never messages/); }
});
