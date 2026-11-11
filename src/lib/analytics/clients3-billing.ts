import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { getCompanyAccessToken } from "../ghl/installations";
import type { Cl3Billing } from "./clients3-types";
import { accountsIn, type Scope } from "./clients3-queries";

// The Billing view of Clients. REAL values only: the plan and subscription status the platform's SaaS endpoints return for each client account (agency token, optional
// permissions saas/location.read and saas/company.read). Payment failures, the next payment date and the apps installed in an account are NOT in that API (checked in the
// public API description), so they are returned as null and the screen says "Not available from the platform yet". Never a guess.

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
const dig = (o: unknown, ...keys: string[]): unknown => { let c = o; for (const k of keys) { if (c && typeof c === "object") c = (c as Record<string, unknown>)[k]; else return undefined; } return c; };

async function get(token: string, path: string) {
  const res = await ghlFetch(`${GHL_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, cache: "no-store" });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

/** Read-only sweep step: store what the platform says per account. Returns accounts written. Skips installs that have no agency token. */
export async function refreshClientBilling(inst: string): Promise<number> {
  const db = sql();
  const inRow = await db`select company_id from installations where id = ${inst}`;
  const companyKey = inRow[0]?.company_id as string | undefined;
  if (!companyKey || companyKey.startsWith("loc:")) return 0;
  let token: string;
  try { token = await getCompanyAccessToken(companyKey); } catch { return 0; }
  const accts = await db`select location_id from locations where installation_id = ${inst} and not ignored`;
  const plans = new Map<string, string | null>();
  let written = 0;
  for (const a of accts) {
    const id = a.location_id as string;
    const r = await get(token, `/saas/get-saas-subscription/${encodeURIComponent(id)}`).catch(() => ({ status: 0, body: null }));
    let state: "ok" | "needs_permission" | "not_available" = "not_available";
    let planId: string | null = null, status: string | null = null, planName: string | null = null;
    if (r.status === 401 || r.status === 403) state = "needs_permission";
    else if (r.status >= 200 && r.status < 300) {
      planId = str(dig(r.body, "saasPlanId")) ?? str(dig(r.body, "subscriptionInfo", "saasPlanId"));
      status = str(dig(r.body, "subscriptionStatus")) ?? str(dig(r.body, "subscriptionInfo", "subscriptionStatus"));
      state = planId || status ? "ok" : "not_available";
      if (planId) {
        if (!plans.has(planId)) { const p = await get(token, `/saas/saas-plan/${encodeURIComponent(planId)}`).catch(() => ({ status: 0, body: null })); plans.set(planId, p.status === 200 ? str(dig(p.body, "name")) : null); }
        planName = plans.get(planId) ?? null;
      }
    }
    await db`insert into client_billing (installation_id, location_id, state, plan_id, plan_name, subscription_status, fetched_at)
      values (${inst}, ${id}, ${state}, ${planId}, ${planName}, ${status}, now())
      on conflict (installation_id, location_id) do update set state = excluded.state, plan_id = excluded.plan_id, plan_name = excluded.plan_name, subscription_status = excluded.subscription_status, fetched_at = now()`;
    written++;
    await new Promise((x) => setTimeout(x, 120));
  }
  return written;
}

const MISSING = "Not available from the platform yet";
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
    const state: Cl3Billing["state"] = st === "ok" ? "ok" : st === "needs_permission" ? "needs_permission" : st === "unknown" ? "not_checked" : "not_available";
    return {
      locationId: a.id, name: a.name, state, plan: (r?.plan_name as string | null) ?? (r?.plan_id as string | null) ?? null, subscriptionStatus: (r?.subscription_status as string | null) ?? null,
      paymentFailing: null, nextPaymentAt: null, appsInstalled: null, fetchedAt: r?.fetched_at ? new Date(r.fetched_at as string).toISOString() : null,
      message: state === "needs_permission" ? "Needs permission: reconnect" : state === "not_checked" ? "Not checked yet" : state === "not_available" ? MISSING : null,
    };
  });
  out.sort((a, b) => Number(b.state === "needs_permission") - Number(a.state === "needs_permission") || a.name.localeCompare(b.name));
  const size = o.size, pages = Math.max(1, Math.ceil(out.length / size)), p = Math.min(Math.max(0, o.page), pages - 1);
  const bad = (x: Cl3Billing) => !!x.subscriptionStatus && !/^(active|trialing|trial|paid)$/i.test(x.subscriptionStatus);
  return { rows: out.slice(p * size, p * size + size), total: out.length, page: p, size, pages, truncated: out.length >= 1000, needPermission: out.filter((x) => x.state === "needs_permission").length, notActive: out.filter(bad).length };
}
