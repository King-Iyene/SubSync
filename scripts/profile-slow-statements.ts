// Read-only: calls one app read on a local dev server (real database) and lists the statements that used the most database time (pg_stat_statements).
// Usage: BASE_URL=http://localhost:3187 node --env-file=.env.local --import tsx scripts/profile-slow-statements.ts "today" ["today/growth?from=..&to=.."]
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";

const BASE = process.env.BASE_URL ?? "http://localhost:3187";
async function main() {
  const db = sql();
  const [inst] = await db`select i.id, i.company_id from installations i where not coalesce(i.is_demo, false) order by (select count(*) from cached_contacts c where c.installation_id = i.id) desc limit 1`;
  const token = signSession({ companyId: inst.company_id as string, userId: null, role: "admin", userName: "profile", demo: false, kind: "agency", dataOwner: false }, 3600);
  const snap = async () => new Map((await db`select queryid::text id, total_exec_time t, calls c, left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 260) q from pg_stat_statements`).map((r) => [r.id as string, r]));
  for (const p of process.argv.slice(2)) {
    const before = await snap();
    const t = performance.now();
    const res = await fetch(`${BASE}/api/app/${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
    const len = (await res.text()).length;
    console.log(`\n== ${p}: ${Math.round(performance.now() - t)} ms, ${res.status}, ${len} B`);
    const after = await snap();
    const d = [...after].map(([id, r]) => ({ ms: Number(r.t) - Number(before.get(id)?.t ?? 0), c: Number(r.c) - Number(before.get(id)?.c ?? 0), q: r.q as string })).filter((x) => x.c > 0 && x.ms > 80).sort((a, b) => b.ms - a.ms).slice(0, 8);
    for (const x of d) console.log(`   ${String(Math.round(x.ms)).padStart(6)} ms x${x.c}  ${x.q}`);
  }
  await closeDb();
}
main();
