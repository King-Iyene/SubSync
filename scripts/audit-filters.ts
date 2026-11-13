// Filter audit probe (READ ONLY): calls the real router in-process for one real test account with different date windows and pickers and prints whether the numbers move.
// Usage: node --env-file=<.env.local> --import tsx scripts/audit-filters.ts [cases-file]
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";
process.env.READ_CACHE = "off"; process.env.ANSWER_STORE = "off"; process.env.DB_POOL_MAX ??= "4";
process.on("unhandledRejection", (e) => console.error("unhandled", String((e as Error)?.message ?? e).slice(0, 120)));
const LOC = process.env.AUDIT_LOCATION ?? "ojRd5O4FHowafUkAMZxn";
const dayOf = (back: number) => new Date(Date.now() - back * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
async function main() {
  const { handle } = await import("../src/lib/api/router");
  const db = sql();
  const [o] = await db`select installation_id from cached_opportunities where location_id = ${LOC} limit 1`;
  const [r] = await db`select id, company_id from installations where id = ${o.installation_id as string}`;
  const token = signSession({ companyId: r.company_id as string, userId: null, role: "admin", userName: "audit", demo: false, kind: "agency", dataOwner: false }, 3600);
  const once = async (path: string) => {
    const res = await handle(new Request(`http://audit.local/api/app/${path}`, { headers: { Authorization: `Bearer ${token}` } }), path.split("?")[0].split("/"));
    const text = await res.text();
    let j: unknown = null; try { j = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, j, bytes: text.length };
  };
  // The shared database is busy when several builders work at once: a 5xx (statement timeout) is retried with a pause, never counted as an answer.
  const get = async (path: string) => {
    let r = await once(path);
    for (let k = 0; k < 3 && r.status >= 500; k++) { await new Promise((s) => setTimeout(s, 3000 * (k + 1))); r = await once(path); }
    return r;
  };
  const mod = await import(process.argv[2] ?? "./audit-filters-cases.ts");
  await mod.run(get, { loc: LOC, dayOf });
  await closeDb();
  process.exit(0);
}
void main();
