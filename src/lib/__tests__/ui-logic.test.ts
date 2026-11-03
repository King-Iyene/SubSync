import assert from "node:assert/strict";
import { test } from "node:test";
import { describeHidden, nameList, scopeOf, EMPTY_FILTER, filterFromLink, filterToLink, filterToQuery, isFiltered, parsePickedAccounts, sanitizeFilter, visibleControls, type FilterOptions } from "../design/filters.ts";
import { buildHash, parseHash } from "../design/route.ts";
import { belowMinimum, errorId, neighbours, niceScale, paginate, PAGE_SIZE, resolveTheme } from "../design/ui-logic.ts";

const choice = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `Choice ${i}` }));
const accounts = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `acc${i}xyz`, name: `Account ${i}` }));

// ---- the filter bar shows what fits the person (N8, N34) ----
test("an agency gets the client-account picker, industry, owner and the test switch, when there is something to choose between", () => {
  const o: FilterOptions = { accounts: accounts(5), industries: choice(3), owners: [{ key: "Ada", label: "Ada" }], testAccounts: 1, ranges: true };
  assert.deepEqual(visibleControls("agency", o), ["accounts", "industry", "owner", "test", "range"]);
});

test("a control with nothing to choose is absent: one account, one industry, no test accounts", () => {
  assert.deepEqual(visibleControls("agency", { accounts: accounts(1), industries: choice(1), owners: [], testAccounts: 0 }), []);
});

test("a client's staff never get an account picker, industry, owner or test switch, even if the options were sent", () => {
  const o: FilterOptions = { accounts: accounts(5), industries: choice(3), owners: [{ key: "Ada", label: "Ada" }], testAccounts: 2, users: choice(4), calendars: choice(2), pipelines: choice(2), sources: choice(3), ranges: true };
  for (const kind of ["business", "client"] as const) assert.deepEqual(visibleControls(kind, o), ["user", "calendar", "pipeline", "source", "range"], kind);
});

test("a page about one account has no account-level controls, for an agency too (N8: absent on single-account pages)", () => {
  const o: FilterOptions = { accounts: accounts(5), industries: choice(3), owners: [{ key: "Ada", label: "Ada" }], testAccounts: 1, users: choice(2) };
  assert.deepEqual(visibleControls("agency", o, true), ["user"]);
});

test("the hidden-note says what is hidden and how to bring it back, in plain words", () => {
  const o: FilterOptions = { accounts: accounts(7), testAccounts: 1, industries: [{ key: "clinic", label: "Clinics" }] };
  const notes = describeHidden({ ...EMPTY_FILTER, accounts: ["acc1xyz", "acc2xyz"], hideTest: true, industry: "clinic" }, o);
  assert.deepEqual(notes.map((n) => n.text), ["Showing 2 of 7 client accounts: Account 1 and Account 2.", "1 test account is hidden because its name says test.", "Only Clinics clients are shown."]);
  assert.deepEqual(notes[0].clear, { accounts: [] });
  assert.deepEqual(notes[1].clear, { hideTest: false });
  assert.deepEqual(describeHidden(EMPTY_FILTER, o), []);
  assert.equal(describeHidden({ ...EMPTY_FILTER, hideTest: true }, { testAccounts: 3 })[0].text, "3 test accounts are hidden because their name says test.");
});

// ---- the filter is carried in the link ----
test("a filter survives the trip through the address and back, and only what the server understands goes in its query", () => {
  const v = { ...EMPTY_FILTER, accounts: ["abc123", "def456"], industry: "clinic", owner: "Ada Lovelace", hideTest: true, user: "u1", calendar: "c9", pipeline: "p2", source: "meta", range: "30d" as const };
  const link = filterToLink(v);
  assert.deepEqual(filterFromLink(link), v);
  assert.equal(filterToQuery(v), "accounts=abc123,def456&industry=clinic&owner=Ada%20Lovelace&hideTest=1");
  assert.equal(filterToQuery(EMPTY_FILTER), "");
  assert.equal(isFiltered(EMPTY_FILTER), false);
  assert.equal(isFiltered(v), true);
});

