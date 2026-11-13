// Demo smoke test: opens every module's data endpoint as the demo agency and checks it holds data (scripts/demo-endpoints.json: the calls each screen really makes, recorded with demo:crawl).
// Usage: npm run demo:smoke   (server from `npm run demo:server`; the first pass is slow while answers are made, a second pass is instant). Exit 1 if a call fails or a "must have data" one is empty.
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:3210";
const list = JSON.parse(fs.readFileSync(new URL("./demo-endpoints.json", import.meta.url), "utf8"));
const day = (back) => new Date(Date.now() - back * 86_400_000 + 3_600_000).toISOString().slice(0, 10); // Lagos day
const expand = (p) => p.replaceAll("{d29}", day(29)).replaceAll("{d0}", day(0));
function measure(v, d = 0, a = { rows: 0, nums: 0, perm: 0 }) {
  if (Array.isArray(v)) { a.rows += v.length; if (d < 5) for (const x of v.slice(0, 50)) measure(x, d + 1, a); }
  else if (v && typeof v === "object") for (const x of Object.values(v)) measure(x, d + 1, a);
  else if (typeof v === "number" && v !== 0) a.nums++;
  else if (typeof v === "string" && /needs[ _]permission/i.test(v)) a.perm++;
  return a;
}
const login = await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ demo: true }) }).then((r) => r.json()).catch(() => ({}));
if (!login.session) { console.error("Demo login failed. Is the server running with `npm run demo:server`?"); process.exit(2); }
const headers = { Authorization: `Bearer ${login.session}` };
let failed = 0, next = 0;
const lines = [];
await Promise.all(Array.from({ length: Number(process.env.CONC || 3) }, async () => {
  while (next < list.length) {
    const e = list[next++], t0 = Date.now();
    let r = null;
    for (let k = 0; k < 2 && (!r || r.status === 503); k++) r = await fetch(`${BASE}/api/app/${expand(e.path)}`, { headers, signal: AbortSignal.timeout(150000) }).catch(() => null);
    const body = r ? await r.json().catch(() => null) : null;
    const m = body ? measure(body) : { rows: 0, nums: 0, perm: 0 };
    const ok = r?.status === 200 && (e.min === 0 || (m.rows + m.nums >= 1 && m.perm === 0));
    if (!ok) failed++;
    lines.push(`${ok ? "ok  " : "FAIL"} ${e.module.padEnd(14)} ${e.path.slice(0, 64).padEnd(64)} ${r?.status ?? "none"} rows=${m.rows} nums=${m.nums} perm=${m.perm} ${Date.now() - t0}ms`);
  }
}));
console.log(lines.sort().join("\n"));
console.log(`\n${list.length - failed}/${list.length} endpoints ok`);
process.exit(failed ? 1 : 0);
