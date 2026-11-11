// Read-only timing and consistency check for the Pipeline screens. (1) the same aggregate shape over N generated rows (generate_series inside ONE query, nothing inserted),
// (2) the real functions on the real data: cards, a card against its own stacks (they must agree to the dollar), and keyset paging of the deal list.
// Run: npx tsx --env-file=.env.local scripts/pl-scale-timing.ts
import { sql } from "../src/lib/db";
import { pipelineCards } from "../src/lib/analytics/pipeline3-cards";
import { dealList, moneyFlow, overview } from "../src/lib/analytics/pipeline3-queries";

async function main() {
const db = sql(), ms = (t: number) => Math.round(performance.now() - t);
for (const n of [100_000, 1_000_000]) {
  const t0 = performance.now();
  const r = await db`
    with o as (
      select (i % 30) loc, (i % 5) pid, (i % 8) stg, case when i % 50 = 0 then 'won' when i % 70 = 0 then 'lost' else 'open' end st, (i % 9000)::numeric val,
        case when i % 20 = 0 then null else 'u' || (i % 40) end owner, now() - ((i % 400) || ' days')::interval chg, 'Deal ' || i nm
      from generate_series(1, ${n}) i
    ), agg as (
      select loc, pid, count(*) filter (where st = 'open' and val > 0 and owner is not null and nm !~* '(^|[^a-z0-9])(test|demo|dummy|sample|fake)([^a-z0-9]|$)')::int open_n,
        sum(val) filter (where st = 'open' and val > 0 and owner is not null)::float8 open_v, count(*) filter (where st = 'open' and chg < now() - interval '30 days')::int stale_n
      from o group by 1, 2
    ) select count(*)::int pipelines, sum(open_v)::float8 open_v from (select * from agg order by open_v desc, loc, pid limit 25) x`;
  console.log(`generated ${n.toLocaleString("en-US")} deals, aggregate + test-name regex + first page: ${ms(t0)} ms (${r[0].pipelines} pipelines)`);
}
const inst = (await db`select i.id, (select count(*)::int from cached_opportunities o where o.installation_id = i.id) deals from installations i order by 2 desc limit 1`)[0];
if (inst) {
  const scope = { inst: inst.id as string, allowed: null }, to = new Date(), from = new Date(Date.now() - 45 * 86_400_000);
  let first;
  for (let k = 0; k < 2; k++) { const t0 = performance.now(); const c = await pipelineCards(scope, { from, to, size: 24 }); first = c; console.log(`cards: ${inst.deals} deals, ${c.totals.pipelines} pipelines, run ${k + 1}: ${ms(t0)} ms`); }
  const card = first!.cards.find((c) => c.openValue > 0);
  if (card) {
    const t0 = performance.now(), m = await moneyFlow(scope, { from, to, location: card.locationId, pipeline: card.name });
    const stacks = m.stages.reduce((a, s) => a + s.openValue, 0);
    console.log(`stacks for "${card.name}": ${ms(t0)} ms; card open $${card.openValue} vs stacks $${Math.round(stacks)} -> ${Math.abs(card.openValue - stacks) <= 1 ? "SAME" : "DIFFERENT"}`);
  }
  let t0 = performance.now();
  const o = await overview(scope, { from, to, bucket: null }, 45);
  console.log(`overview: ${ms(t0)} ms, big untouched: ${JSON.stringify(o.bigUntouched)}`);
  t0 = performance.now();
  const p1 = await dealList(scope, { f: { from, to, bucket: null }, page: 0, size: 100 }, null);
  console.log(`deal list page 1: ${ms(t0)} ms, ${p1.rows.length} rows of ${p1.total}, next=${p1.next}`);
  t0 = performance.now();
  const p2 = await dealList(scope, { f: { from, to, bucket: null }, page: 1, size: 100, after: p1.next, knownTotal: p1.total }, null);
  const dup = p2.rows.filter((r) => p1.rows.some((x) => x.opportunityId === r.opportunityId)).length;
  console.log(`deal list page 2 (keyset, no recount): ${ms(t0)} ms, ${p2.rows.length} rows, overlap with page 1: ${dup}`);
}
await db.end();
}
void main();
