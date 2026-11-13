import fs from "node:fs";
type Res = { status: number; j: unknown; bytes: number };
type Get = (p: string) => Promise<Res>;
const SKIP = new Set(["generatedAt", "cached", "now", "at", "ms", "computedAt", "ageMs", "builtAt", "problem", "range", "window", "label", "sentence", "from", "to", "cmpFrom", "cmpTo", "days"]);
// Flatten the numeric leaves (depth 5, arrays summarized by length plus the first 3 items) so two answers can be compared path by path.
function leaves(v: unknown, path = "", depth = 0, out: Record<string, string | number> = {}): Record<string, string | number> {
  if (v === null || v === undefined) return out;
  if (typeof v === "number") { out[path] = v; return out; }
  if (typeof v === "boolean") { out[path] = v ? 1 : 0; return out; }
  if (typeof v === "string") { if (v.length < 40 && /^-?\d/.test(v)) out[path] = v; return out; }
  if (Array.isArray(v)) { out[`${path}.length`] = v.length; if (depth < 4) v.slice(0, 3).forEach((x, i) => leaves(x, `${path}[${i}]`, depth + 1, out)); return out; }
  if (typeof v === "object" && depth < 5) for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (!SKIP.has(k)) leaves(x, path ? `${path}.${k}` : k, depth + 1, out);
  return out;
}
const diff = (a: Record<string, string | number>, b: Record<string, string | number>) => Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);
const stripRange = (p: string) => p.replace(/[?&](from|to|cmpFrom|cmpTo|wfrom|wto)=[^&]*/g, "").replace(/\?&/, "?").replace(/&&/g, "&").replace(/\?$/, "");
const addQ = (p: string, q: string) => `${p}${p.includes("?") ? "&" : "?"}${q}`;
const NOISE = /(\/act\/|part=settings|part=setup|part=options|\/options|settings|api-keys|^start|st\/|roadmap|deal-rules|meeting-setup|workflows\/library|am\/slack|dial\/cq-status|part=race|today3\?part=today$|freshness|part=periods)/;

export async function run(get: Get, c: { loc: string; dayOf: (n: number) => string }) {
  const list = JSON.parse(fs.readFileSync(new URL("./demo-endpoints.json", import.meta.url), "utf8")) as Array<{ module: string; path: string }>;
  const only = (process.env.AUDIT_ONLY ?? "").split(",").filter(Boolean);
  const extra = (process.env.AUDIT_PATHS ?? "").split(",").filter(Boolean).map((path) => ({ module: process.env.AUDIT_LABEL ?? "Extra", path }));
  const mods = extra.length ? extra : list.filter((e) => (!only.length || only.includes(e.module)) && !NOISE.test(e.path));
  const win = (n: number, p: string) => addQ(addQ(stripRange(p), `from=${c.dayOf(n - 1)}&to=${c.dayOf(0)}`), `wfrom=${c.dayOf(n - 1)}&wto=${c.dayOf(0)}`);
  const lines: string[] = [];
  const queue = mods.map((e) => async () => {
    const base = stripRange(e.path.replace(/\{d29\}|\{d0\}/g, ""));
    const out: string[] = [];
    try {
      const r = [await get(win(30, base)), await get(win(90, base))];
      const l = r.map((x) => leaves(x.j));
      const d3090 = diff(l[0], l[1]);
      const m = await get(addQ(win(30, base), `location=${c.loc}`));
      const lm = leaves(m.j);
      out.push(`${e.module} | ${base} | st ${r.map((x) => x.status).join("/")}/${m.status} | 30v90 ${d3090.length} ${d3090.slice(0, 4).map((k) => `${k}:${l[0][k]}>${l[1][k]}`).join("; ")} | loc-vs-all(30d) ${diff(l[0], lm).length}`);
    } catch (err) { out.push(`${e.module} | ${base} | ERROR ${(err as Error).message.slice(0, 100)}`); }
    lines.push(...out); console.log(out.join("\n"));
  });
  let i = 0;
  await Promise.all(Array.from({ length: 3 }, async () => { while (i < queue.length) { const f = queue[i++]; await f(); } }));
  fs.writeFileSync(process.env.AUDIT_OUT ?? "audit-out.txt", lines.join("\n"));
}
