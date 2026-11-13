// Perf budget probe: calls the real app router IN-PROCESS against the database in DATABASE_URL / POSTGRES_URL / SUPABASE_DB_PASSWORD (read-only: GET reads only, a signed
// session for the biggest real company is minted locally; nothing is written except the answer cache the app itself keeps).
// Prints, per module and endpoint: first call (cold: nothing cached in this process), second call (warm), statements used, and the module's "all at once" wall time
// (how the browser opens the screen). The database round trip from a developer machine is far slower than from the host's region, so the statement count and the number of
// round trips in a row ("RTT x") are the stable numbers; compare runs on the same machine.
// Usage: npm run perf:measure [-- Module Name ...]     (env: BUDGET_MS=3000 fails the run when a cold module wall exceeds it; PERF_JSON=1 prints JSON; TOP=6 rows per module)
import fs from "node:fs";
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";

process.env.READ_CACHE = "on";
process.env.ANSWER_STORE = "off"; // a measurement never writes the stored answers
const g = globalThis as unknown as { __subsyncQueries?: number };
const day = (back: number) => new Date(Date.now() - back * 86_400_000 + 3_600_000).toISOString().slice(0, 10);
const expand = (p: string) => p.replaceAll("{d29}", day(29)).replaceAll("{d0}", day(0));

async function main() {
  const { handle } = await import("../src/lib/api/router");
  const { forgetAllReads } = await import("../src/lib/read-cache");
  const db = sql();
  const rttT = [] as number[];
  await db`select 1`;
  for (let i = 0; i < 4; i++) { const t = performance.now(); await db`select 1`; rttT.push(performance.now() - t); }
  const rtt = Math.round(rttT.sort((a, b) => a - b)[1]);
  const [inst] = await db`select i.id, i.company_id from installations i where not coalesce(i.is_demo, false) and i.uninstalled_at is null order by (select count(*) from cached_contacts c where c.installation_id = i.id) desc limit 1`;
  const token = signSession({ companyId: inst.company_id as string, userId: null, role: "admin", userName: "perf", demo: false, kind: "agency", dataOwner: false }, 3600);
  const list = JSON.parse(fs.readFileSync(new URL("./demo-endpoints.json", import.meta.url), "utf8")) as Array<{ module: string; path: string }>;
  const only = process.argv.slice(2);
  const modules = [...new Set(list.map((e) => e.module))].filter((m) => !only.length || only.includes(m));
  const call = async (path: string) => {
    const before = g.__subsyncQueries ?? 0, t = performance.now();
    const p = expand(path);
    const res = await handle(new Request(`http://perf.local/api/app/${p}`, { headers: { Authorization: `Bearer ${token}` } }), p.split("?")[0].split("/"));
    await res.text();
    const ms = Math.round(performance.now() - t), stmts = (g.__subsyncQueries ?? 0) - before;
    return { ms, stmts, status: res.status };
  };
  const out: Array<Record<string, unknown>> = [];
  console.log(`database round trip here: ~${rtt} ms (production is a few ms); installation ${String(inst.id).slice(0, 8)}`);
  const first = await call("freshness");
  console.log(`first request after start (installation + flags + plan lookup + freshness): ${first.ms} ms, ${first.stmts} statements`);
  let worst = 0;
  for (const m of modules) {
    const paths = list.filter((e) => e.module === m).map((e) => e.path);
    console.log(`\n== ${m} (${paths.length} reads)`);
    let seqStmts = 0;
    const rows: Array<{ path: string; cold: number; warm: number; stmts: number; status: number }> = [];
    for (const p of paths) {
      forgetAllReads();
      const c = await call(`${p}${p.includes("?") ? "&" : "?"}_r=${Date.now().toString(36)}`);
      const w = await call(p);
      seqStmts += c.stmts;
      rows.push({ path: p, cold: c.ms, warm: w.ms, stmts: c.stmts, status: c.status });
    }
    for (const r of rows.sort((a, b) => b.cold - a.cold).slice(0, Number(process.env.TOP ?? 6))) console.log(`${String(r.cold).padStart(6)} ms cold ${String(r.warm).padStart(5)} ms warm ${String(r.stmts).padStart(3)} stmts  ${r.status}  ${expand(r.path).slice(0, 70)}`);
    // The browser opens a screen with all of its reads at once.
    forgetAllReads();
    const t = performance.now(); const b = g.__subsyncQueries ?? 0;
    const res = await Promise.all(paths.map((p) => call(`${p}${p.includes("?") ? "&" : "?"}_r=${Date.now().toString(36)}`)));
    const wall = Math.round(performance.now() - t); worst = Math.max(worst, wall);
    console.log(`   module opened all at once (cache bypassed): ${wall} ms wall, ${(g.__subsyncQueries ?? 0) - b} statements, ${res.filter((r) => r.status !== 200).length} not-200; reads alone in a row: ${seqStmts} statements  (about ${Math.round(wall / Math.max(rtt, 1))} RTT x)`);
    out.push({ module: m, reads: paths.length, wallMs: wall, statements: seqStmts, rtt });
  }
  if (process.env.PERF_JSON) console.log(JSON.stringify(out));
  await closeDb();
  const budget = Number(process.env.BUDGET_MS || 0);
  if (budget && worst > budget) { console.error(`over budget: ${worst} ms > ${budget} ms`); process.exit(1); }
  process.exit(0);
}
void main();
