import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { looksLikeTestName, TEST_NAME_PATTERN } from "../analytics/deal-trust.ts";
import { queryOf } from "../../app/app/views/pl3/adapters.ts";
import { pageProgress, rowNotes, testNamesNote } from "../../app/app/views/pl3/pipe-list.ts";
import type { PipeCard, Pl3Cards } from "../analytics/pipeline3-types.ts";
import { routeAllowed } from "../access.ts";

// Pipeline > Money flow list: paging that stays at the bottom, date meaning (open money is as of now), and the "count deals that look like tests" switch.
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const card = (o: Partial<PipeCard> = {}): PipeCard => ({ locationId: "L", pipelineId: "P", accountName: "A", name: "Sales", openCount: 3, openValue: 1000, wonCount: 0, wonValue: 0, lostCount: 0, lostValue: 0, staleCount: 0, noOwnerCount: 0, zeroValueCount: 0, outlierCount: 0, outlierValue: 0, empty: false, mini: [], ...o });
const F = { from: "2026-11-12", to: "2026-11-12", locationId: "", pipeline: "", ownerId: "", q: "" };

test("test names: only whole test words trigger it, never real names", () => {
  for (const yes of ["Test deal 101", "demo", "Dummy contract", "Sample - roof", "lorem ipsum", "Deal (test)", "xtest-abc", "TEST"]) assert.equal(looksLikeTestName(yes), true, yes);
  for (const no of ["Contested Will", "Attestation Ltd", "Demolition Co", "Samples Unlimited", "Loremaster", "Protest Inc", "Latest deal", "Smith roofing", "Fakenham Homes", ""]) assert.equal(looksLikeTestName(no), false, no);
  assert.equal(looksLikeTestName(null, "Test Lead 7"), true, "the contact name counts too");
  assert.match(TEST_NAME_PATTERN, /lorem/);
  assert.doesNotMatch(TEST_NAME_PATTERN, /fake|testing/);
});

