import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountsSpec, alertsSpec, csvCell, emptyFilter, facetValues, filterRecs, itemsSpec, leadsSpec, rangeChoices, sortRecs, toCsv, trimColumns,
  type LedgerLead, type RecordsSpec,
} from "../analytics/today-records.ts";
import { accountsNeedingYou, buildQueue, emptyTotals, KINDS, slicesOf, type AccountFacts, type Kind, type TodayItem, type Totals } from "../analytics/today-queue.ts";

// Every mark on Today opens a list. The rule this file guards: the number on the mark equals the number of rows in the list it opens (or the list says it was cut).
const NOW = Date.parse("2026-11-04T12:00:00Z");
const H = 3_600_000, D = 86_400_000;
const ACCOUNTS: AccountFacts[] = [
  { id: "aaa", name: "Maple Dental", followUpEstimate: null, url: "https://crm.example.com/a" },
  { id: "bbb", name: "Harbor Realty", followUpEstimate: 900, url: "https://crm.example.com/b" },
];
let n = 0;
const item = (kind: Kind, loc: string, over: Partial<TodayItem> = {}): TodayItem => ({
  id: `i${n++}`, kind, locationId: loc, accountName: loc === "aaa" ? "Maple Dental" : "Harbor Realty", name: `Person ${n}`, detail: "detail", at: NOW - 2 * H, value: null, contactId: `c${n}`, url: `https://crm.example.com/c${n}`, ...(kind === "replies" ? { newLead: true } : {}), ...over,
});
const ITEMS: TodayItem[] = [
  ...Array.from({ length: 7 }, () => item("replies", "aaa", { owner: "Marcus", source: "Facebook" })),
  ...Array.from({ length: 3 }, () => item("replies", "bbb")),
  ...Array.from({ length: 2 }, () => item("appointments", "aaa")),
  ...Array.from({ length: 4 }, () => item("stale", "bbb", { value: 1000, at: NOW - 40 * D })),
  item("noshows", "aaa"),
];
const totals = (items: TodayItem[]): Totals => {
  const t = emptyTotals();
  for (const k of KINDS) { const m = items.filter((x) => x.kind === k); t[k] = { count: m.length, dollars: k === "stale" && m.length ? m.reduce((s, x) => s + (x.value ?? 0), 0) : null, shown: m.length }; }
  return t;
};

test("a slice's count equals the rows of its list, for every kind", () => {
  const t = totals(ITEMS);
  for (const s of slicesOf(t)) {
    const spec = itemsSpec(ITEMS.filter((i) => i.kind === s.kind), NOW, { key: `kind:${s.kind}`, title: s.label, subtitle: "", noun: "things", count: s.count });
    assert.equal(spec.count, s.count, s.kind);
    assert.equal(spec.rows.length, s.count, s.kind);
    assert.equal(spec.note, null);
  }
});

test("a queue row's count equals the rows behind it, and a bar's count equals its account's rows", () => {
  const q = buildQueue({ items: ITEMS, totals: totals(ITEMS), accounts: new Map(ACCOUNTS.map((a) => [a.id, a])), staleDays: 30, now: NOW });
  for (const r of q) {
    const spec = itemsSpec(ITEMS.filter((i) => r.itemIds.includes(i.id)), NOW, { key: r.key, title: r.accountName, subtitle: "", noun: "x", count: r.count });
    assert.equal(spec.rows.length, r.count, r.key);
  }
  const maple = ITEMS.filter((i) => i.locationId === "aaa");
  assert.equal(itemsSpec(maple, NOW, { key: "a", title: "", subtitle: "", noun: "", count: maple.length }).rows.length, 10);
});

test("a list that was cut says how many were loaded and keeps the number that was pressed", () => {
  const spec = itemsSpec(ITEMS.slice(0, 5), NOW, { key: "k", title: "t", subtitle: "", noun: "replies", count: 183 });
  assert.equal(spec.count, 183);
  assert.equal(spec.rows.length, 5);
  assert.match(spec.note ?? "", /first 5 of 183/);
});

test("the clients headline number equals the rows of the accounts list", () => {
  const q = buildQueue({ items: ITEMS, totals: totals(ITEMS), accounts: new Map(ACCOUNTS.map((a) => [a.id, a])), staleDays: 30, now: NOW });
  const needing = accountsNeedingYou(q, new Map(ACCOUNTS.map((a) => [a.id, a])), 50);
  const spec = accountsSpec(needing.rows.map((a) => ({ locationId: a.locationId, name: a.name, state: a.state, things: a.count, dollars: a.dollars, oldestMinutes: 120, reason: a.reason, url: a.url })),
    { key: "clients", title: "Clients", subtitle: "", noun: "clients", count: needing.total });
  assert.equal(spec.rows.length, needing.total);
  assert.equal(spec.count, new Set(q.map((r) => r.locationId)).size);
  assert.equal(spec.rows.reduce((s, r) => s + (r.cells.things as number), 0), ITEMS.length);
});

