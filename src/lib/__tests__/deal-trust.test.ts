import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DAYS_STALE_HEADER_TIP, HOW_LEFT_OUT, HOW_STALE_WORKED_OUT, LEFT_OUT_CHIP, countingLine, detectOutreach, leftOutLine, leftOutReasons, looksLikeTestName, stageLimitDays, staleVerdict,
  type LeftOutSummary, type TrustDeal,
} from "../analytics/deal-trust.ts";

// The dollar trust rules (CLAUDE.md 13A, docs/METRICS.md "Deal dollars you can trust"). Fixtures are the real screenshot: one $1,000,000 test deal, one $100,000 deal, and
// 480 identical $2,000 deals in the intro step of a cold-email outreach pipeline, next to a normal sales pipeline with mixed values.

const deal = (id: string, o: Partial<TrustDeal> = {}): TrustDeal => ({ id, locationId: "L1", pipelineKey: "sales", stageKey: "qualified", value: 5000, owner: "u1", name: `Deal ${id}`, contactName: `Person ${id}`, ...o });
const outreach = Array.from({ length: 480 }, (_, i) => deal(`o${i}`, { pipelineKey: "cold mail", stageKey: "intro email", value: 2000 }));
const sales = [4200, 5100, 6800, 3900, 7500, 4800, 5600, 6100].map((v, i) => deal(`s${i}`, { value: v, stageKey: i < 4 ? "qualified" : "proposal" }));

test("480 identical $2,000 deals in an outreach pipeline are left out as outreach", () => {
  const out = leftOutReasons([...sales, ...outreach]);
  assert.equal([...out.values()].filter((r) => r === "outreach").length, 480);
  for (const s of sales) assert.equal(out.has(s.id), false, "real sales deals stay counted");
});

test("the same $2,000 on 20+ deals in a step is a default value even when the pipeline is not an outreach list", () => {
  const mixed = [...Array.from({ length: 20 }, (_, i) => deal(`d${i}`, { value: 2000 })), ...Array.from({ length: 40 }, (_, i) => deal(`m${i}`, { value: 1000 + i * 137, stageKey: i % 2 ? "qualified" : "proposal" }))];
  const out = leftOutReasons(mixed);
  assert.equal([...out.entries()].filter(([, r]) => r === "default_value").length, 20);
  assert.equal(detectOutreach(mixed).size, 0);
});

test("30% of a step with at least 5 deals is a default value; 4 of 10 and 2 of 3 are not", () => {
  const five = [...Array.from({ length: 5 }, (_, i) => deal(`f${i}`, { value: 900 })), ...Array.from({ length: 5 }, (_, i) => deal(`g${i}`, { value: 1000 + i * 111 }))];
  assert.equal([...leftOutReasons(five).values()].filter((r) => r === "default_value").length, 5);
  const four = [...Array.from({ length: 4 }, (_, i) => deal(`f${i}`, { value: 900 })), ...Array.from({ length: 6 }, (_, i) => deal(`g${i}`, { value: 1000 + i * 111 }))];
  assert.equal(leftOutReasons(four).size, 0, "4 of 10 is under the 5-deal minimum");
  const three = [deal("a", { value: 700 }), deal("b", { value: 700 }), deal("c", { value: 1900 })];
  assert.equal(leftOutReasons(three).size, 0, "2 of 3 is not a pattern");
});

test("a round $1,000,000 and 100 times the account median are outliers, even in a pipeline marked In use", () => {
  const big = [...sales, deal("million", { value: 1_000_000 }), deal("huge", { value: 900_000 })];
  const out = leftOutReasons(big, () => "in_use");
  assert.equal(out.get("million"), "outlier");
  assert.equal(out.get("huge"), "outlier"); // 900,000 >= 100 x the median (about 5,300)
  assert.equal(out.size, 2);
  assert.equal(leftOutReasons([deal("a", { value: 2_000_000 }), ...sales]).get("a"), "outlier", "any round million");
  assert.equal(leftOutReasons([deal("a", { value: 1_250_000 }), ...Array.from({ length: 5 }, (_, i) => deal(`z${i}`, { value: 400_000 + i * 90_000 }))]).has("a"), false, "1,250,000 next to similar deals is a real deal");
});

