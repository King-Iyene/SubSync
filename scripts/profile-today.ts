// Read-only profile of the Today screen's reads against the real database: wall time and statement count per read.
// Usage: DB_QUERY_COUNT=1 node --env-file=.env.local --import tsx scripts/profile-today.ts [installationId]
import { closeDb, sql } from "../src/lib/db";
import { today, numbers } from "../src/lib/analytics/today3-queries";

const g = globalThis as unknown as { __subsyncQueries?: number };
async function main() {
  const db = sql();
  const rows = await db`select i.id, (select count(*) from cached_contacts c where c.installation_id = i.id)::int contacts from installations i where not coalesce(i.is_demo, false) order by 2 desc limit 3`;
  console.log("installations by contacts:", rows.map((r) => `${r.id} ${r.contacts}`).join(" | "));
  const inst = process.argv[2] ?? (rows[0].id as string);
  const time = async (label: string, run: () => Promise<unknown>) => {
    g.__subsyncQueries = 0; const t = performance.now();
    try { await run(); } catch (e) { console.log(`${label}: FAILED ${(e as Error).message.slice(0, 120)}`); return; }
    console.log(`${label.padEnd(30)} ${String(Math.round(performance.now() - t)).padStart(6)} ms  ${String(g.__subsyncQueries).padStart(3)} statements`);
  };
  const scope = { inst, allowed: null as string[] | null, level: "all" as const, selfId: null };
  await time("warm-up", () => db`select 1`);
  await time("today3 today (cold)", () => today(scope, null, Date.now()));
  await time("today3 today (2nd)", () => today(scope, null, Date.now()));
  await time("today3 numbers 30d", () => numbers(scope, null, 30, Date.now()));
  await closeDb();
}
main();
