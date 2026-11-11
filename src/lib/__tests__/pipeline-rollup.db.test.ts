import assert from "node:assert/strict";
import { test } from "node:test";

// DB test: the stored totals (rollup) must give the SAME answers as the live scan, on a small fixture that covers every rule: a normal deal, a stuck one, no owner, $0, a test name,
// a deal over 40% of the account (the outlier), won and lost (with and without a reason), a deal in a stage the pipeline no longer has, and a deal nobody has touched for weeks.
// It runs only when ROLLUP_DB_TEST=1 (needs a database and ONE connection): the fixture lives in TEMPORARY tables that shadow the real ones for this connection only, so nothing real is read or written.
//   ROLLUP_DB_TEST=1 DB_POOL_MAX=1 node --env-file=.env.local --experimental-strip-types --test src/lib/__tests__/pipeline-rollup.db.test.ts  (needs tsx for the extensionless imports: npx tsx --test ...)
const RUN = process.env.ROLLUP_DB_TEST === "1";

test("rollup and live scan agree on a fixture", { skip: !RUN }, async () => {
  const { sql } = await import("../db");
  const { pipelineCards } = await import("../analytics/pipeline3-cards");
  const { overview } = await import("../analytics/pipeline3-queries");
  const { refreshRollup, rollupFresh } = await import("../analytics/pipeline3-rollup");
  const db = sql();
  for (const t of ["installations", "locations", "pipelines", "cached_opportunities", "cached_contacts", "deal_facts", "deal_stage_stats", "stage_rules", "pipeline_rollup", "pipeline_rollup_state"]) {
    await db.unsafe(`create temp table ${t} (like public.${t} including defaults)`);
  }
  const inst = "00000000-0000-4000-8000-000000000001", loc = "locFixture1", day = 86_400_000, ago = (d: number) => new Date(Date.now() - d * day);
  await db`insert into installations (id) values (${inst})`.catch(async () => { await db.unsafe(`insert into installations (id, company_id) values ('${inst}', 'c1')`); });
  await db`insert into locations (installation_id, location_id, name) values (${inst}, ${loc}, 'Fixture account')`;
  await db`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${inst}, ${loc}, 'p1', 'Sales', ${db.json([{ id: "s1", name: "New" }, { id: "s2", name: "Proposal" }])})`;
  const deal = (id: string, o: Record<string, unknown>) => ({ installation_id: inst, location_id: loc, opportunity_id: id, pipeline_id: "p1", stage_id: "s1", contact_id: `c${id}`, contact_name: `Person ${id}`, name: `Deal ${id}`, monetary_value: 1000, status: "open", assigned_to: "u1", source: "web",
    last_stage_change_at: ago(2), last_status_change_at: ago(2), created_remote_at: ago(40), updated_remote_at: ago(2), last_action_at: ago(2), synced_at: new Date(), ...o });
  const rows = [
    deal("a1", {}), deal("a2", { monetary_value: 2000, stage_id: "s2" }), deal("a3", { last_stage_change_at: ago(90), last_action_at: ago(90), updated_remote_at: ago(90) }), deal("a4", { assigned_to: null }),
    deal("a5", { monetary_value: 0 }), deal("a6", { name: "Test deal" }), deal("a7", { monetary_value: 900000 }), deal("a8", { stage_id: "gone" }),
    deal("w1", { status: "won", monetary_value: 3000, last_status_change_at: ago(5) }), deal("w2", { status: "won", monetary_value: 500, last_status_change_at: ago(60) }),
    deal("l1", { status: "lost", last_status_change_at: ago(4) }), deal("l2", { status: "lost", monetary_value: 700, stage_id: "s2", last_status_change_at: ago(8) }),
    ...Array.from({ length: 6 }, (_, i) => deal(`b${i}`, { monetary_value: 800 + i * 10 })),
  ];
  await db`insert into cached_opportunities ${db(rows as never)}`;
  await db`insert into deal_facts (installation_id, location_id, opportunity_id, lost_reason) values (${inst}, ${loc}, 'l2', 'Price too high')`;

  const scope = { inst, allowed: null }, to = new Date(Math.floor(Date.now() / day) * day), from = new Date(to.getTime() - 45 * day);
  assert.equal((await rollupFresh(scope)).fresh, false, "empty rollup: not fresh, so the live scan is used");
  const liveCards = await pipelineCards(scope, { from, to, size: 24 }), liveOv = await overview(scope, { from, to, bucket: null }, 45);
  assert.equal(liveCards.refreshing, true);
  const built = await refreshRollup(inst, { force: true });
  assert.equal(built.rebuilt, 1);
  assert.equal((await rollupFresh(scope)).fresh, true);
  const fastCards = await pipelineCards(scope, { from, to, size: 24 }), fastOv = await overview(scope, { from, to, bucket: null }, 45);
  assert.equal(fastCards.refreshing, false);
  const strip = (c: { cards: Array<Record<string, unknown>> }) => c.cards.map((x) => ({ ...x, mini: undefined }));
  assert.deepEqual(strip(fastCards as never), strip(liveCards as never));
  assert.deepEqual(fastCards.totals, liveCards.totals);
  const keep = (o: typeof liveOv) => ({ open: o.openCount, ov: o.openValue.value, stale: o.stale, won: o.wonLast30, lost: o.lostLast30, health: o.health, big: o.bigUntouched, cards: o.cards.map((c) => [c.key, c.value]) });
  assert.deepEqual(keep(fastOv), keep(liveOv));
  // the rules themselves, spelled out so a change shows up here: 7 normal open deals count (a1 a2 a3 + b0..b5 is 9, minus the outlier a7 is separate, a8 is in an unknown stage but still counted)
  assert.equal(fastCards.cards[0].noOwnerCount, 1);
  assert.equal(fastCards.cards[0].zeroValueCount, 1);
  assert.equal(fastCards.cards[0].outlierCount, 1);
  await db.end();
});
