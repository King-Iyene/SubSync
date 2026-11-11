// Read-only timing for the Pipeline cards. (1) the same aggregate shape over N generated rows (generate_series inside ONE query, nothing inserted), (2) the real function on the real data.
// Run: node --env-file=.env.local --experimental-strip-types scripts/pl-scale-timing.ts
import { sql } from "../src/lib/db.ts";
import { pipelineCards } from "../src/lib/analytics/pipeline3-cards.ts";

const db = sql();
for (const n of [100_000, 1_000_000]) {
  const t0 = performance.now();
  const r = await db`
    with o as (
      select (i % 30) loc, (i % 5) pid, (i % 8) stg, case when i % 50 = 0 then 'won' when i % 70 = 0 then 'lost' else 'open' end st,
        (i % 9000)::numeric val, case when i % 20 = 0 then null else 'u' || (i % 40) end owner, now() - ((i % 400) || ' days')::interval chg
      from generate_series(1, ${n}) i
    ), agg as (
      select loc, pid, count(*) filter (where st = 'open' and val > 0 and owner is not null)::int open_n, sum(val) filter (where st = 'open' and val > 0 and owner is not null)::float8 open_v,
        count(*) filter (where st = 'open' and chg < now() - interval '30 days')::int stale_n, count(*) filter (where owner is null)::int no_owner
      from o group by 1, 2
    ) select count(*)::int pipelines, sum(open_v)::float8 open_v from (select * from agg order by open_v desc, loc, pid limit 25) x`;
  console.log(`generated ${n.toLocaleString("en-US")} deals, aggregate + first page: ${Math.round(performance.now() - t0)} ms (${JSON.stringify(r[0])})`);
}
const inst = (await db`select i.id, (select count(*)::int from cached_opportunities o where o.installation_id = i.id) deals from installations i order by 2 desc limit 1`)[0];
if (inst) {
  const to = new Date(), from = new Date(Date.now() - 45 * 86_400_000);
  for (let k = 0; k < 2; k++) {
    const t0 = performance.now(), c = await pipelineCards({ inst: inst.id as string, allowed: null }, { from, to, size: 24 });
    console.log(`real data: ${inst.deals} deals, ${c.totals.pipelines} pipelines, ${c.cards.length} cards, run ${k + 1}: ${Math.round(performance.now() - t0)} ms`);
  }
}
await db.end();
