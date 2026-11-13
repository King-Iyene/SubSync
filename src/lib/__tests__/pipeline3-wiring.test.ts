import assert from "node:assert/strict";
import { test } from "node:test";
import { adapt, API_PART, dealsOf, flowOf, forecastOf, healthOf, overviewIsEmpty, overviewOf, peopleOf, proofOf, queryOf } from "../../app/app/views/pl3/adapters.ts";
import { allowedAccount } from "../api/pl-guard.ts";
import { routeAllowed } from "../access.ts";

// The screens speak cents and their own words; the API speaks dollars and its own. These tests pin the translation and the address every drill-down builds.
const F = { from: "2026-10-01", to: "2026-11-12", locationId: "", pipeline: "", ownerId: "", q: "" };

test("every screen part has an API part, and an address that the route accepts", () => {
  const parts = ["money-flow", "overview", "needs-attention", "won-lost", "forecast", "people", "sources", "stage-history", "health", "proof", "list", "accounts"] as const;
  for (const p of parts) {
    const u = new URL("http://x/" + queryOf(p, F, {}));
    assert.equal(u.pathname, "/pipeline3");
    assert.equal(u.searchParams.get("part"), API_PART[p]);
    assert.equal(u.searchParams.get("to"), "2026-11-12");
    assert.equal(u.searchParams.get("from"), "2026-10-01");
  }
});

test("drill-down words become the server's own: status and stale are a bucket, lostReason a reason, the stage key and page are passed whole", () => {
  const u = new URL("http://x/" + queryOf("list", F, { status: "lost", lostReason: "Went quiet", stage: "sales|proposal sent", owner: "u1", page: 3, pageSize: 50, expect: 12 })).searchParams;
  assert.equal(u.get("bucket"), "lost"); assert.equal(u.get("reason"), "Went quiet"); assert.equal(u.get("stage"), "sales|proposal sent"); assert.equal(u.get("owner"), "u1");
  assert.equal(u.get("page"), "2"); assert.equal(u.get("size"), "50"); assert.equal(u.get("expect"), null);
  assert.equal(new URL("http://x/" + queryOf("list", F, { stale: 1, status: "open" })).searchParams.get("bucket"), "stale");
  assert.equal(new URL("http://x/" + queryOf("list", F, { status: "lost", lostReason: "No reason recorded" })).searchParams.get("reason"), "none");
  assert.equal(new URL("http://x/" + queryOf("list", F, { status: "x; select 1" })).searchParams.get("bucket"), null, "an unknown status is not passed on");
  assert.equal(new URL("http://x/" + queryOf("accounts", F, {})).searchParams.get("size"), "100");
});

test("deals: dollars become cents, the page counts from 1, a bad answer is an empty list", () => {
  const row = { opportunityId: "o1", locationId: "l1", accountName: "A", contactId: "c", contactName: "Sam", name: "Roof", url: "https://crm/x", pipelineId: "p", pipelineName: "Sales", stageId: "s", stageName: "Proposal", status: "open", value: 1234.5, bucket: "stale", ownerId: null, ownerName: null, source: null, lostReason: null, createdAt: null, lastStageChangeAt: null, daysInStage: 20.4, staleLimitDays: 12, stale: true, health: 30, healthWhy: null, appointment: null, why: null, dnd: false, outlier: false, isTest: false };
  const d = dealsOf({ total: 41, page: 1, size: 20, rows: [row] } as never);
  assert.equal(d.total, 41); assert.equal(d.page, 2); assert.equal(d.rows[0].valueCents, 123450); assert.equal(d.rows[0].daysInStage, 20); assert.equal(d.rows[0].url, "https://crm/x");
  assert.deepEqual(dealsOf(null), { total: 0, page: 1, pageSize: 20, rows: [], next: null });
});

test("an empty or missing answer never throws and shows nothing yet", () => {
  for (const p of Object.keys(API_PART)) { for (const raw of [null, {}, { rows: null }]) assert.doesNotThrow(() => adapt(p as never, raw)); }
  assert.equal(overviewOf(null).headline.openCount, 0);
  assert.equal(forecastOf(null).midCents, null);
  assert.deepEqual(peopleOf(null), []); assert.deepEqual(healthOf(null), []);
  assert.equal(proofOf(null).rows.length, 0);
});

test("forecast: a range only when there is enough data; the money is in cents", () => {
  const none = forecastOf({ next30: { value: null, low: null, high: null, enough: false, estimate: true, formula: "f", minNote: "Needs 15" }, stageProb: [], minClosed: 15, closedDeals: 4 } as never);
  assert.equal(none.midCents, null); assert.match(none.formula, /Needs 15/);
  const ok = forecastOf({ next30: { value: 1000, low: 800, high: 1200, enough: true, estimate: true, formula: "f", minNote: null }, stageProb: [], minClosed: 15, closedDeals: 30 } as never);
  assert.deepEqual([ok.lowCents, ok.midCents, ok.highCents], [80000, 100000, 120000]);
});

