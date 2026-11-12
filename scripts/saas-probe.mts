// Read-only probe of the billing and install endpoints (docs/research/CLIENTS_V3_R1.md). Prints HTTP statuses, field NAMES and the distinct status words only:
// never a name, an email, an id or a token. Run once by King: node --env-file=.env.local --import tsx scripts/saas-probe.mts [other app id]
// Note: it uses the app's own token service, which may rotate the refresh token (the same thing every sync does).
import { closeDb, sql } from "../src/lib/db.ts";
import { GHL_API } from "../src/lib/ghl/client.ts";
import { getCompanyAccessToken } from "../src/lib/ghl/installations.ts";

const db = sql();
const keys = (v: unknown): string[] => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object).sort() : []);
const H = (t: string, v = "v3") => ({ Authorization: `Bearer ${t}`, Version: v, Accept: "application/json" });
const other = process.argv[2] ?? null;
try {
  const [row] = await db`select company_id from installations where uninstalled_at is null and not is_demo and company_id not like 'loc:%' limit 1`;
  if (!row) { console.log("No agency install found."); process.exit(0); }
  const company = row.company_id as string;
  const token = await getCompanyAccessToken(company);
  const get = async (label: string, path: string, v = "v3") => { const r = await fetch(`${GHL_API}${path}`, { headers: H(token, v) }); const j = await r.json().catch(() => ({})); console.log(label, "->", r.status, " keys:", keys(j).join(", ")); return j as Record<string, unknown>; };
  const list = await get("saas-locations", `/saas/saas-locations/${company}?page=1`);
  const items = (Array.isArray(list.locations) ? list.locations : []) as Array<Record<string, unknown>>;
  console.log(" item keys:", keys(items[0]).join(", "), " subscriptionInfo keys:", keys(items[0]?.subscriptionInfo).join(", "));
  console.log(" status words:", [...new Set(items.map((i) => String((i.subscriptionInfo as Record<string, unknown> | undefined)?.subscriptionStatus)))].join(", "));
  console.log(" non-SaaS accounts appear in this list? compare list total with accounts you have:", JSON.stringify(list.pagination ?? null));
  const loc = items[0]?.locationId as string | undefined;
  if (loc) {
    await get("get-saas-subscription", `/saas/get-saas-subscription/${loc}?companyId=${company}`);
    await get("wallet/balance", `/wallet/balance?locationId=${loc}`, "2021-07-28");
  }
  const appId = process.env.GHL_APP_ID;
  if (appId) await get("installed-locations (our app)", `/oauth/installed-locations?companyId=${company}&appId=${appId}&isInstalled=true&pageSize=5`);
  if (other) await get("installed-locations (OTHER app id: does it list?)", `/oauth/installed-locations?companyId=${company}&appId=${other}&isInstalled=true&pageSize=5`);
  await get("agency-plans", `/saas/agency-plans/${company}`);
} finally { await closeDb(); }