test("the SQL scan and the stored totals state the test pattern once (pipeline3-queries reads deal-trust.ts)", () => {
  assert.match(read("lib/analytics/pipeline3-queries.ts"), /const TEST_RE = TEST_NAME_PATTERN;/);
  assert.doesNotMatch(read("lib/analytics/pipeline3-queries.ts"), /\(test\|testing\|demo/);
});

test("the company switch: left-out test names follow settings.count_test_deals in both rules (is_test and the value-suspect reason), default off", () => {
  const sqlSrc = read("lib/analytics/stage-rules-sql.ts"), q = read("lib/analytics/pipeline3-queries.ts"), mig = read("../supabase/migrations/20261231140000_count_test_deals.sql");
  assert.match(sqlSrc, /left join settings sc_cfg on sc_cfg\.installation_id = o\.installation_id/);
  assert.match(sqlSrc, /not coalesce\(sc_cfg\.count_test_deals, false\) and \(coalesce\(o\.name/);
  assert.match(q, /and not coalesce\(sc_cfg\.count_test_deals, false\)\) is_test/);
  assert.match(q, /valueSuspect\(f\.includeTest === true\)/, "the screen toggle reaches the left-out reason too");
  assert.match(mig, /add column if not exists count_test_deals boolean;/);
  assert.doesNotMatch(mig, /default true|drop |delete /i);
});

test("the switch is editable by the company only: a client may read it, not change it", () => {
  assert.equal(routeAllowed("agency", "PUT", ["deal-rules", "test-names"]), true);
  assert.equal(routeAllowed("business", "PUT", ["deal-rules", "test-names"]), true);
  assert.equal(routeAllowed("client", "PUT", ["deal-rules", "test-names"]), false);
  assert.equal(routeAllowed("client", "GET", ["deal-rules", "test-names"]), true);
  const route = read("lib/api/test-deals-routes.ts");
  assert.match(route, /ctx\.kind === "client"\) return json\(\{ error: "Not available in this view" \}, 403\)/);
  assert.match(route, /typeof body\.countTestDeals !== "boolean"/);
  assert.match(read("lib/analytics/test-deals-setting.ts"), /delete from pipeline_rollup_state/, "stored totals rebuild after a change");
  const ui = read("app/app/views/deal-rules-settings.tsx");
  assert.match(ui, /Count deals that look like tests/);
  assert.match(ui, /deal-rules-readonly/);
  assert.match(read("app/app/views/settings-hub.tsx"), /<DealRulesSettings \/>/);
});

test("dates: open money has no date in it; won and lost follow the chosen dates (rows and stored totals)", () => {
  const cards = read("lib/analytics/pipeline3-cards.ts"), roll = read("lib/analytics/pipeline3-rollup.ts"), q = read("lib/analytics/pipeline3-queries.ts");
  // the open filters never mention the dates ...
  assert.match(roll, /open: \(db: Db\) => db`\(r\.status = 'open' and r\.has_value and r\.has_owner and not r\.oos and not r\.is_test and not r\.outlier\)`/);
  assert.match(q, /P_OPEN = \(db: Db\) => db`d\.status = 'open' and d\.counted and not d\.outlier`/);
  // ... and the won and lost columns are the ones that take them
  assert.match(cards, /R\.closedIn\(db, "won", o\.from, o\.to\)/);
  assert.match(cards, /R\.closedIn\(db, "lost", o\.from, o\.to\)/);
  assert.match(cards, /d\.last_status_change_at >= \$\{o\.from\} and d\.last_status_change_at < \$\{o\.to\}/);
  // the date bar's dates are what the request carries, and the screen says so in words
  const a = queryOf("pipelines", F, {}), b = queryOf("pipelines", { ...F, from: "2026-10-01" }, {});
  assert.match(a, /from=2026-11-12/); assert.match(a, /to=2026-11-12/);
  assert.notEqual(a, b, "narrowing the dates changes the request (so won and lost), and nothing about open money");
  assert.match(read("app/app/views/pl3/pipes.tsx"), /Open money is as of now\.<\/b> The dates/);
  assert.match(read("app/app/views/pl3/pipes.tsx"), /apply to won and lost/);
});

test("the test-names toggle rides on the request and reads the live scan", () => {
  assert.doesNotMatch(queryOf("pipelines", F), /test=1/);
  assert.match(queryOf("pipelines", { ...F, includeTest: true }), /test=1/);
  assert.match(queryOf("money-flow", { ...F, includeTest: true }), /test=1/, "the river follows the same toggle");
  assert.match(queryOf("pipelines", F, { dir: "asc" }), /dir=asc/);
  const cards = read("lib/analytics/pipeline3-cards.ts");
  assert.match(cards, /\(await rollupFresh\(s, o\.location\)\)\.fresh && !o\.includeTest/, "stored totals leave test names out, so counting them needs the live scan");
  assert.match(cards, /\(\$\{inclTest\}::boolean or not d\.is_test\)/, "won and lost count them too");
  assert.match(read("lib/api/pipeline3-routes.ts"), /includeTest: f\.includeTest, asc: sp\.get\("dir"\) === "asc"/);
});

test("test-names line: left out with one tap to count; counted by toggle or setting says so", () => {
  const base: Pl3Cards["totals"] = { pipelines: 2, emptyHidden: 0, openValue: 0, wonValue: 0, lostValue: 0, openCount: 0, wonCount: 0, lostCount: 0, staleCount: 0, noOwnerCount: 0 };
  assert.equal(testNamesNote(undefined), null);
  assert.equal(testNamesNote(base), null);
  const out = testNamesNote({ ...base, testCount: 25, testValue: 40700, countsTests: null });
  assert.equal(out?.text, "25 deals ($40,700) left out: test names."); assert.equal(out?.action, "count");
  const on = testNamesNote({ ...base, testCount: 25, testValue: 40700, countsTests: "toggle" });
  assert.match(on?.text ?? "", /counted in these rows/); assert.equal(on?.action, "leave");
  const one = testNamesNote({ ...base, testCount: 1, testValue: 100, countsTests: null });
  assert.match(one?.text ?? "", /^1 deal \(\$100\) left out/);
  const setting = testNamesNote({ ...base, testCount: 0, countsTests: "setting" });
  assert.match(setting?.text ?? "", /Settings, Targets/); assert.equal(setting?.action, null);
});

test("pagination: one button below the last page, 'Showing 12 of 22', gone when everything is shown", () => {
  const rk = "k";
  let p = pageProgress({ "k#": { n: 12, next: "100|L|P12" } }, rk, [], 22);
  assert.equal(p.label, "Showing 12 of 22"); assert.equal(p.next, "100|L|P12"); assert.equal(p.loading, false); assert.equal(p.done, false);
  // the button was pressed: the new page is loading, so the button must not offer the OLD cursor again
  p = pageProgress({ "k#": { n: 12, next: "100|L|P12" } }, rk, ["100|L|P12"], 22);
  assert.equal(p.loading, true); assert.equal(p.next, null); assert.equal(p.label, "Showing 12 of 22");
  // the second page arrived: 22 of 22, nothing more
  p = pageProgress({ "k#": { n: 12, next: "100|L|P12" }, "k#100|L|P12": { n: 10, next: null } }, rk, ["100|L|P12"], 22);
  assert.equal(p.label, "Showing 22 of 22"); assert.equal(p.next, null); assert.equal(p.done, true);
  // a new range (new key) starts again from the first page
  p = pageProgress({ "k#": { n: 12, next: "x" } }, "other", [], 5);
  assert.equal(p.loading, true); assert.equal(p.shown, 0);
  // the screen renders ONE button, after the rows, and no page draws its own
  const ui = read("app/app/views/pl3/pipes.tsx");
  assert.equal((ui.match(/data-testid="pl-more"/g) ?? []).length, 1);
  assert.match(ui, /<\/ul>\s*<div className="pl-more" data-testid="pl-more-bar">/);
});

test("rows: quiet notes keep the no-value info; nothing-yet pipelines get words, not placeholder lines", () => {
  assert.deepEqual(rowNotes(card()), []);
  assert.deepEqual(rowNotes(card({ zeroValueCount: 3 })), ["3 deals without a value"]);
  assert.deepEqual(rowNotes(card({ zeroValueCount: 1, noOwnerCount: 2 })), ["1 deal without a value", "2 deals without an owner"]);
  const ui = read("app/app/views/pl3/pipes.tsx");
  assert.match(ui, /Nothing in this pipeline yet\./);
  assert.match(ui, /stages\.every\(\(s\) => s\.value <= 0\)\) return <span className="pl-mini pl-mini-none"/, "no empty dashed bar");
  assert.match(read("app/app/views/pl3/pl3.css"), /@media \(max-width: 760px\)[\s\S]*\.pl-row-head \{ display: none; \}/, "rows stack on a phone");
});
