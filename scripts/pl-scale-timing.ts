// Timing and equality check for the Pipeline screens, read-only on the real tables. The rollup tables are created as TEMPORARY tables in this one connection (nothing is applied to the
// database), the rollup is built from the real deals, and every screen is run twice: before (live scan, the rollup is empty) and after (read from the rollup). The answers must be equal.
// Also: the same aggregate shape over N generated rows (generate_series inside ONE query, nothing inserted).
// Run: DB_POOL_MAX=1 npx tsx --env-file=.env.local scripts/pl-scale-timing.ts
import { sql } from "../src/lib/db";
import { pipelineCards } from "../src/lib/analytics/pipeline3-cards";
import { dealList, moneyFlow, overview } from "../src/lib/analytics/pipeline3-queries";
import { refreshRollup } from "../src/lib/analytics/pipeline3-rollup";

const ms = (t: number) => Math.round(performance.now() - t);
async function timed<T>(label: string, fn: () => Promise<T>): Promise<{ r: T; ms: number }> { const t = performance.now(); const r = await fn(); const d = ms(t); console.log(`${label}: ${d} ms`); return { r, ms: d }; }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const db = sql();
  for (const n of [100_000, 1_000_000]) {
    const t0 = performance.now();
    const r = await db`
      with o as (
        select (i % 30) loc, (i % 5) pid, (i % 8) stg, case when i % 50 = 0 then 'won' when i % 70 = 0 then 'lost' else 'open' end st, (i % 9000)::numeric val,
          case when i % 20 = 0 then null else 'u' || (i % 40) end owner, now() - ((i % 400) || ' days')::interval chg, 'Deal ' || i nm
        from generate_series(1, ${n}) i
      ), g as (
        select loc, pid, stg, st, (owner is null) no_owner, (val > 0) has_value, (chg < now() - interval '30 days') stale, (nm ~* '(^|[^a-z0-9])(test|demo|dummy|sample|fake)([^a-z0-9]|$)') is_test, count(*)::int n, sum(val)::float8 v
        from o group by 1, 2, 3, 4, 5, 6, 7, 8
      ), cards as (
        select loc, pid, sum(v) filter (where st = 'open' and has_value and not no_owner and not is_test) open_v from g group by 1, 2
      ) select count(*)::int pipelines from (select * from cards order by open_v desc nulls last, loc, pid limit 25) x`;
    console.log(`generated ${n.toLocaleString("en-US")} deals: the full build (flags + test-name regex + group-by into rollup-shaped rows) and the first card page: ${ms(t0)} ms (${r[0].pipelines} pipelines)`);
    const rollupRows = (await db`select count(*)::int n from (select (i % 30) a, (i % 5) b, (i % 8) c, (i % 3) d, (i % 7) e, (i % 90) f from generate_series(1, ${n}) i group by 1, 2, 3, 4, 5, 6) x`)[0].n;
    const t1 = performance.now();
    const cardsFromRollup = await db`
      with r as (select (i % 30) loc, (i % 5) pid, (i % 8) stg, (i % 90) dy, (i % 7) k, 1 n, (i % 9000)::float8 v from generate_series(1, ${Math.min(Number(rollupRows), 200_000)}) i)
      select count(*)::int c from (select loc, pid, sum(n), sum(v) from r group by 1, 2 order by 4 desc limit 25) x`;
    console.log(`  reading the rollup for the cards (a rollup of about ${Math.min(Number(rollupRows), 200_000).toLocaleString("en-US")} rows, however many deals it stands for): ${ms(t1)} ms (${cardsFromRollup[0].c} cards)`);
  }

  const inst = (await db`select i.id, (select count(*)::int from cached_opportunities o where o.installation_id = i.id) deals from installations i order by 2 desc limit 1`)[0];
  if (!inst) return;
  const scope = { inst: inst.id as string, allowed: null }, to = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000), from = new Date(to.getTime() - 45 * 86_400_000);
  // temporary copies of the two rollup tables: they exist only in this connection
  await db`create temp table pipeline_rollup (like public.pipeline_rollup including defaults) on commit preserve rows`.catch(async () => {
    await db`create temp table pipeline_rollup (installation_id uuid, location_id text, pipeline_id text, stage_id text default '', owner_id text default '', source text default '', status text, is_test boolean, oos boolean, has_value boolean, has_owner boolean, outlier boolean, stale boolean, big_untouched boolean default false, closed_day date default date '1970-01-01', lost_reason text default '', n integer, value double precision, med_days double precision, norm_days double precision, stays integer, refreshed_at timestamptz default now())`;
  });
  await db`create temp table pipeline_rollup_state (installation_id uuid, location_id text, refreshed_at timestamptz default now(), deals integer default 0, rows_written integer default 0, primary key (installation_id, location_id))`;

  console.log(`\nreal data: ${inst.deals} deals`);
  const before = {
    cards: await timed("BEFORE cards (live scan)", () => pipelineCards(scope, { from, to, size: 24 })),
    overview: await timed("BEFORE overview (live scan)", () => overview(scope, { from, to, bucket: null }, 45)),
  };
  const card = before.cards.r.cards.find((c) => c.openValue > 0), flowArgs = card ? { from, to, location: card.locationId, pipeline: card.name } : null;
  const flowBefore = flowArgs ? await timed("BEFORE stacks (live scan)", () => moneyFlow(scope, flowArgs)) : null;
  await timed("BEFORE cards (live scan) run 2", () => pipelineCards(scope, { from, to, size: 24 }));
  await timed("BEFORE overview (live scan) run 2", () => overview(scope, { from, to, bucket: null }, 45));
  const built = await timed("refreshRollup (build, every account)", () => refreshRollup(scope.inst, { force: true }));
  console.log(`  rebuilt ${built.r.rebuilt} of ${built.r.accounts} accounts, ${built.r.rows} rollup rows for ${inst.deals} deals`);
  for (let k = 1; k <= 2; k++) {
    const after = {
      cards: await timed(`AFTER cards (rollup) run ${k}`, () => pipelineCards(scope, { from, to, size: 24 })),
      overview: await timed(`AFTER overview (rollup) run ${k}`, () => overview(scope, { from, to, bucket: null }, 45)),
    };
    const flowAfter = flowArgs ? await timed(`AFTER stacks (rollup) run ${k}`, () => moneyFlow(scope, flowArgs)) : null;
    if (k === 2) {
      const strip = (o: { cards: unknown[] }) => (o.cards as Array<Record<string, unknown>>).map((c) => ({ ...c, mini: undefined }));
      console.log("EQUAL cards:", same(strip(before.cards.r), strip(after.cards.r)) && same(before.cards.r.totals, after.cards.r.totals), "| refreshing flag after:", after.cards.r.refreshing);
      const keep = (o: Awaited<ReturnType<typeof overview>>) => ({ open: o.openCount, ov: o.openValue.value, stale: o.stale, won: o.wonLast30, lost: o.lostLast30, health: o.health, big: o.bigUntouched, cards: o.cards.map((c) => [c.key, c.value]) });
      console.log("EQUAL overview:", same(keep(before.overview.r), keep(after.overview.r)));
      if (flowBefore && flowAfter) console.log("EQUAL stacks:", same(flowBefore.r.stages.map((s) => [s.id, s.openCount, s.openValue, s.clog]), flowAfter.r.stages.map((s) => [s.id, s.openCount, s.openValue, s.clog])), same(flowBefore.r.vault, flowAfter.r.vault), same(flowBefore.r.drain, flowAfter.r.drain));
    }
  }
  const p1 = await timed("deal list page 1 (live, keyset)", () => dealList(scope, { f: { from, to, bucket: null }, page: 0, size: 100 }, null));
  const p2 = await timed("deal list page 2 (keyset, no recount)", () => dealList(scope, { f: { from, to, bucket: null }, page: 1, size: 100, after: p1.r.next, knownTotal: p1.r.total }, null));
  console.log("list overlap between pages:", p2.r.rows.filter((r) => p1.r.rows.some((x) => x.opportunityId === r.opportunityId)).length);
  await db.end();
}
void main();