test("money flow: only the chosen pipeline's stages, lost money lands on its own stage, the replay lines up with the stage order", () => {
  const dwell = (m: number | null) => ({ medianDays: m, normalDays: m, pressure: m === null ? null : 1, enough: m !== null });
  const m = {
    pipelineId: "sales", pipelines: [{ id: "sales", name: "Sales", locationId: "l" }, { id: "other", name: "Other", locationId: "l" }],
    stages: [
      { id: "sales|b", pipelineId: "sales", name: "B", order: 2, openCount: 3, openValue: 300, dwell: dwell(5), clog: { count: 1, value: 100 }, velocity: 0.5 },
      { id: "sales|a", pipelineId: "sales", name: "A", order: 1, openCount: 5, openValue: 500, dwell: dwell(null), clog: { count: 0, value: 0 }, velocity: null },
      { id: "other|x", pipelineId: "other", name: "X", order: 1, openCount: 9, openValue: 900, dwell: dwell(1), clog: { count: 0, value: 0 }, velocity: 1 },
    ],
    edges: [], drain: [{ stageId: "sales|b", reason: "Went quiet", count: 2, value: 40, noReason: false }, { stageId: "other|x", reason: "Price", count: 9, value: 9, noReason: false }], drainTotal: { value: 49, n: 11 },
    vault: { won: { value: 70, n: 2 }, wonLast7: { value: 10, n: 1 }, target: null },
    people: [{ ownerId: null, name: "Nobody", open: { value: 0, n: 0 }, won: { value: 0, n: 0 }, lost: { value: 0, n: 0 }, staleCount: 0, stages: [{ stageId: "sales|a", count: 2, value: 20 }] }],
    leak: { text: "t", fromStageId: "sales|b", toStageId: null, lostValue: 40, lostCount: 2 }, outliers: [], period: { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }, historyDays: 40, enoughHistory: true,
  };
  const r = { days: 30, enough: true, historySince: "2026-10-01", frames: [{ day: "2026-10-02", stages: [{ stageId: "sales|b", count: 1, value: 10 }, { stageId: "sales|a", count: 2, value: 20 }], wonValue: 5, lostValue: 1, moved: [] }] };
  const f = flowOf(m as never, r as never);
  assert.deepEqual(f.stages.map((s) => s.name), ["A", "B"]);
  assert.equal(f.stages[1].lostValueCents, 4000); assert.equal(f.stages[1].lostCount, 2); assert.equal(f.stages[0].lostValueCents, 0);
  assert.deepEqual(f.drains.map((d) => d.reason), ["Went quiet"]);
  assert.equal(f.won.valueCents, 7000); assert.equal(f.leak?.fromStage, "B"); assert.equal(f.leak?.toStage, "the drain");
  assert.deepEqual(f.replay?.[0].stageValueCents, [2000, 1000]); assert.deepEqual(f.people[0].stages.map((s) => s.count), [2, 0]); assert.equal(f.people[0].id, "none");
  assert.equal(flowOf(m as never, { ...r, enough: false } as never).replay, null, "no replay under the minimum recorded history");
});

test("the one account guard: well formed, inside the session's accounts, never a foreign or odd id", () => {
  assert.equal(allowedAccount(null, "locA123"), "locA123");
  assert.equal(allowedAccount(["locA123"], "locA123"), "locA123");
  assert.equal(allowedAccount(["locA123"], "locB456"), null, "another account of the same agency that the session may not read");
  assert.equal(allowedAccount([], "locA123"), null);
  for (const bad of [undefined, null, 5, "", "ab", "a b c", "x'; select 1", "../etc", "a".repeat(65), ["locA123"]]) assert.equal(allowedAccount(null, bad), null);
});

test("route rules: the pipeline reads and the checked change routes are open to the right kinds of person", () => {
  for (const kind of ["agency", "business", "client"] as const) {
    assert.equal(routeAllowed(kind, "GET", ["pipeline3"]), true, `${kind} reads pipeline3`);
    assert.equal(routeAllowed(kind, "GET", ["pipeline3", "act", "panel"]), true, `${kind} opens the deal panel`);
  }
  assert.equal(routeAllowed("agency", "POST", ["pipeline3", "act", "apply"]), true);
  assert.equal(routeAllowed("client", "DELETE", ["pipeline3"]), false);
});

// Regression (13 Nov): the Overview said "No deals to show yet" for accounts with thousands of open deals, because the empty rule asked the MONEY count (deals with a value and an owner) instead of the open deals.
test("the Overview is never empty while open deals exist, with or without money, and whatever the dates are", () => {
  // The live shape: 9,002 open deals, none counted in the money, nothing won or lost in the dates (no stage moves in the window).
  const live = overviewOf({ openCount: 0, openAll: 9002, openValue: { value: 0, n: 0 }, stale: { count: 0, value: 0 }, wonLast30: { value: 0, n: 0 }, lostLast30: { value: 0, n: 0 }, winRate: { value: null, n: 0, of: 0, enough: false }, health: { score: 0, noOwner: 151, noValue: 8838, test: 13, outliers: 0 }, headline: "No deals in play yet." } as never);
  assert.equal(live.headline.openAll, 9002);
  assert.equal(overviewIsEmpty(live.headline), false);
  // Money deals only (an older answer without openAll) is not empty either.
  assert.equal(overviewIsEmpty(overviewOf({ openCount: 3, openValue: { value: 100, n: 3 } } as never).headline), false);
  // Closed deals in the dates alone keep it open too.
  assert.equal(overviewIsEmpty(overviewOf({ openCount: 0, openAll: 0, wonLast30: { value: 500, n: 1 } } as never).headline), false);
  // Truly nothing: the empty state shows.
  assert.equal(overviewIsEmpty(overviewOf({ openCount: 0, openAll: 0 } as never).headline), true);
  assert.equal(overviewIsEmpty(overviewOf(null).headline), true);
});
