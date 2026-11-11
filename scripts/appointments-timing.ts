// Read-only timing of the Appointments query shapes on 1,000,000 synthetic appointments built inside the query with generate_series (no rows are inserted).
// Run: node --env-file=.env.local --experimental-strip-types scripts/appointments-timing.ts
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? (process.env.SUPABASE_DB_PASSWORD ? `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.ugfvzcbkqnhtejgcqhsb.supabase.co:5432/postgres` : undefined);
if (!url) throw new Error("no database credentials");
const db = postgres(url, { prepare: false, max: 1 });
const N = 1_000_000;
const syn = db`select g id, 'a' || (g % 40) loc, 'cal' || (g % 25) cal, 'u' || (g % 60) owner, 'u' || ((g * 7) % 60) booker,
  (array['new','confirmed','showed','noshow','cancelled'])[1 + g % 5] status, now() - make_interval(mins => (g % 525600)::int) start_at from generate_series(1, ${N}) g`;
const time = async (label: string, run: () => Promise<unknown>) => { const t = performance.now(); await run(); console.log(`${label}: ${Math.round(performance.now() - t)} ms`); };
await time("status counts (overview shape)", () => db`with ap as (${syn}) select status, count(*) from ap where start_at > now() - interval '30 days' group by 1`);
await time("per person (booking share shape)", () => db`with ap as (${syn}) select owner, count(*) filter (where status = 'showed'), count(*) filter (where status = 'noshow') from ap group by 1`);
await time("weekly trend per person", () => db`with ap as (${syn}) select owner, date_trunc('week', start_at), count(*) from ap where start_at > now() - interval '63 days' group by 1, 2`);
await time("keyset page of 50", () => db`with ap as (${syn}) select * from ap where (start_at, id) < (now() - interval '100 days', 500000) order by start_at desc, id desc limit 50`);
await db.end();
