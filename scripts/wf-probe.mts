// Read-only probe of what the platform's Workflows API gives for one real client account (docs/features/WORKFLOWS.md, "Live probe"). Prints HTTP statuses, field NAMES and
// status words only, never a workflow name, a contact or a token. Run: node --env-file=.env.local --import tsx scripts/wf-probe.mts [location id]
import { closeDb, sql } from "../src/lib/db.ts";
import { GHL_API } from "../src/lib/ghl/client.ts";
import { locationAccessToken } from "../src/lib/sync/engine.ts";

const db = sql();
const want = process.argv[2] ?? null;
const keys = (v: unknown): string[] => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object).sort() : []);
const H = (t: string) => ({ Authorization: `Bearer ${t}`, Version: "2021-07-28", Accept: "application/json", "Content-Type": "application/json" });
try {
  const [row] = await db`select i.company_id, l.location_id, i.scope from locations l join installations i on i.id = l.installation_id
    where i.uninstalled_at is null and not i.is_demo and ${want ? db`l.location_id = ${want}` : db`true`} order by l.name limit 1`;
  if (!row) { console.log("No real client account found to probe."); process.exit(0); }
  const scope = String(row.scope ?? "");
  console.log("Permissions granted (workflow related):", scope.split(/[\s,]+/).filter((s) => /workflow|campaign|calendar|conversation/.test(s)).join(", ") || "(none)");
  const token = await locationAccessToken(row.company_id as string, row.location_id as string);
  const search = await fetch(`${GHL_API}/workflows/search`, { method: "POST", headers: H(token), body: JSON.stringify({ limit: 5, sort: [{ field: "updatedAt", direction: "desc" }] }) });
  console.log("POST /workflows/search ->", search.status);
  const sj = await search.json().catch(() => ({}));
  console.log(" top-level keys:", keys(sj).join(", ") || "(none)");
  const list = (Array.isArray(sj.workflows) ? sj.workflows : Array.isArray(sj.data) ? sj.data : []) as Array<Record<string, unknown>>;
  console.log(" item count:", list.length, " item keys:", keys(list[0]).join(", ") || "(none)", " status words:", [...new Set(list.map((w) => String(w.status)))].join(", "));
  if (!search.ok) console.log(" Not available from the platform yet (answer: ", JSON.stringify(sj).slice(0, 160), ")");
  const id = list.find((w) => w.id)?.id as string | undefined;
  if (id) {
    const q = new URLSearchParams({ groupBy: "status", startDate: new Date(Date.now() - 29 * 864e5).toISOString(), endDate: new Date().toISOString(), limit: "20" });
    const agg = await fetch(`${GHL_API}/workflows/${encodeURIComponent(id)}/logs/aggregate?${q}`, { headers: H(token) });
    const aj = await agg.json().catch(() => ({}));
    console.log("GET /workflows/{id}/logs/aggregate ->", agg.status, " keys:", keys(aj).join(", "), " row keys:", keys(Array.isArray(aj.rows) ? aj.rows[0] : Array.isArray(aj.data) ? aj.data[0] : null).join(", "));
    const lg = await fetch(`${GHL_API}/workflows/${encodeURIComponent(id)}/logs?limit=1`, { headers: H(token) });
    const lj = await lg.json().catch(() => ({}));
    console.log("GET /workflows/{id}/logs ->", lg.status, " keys:", keys(lj).join(", "), " log keys:", keys(Array.isArray(lj.logs) ? lj.logs[0] : Array.isArray(lj.data) ? lj.data[0] : null).join(", "));
    const df = await fetch(`${GHL_API}/workflows/${encodeURIComponent(id)}/definition`, { headers: H(token) });
    const dj = await df.json().catch(() => ({}));
    console.log("GET /workflows/{id}/definition ->", df.status, " keys:", keys(dj).join(", "), " inner keys:", keys(dj.definition ?? dj.workflow).join(", "));
  } else console.log("No workflow id came back, so logs and definition were not probed.");
} finally { await closeDb(); }
