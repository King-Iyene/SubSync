// READ-ONLY probe for the SaaS and installer-details reads (docs/SAAS_INSTALLER_PROBE.md). Only GET calls.
// Prints HTTP status, field NAMES and distinct status words only: never a name, email, id or token.
//   DB_POOL_MAX=2 DB_IDLE_TIMEOUT=5 node --env-file=.env.local --import tsx scripts/saas-installer-probe.mts
// It uses the app's own token service (which may rotate a refresh token, the same as every sync).
import { closeDb, sql } from "../src/lib/db.ts";
import { GHL_API } from "../src/lib/ghl/client.ts";
import { getCompanyAccessToken } from "../src/lib/ghl/installations.ts";
import { locationAccessToken } from "../src/lib/sync/engine.ts";

const db = sql();
const keys = (v: unknown): string[] => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v as object).sort() : []);
const mask = (s: string) => s.replace(/[0-9a-zA-Z]{20,}/g, "<id>");
async function get(label: string, token: string, path: string, version: string) {
  const r = await fetch(`${GHL_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" } });
  const text = await r.text();
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  console.log(`${label} -> HTTP ${r.status} keys: ${keys(j).join(", ") || "-"}${r.ok ? "" : ` msg: ${mask(text).slice(0, 160)}`}`);
  return { status: r.status, body: j as Record<string, unknown> | null };
}
try {
  const [row] = await db`select company_id, scope from installations where uninstalled_at is null and not is_demo and company_id not like 'loc:%' order by created_at limit 1`;
  if (!row) { console.log("No agency install found."); process.exit(0); }
  const company = row.company_id as string;
  const scopes = String(row.scope ?? "").split(/\s+/);
  for (const s of ["saas/location.read", "saas/company.read", "marketplace-installer-details.readonly", "wallet.readonly", "oauth.readonly"]) console.log(`scope ${s}: ${scopes.includes(s) ? "granted" : "NOT granted"}`);
  const locs = await db`select location_id from locations where installation_id = (select id from installations where company_id = ${company} limit 1) and not ignored limit 3`;
  console.log("accounts on this install (sampled up to 3):", locs.length);
  const appId = process.env.GHL_APP_ID;
  const ag = await getCompanyAccessToken(company);

  console.log("\n== Agency token");
  const list = await get("GET /saas/saas-locations/{company}?page=1", ag, `/saas/saas-locations/${company}?page=1`, "v3");
  const items = (Array.isArray(list.body?.locations) ? list.body!.locations : []) as Array<Record<string, unknown>>;
  if (items[0]) console.log("  item keys:", keys(items[0]).join(", "), "| subscriptionInfo keys:", keys(items[0].subscriptionInfo).join(", "), "| status words:", [...new Set(items.map((i) => String((i.subscriptionInfo as Record<string, unknown> | undefined)?.subscriptionStatus)))].join(", "));
  const one = String(locs[0]?.location_id ?? "");
  if (one) {
    await get("GET /saas/get-saas-subscription/{loc}?companyId=", ag, `/saas/get-saas-subscription/${one}?companyId=${company}`, "v3");
    await get("GET /saas-api/public-api/get-saas-subscription/{loc}?companyId=", ag, `/saas-api/public-api/get-saas-subscription/${one}?companyId=${company}`, "v3");
  }
  await get("GET /saas/agency-plans/{company}", ag, `/saas/agency-plans/${company}`, "v3");
  await get("GET /saas/saas-plan/{planId}?companyId=  (bogus id)", ag, `/saas/saas-plan/000000000000000000000000?companyId=${company}`, "v3");
  if (appId) {
    const inst = await get("GET /marketplace/app/{appId}/installations (agency token)", ag, `/marketplace/app/${appId}/installations`, "2021-07-28");
    const d = inst.body?.installationDetails as Record<string, unknown> | undefined;
    if (d) console.log("  installationDetails keys:", keys(d).join(", "), "| has locationId:", Boolean(d.locationId), "| has plan id:", Boolean(d.marketplaceAppPlanId), "| companyPlan:", d.companyPlan ?? null);
    const il = async (label: string, q: string) => {
      const r = await get(`GET /oauth/installedLocations ${label}`, ag, `/oauth/installedLocations?companyId=${company}&appId=${appId}&limit=100${q}`, "2021-07-28");
      const ls = (Array.isArray(r.body?.locations) ? r.body!.locations : []) as Array<Record<string, unknown>>;
      if (r.status === 200) console.log("  count:", r.body?.count, "| rows:", ls.length, "| item keys:", keys(ls[0]).join(", "), "| isInstalled values:", [...new Set(ls.map((x) => String(x.isInstalled)))].join(", "), "| with installedAt:", ls.filter((x) => x.installedAt).length, "| with versionId:", ls.filter((x) => x.versionId).length, "| install ages (days):", ls.map((x) => (x.installedAt ? Math.round((Date.now() - Date.parse(String(x.installedAt))) / 864e5) : null)).join(","));
      const t = ls[0]?.trial as Record<string, unknown> | undefined;
      if (t) console.log("  trial keys:", keys(t).join(", "), "| onTrial:", t.onTrial, "| trialDuration:", t.trialDuration, "| trialStartDate age (days):", t.trialStartDate ? Math.round((Date.now() - Date.parse(String(t.trialStartDate))) / 864e5) : null, "| planId present:", Boolean(ls[0]?.planId), "| version present:", Boolean(ls[0]?.versionId));
      return r;
    };
    await il("(no filter)", "");
    await il("isInstalled=false", "&isInstalled=false");
    await il("onTrial=true", "&onTrial=true");
    const plans = await db`select distinct plan_id from install_plans where plan_id is not null limit 5`;
    for (const [i, p] of plans.entries()) await il(`planId=#${i + 1}`, `&planId=${p.plan_id}`);
    const own = await db`select count(*)::int n, count(*) filter (where on_trial)::int on_trial, count(*) filter (where trial_started_at is not null)::int with_trial_start, count(*) filter (where plan_id is not null)::int with_plan from install_plans`;
    console.log("  our own install_plans rows (from install events):", JSON.stringify(own[0]));
  } else console.log("GHL_APP_ID not set: installer-details skipped");

  console.log("\n== Location token (saas/location.read and installer details)");
  for (const [i, l] of locs.entries()) {
    const id = String(l.location_id);
    let lt: string;
    try { lt = await locationAccessToken(company, id); } catch { console.log(`account ${i + 1}: could not mint a location token`); continue; }
    console.log(`-- account ${i + 1}`);
    await get("GET /saas/get-saas-subscription/{loc} (location token)", lt, `/saas/get-saas-subscription/${id}?companyId=${company}`, "v3");
    await get("GET /saas/saas-locations/{company} (location token)", lt, `/saas/saas-locations/${company}?page=1`, "v3");
    await get("GET /saas/location/{loc} (guess, to see 404 vs 401)", lt, `/saas/location/${id}`, "v3");
    if (appId) {
      const inst = await get("GET /marketplace/app/{appId}/installations (location token)", lt, `/marketplace/app/${appId}/installations`, "2021-07-28");
      const d = inst.body?.installationDetails as Record<string, unknown> | undefined;
      if (d) console.log("  installationDetails keys:", keys(d).join(", "), "| companyPlan:", d.companyPlan ?? null, "| plan id present:", Boolean(d.marketplaceAppPlanId));
    }
    const w = await get("GET /wallet/balance (location token)", lt, `/wallet/balance?locationId=${id}`, "2021-07-28");
    if (w.body) console.log("  wallet value types:", Object.entries(w.body).map(([k, v]) => `${k}:${typeof v}`).join(", "));
  }
} finally { await closeDb(); }