test("test-looking names are left out as test; ordinary names are not", () => {
  assert.equal(looksLikeTestName("KD Squares Test"), true);
  assert.equal(looksLikeTestName(null, "Demo lead"), true);
  assert.equal(looksLikeTestName("xtest-abc"), true);
  assert.equal(looksLikeTestName("Contested Will", "Attestation Ltd"), false);
  assert.equal(leftOutReasons([deal("t", { name: "Test deal" }), ...sales]).get("t"), "test");
});

test("the owner's rule wins: a pipeline marked In use is never an outreach list or a default value; Not in use is left to stage rules", () => {
  const out = leftOutReasons(outreach, (_l, p) => (p === "cold mail" ? "in_use" : null));
  assert.equal(out.size, 0);
  assert.equal([...leftOutReasons(outreach, () => "not_in_use").values()].includes("outreach"), false, "not in use is dropped by stage-rules (in SQL: outOfScope), never double-named outreach");
});

test("deals without a value or an owner are never judged (they are already left out)", () => {
  const out = leftOutReasons([deal("n1", { owner: null, value: 1_000_000 }), deal("n2", { value: 0 }), ...sales]);
  assert.equal(out.size, 0);
});

test("outreach needs 20 deals and one step-and-amount cell holding 80%", () => {
  assert.equal(detectOutreach(outreach.slice(0, 19)).size, 0);
  assert.equal(detectOutreach(outreach.slice(0, 20)).size, 1);
  const mixedAmounts = outreach.map((d, i) => ({ ...d, value: 1000 + (i % 10) * 100 }));
  assert.equal(detectOutreach(mixedAmounts).size, 0, "mixed amounts across 10 values: no single cell holds 80%");
});

test("per-step staleness: judged only with 10 finished stays; limit is the 75th percentile, 3 to 60 days; else not judged", () => {
  assert.equal(stageLimitDays(9, 12), null);
  assert.equal(stageLimitDays(null, 12), null);
  assert.equal(stageLimitDays(10, null), null);
  assert.equal(stageLimitDays(10, 12.5), 12.5);
  assert.equal(stageLimitDays(40, 1), 3);
  assert.equal(stageLimitDays(40, 400), 60);
  assert.equal(staleVerdict(13, 12.5), "stale");
  assert.equal(staleVerdict(12, 12.5), "ok");
  assert.equal(staleVerdict(900, null), "not_judged", "a step with no history never calls a deal stale");
});

const summary: LeftOutSummary = {
  parts: [
    { reason: "outreach", deals: 480, dollars: 960_000, detail: "in 1 outreach list" },
    { reason: "outlier", deals: 1, dollars: 1_000_000, detail: "largest $1,000,000" },
  ],
  deals: 481, dollars: 1_960_000, notJudged: 3, pipelinesCounted: 2, pipelinesTotal: 3,
};
test("the headline basis says what was counted and what was left out, in plain words", () => {
  assert.equal(countingLine(12, summary), "Estimate. Counting 12 deals in 2 of 3 pipelines.");
  assert.equal(countingLine(1, { pipelinesCounted: 1, pipelinesTotal: 1 }), "Estimate. Counting 1 deal in 1 pipeline.");
  const line = leftOutLine(summary) as string;
  assert.match(line, /^Left out: 481 deals worth \$1,960,000/);
  assert.match(line, /480 deals worth \$960,000 in 1 outreach list: not sales deals/);
  assert.match(line, /1 deal worth \$1,000,000 looks like a test or placeholder \(largest \$1,000,000\)/);
  assert.equal(leftOutLine({ ...summary, parts: [], deals: 0, dollars: 0 }), null);
  const dv = leftOutLine({ ...summary, parts: [{ reason: "default_value", deals: 480, dollars: 960_000, detail: "the same $2,000 on 480 deals" }], deals: 480, dollars: 960_000 }) as string;
  assert.match(dv, /the same \$2,000 on 480 deals: looks like a default value/);
  assert.ok(HOW_STALE_WORKED_OUT.length > 50 && HOW_LEFT_OUT.length > 50 && DAYS_STALE_HEADER_TIP.includes("changed step"));
  assert.equal(Object.keys(LEFT_OUT_CHIP).length, 4);
});