test("a hand-edited link cannot smuggle anything: bad ids, long lists, script text and unknown ranges are dropped", () => {
  const f = filterFromLink("accounts=ok_123,../etc,<script>,a&industry=Clinic;drop&owner=%3Cb%3E&user=a%20b&range=forever&hideTest=yes");
  assert.deepEqual(f, { ...EMPTY_FILTER, accounts: ["ok_123"] });
  const many = sanitizeFilter({ accounts: Array.from({ length: 200 }, (_, i) => `acc${i}`) });
  assert.equal(many.accounts.length, 50);
  assert.deepEqual(parsePickedAccounts("abc123, abc123 ,x,<y>,def_456"), ["abc123", "def_456"]);
  assert.deepEqual(parsePickedAccounts(null), []);
});

// ---- the address of a page ----
const IDS = ["today", "speed", "appointments", "audit", "overview"];
test("an address holds the page, the account and the filter, and reads back the same", () => {
  const filter = { ...EMPTY_FILTER, hideTest: true, industry: "clinic" };
  for (const view of [{ id: "speed" }, { id: "account", locationId: "loc_Abc-123" }]) {
    const hash = buildHash(view, filter);
    assert.deepEqual(parseHash(hash, IDS), { view, filter });
  }
  assert.equal(buildHash({ id: "today" }, EMPTY_FILTER), "#today");
  assert.equal(buildHash({ id: "account", locationId: "abc123" }, EMPTY_FILTER), "#account=abc123");
});

test("an unknown page, an empty address or a damaged account id lands on Today", () => {
  assert.deepEqual(parseHash("", IDS).view, { id: "today" });
  assert.deepEqual(parseHash("#nonsense", IDS).view, { id: "today" });
  assert.deepEqual(parseHash("#account=%E0%A4%A", IDS).view, { id: "today" });
  assert.deepEqual(parseHash("#account=../../x", IDS).view, { id: "today" });
});

// ---- lists ----
test("paginate: ten per page by default size, clamps a wild page number, and counts from 1", () => {
  const items = Array.from({ length: 60 }, (_, i) => i);
  const p1 = paginate(items, 1);
  assert.equal(p1.rows.length, PAGE_SIZE);
  assert.deepEqual([p1.from, p1.to, p1.pages, p1.total], [1, 25, 3, 60]);
  const last = paginate(items, 99);
  assert.deepEqual([last.page, last.from, last.to, last.rows.length], [3, 51, 60, 10]);
  assert.equal(paginate(items, -4).page, 1);
  assert.equal(paginate(items, Number.NaN).page, 1);
  const none = paginate([], 1);
  assert.deepEqual([none.from, none.to, none.pages, none.rows.length], [0, 0, 1, 0]);
  assert.equal(paginate(items, 2, 10).rows[0], 10);
});

test("the lead drawer steps to the previous and next row, and stops at both ends", () => {
  assert.deepEqual(neighbours(0, 5), { prev: null, next: 1 });
  assert.deepEqual(neighbours(2, 5), { prev: 1, next: 3 });
  assert.deepEqual(neighbours(4, 5), { prev: 3, next: null });
  assert.deepEqual(neighbours(0, 1), { prev: null, next: null });
  assert.deepEqual(neighbours(7, 5), { prev: null, next: null });
  assert.deepEqual(neighbours(-1, 5), { prev: null, next: null });
});

// ---- error id, theme, charts ----
test("an error id is E- and six characters, stable within the minute and different for different errors", () => {
  const t = Date.parse("2026-11-01T12:00:10Z");
  const a = errorId(500, "Request failed (500)", t);
  assert.match(a, /^E-[0-9A-Z]{6}$/);
  assert.equal(errorId(500, "Request failed (500)", t + 20_000), a);
  assert.notEqual(errorId(500, "Request failed (500)", t + 120_000), a);
  assert.notEqual(errorId(504, "Request failed (500)", t), a);
  assert.match(errorId(null, "", 0), /^E-[0-9A-Z]{6}$/);
});

