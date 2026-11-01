// Times every Call lists query against the largest real installation (read-only: it only runs selects). Run before and after a change to
// the call list queries; it prints milliseconds per preset and the total the page waits for.
//   node --env-file=.env.local --import tsx scripts/profile-calls.ts
import { callQueue, outcomeSummary, speedToLead } from "../src/lib/analytics/call-queries";
import { PRESETS } from "../src/lib/analytics/call-intel";
import { closeDb, sql } from "../src/lib/db";

async function time<T>(label: string, fn: () => Promise<T>): Promise<number> {
  const t = performance.now();
  await fn();
  const ms = Math.round(performance.now() - t);
  console.log(`${String(ms).padStart(6)} ms  ${label}`);
  return ms;
}

async function main() {
  const [big] = await sql()`select c.installation_id id, count(*)::int n from cached_contacts c join installations i on i.id = c.installation_id where i.is_demo is not true and i.uninstalled_at is null group by 1 order by 2 desc limit 1`;
  console.log(`Largest real installation: ${big.n.toLocaleString("en-US")} contacts`);
  const id = big.id as string;
  let worst = 0;
  for (const p of PRESETS) worst = Math.max(worst, await time(`queue: ${(p as { id: string }).id}`, () => callQueue(id, null, { preset: (p as { id: string }).id as never })));
  await time("speed to lead strip", () => speedToLead(id, null));
  await time("outcome summary", () => outcomeSummary(id));
  console.log(`Page wait is about the slowest queue plus the others in parallel: ${worst} ms or more.`);
  await closeDb();
}
void main();
