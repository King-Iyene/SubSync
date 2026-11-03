// Times the People and Call lists reads against the largest real installation (read-only: it only runs selects). Run before and after a change.
//   node --env-file=.env.local --import tsx scripts/profile-people.ts
// Each read is run twice: the first is the cold read (what a person waits for), the second is the same read again (what the 45 second cache answers).
import { callQueueAll } from "../src/lib/analytics/call-queries";
import { PRESETS } from "../src/lib/analytics/call-intel";
import { coldTagsFor, goingCold, peopleOptions, searchPeople, tagDetail } from "../src/lib/analytics/people-list-queries";
import { closeDb, sql } from "../src/lib/db";

async function time(label: string, fn: () => Promise<unknown>): Promise<number> {
  const t = performance.now();
  let note = "";
  try { const r = (await fn()) as { total?: number } | undefined; note = r && typeof r === "object" && r.total !== undefined ? `  (${r.total} rows)` : ""; } catch (e) { note = `  FAILED: ${(e as { code?: string }).code ?? ""} ${(e as Error).message.slice(0, 80)}`; }
  const ms = Math.round(performance.now() - t);
  console.log(`${String(ms).padStart(6)} ms  ${label}${note}`);
  return ms;
}

async function main() {
  const [big] = await sql()`select c.installation_id id, count(*)::int n from cached_contacts c join installations i on i.id = c.installation_id where i.is_demo is not true and i.uninstalled_at is null group by 1 order by 2 desc limit 1`;
  console.log(`Largest real installation: ${big.n.toLocaleString("en-US")} contacts`);
  const id = big.id as string;
  await time("round trip (select 1)", () => sql()`select 1`);
  let worst = 0;
  const w = async (label: string, fn: () => Promise<unknown>) => { worst = Math.max(worst, await time(label, fn)); };
  for (const p of PRESETS) await w(`call list: ${p.id}`, () => callQueueAll(id, null, { preset: p.id as never }));
  for (const p of ["hot_uncontacted", "custom"]) await time(`call list again (cached): ${p}`, () => callQueueAll(id, null, { preset: p as never }));
  await w("people options (tags, sources, owners, stages, accounts)", () => peopleOptions(id, null));
  const cold = await coldTagsFor(id, null, null);
  await w("people: no filter, page 1", () => searchPeople(id, null, {}, 1, cold));
  await w("people: name search 'sam'", () => searchPeople(id, null, { q: "sam" }, 1, cold));
  await w("people: quiet 30+ days, has phone, hide do-not-disturb", () => searchPeople(id, null, { quietDays: 30, hasPhone: true, hideDnd: true }, 1, cold));
  const opts = await peopleOptions(id, null);
  if (opts.tags[0]) await w(`people: tag '${opts.tags[0].tag.slice(0, 20)}' (${opts.tags[0].count})`, () => searchPeople(id, null, { tags: [opts.tags[0].tag] }, 1, cold));
  await w("people: never called from SubSync, open deal", () => searchPeople(id, null, { lastCall: "never", deal: "open" }, 1, cold));
  await w("people: cold lists only", () => searchPeople(id, null, { cold: "cold" }, 1, cold));
  for (const b of ["quiet", "recent", "none"] as const) await w(`going cold: ${b}`, () => goingCold(id, null, b, cold, 1));
  if (opts.tags[0]) await w("tag detail (90 days)", () => tagDetail(id, null, opts.tags[0].tag, "2026-08-03", "2026-11-01"));
  console.log(`Slowest read: ${worst} ms (round trip from this machine included).`);
  await closeDb();
}
void main();
