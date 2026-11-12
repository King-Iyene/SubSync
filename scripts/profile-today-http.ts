// Read-only: times every read the Today tab makes, over HTTP against a local dev server that uses the real database (a signed agency session for the biggest real company is minted locally).
// Usage: BASE_URL=http://localhost:3187 node --env-file=.env.local --import tsx scripts/profile-today-http.ts
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";

const BASE = process.env.BASE_URL ?? "http://localhost:3187";
async function main() {
  const db = sql();
  const [inst] = await db`select i.id, i.company_id from installations i where not coalesce(i.is_demo, false) order by (select count(*) from cached_contacts c where c.installation_id = i.id) desc limit 1`;
  const locs = await db`select location_id from locations where installation_id = ${inst.id} limit 5`;
  const token = signSession({ companyId: inst.company_id as string, userId: null, role: "admin", userName: "profile", demo: false, kind: "agency", dataOwner: false }, 3600);
  const ids = locs.map((l) => l.location_id as string).join(",");
  const ta = ids ? `&accounts=${encodeURIComponent(ids)}` : "";
  const paths = ["today3?part=today", "today", "today/growth?from=2026-10-14&to=2026-11-12", "segments", "finance?part=options", "finance?part=headline", "wg?part=summary", "br?part=brief", "bf?part=summary", "today3?part=numbers&days=30"];
  const run = async (p: string) => {
    const t = performance.now();
    try {
      const res = await fetch(`${BASE}/api/app/${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90_000) });
      const txt = await res.text();
      console.log(`${String(Math.round(performance.now() - t)).padStart(6)} ms  ${res.status}  ${String(txt.length).padStart(7)} B  ${p}`);
    } catch (e) { console.log(`${String(Math.round(performance.now() - t)).padStart(6)} ms  FAIL ${(e as Error).message}  ${p}`); }
  };
  console.log("-- sequential (cold)"); for (const p of paths) await run(p);
  console.log("-- all at once"); const t = performance.now(); await Promise.all(paths.map(run)); console.log(`total ${Math.round(performance.now() - t)} ms`);
  void ta;
  await closeDb();
}
main();
