// Read-only: what the database is doing right now (running statements, waits, connection counts) and the slowest statements since the last stats reset.
// Usage: node --env-file=.env.local --import tsx scripts/db-activity.ts
import { closeDb, sql } from "../src/lib/db";

async function main() {
  const db = sql();
  const conns = await db`select state, count(*)::int c from pg_stat_activity where datname = current_database() group by 1 order by 2 desc`;
  console.log("connections:", conns.map((r) => `${r.state ?? "none"}=${r.c}`).join(" "));
  const [lim] = await db`select current_setting('max_connections') m, current_setting('statement_timeout') st`;
  console.log("max_connections", lim.m, "statement_timeout", lim.st);
  const run = await db`select now() - query_start as age, wait_event_type, state, left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 160) q from pg_stat_activity where datname = current_database() and state <> 'idle' and pid <> pg_backend_pid() order by query_start limit 10`;
  for (const r of run) console.log("running:", String(r.age), r.wait_event_type ?? "-", r.state, r.q);
  const top = await db`select calls, round(mean_exec_time)::int mean_ms, round(max_exec_time)::int max_ms, round(total_exec_time/1000)::int total_s, left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 150) q from pg_stat_statements where calls > 20 order by total_exec_time desc limit 12`;
  for (const r of top) console.log(`${String(r.total_s).padStart(6)} s total  ${String(r.calls).padStart(7)} calls  mean ${String(r.mean_ms).padStart(6)} ms  max ${String(r.max_ms).padStart(6)} ms  ${r.q}`);
  await closeDb();
}
main();