test("the theme choice resolves: dark and light are fixed, system follows the device", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("niceScale picks round steps and always covers the biggest value", () => {
  assert.deepEqual(niceScale(87, 4), { top: 100, step: 25, ticks: [0, 25, 50, 75, 100] });
  assert.deepEqual(niceScale(9, 4).ticks, [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(niceScale(1, 4).ticks, [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(niceScale(1234, 4).ticks, [0, 500, 1000, 1500]);
  for (const max of [0, -3, Number.NaN, 0.37, 1234, 99999]) {
    const s = niceScale(max);
    assert.ok(s.top >= (Number.isFinite(max) && max > 0 ? max : 1), String(max));
    assert.equal(s.ticks[0], 0);
    assert.equal(s.ticks.at(-1), s.top);
  }
});

test("a chart is replaced by a placeholder below its minimum sample", () => {
  assert.equal(belowMinimum(4, 5), true);
  assert.equal(belowMinimum(5, 5), false);
  assert.equal(belowMinimum(Number.NaN, 5), true);
});

test("waitLabel says how long in the shortest plain words", async () => {
  const { waitLabel } = await import("../design/ui-logic.ts");
  assert.equal(waitLabel(0.2), "under a minute");
  assert.equal(waitLabel(20), "20 min");
  assert.equal(waitLabel(60), "1 hour");
  assert.equal(waitLabel(180), "3 hours");
  assert.equal(waitLabel(24 * 60), "1 day");
  assert.equal(waitLabel(13 * 24 * 60), "13 days");
  assert.equal(waitLabel(-5), "unknown");
  assert.equal(waitLabel(Number.NaN), "unknown");
});

// ---- KF-2: which accounts are in, and which are left out and why ----
const roster = [
  { id: "aaa111", name: "Maple Dental", industry: "medical", owner: "Ada" }, { id: "bbb222", name: "Harbor Realty", industry: "real_estate", owner: "Ada" },
  { id: "ccc333", name: "Test Sandbox", test: true, industry: "real_estate", owner: "Ben" }, { id: "ddd444", name: "Old Client", ignored: true, industry: "medical", owner: "Ben" },
  { id: "eee555", name: "Bright Solar", industry: "home_services", owner: "Ben" },
];
test("nameList is short and plain", () => {
  assert.equal(nameList([]), "");
  assert.equal(nameList(["A"]), "A");
  assert.equal(nameList(["A", "B"]), "A and B");
  assert.equal(nameList(["A", "B", "C"]), "A, B and C");
  assert.equal(nameList(["A", "B", "C", "D", "E"]), "A, B, C and 2 more");
});

test("with no filter everyone is in except the ignored account, which is listed as left out with its reason", () => {
  const s = scopeOf(EMPTY_FILTER, { accounts: roster });
  assert.deepEqual(s.included.map((a) => a.name), ["Maple Dental", "Harbor Realty", "Test Sandbox", "Bright Solar"]);
  assert.deepEqual(s.left.map((a) => [a.name, a.reason]), [["Old Client", "set to ignore, never counted"]]);
});

test("each way of leaving an account out gives its own plain reason, and an ignored account is never counted back in", () => {
  const picked = scopeOf({ ...EMPTY_FILTER, accounts: ["aaa111", "ddd444"] }, { accounts: roster });
  assert.deepEqual(picked.included.map((a) => a.name), ["Maple Dental"]);
  assert.equal(picked.left.find((a) => a.name === "Old Client")?.reason, "set to ignore, never counted");
  assert.equal(picked.left.find((a) => a.name === "Harbor Realty")?.reason, "not picked");
  const test = scopeOf({ ...EMPTY_FILTER, hideTest: true }, { accounts: roster });
  assert.equal(test.left.find((a) => a.name === "Test Sandbox")?.reason, "test account, hidden");
  const kind = scopeOf({ ...EMPTY_FILTER, industry: "medical" }, { accounts: roster });
  assert.deepEqual(kind.included.map((a) => a.name), ["Maple Dental"]);
  assert.equal(kind.left.find((a) => a.name === "Bright Solar")?.reason, "another kind of business");
  const owner = scopeOf({ ...EMPTY_FILTER, owner: "Ada" }, { accounts: roster });
  assert.deepEqual(owner.included.map((a) => a.name), ["Maple Dental", "Harbor Realty"]);
  assert.equal(owner.left.find((a) => a.name === "Bright Solar")?.reason, "belongs to another owner");
  const both = scopeOf({ ...EMPTY_FILTER, owner: "Ada", hideTest: true, industry: "real_estate" }, { accounts: roster });
  assert.deepEqual(both.included.map((a) => a.name), ["Harbor Realty"]);
  assert.equal(both.included.length + both.left.length, roster.length, "every account is either in or left out, never both and never missing");
});

test("the account notes name the accounts, and the picker counts only accounts that are not ignored", () => {
  const notes = describeHidden({ ...EMPTY_FILTER, accounts: ["aaa111", "bbb222", "eee555", "ccc333"] }, { accounts: roster });
  assert.equal(notes[0].text, "Showing 4 of 4 client accounts: Maple Dental, Harbor Realty, Test Sandbox and 1 more.");
  assert.deepEqual(visibleControls("agency", { accounts: [roster[0], roster[3]] }), [], "one live account and one ignored: nothing to pick between");
});