test("the dollar headline equals the counted stale deals in its list", () => {
  const stale = ITEMS.filter((i) => i.kind === "stale");
  const spec = itemsSpec(stale, NOW, { key: "dollars", title: "", subtitle: "", noun: "deals", count: stale.length });
  assert.equal(spec.rows.reduce((s, r) => s + ((r.cells.value as number) ?? 0), 0), totals(ITEMS).stale.dollars);
});

test("columns that hold nothing are left out, so a lead list has no deal value and a one-account list no account", () => {
  const leads = itemsSpec(ITEMS.filter((i) => i.kind === "replies"), NOW, { key: "l", title: "", subtitle: "", noun: "", count: 10 });
  assert.ok(!leads.cols.some((c) => c.key === "value"));
  assert.ok(leads.cols.some((c) => c.key === "owner"));
  assert.ok(leads.cols.some((c) => c.primary));
  assert.deepEqual(trimColumns([{ key: "a", header: "A", type: "text", primary: true }, { key: "b", header: "B", type: "text" }], [{ id: "1", cells: { a: null, b: null }, url: null, lead: null }]).map((c) => c.key), ["a"]);
});

function spec(): RecordsSpec { return itemsSpec(ITEMS, NOW, { key: "all", title: "All", subtitle: "", noun: "things", count: ITEMS.length }); }

test("filters: a facet chip, the date range, and search narrow the rows and never add any", () => {
  const s = spec();
  assert.equal(filterRecs(s, emptyFilter()).length, ITEMS.length);
  assert.equal(filterRecs(s, { ...emptyFilter(), facets: { account: ["Maple Dental"] } }).length, 10);
  assert.equal(filterRecs(s, { ...emptyFilter(), facets: { account: ["Maple Dental"], kind: ["Waiting for a reply"] } }).length, 7);
  assert.equal(filterRecs(s, { ...emptyFilter(), facets: { owner: ["Marcus"] } }).length, 7);
  assert.equal(filterRecs(s, { ...emptyFilter(), facets: { owner: ["(none)"] } }).length, ITEMS.length - 7);
  assert.equal(filterRecs(s, { ...emptyFilter(), q: "facebook" }).length, 7);
  assert.equal(filterRecs(s, { ...emptyFilter(), q: "zzz nothing" }).length, 0);
  const old = rangeChoices(NOW).find((r) => r.id === "old30")!;
  assert.equal(filterRecs(s, { ...emptyFilter(), range: { from: old.from, to: old.to } }).length, 4);
  const day = rangeChoices(NOW).find((r) => r.id === "24h")!;
  assert.equal(filterRecs(s, { ...emptyFilter(), range: { from: day.from, to: day.to } }).length, ITEMS.length - 4);
  assert.deepEqual(facetValues(s.rows, "account").map((v) => [v.value, v.n]), [["Maple Dental", 10], ["Harbor Realty", 7]]);
});

test("sorting: numbers numerically, text naturally, a missing value always last", () => {
  const s = spec();
  const up = sortRecs(s.rows, { key: "value", dir: "asc" }).map((r) => r.cells.value);
  assert.equal(up[0], 1000);
  assert.equal(up[up.length - 1], null);
  const down = sortRecs(s.rows, { key: "value", dir: "desc" }).map((r) => r.cells.value);
  assert.equal(down[0], 1000);
  assert.equal(down[down.length - 1], null);
  assert.equal(sortRecs(s.rows, null), s.rows);
});

test("CSV: only the columns shown, escaped, and a formula cell is neutralised", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("+1 555"), "'+1 555");
  assert.equal(csvCell("@sum"), "'@sum");
  const s = spec();
  const cols = s.cols.filter((c) => ["what", "account"].includes(c.key));
  const lines = toCsv(cols, s.rows.slice(0, 2)).trim().split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[0], "What,Client account");
  assert.ok(!lines.join("").includes("crm.example.com"));
});

test("leads and alerts lists build a row per lead or alert, with the reply time in minutes", () => {
  const l: LedgerLead[] = [
    { id: "1", locationId: "aaa", accountName: "Maple Dental", contactId: "c1", name: "Ann", source: "Google", ownerName: "Marcus", touchBy: "Priya", leadAt: NOW - H, touchAt: NOW - H + 5 * 60_000, url: "u" },
    { id: "2", locationId: "aaa", accountName: "Maple Dental", contactId: "c2", name: "Bo", source: null, ownerName: null, touchBy: null, leadAt: NOW - H, touchAt: null, url: "u" },
  ];
  const s = leadsSpec(l, NOW, { key: "x", title: "t", subtitle: "", noun: "replies", count: 2 });
  assert.equal(s.rows.length, 2);
  assert.equal(s.rows[0].cells.reply, 5);
  assert.equal(s.rows[1].cells.reply, null);
  assert.equal(s.rows[1].lead?.note, "Not answered yet");
  const a = alertsSpec([{ id: "a", accountName: "Maple Dental", title: "Slow replies", what: "Raised", at: NOW, severity: "warning" }, { id: "a", accountName: "Maple Dental", title: "Slow replies", what: "Cleared", at: NOW, severity: "warning" }], { key: "d", title: "d", subtitle: "", noun: "alerts", count: 2 });
  assert.equal(a.rows.length, 2);
  assert.notEqual(a.rows[0].id, a.rows[1].id);
});
