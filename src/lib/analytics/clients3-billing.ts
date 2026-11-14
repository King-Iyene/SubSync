import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { getCompanyAccessToken } from "../ghl/installations";
import { PLANS_AGENCY_ONLY, PLANS_NEED_PERMISSION, readSaasPlans, stateFor, type Getter } from "./clients3-saas";
import { readInstalls } from "./clients3-installs";
import { parseGranted } from "../scope-groups";
import type { Cl3Billing } from "./clients3-types";
import { accountsIn, type Scope } from "./clients3-queries";

// The Billing view of Clients. REAL values only: the plan and subscription status the platform's SaaS endpoints return for each client account (agency token, optional
// agency-level apps only; one paged call lists every account on a plan). Payment failures, the next payment date and the apps installed in an account are NOT in that API (checked in the
// public API description), so they are returned as null and the screen says "Not available from the platform yet". Never a guess.

async function get(token: string): Promise<Getter> {
  return async (path, version) => {
    const res = await ghlFetch(`${GHL_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" }, cache: "no-store" });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* empty */ }
    return { status: res.status, body };
  };
}

/** Read-only sweep step: one paged call lists every account on a plan; store what the platform says per account. Returns accounts written. Skips installs that have no agency token. */
export async function refreshClientBilling(inst: string): Promise<number> {
  const db = sql();
  const inRow = await db`select company_id, scope from installations where id = ${inst}`;
  const companyKey = inRow[0]?.company_id as string | undefined;
  if (!companyKey || companyKey.startsWith("loc:")) return 0;
  const granted = typeof inRow[0]?.scope === "string" && (inRow[0].scope as string).trim() ? parseGranted(inRow[0].scope as string) : null;
  let token: string;
  try { token = await getCompanyAccessToken(companyKey); } catch { return 0; }
  const accts = await db`select location_id from locations where installation_id = ${inst} and not ignored`;
  const getter = await get(token);
  const result = await readSaasPlans(getter, companyKey, granted);
  let before = new Map<string, { status: string | null; since: Date | null; plan: string | null }>();
  try {
    const p = await db`select location_id, subscription_status, status_since, plan_name from client_billing where installation_id = ${inst}`;
    before = new Map(p.map((x) => [x.location_id as string, { status: (x.subscription_status as string | null) ?? null, since: (x.status_since as Date | null) ?? null, plan: (x.plan_name as string | null) ?? null }]));
  } catch { /* the Clients v2 columns are not there yet: the older write below still works */ }
  const reason = result.failed === null ? null : result.access === "needs_permission" ? PLANS_NEED_PERMISSION : result.failed === 401 || result.failed === 403 ? PLANS_AGENCY_ONLY : `The platform answered ${result.failed} when asked for plans.`;
  let written = 0;
  for (const a of accts) {
    const id = a.location_id as string;
    const r = stateFor(result, id);
    const old = before.get(id);
    const changed = !!old && old.status !== r.status && r.state === "ok";
    const since = !old || changed || !old.since ? new Date() : old.since;
    try {
      await db`insert into client_billing (installation_id, location_id, state, plan_id, plan_name, subscription_status, fetched_at, subscription_id, price_amount, price_currency, billing_interval, trial_days, user_limit, contact_limit, status_since, http_status, reason)
        values (${inst}, ${id}, ${r.state}, ${r.planId}, ${r.planName}, ${r.status}, now(), ${r.subscriptionId ?? null}, ${r.price?.amount ?? null}, ${r.price?.currency ?? null}, ${r.price?.interval ?? null}, ${r.trialDays ?? null}, ${r.userLimit ?? null}, ${r.contactLimit ?? null}, ${since}, ${result.failed}, ${reason})
        on conflict (installation_id, location_id) do update set state = excluded.state, plan_id = excluded.plan_id, plan_name = excluded.plan_name, subscription_status = excluded.subscription_status, fetched_at = now(),
          subscription_id = excluded.subscription_id, price_amount = excluded.price_amount, price_currency = excluded.price_currency, billing_interval = excluded.billing_interval, trial_days = excluded.trial_days,
          user_limit = excluded.user_limit, contact_limit = excluded.contact_limit, status_since = excluded.status_since, http_status = excluded.http_status, reason = excluded.reason`;
      if (old && r.state === "ok" && old.plan !== null && r.planName !== null && old.plan !== r.planName) await db`insert into cl3_history (installation_id, location_id, kind, from_value, to_value) values (${inst}, ${id}, 'plan', ${old.plan}, ${r.planName})`.catch(() => undefined);
      if (changed) await db`insert into cl3_history (installation_id, location_id, kind, from_value, to_value) values (${inst}, ${id}, 'status', ${old?.status ?? null}, ${r.status})`.catch(() => undefined);
      if (changed) await db`insert into cl2_plan_events (installation_id, location_id, from_status, to_status, plan_name) values (${inst}, ${id}, ${old?.status ?? null}, ${r.status}, ${r.planName})`;
    } catch {
      await db`insert into client_billing (installation_id, location_id, state, plan_id, plan_name, subscription_status, fetched_at)
        values (${inst}, ${id}, ${r.state}, ${r.planId}, ${r.planName}, ${r.status}, now())
        on conflict (installation_id, location_id) do update set state = excluded.state, plan_id = excluded.plan_id, plan_name = excluded.plan_name, subscription_status = excluded.subscription_status, fetched_at = now()`;
    }
    written++;
  }
  await refreshWallets(inst, getter, accts.map((a) => a.location_id as string)).catch(() => undefined);
  await refreshAppInstalls(inst, getter, companyKey).catch(() => undefined);
  return written;
}

/** Reads the credit balances only (no plan calls), for the wallet guard when the Clients billing refresh is not switched on. Skips installs with no agency token. Returns false when it could not run. */
export async function refreshWalletsFor(inst: string): Promise<boolean> {
  const db = sql();
  const inRow = await db`select company_id from installations where id = ${inst}`;
  const companyKey = inRow[0]?.company_id as string | undefined;
  if (!companyKey || companyKey.startsWith("loc:")) return false;
  let token: string;
  try { token = await getCompanyAccessToken(companyKey); } catch { return false; }
  const accts = await db`select location_id from locations where installation_id = ${inst} and not ignored`;
  // A client_billing row must exist for the balance to be stored.
  for (const a of accts) await db`insert into client_billing (installation_id, location_id, state) values (${inst}, ${a.location_id as string}, 'unknown') on conflict (installation_id, location_id) do nothing`.catch(() => undefined);
  await refreshWallets(inst, await get(token), accts.map((a) => a.location_id as string));
  return true;
}

const WALLET_EVERY_HOURS = 6;
const WALLET_PER_RUN = 150;
const WALLET_PACE_MS = 120;
/** Credit balance per account (optional permission wallet.readonly): at most 150 accounts a run, each at most every 6 hours, stops at the first refusal. Only values the platform returned are stored. */
async function refreshWallets(inst: string, get: Getter, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = sql();
  const due = await db`select l.location_id, b.wallet_balance prev from locations l left join client_billing b on b.installation_id = l.installation_id and b.location_id = l.location_id
    where l.installation_id = ${inst} and not l.ignored and l.location_id = any(${ids}::text[]) and (b.wallet_at is null or b.wallet_at < now() - ${`${WALLET_EVERY_HOURS} hours`}::interval)
    order by b.wallet_at nulls first limit ${WALLET_PER_RUN}`;
  for (const d of due) {
    const id = d.location_id as string;
    // The platform's wallet page says Version v3 (read in its docs); the older date stays as the fallback for a refusal that is not about permission.
    const wallet = (version: string) => get(`/wallet/balance?locationId=${encodeURIComponent(id)}`, version).catch(() => ({ status: 0, body: null as unknown }));
    let r = await wallet("v3");
    if (r.status !== 0 && (r.status < 200 || r.status >= 300) && r.status !== 401 && r.status !== 403 && r.status !== 429) r = await wallet("2021-07-28");
    const body = (r.body && typeof r.body === "object" ? r.body : {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
    const ok = r.status >= 200 && r.status < 300;
    const state = ok ? "ok" : r.status === 401 || r.status === 403 ? "needs_permission" : "not_available";
    const now = ok ? n(body.balance) : null, was = d.prev === null || d.prev === undefined ? null : Number(d.prev);
    if (now !== null && now <= 0 && was !== null && was > 0) await db`insert into cl3_history (installation_id, location_id, kind) values (${inst}, ${id}, 'wallet_low')`.catch(() => undefined);
    await db`update client_billing set wallet_state = ${state}, wallet_balance = ${ok ? n(body.balance) : null}, wallet_credits = ${ok ? n(body.complimentaryCredits) : null}, wallet_at = now() where installation_id = ${inst} and location_id = ${id}`;
    if (state === "needs_permission") break;
    await new Promise((res) => setTimeout(res, WALLET_PACE_MS));
  }
}

const MISSING = "Not available from the platform yet";
const NO_PLAN = "Not on a plan";
export async function billing(s: Scope, f: { q?: string | null; industry?: string | null }, o: { page: number; size: number }): Promise<{ rows: Cl3Billing[]; total: number; page: number; size: number; pages: number; truncated: boolean; needPermission: number; notActive: number }> {
  const accts = await accountsIn(s, { q: f.q, industry: f.industry });
  const ids = accts.map((a) => a.id);
  let rows: Record<string, unknown>[] = [];
  if (ids.length) {
    try { rows = await sql()`select location_id, state, plan_id, plan_name, subscription_status, fetched_at from client_billing where installation_id = ${s.inst} and location_id = any(${ids}::text[])`; } catch { rows = []; }
  }
  const by = new Map(rows.map((r) => [r.location_id as string, r]));
  const out: Cl3Billing[] = accts.map((a) => {
    const r = by.get(a.id);
    const st = (r?.state as string | undefined) ?? "unknown";
    const state: Cl3Billing["state"] = st === "ok" ? "ok" : st === "no_plan" ? "no_plan" : st === "unknown" ? "not_checked" : st === "needs_permission" ? "needs_permission" : "not_available";
    return {
      locationId: a.id, name: a.name, state, plan: (r?.plan_name as string | null) ?? (r?.plan_id as string | null) ?? null, subscriptionStatus: (r?.subscription_status as string | null) ?? null,
      paymentFailing: null, nextPaymentAt: null, appsInstalled: null, fetchedAt: r?.fetched_at ? new Date(r.fetched_at as string).toISOString() : null,
      message: state === "no_plan" ? NO_PLAN : state === "not_checked" ? "Not checked yet" : state === "needs_permission" ? PLANS_NEED_PERMISSION : state === "not_available" ? PLANS_AGENCY_ONLY : null,
    };
  });
  out.sort((a, b) => Number(b.state === "needs_permission") - Number(a.state === "needs_permission") || a.name.localeCompare(b.name));
  const size = o.size, pages = Math.max(1, Math.ceil(out.length / size)), p = Math.min(Math.max(0, o.page), pages - 1);
  const bad = (x: Cl3Billing) => !!x.subscriptionStatus && !/^(active|trialing|trial|paid)$/i.test(x.subscriptionStatus);
  return { rows: out.slice(p * size, p * size + size), total: out.length, page: p, size, pages, truncated: out.length >= 1000, needPermission: out.filter((x) => x.state === "needs_permission").length, notActive: out.filter(bad).length };
}

/** Whether SubSync is installed on each client account, and its plan and trial flag, from the platform installed list (agency token, permission oauth.readonly, live-verified: GET /oauth/installedLocations).
 *  Only SubSync can be read: the platform has no list of other apps in an account. After a full successful read, an account the list no longer holds is recorded as not installed. */
async function refreshAppInstalls(inst: string, get: Getter, companyKey: string): Promise<void> {
  const appId = process.env.GHL_APP_ID;
  if (!appId) return;
  const db = sql();
  const prev = new Map<string, boolean>((await db`select location_id, is_installed from cl3_app_installs where installation_id = ${inst}`.catch(() => [])).map((r) => [r.location_id as string, r.is_installed === true]));
  const res = await readInstalls(get, companyKey, appId);
  if (res.failed) return;
  const seen = new Set<string>();
  for (const it of res.rows) {
    seen.add(it.locationId);
    await db`insert into cl3_app_installs (installation_id, location_id, name, is_installed, version_id, installed_at, plan_id, on_trial, seen_at)
      values (${inst}, ${it.locationId}, ${it.name}, ${it.installed}, ${it.versionId}, ${it.installedAt}, ${it.planId}, ${it.onTrial}, now())
      on conflict (installation_id, location_id) do update set name = excluded.name, is_installed = excluded.is_installed, version_id = excluded.version_id, installed_at = excluded.installed_at, plan_id = excluded.plan_id, on_trial = excluded.on_trial, seen_at = now()`;
    const was = prev.get(it.locationId);
    if (was !== undefined && was !== it.installed) await db`insert into cl3_history (installation_id, location_id, kind) values (${inst}, ${it.locationId}, ${it.installed ? "app_installed" : "app_removed"})`.catch(() => undefined);
  }
  // Accounts we knew as installed that the platform no longer lists: removed.
  for (const [id, was] of prev) {
    if (!was || seen.has(id)) continue;
    await db`update cl3_app_installs set is_installed = false, seen_at = now() where installation_id = ${inst} and location_id = ${id}`.catch(() => undefined);
    await db`insert into cl3_history (installation_id, location_id, kind) values (${inst}, ${id}, 'app_removed')`.catch(() => undefined);
  }
}