// ---- one function: every dollar surface reads the same SQL rules (no screen keeps its own age or its own counted-deal formula) ----
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const SURFACES = [
  "lib/analytics/today3-money.ts", "lib/analytics/today3-queries.ts", "lib/analytics/audit-queries.ts", "lib/analytics/queries.ts", "lib/analytics/clients3-queries.ts",
  "lib/analytics/people-queries.ts", "lib/analytics/people3-rollup.ts", "lib/analytics/pipeline3-queries.ts", "lib/analytics/pipeline-queries.ts",
];
test("Pipeline, Today, Account audit, Clients, People and the brief all use the shared counted-deal and stale fragments", () => {
  for (const f of SURFACES) {
    const src = read(f);
    assert.match(src, /stage-rules-sql/, `${f} reads the shared fragments`);
    assert.doesNotMatch(src, /last_stage_change_at, [a-z.]*created_remote_at\) < now\(\) - \$\{`\$\{STALE_DEAL_DAYS\} days`\}/, `${f} has no global stale age`);
    assert.doesNotMatch(src, /act < now\(\) - make_interval\(days => \$\{[a-zA-Z.]*staleDays\}::int\)/, `${f} has no global stale age`);
  }
  for (const f of ["lib/analytics/today3-money.ts", "lib/analytics/audit-queries.ts", "lib/analytics/clients3-queries.ts", "lib/analytics/people3-rollup.ts", "lib/analytics/today3-queries.ts", "lib/analytics/queries.ts"]) {
    assert.match(read(f), /dealIsStale\(\)/, `${f} judges stale with the one fragment`);
  }
  // the counted-deal formula is stated once: queries.ts used its own copy before
  assert.doesNotMatch(read("lib/analytics/queries.ts"), /monetary_value, 0\) > 0 and o\.assigned_to is not null and not \$\{outOfScope\(\)\}\) counted/);
  assert.match(read("lib/analytics/stage-rules-sql.ts"), /valueSuspect\(\)\} is null\)`/, "countedInScope drops left-out deals");
  // Today's money row, the Pipeline and the Overview take their basis line from the same function
  assert.match(read("lib/analytics/today3-money.ts"), /dealTrust\(/);
  assert.match(read("lib/analytics/pipeline3-queries.ts"), /dealTrust\(/);
  assert.match(read("lib/api/router.ts"), /dealTrust\(/);
});

test("SQL and TypeScript state the same thresholds", () => {
  const sqlSrc = read("lib/analytics/stage-rules-sql.ts");
  for (const c of ["DEFAULT_VALUE_MIN_DEALS", "DEFAULT_VALUE_MIN_SHARE_DEALS", "DEFAULT_VALUE_SHARE", "OUTLIER_MULTIPLE", "OUTLIER_MIN_DEALS", "ROUND_AMOUNT", "OUTREACH_MIN_DEALS", "OUTREACH_SHARE", "MIN_STAGE_STAYS", "TEST_NAME_PATTERN"]) {
    assert.match(sqlSrc, new RegExp(`\\$\\{${c}\\}`), `${c} is read by the SQL fragment`);
  }
});

test("the drill list opens in view and the left-out toggle exists", () => {
  const mod = read("app/app/views/td3/module.tsx");
  assert.match(mod, /scrollIntoView\(\{ block: "start"/);
  assert.match(mod, /el\.focus\(/);
  assert.match(mod, /td-drill-left-toggle/);
  assert.match(read("app/app/views/td3/today-strip.tsx"), /TrustBasis/);
  assert.match(read("app/app/views/deals.tsx"), /DAYS_STALE_HEADER_TIP/);
  assert.match(read("app/app/views/deals.tsx"), /stale-left-toggle/);
});
