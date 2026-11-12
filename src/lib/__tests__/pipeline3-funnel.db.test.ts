import assert from "node:assert/strict";
import { test } from "node:test";

// DB test for the history funnel and the stuck-in-step list (flag pl_history_funnel). Runs only when ROLLUP_DB_TEST=1 and ONE connection (DB_POOL_MAX=1): the fixture lives in TEMPORARY tables
// that shadow the real ones for this connection, so nothing real is read or written.
//   ROLLUP_DB_TEST=1 DB_POOL_MAX=1 npx tsx --env-file=.env.local --test src/lib/__tests__/pipeline3-funnel.db.test.ts
const RUN = process.env.ROLLUP_DB_TEST === "1";

test("funnel counts, dwell, drill rows and the stuck ranking on a fixture", { skip: !RUN }, async () => {
  const { sql } = await import("../db");
  const { funnel, funnelDeals, stuck } = await import("../analytics/pipeline3-funnel");
  const db = sql();
  for (const t of ["installations", "locations", "pipelines", "cached_opportunities", "cached_contacts", "deal_facts", "deal_stage_stats", "stage_rules", "deal_history", "team_names"]) {
    await db.unsafe(`create temp table ${t} (like public.${t} including defaults)`);
  }
  // our own table (the migration may not be applied where this runs): same shape as the migration
  await db`create temp table pl_history_settings (installation_id uuid primary key, min_sample integer not null default 10, exclude_test boolean not null default true, default_pipeline text, updated_at timestamptz not null default now())`;
  const inst = "00000000-0000-4000-8000-000000000002", other = "00000000-0000-4000-8000-000000000003", loc = "locFunnel1", day = 86_400_000, ago = (d: number) => new Date(Date.now() - d * day);
  await db`insert into installations (id) values (${inst})`.catch(async () => { await db.unsafe(`insert into installations (id, company_id) values ('${inst}', 'c2')`); });
  await db`insert into locations (installation_id, location_id, name) values (${inst}, ${loc}, 'Funnel account')`;
  await db`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${inst}, ${loc}, 'p1', 'Sales', ${db.json([{ id: "s1", name: "New" }, { id: "s2", name: "Proposal" }])})`;
  await db`insert into pl_history_settings (installation_id, min_sample, exclude_test) values (${inst}, 5, true)`;
  const deal = (id: string, o: Record<string, unknown>) => ({ installation_id: inst, location_id: loc, opportunity_id: id, pipeline_id: "p1", stage_id: "s1", contact_id: `c${id}`, contact_name: `Person ${id}`, name: `Deal ${id}`, monetary_value: 1000, status: "open", assigned_to: "u1", source: "web",
    last_stage_change_at: ago(5), last_status_change_at: ago(5), created_remote_at: ago(40), updated_remote_at: ago(5), last_action_at: ago(5), synced_at: new Date(), ...o });
  const rows = [
    ...["f1", "f2", "f3", "f4", "f5", "f6"].map((id) => deal(id, { stage_id: "s2" })),
    deal("f7", { status: "lost", last_status_change_at: ago(4) }), deal("f8", {}), deal("f9", { name: "Test deal", stage_id: "s2" }), deal("f10", {}), deal("f11", { status: "won", stage_id: "s2" }),
    // stuck fixtures (all in Proposal, which has history): two real, one $0, one without an owner, one test, one within the usual time
    deal("k1", { stage_id: "s2", monetary_value: 5000, last_stage_change_at: ago(40) }), deal("k2", { stage_id: "s2", monetary_value: 3000, last_stage_change_at: ago(20) }),
    deal("k3", { stage_id: "s2", monetary_value: 9000, last_stage_change_at: ago(8) }), deal("k4", { stage_id: "s2", monetary_value: 0, last_stage_change_at: ago(50) }),
    deal("k5", { stage_id: "s2", assigned_to: null, last_stage_change_at: ago(50) }), deal("k6", { stage_id: "s2", name: "Demo deal", last_stage_change_at: ago(50) }),
  ];
  await db`insert into cached_opportunities ${db(rows as never)}`;
  let n = 0;
  const ev = (opp: string, kind: "created" | "stage", to: string, at: Date) => ({ id: ++n, installation_id: inst, location_id: loc, opportunity_id: opp, kind, event_key: `${opp}-${n}`, to_value: to, at });
  const hist = [
    ...["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11"].map((id) => ev(id, "created", "s1", ago(10))),
    ...["f1", "f2", "f3", "f4", "f5", "f6", "f9", "f10", "f11"].map((id) => ev(id, "stage", "s2", ago(5))),
    ev("f10", "stage", "s1", ago(3)),
  ];
  await db`insert into deal_history ${db(hist as never)}`;
  await db`insert into deal_stage_stats (installation_id, location_id, stage_id, stays, median_days, p75_days, p90_days, limit_days, is_estimate) values (${inst}, ${loc}, 's2', 30, 6, 10, 14, 10, false), (${inst}, ${loc}, 's1', 3, 4, 5, 6, 5, true)`;

  const scope = { inst, allowed: null }, to = new Date(Date.now() + day), from = new Date(Date.now() - 30 * day), st = { minSample: 5, excludeTest: true, defaultPipeline: null };
  const fu = await funnel(scope, { from, to }, st);
  assert.equal(fu.pipeline, "Sales");
  assert.equal(fu.empty, false);
  const [s1, s2] = fu.steps;
  assert.deepEqual([s1.name, s1.entered, s1.advanced, s1.dropped, s1.here, s1.other], ["New", 10, 8, 1, 1, 0], "test deal f9 is left out; won and moved-on count as advanced");
  assert.equal(s1.entered, s1.advanced + s1.dropped + s1.here + s1.other, "the outcomes add up to entered");
  assert.equal(s1.advanceRate, 0.8);
  assert.equal(s1.medianDays, 5, "typical stay in New is 5 days");
  assert.equal(s2.name, "Proposal");
  assert.equal(s2.entered, 8);
  assert.equal(s2.medianDays, null, "one finished stay is under the minimum sample: no made-up median");
  // a bigger minimum sample hides the rate (not enough data yet), never a fake number
  const few = await funnel(scope, { from, to }, { ...st, minSample: 50 });
  assert.equal(few.steps[0].advanceRate, null);
  // counts equal rows: every number opens exactly its deals
  for (const s of fu.steps) {
    for (const k of ["entered", "advanced", "dropped", "here", "other"] as const) {
      const l = await funnelDeals(scope, { from, to, pipeline: "Sales" }, st, s.key, k, 0, 100, null);
      assert.equal(l.total, s[k], `${s.name} ${k}: count equals its list`);
      assert.equal(l.rows.length, s[k]);
    }
  }
  // dates after everything: nothing entered, shown as empty
  const none = await funnel(scope, { from: ago(-5), to: ago(-9) }, st);
  assert.equal(none.empty, true);
  // another installation sees none of this
  const foreign = await funnel({ inst: other, allowed: null }, { from, to }, st);
  assert.equal(foreign.pipeline, null);
  assert.equal((await stuck({ inst: other, allowed: null }, { from, to }, st, 0, 20, null)).total, 0);
  // an installation limited to a different account sees nothing
  assert.equal((await stuck({ inst, allowed: ["someoneElse"] }, { from, to }, st, 0, 20, null)).total, 0);

  const sk = await stuck(scope, { from, to }, st, 0, 20, null);
  assert.deepEqual(sk.rows.map((r) => r.name), ["Deal k1", "Deal k2"], "ranked by value; $0, ownerless, test and within-usual deals are left out");
  assert.equal(sk.total, 2);
  assert.equal(sk.totalValue, 8000);
  assert.equal(sk.estimate, true);
  assert.ok(sk.notJudged > 0, "deals in New (3 past stays) are not judged");
  assert.ok(sk.rows[0].why?.includes("usually move within 10 days"));
  // a high minimum sample judges nothing
  assert.equal((await stuck(scope, { from, to }, { ...st, minSample: 50 }, 0, 20, null)).total, 0);
  await db.end();
});
