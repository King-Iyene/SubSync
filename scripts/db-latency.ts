// Round-trip time of the database from this machine: connect, then 5 trivial queries. Read-only.
// Usage: node --env-file=.env.local --import tsx scripts/db-latency.ts
import { closeDb, sql } from "../src/lib/db";

async function main() {
  const t0 = performance.now();
  await sql()`select 1`;
  console.log(`connect + first query: ${Math.round(performance.now() - t0)} ms`);
  const ts: number[] = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); await sql()`select 1`; ts.push(Math.round(performance.now() - t)); }
  console.log(`next 5 round trips: ${ts.join(" / ")} ms`);
  await closeDb();
}
main();
