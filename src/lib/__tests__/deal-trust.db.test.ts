import assert from "node:assert/strict";
import { test } from "node:test";

// DB test for the dollar trust rules: the SQL (stage-rules-sql.ts) against the pure rules (deal-trust.ts) and against an independent SQL sum, on a fixture. Runs only when ROLLUP_DB_TEST=1 and ONE
// connection (DB_POOL_MAX=1): the fixture lives in TEMPORARY tables that shadow the real ones for this connection, so nothing real is read or written.
//   ROLLUP_DB_TEST=1 DB_POOL_MAX=1 npx tsx --env-file=.env.local --test src/lib/__tests__/deal-trust.db.test.ts
const RUN = process.env.ROLLUP_DB_TEST === "1";

test("left-out and stale dollars: SQL equals the pure rules, count equals rows, totals equal an independent sum, the owner's rule wins", { skip: !RUN }, async () => {
  const { sql } = await import("../db");
  const { dealTrust, leftOutRows } = await import("../analytics/deal-trust-queries");
  const { staleDealsPage } = await import("../analytics/queries");
  const { leftOutReasons } = await import("../analytics/deal-trust");
  const db = sql();
  for (const t of ["installations", "locations", "pipelines", "cached_opportunities", "stage_rules", "deal_stage_stats"]) await db.unsafe(`create temp table ${t} (like public.${t} including defaults)`);
  const inst = "00000000-0000-4000-8000-0000000000a1", other = "00000000-0000-4000-8000-0000000000a2", L1 = "locTrust1", L2 = "locTrust2", day = 86_400_000, ago = (d: number) => new Date(Date.now() - d * day);
  for (const i of [inst, other]) await db`insert into installations (id) values (${i})`.catch(async () => { await db.unsafe(`insert into installations (id, company_id) values ('${i}', 'c-${i.slice(-2)}')`); });
  await db`insert into locations (installation_id, location_id, name) values (${inst}, ${L1}, 'Trust one'), (${inst}, ${L2}, 'Trust two'), (${other}, 'locOther', 'Other agency')`;
  const stages = (...s: Array<[string, string]>) => db.json(s.map(([id, name]) => ({ id, name })));
  await db`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values
    (${inst}, ${L1}, 'p_sales', 'Sales', ${stages(["s1", "Qualified"], ["s2", "Proposal"])}), (${inst}, ${L1}, 'p_cold', 'Cold Mail', ${stages(["c1", "Intro Email"])}),
    (${inst}, ${L2}, 'p_sales', 'Sales', ${stages(["s1", "Qualified"], ["s2", "Proposal"])}), (${other}, 'locOther', 'p_sales', 'Sales', ${stages(["s1", "Qualified"])})`;
  // Proposal has 12 finished stays and a usual limit of 10 days; Qualified has 3 (not judged)
  await db`insert into deal_stage_stats (installation_id, location_id, stage_id, stays, median_days, p75_days, p90_days, limit_days, is_estimate) values
    (${inst}, ${L1}, 's2', 12, 6, 10, 15, 10, false), (${inst}, ${L1}, 's1', 3, 4, 8, 9, 8, true)`;
  const base = { status: "open", assigned_to: "u1", created_remote_at: ago(60), updated_remote_at: ago(1), synced_at: new Date() };
  const rows: Array<Record<string, unknown>> = [];
  const add = (loc: string, id: string, o: Record<string, unknown>) => {
    const { inst: owner, ...rest } = o;
    rows.push({ installation_id: owner ?? inst, location_id: loc, opportunity_id: id, contact_id: `c${id}`, contact_name: `Person ${id}`, name: `Deal ${id}`, pipeline_id: "p_sales", stage_id: "s2", monetary_value: 5000, last_stage_change_at: ago(2), ...base, ...rest });
  };
  // L1 sales: two stale in Proposal (20 days), two fresh in Proposal, three in Qualified (not judged, 90 days in step: never stale)
  [4200, 5100, 6800, 3900, 7500, 4800].forEach((v, i) => add(L1, `p${i}`, { monetary_value: v, last_stage_change_at: ago(i < 2 ? 20 : 3) }));
  [4000, 6000, 8000].forEach((v, i) => add(L1, `q${i}`, { stage_id: "s1", monetary_value: v, last_stage_change_at: ago(90) }));
  add(L1, "million", { monetary_value: 1_000_000, last_stage_change_at: ago(300) });
  add(L1, "testname", { name: "Test deal", monetary_value: 3300 });
  add(L1, "noowner", { assigned_to: null, monetary_value: 9100 });
  add(L1, "zero", { monetary_value: 0 });
  for (let i = 0; i < 25; i++) add(L1, `cold${i}`, { pipeline_id: "p_cold", stage_id: "c1", monetary_value: 2000, last_stage_change_at: ago(900) });
  add(L2, "l2a", { monetary_value: 11000, last_stage_change_at: ago(40) });
  add("locOther", "x1", { inst: other, monetary_value: 77777, stage_id: "s1" });
  await db`insert into cached_opportunities ${db(rows as never)}`;

  const t = await dealTrust(inst, [L1, L2]);
  // the pure rules on the same fixture
  const pure = leftOutReasons(rows.filter((r) => r.installation_id === inst && r.status === "open").map((r) => ({
    id: `${r.location_id}:${r.opportunity_id}`, locationId: r.location_id as string, pipelineKey: r.pipeline_id as string, stageKey: r.stage_id as string, value: Number(r.monetary_value), owner: (r.assigned_to as string | null), name: r.name as string, contactName: r.contact_name as string,
  })));
  const count = (why: string) => [...pure.values()].filter((w) => w === why).length;
  const part = (why: string) => t.leftOut.parts.find((p) => p.reason === why)?.deals ?? 0;
  for (const why of ["outreach", "default_value", "outlier", "test"]) assert.equal(part(why), count(why), `SQL and pure rules agree on ${why}`);
  assert.equal(part("outreach"), 25);
  assert.equal(part("outlier"), 1);
  assert.equal(part("test"), 1);
  // counted: every valued, owned open deal that is not left out; compared with an independent sum
  const [ind] = await db`select count(*)::int n, sum(monetary_value)::float8 d from cached_opportunities where installation_id = ${inst} and status = 'open' and monetary_value > 0 and assigned_to is not null
    and pipeline_id = 'p_sales' and name not ilike '%test%' and monetary_value < 1000000`;
  assert.equal(t.counted.deals, Number(ind.n));
  assert.equal(t.counted.dollars, Math.round(Number(ind.d)));
  // stale: only judged steps (Proposal), past 10 days: p0, p1 (20 days). L2 has no history: not judged. Qualified deals (90 days) are never stale.
  assert.equal(t.stale.deals, 2);
  assert.equal(t.stale.dollars, 4200 + 5100);
  assert.ok(t.leftOut.notJudged >= 4, "deals in steps with too little history are counted as not judged");
  const pg = await staleDealsPage(inst, { ids: [L1, L2], limit: 1 });
  assert.equal(pg.total, t.stale.deals, "the list total equals the figure");
  assert.equal(Math.round(pg.totalValue), t.stale.dollars);
  assert.equal(pg.rows.length, 1, "rows are cut, the total is not");
  // count equals rows
  const lo = await leftOutRows(inst, [L1, L2], null, 100, 0);
  assert.equal(lo.total, t.leftOut.deals);
  assert.equal(lo.rows.length, t.leftOut.deals);
  assert.equal(Math.round(lo.rows.reduce((s, r) => s + r.value, 0)), t.leftOut.dollars);
  // another agency's deal never appears
  assert.equal(lo.rows.some((r) => r.locationId === "locOther"), false);
  assert.equal((await dealTrust(inst, ["locOther"])).counted.deals, 0);
  // the owner's rule wins: mark Cold Mail In use and its 25 deals count again
  await db`insert into stage_rules (installation_id, pipeline_key, stage_key, class) values (${inst}, 'cold mail', '', 'in_use')`;
  const t2 = await dealTrust(inst, [L1, L2]);
  assert.equal(t2.leftOut.parts.some((p) => p.reason === "outreach" || p.reason === "default_value"), false);
  assert.equal(t2.counted.deals, t.counted.deals + 25);
  assert.equal(t2.counted.dollars, t.counted.dollars + 25 * 2000);
  // marked Not in use: out of scope (not counted, not double-named)
  await db`update stage_rules set class = 'not_in_use' where installation_id = ${inst}`;
  const t3 = await dealTrust(inst, [L1, L2]);
  assert.equal(t3.counted.deals, t.counted.deals);
  assert.equal(t3.leftOut.parts.some((p) => p.reason === "outreach"), false);
});
