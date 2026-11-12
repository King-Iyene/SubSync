// Read-only: times the live "all accounts with numbers" read (what every screen starts with) against ONE lookup of the same shape (a primary-key read of one small row set), N times, p50 / p95.
// The rollup table itself exists only after the migration is applied by the pull request flow, so the lookup is timed against `locations` (same index shape, same size of answer): a stand-in, labelled as one.
// Usage: node --env-file=.env.local --import tsx scripts/profile-rollup.ts [runs]
import { closeDb, sql } from "../src/lib/db";
import { getSettings, accountRows, scoreHistory } from "../src/lib/analytics/queries";

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
async function main() {
  const db = sql();
  const runs = Number(process.argv[2] ?? 5);
  const [inst] = await db`select i.id from installations i where not coalesce(i.is_demo, false) order by (select count(*) from cached_contacts c where c.installation_id = i.id) desc limit 1`;
  const id = inst.id as string;
  await db`select 1`;
  const live: number[] = [], one: number[] = [];
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    const s = await getSettings(id);
    await Promise.all([accountRows(id, s), scoreHistory(id, 30)]);
    live.push(performance.now() - t);
    t = performance.now();
    await db`select l.location_id, l.name, (select count(*) from locations x where x.installation_id = ${id})::int n from locations l where l.installation_id = ${id}`;
    one.push(performance.now() - t);
  }
  const f = (a: number[]) => `p50 ${Math.round(pct(a, 0.5))} ms, p95 ${Math.round(pct(a, 0.95))} ms (n=${a.length})`;
  console.log(`live accounts read (settings + accountRows + scoreHistory): ${f(live)}`);
  console.log(`one-lookup stand-in for the rollup read:                    ${f(one)}`);
  await closeDb();
}
main();
