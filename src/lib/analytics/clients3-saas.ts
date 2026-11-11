// Reads which plan each client account is on, from the platform's SaaS API. Pure logic (no database) so it can be tested with mocked responses.
// One paged call lists every account that is in SaaS mode: GET /saas/saas-locations/{companyId}?page=N (agency token, scope saas/company.read, Version v3).
// Three honest states per account: "ok" (plan found), "no_plan" (the platform answered and the account is not on a plan), "needs_permission" (ONLY when the platform answered 401 or 403).

export type SaasState = "ok" | "no_plan" | "needs_permission" | "not_available";
export type SaasRow = { state: SaasState; planId: string | null; planName: string | null; status: string | null };
export type Resp = { status: number; body: unknown };
export type Getter = (path: string, version: string) => Promise<Resp>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
const dig = (o: unknown, ...keys: string[]): unknown => { let c = o; for (const k of keys) { if (c && typeof c === "object") c = (c as Record<string, unknown>)[k]; else return undefined; } return c; };

export const SAAS_VERSION = "v3";
const OLD_VERSION = "2021-07-28";
const MAX_PAGES = 200;

async function call(get: Getter, path: string): Promise<Resp> {
  let r = await get(path, SAAS_VERSION).catch(() => ({ status: 0, body: null }));
  if (r.status === 400 || r.status === 404 || r.status === 422) r = await get(path, OLD_VERSION).catch(() => r);
  return r;
}

/** Plan name from a saas-plan response (the platform calls it title; older shapes used name). */
export function planTitle(body: unknown): string | null { return str(dig(body, "title")) ?? str(dig(body, "name")) ?? str(dig(body, "plan", "title")); }

/** Fetch every page of the SaaS accounts list and map it to one row per account id. `failed` carries the real HTTP status when the call did not succeed. */
export async function readSaasPlans(get: Getter, companyId: string): Promise<{ failed: number | null; rows: Map<string, SaasRow> }> {
  const rows = new Map<string, SaasRow>();
  const plans = new Map<string, string | null>();
  const base = `/saas/saas-locations/${encodeURIComponent(companyId)}`;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await call(get, `${base}?page=${page}`);
    if (r.status < 200 || r.status >= 300) return { failed: r.status, rows: page === 1 ? rows : rows };
    const list = dig(r.body, "locations");
    for (const l of Array.isArray(list) ? list : []) {
      const id = str(dig(l, "locationId"));
      if (!id) continue;
      const planId = str(dig(l, "subscriptionInfo", "saasPlanId")), status = str(dig(l, "subscriptionInfo", "subscriptionStatus"));
      rows.set(id, planId || status ? { state: "ok", planId, planName: null, status } : { state: "no_plan", planId: null, planName: null, status: null });
    }
    if (dig(r.body, "pagination", "hasNext") !== true) break;
  }
  for (const row of rows.values()) {
    if (!row.planId) continue;
    if (!plans.has(row.planId)) {
      const p = await call(get, `/saas/saas-plan/${encodeURIComponent(row.planId)}?companyId=${encodeURIComponent(companyId)}`);
      plans.set(row.planId, p.status >= 200 && p.status < 300 ? planTitle(p.body) : null);
    }
    row.planName = plans.get(row.planId) ?? null;
  }
  return { failed: null, rows };
}

/** State for an account the list did not contain, or for every account when the call failed. */
export function stateFor(result: { failed: number | null; rows: Map<string, SaasRow> }, locationId: string): SaasRow {
  if (result.failed !== null) {
    const needs = result.failed === 401 || result.failed === 403;
    return { state: needs ? "needs_permission" : "not_available", planId: null, planName: null, status: null };
  }
  return result.rows.get(locationId) ?? { state: "no_plan", planId: null, planName: null, status: null };
}
