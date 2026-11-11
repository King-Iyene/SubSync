import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { getCompanyAccessToken } from "../ghl/installations";
import { readSaasPlans, stateFor, type Getter } from "./clients3-saas";
import type { Cl3Billing } from "./clients3-types";
import { accountsIn, type Scope } from "./clients3-queries";

// The Billing view of Clients. REAL values only: the plan and subscription status the platform's SaaS endpoints return for each client account (agency token, optional
// permission saas/company.read; one paged call lists every account on a plan). Payment failures, the next payment date and the apps installed in an account are NOT in that API (checked in the
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
  const inRow = await db`select company_id from installations where id = ${inst}`;
  const companyKey = inRow[0]?.company_id as string | undefined;
  if (!companyKey || companyKey.startsWith("loc:")) return 0;
  let token: string;
  try { token = await getCompanyAccessToken(companyKey); } catch { return 0; }
  const accts = await db`select location_id from locations where installation_id = ${inst} and not ignored`;
  const result = await readSaasPlans(await get(token), companyKey);
  let written = 0;
  for (const a of accts) {
    const id = a.location_id as string;
    const r = stateFor(result, id);
    await db`insert into client_billing (installation_id, location_id, state, plan_id, plan_name, subscription_status, fetched_at)
      values (${inst}, ${id}, ${r.state}, ${r.planId}, ${r.planName}, ${r.status}, now())
      on conflict (installation_id, location_id) do update set state = excluded.state, plan_id = excluded.plan_id, plan_name = excluded.plan_name, subscription_status = excluded.subscription_status, fetched_at = now()`;
    written++;
  }
  return written;
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
    const state: Cl3Billing["state"] = st === "ok" ? "ok" : st === "needs_permission" ? "needs_permission" : st === "no_plan" ? "no_plan" : st === "unknown" ? "not_checked" : "not_available";
    return {
      locationId: a.id, name: a.name, state, plan: (r?.plan_name as string | null) ?? (r?.plan_id as string | null) ?? null, subscriptionStatus: (r?.subscription_status as string | null) ?? null,
      paymentFailing: null, nextPaymentAt: null, appsInstalled: null, fetchedAt: r?.fetched_at ? new Date(r.fetched_at as string).toISOString() : null,
      message: state === "needs_permission" ? "Needs permission: reconnect" : state === "no_plan" ? NO_PLAN : state === "not_checked" ? "Not checked yet" : state === "not_available" ? MISSING : null,
    };
  });
  out.sort((a, b) => Number(b.state === "needs_permission") - Number(a.state === "needs_permission") || a.name.localeCompare(b.name));
  const size = o.size, pages = Math.max(1, Math.ceil(out.length / size)), p = Math.min(Math.max(0, o.page), pages - 1);
  const bad = (x: Cl3Billing) => !!x.subscriptionStatus && !/^(active|trialing|trial|paid)$/i.test(x.subscriptionStatus);
  return { rows: out.slice(p * size, p * size + size), total: out.length, page: p, size, pages, truncated: out.length >= 1000, needPermission: out.filter((x) => x.state === "needs_permission").length, notActive: out.filter(bad).length };
}
