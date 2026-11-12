// Read-only: the slowest read statements the database has seen (needs the pg_stat_statements extension).
// Usage: node --env-file=.env.local --import tsx scripts/db-slow.ts
import { closeDb, sql } from "../src/lib/db";

async function main() {
  const db = sql();
  try {
    const rows = await db`select round(mean_exec_time::numeric) mean_ms, calls, round(max_exec_time::numeric) max_ms, left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 220) q from pg_stat_statements where query ~* '^[[:space:]]*(with|select)' and query not ilike '%pg_stat%' and calls >= 3 order by mean_exec_time desc limit 25`;
    console.log(rows.map((r) => `${r.mean_ms} ms avg (max ${r.max_ms}) x${r.calls}  ${r.q}`).join("\n"));
  } catch (e) { console.log("pg_stat_statements not available:", (e as Error).message); }
  await closeDb();
}
main();
