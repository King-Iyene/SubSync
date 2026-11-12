import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionFor, cleanMoneyInput, groupThousands, historyLines, historyStarts, looksLikeTestValue, orderDeals, stageDwell, stageProgress, summarize, usualStay, valueChangeWarning } from "../people/deal-view.ts";

const NOW = Date.parse("2026-11-12T12:00:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

test("summary counts equal the rows and sum open and won value", () => {
  const rows = [{ status: "open", value: 500 }, { status: "open", value: 1500 }, { status: "won", value: 2000 }, { status: "lost", value: 900 }, { status: "abandoned", value: 1 }];
  const s = summarize(rows);
  assert.deepEqual([s.open, s.won, s.lost, s.total], [2, 1, 2, 5]);
  assert.equal(s.open + s.won + s.lost, rows.length);
  assert.equal(s.openValue, 2000); assert.equal(s.wonValue, 2000);
});
test("test-value note", () => {
  assert.equal(summarize([{ status: "open", value: 1234 }]).testNote, true);
  assert.equal(summarize([{ status: "open", value: 2400000 }]).testNote, true);
  assert.equal(summarize([{ status: "open", value: 4200 }]).testNote, false);
  assert.equal(summarize([{ status: "lost", value: 1234 }]).testNote, false);
  assert.equal(looksLikeTestValue(0), false);
});
test("usual stay needs enough finished stays", () => {
  assert.equal(usualStay(6, 19).days, null);
  assert.equal(usualStay(6, 19).note, "Not enough history");
  assert.equal(usualStay(null, 50).days, null);
  assert.equal(usualStay(6.4, 20).days, 6);
});
test("days in stage versus usual", () => {
  const slow = stageDwell(ago(9), 5, 30, NOW);
  assert.equal(slow.days, 9); assert.equal(slow.tone, "slow"); assert.match(slow.text, /9 days in this stage, usual 5 days/);
  assert.equal(stageDwell(ago(3), 5, 30, NOW).tone, "ok");
  const none = stageDwell(ago(3), 5, 4, NOW);
  assert.equal(none.tone, "unknown"); assert.match(none.text, /Not enough history/);
  assert.equal(stageDwell(null, 5, 30, NOW).days, null);
  assert.match(stageDwell(ago(1), null, 0, NOW).text, /1 day in this stage/);
});
test("stage progress", () => {
  const st = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(stageProgress(st, "b"), { index: 2, total: 3 });
  assert.equal(stageProgress(st, "zz"), null);
  assert.equal(stageProgress(st, null), null);
});
test("value change over 10x warns, both ways, and normal changes do not", () => {
  assert.match(valueChangeWarning(500, 5000) ?? "", /10 times/);
  assert.match(valueChangeWarning(5000, 500) ?? "", /smaller/);
  assert.equal(valueChangeWarning(500, 4999), null);
  assert.equal(valueChangeWarning(0, 5000), null);
});
test("money input and grouping", () => {
  assert.equal(cleanMoneyInput("$1,2a3.456.7"), "123.45");
  assert.equal(groupThousands("1234567.5"), "1,234,567.5");
});
test("attention: owner first, then stuck, quiet, no value; closed deals never", () => {
  const ok = stageDwell(ago(1), 5, 30, NOW), slow = stageDwell(ago(9), 5, 30, NOW);
  assert.match(attentionFor({ status: "open", value: 10, ownerId: null, dwell: slow, quietDays: 30 })?.why ?? "", /Nobody owns/);
  assert.match(attentionFor({ status: "open", value: 10, ownerId: "u", dwell: slow, quietDays: 30 })?.why ?? "", /Stuck/);
  assert.match(attentionFor({ status: "open", value: 10, ownerId: "u", dwell: ok, quietDays: 20 })?.why ?? "", /Quiet/);
  assert.match(attentionFor({ status: "open", value: 0, ownerId: "u", dwell: ok, quietDays: 1 })?.why ?? "", /No value/);
  assert.equal(attentionFor({ status: "open", value: 10, ownerId: "u", dwell: ok, quietDays: 1 }), null);
  assert.equal(attentionFor({ status: "won", value: 0, ownerId: null, dwell: slow, quietDays: 99 }), null);
});
test("history is newest first, plain, and labels who made the change", () => {
  const base = { from: null, to: null, fromName: null, toName: null, value: null, actor: null, byUs: false };
  const rows = [
    { ...base, id: 1, kind: "created", at: ago(20), toName: "New" },
    { ...base, id: 2, kind: "stage", at: ago(10), fromName: "New", toName: "Booked" },
    { ...base, id: 3, kind: "value", at: ago(5), from: "500", to: "900", actor: "Dana" },
    { ...base, id: 4, kind: "status", at: ago(1), to: "won", byUs: true },
    { ...base, id: 5, kind: "note", at: ago(2) },
  ];
  const lines = historyLines(rows);
  assert.deepEqual(lines.map((l) => l.id), ["4", "3", "2", "1"]);
  assert.equal(lines[0].text, "Marked won (SubSync)");
  assert.equal(lines[1].text, "Value changed from $500 to $900 (Dana)");
  assert.equal(lines[2].text, "Moved from New to Booked");
  assert.equal(historyStarts(rows), ago(20));
  assert.equal(historyStarts([]), null);
});
test("deal order: open first by value, then won, then lost", () => {
  const o = orderDeals([{ status: "lost", value: 9 }, { status: "open", value: 1 }, { status: "won", value: 5 }, { status: "open", value: 7 }]);
  assert.deepEqual(o.map((d) => `${d.status}${d.value}`), ["open7", "open1", "won5", "lost9"]);
});
