import assert from "node:assert/strict";
import { test } from "node:test";

// DB test (runs only when ROLLUP_DB_TEST=1, like pipeline-rollup.db.test.ts; needs ONE connection: DB_POOL_MAX=1): the pipeline list on a fixture in TEMPORARY tables.
//  1. narrowing the dates changes won and lost, never open money (open money is as of now);
//  2. deals with a test name are left out (shown as a count and money), counted when the screen asks (includeTest) and always when the company switch is on.
const RUN = process.env.ROLLUP_DB_TEST === "1";

test("pipeline list: dates move won and lost, not open; test names follow the toggle and the company switch", { skip: !RUN }, async () => {
  const { sql } = await import("../db");
  const { pipelineCards } = await import("../analytics/pipeline3-cards");
  const db = sql();
  for (const t of ["installations", "locations", "pipelines", "cached_opportunities", "cached_contacts", "deal_facts", "deal_stage_stats", "stage_rules", "settings"]) {
    await db.unsafe(`create temp table ${t} (like public.${t} including defaults)`);
  }
  await db`create temp table pipeline_rollup (installation_id uuid, location_id text, pipeline_id text, stage_id text default '', owner_id text default '', source text default '', status text, is_test boolean, oos boolean, has_value boolean, has_owner boolean, outlier boolean, stale boolean, big_untouched boolean default false, closed_day date default date '1970-01-01', lost_reason text default '', n integer, value double precision, med_days double precision, norm_days double precision, stays integer, refreshed_at timestamptz default now())`;
  await db`create temp table pipeline_rollup_state (installation_id uuid, location_id text, refreshed_at timestamptz default now(), deals integer default 0, rows_written integer default 0, primary key (installation_id, location_id))`;
  const inst = "00000000-0000-4000-8000-000000000002", loc = "locPl2", day = 86_400_000, ago = (n: number) => new Date(Date.now() - n * day);
  await db.unsafe(`insert into installations (id, company_id) values ('${inst}', 'c2')`);
  await db`insert into locations (installation_id, location_id, name) values (${inst}, ${loc}, 'List account')`;
  await db`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${inst}, ${loc}, 'p1', 'Sales', ${db.json([{ id: "s1", name: "New" }, { id: "s2", name: "Proposal" }])})`;
  const deal = (id: string, o: Record<string, unknown>) => ({ installation_id: inst, location_id: loc, opportunity_id: id, pipeline_id: "p1", stage_id: "s1", contact_id: `c${id}`, contact_name: `Person ${id}`, name: `Deal ${id}`, monetary_value: 1000 + Number(id.replace(/\D/g, "") || 0) * 10, status: "open", assigned_to: "u1", source: "web",
    last_stage_change_at: ago(2), last_status_change_at: ago(2), created_remote_at: ago(40), updated_remote_at: ago(2), last_action_at: ago(2), synced_at: new Date(), ...o });
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => deal(`o${i}`, { monetary_value: 1000 + i * 111 })),
    deal("w1", { status: "won", monetary_value: 3000, last_status_change_at: ago(0.2) }), deal("w2", { status: "won", monetary_value: 500, last_status_change_at: ago(20) }),
    deal("l1", { status: "lost", monetary_value: 700, last_status_change_at: ago(0.2) }),
    ...Array.from({ length: 3 }, (_, i) => deal(`t${i}`, { name: `Test deal 10${i}`, monetary_value: 1500 + i * 100 })),
  ];
  await db`insert into cached_opportunities ${db(rows as never)}`;

  const scope = { inst, allowed: null }, to = new Date(Math.floor(Date.now() / day) * day + day);
  const wide = await pipelineCards(scope, { from: new Date(to.getTime() - 45 * day), to, size: 24 });
  const narrow = await pipelineCards(scope, { from: new Date(to.getTime() - day), to, size: 24 });
  const w = wide.cards[0], n = narrow.cards[0];
  assert.equal(w.openValue, n.openValue, "narrowing the dates never changes open money");
  assert.equal(w.wonValue, 3500); assert.equal(n.wonValue, 3000, "won follows the dates");
  assert.equal(w.lostValue, n.lostValue); // the lost deal is from today in both
  // test names: left out, counted in the note
  assert.equal(w.testCount, 3); assert.equal(w.testValue, 1500 + 1600 + 1700);
  assert.equal(wide.totals.countsTests, null);
  // the screen toggle counts them
  const withTests = await pipelineCards(scope, { from: new Date(to.getTime() - 45 * day), to, size: 24, includeTest: true });
  assert.equal(withTests.cards[0].openValue, w.openValue + 4800, "the three test deals are counted");
  assert.equal(withTests.totals.countsTests, "toggle");
  // the company switch counts them for everyone, and the note says it is the setting
  await db`insert into settings (installation_id, count_test_deals) values (${inst}, true)`.catch(async () => { await db`update settings set count_test_deals = true where installation_id = ${inst}`; });
  const bySetting = await pipelineCards(scope, { from: new Date(to.getTime() - 45 * day), to, size: 24 });
  assert.equal(bySetting.cards[0].openValue, w.openValue + 4800);
  assert.equal(bySetting.totals.countsTests, "setting");
  assert.equal(bySetting.cards[0].testCount, 0);
  await db.end();
});
