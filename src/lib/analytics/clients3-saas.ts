// Reads which plan each client account is on, from the platform's SaaS API. Pure logic (no database) so it can be tested with mocked responses.
// One paged call lists every account that is in SaaS mode: GET /saas/saas-locations/{companyId}?page=N (agency token, Version v3; the platform gives plan details to agency-level apps only, so for this app it normally answers 401/403).
// Three honest states per account: "ok" (plan found), "no_plan" (the platform answered and the account is not on a plan), never "needs_permission": the permission for this read is agency-only and can never be granted to this app, so 401/403 means "not_available".

export type SaasState = "ok" | "no_plan" | "needs_permission" | "not_available";
export type PlanDetail = { title: string | null; trialDays: number | null; userLimit: number | null; contactLimit: number | null; prices: Array<{ id: string | null; amount: number; currency: string | null; interval: string | null }> };
export type SaasRow = {
  state: SaasState; planId: string | null; planName: string | null; status: string | null;
  /** Extra detail the platform returned (the price line the account is on, trial days, limits). Absent when the plan could not be read. */
  subscriptionId?: string | null; price?: { amount: number; currency: string | null; interval: string | null } | null; trialDays?: number | null; userLimit?: number | null; contactLimit?: number | null;
};
export type Resp = { status: number; body: unknown };
export type Getter = (path: string, version: string) => Promise<Resp>;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
const dig = (o: unknown, ...keys: string[]): unknown => { let c = o; for (const k of keys) { if (c && typeof c === "object") c = (c as Record<string, unknown>)[k]; else return undefined; } return c; };

/** Plain words shown wherever client plan details cannot be read (the platform gives them to agency-level apps only). */
export const PLANS_AGENCY_ONLY = "Not available for this kind of app. The platform only gives plan details to company-level apps.";
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

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
/** Plan detail from a saas-plan response: title, trial days, limits and every price line (amount, currency, month or year). */
export function planDetail(body: unknown): PlanDetail {
  const list = dig(body, "prices");
  const prices = (Array.isArray(list) ? list : []).flatMap((p) => { const amount = num(dig(p, "amount")); return amount === null ? [] : [{ id: str(dig(p, "_id")) ?? str(dig(p, "id")) ?? str(dig(p, "priceId")), amount, currency: str(dig(p, "currency")), interval: str(dig(p, "billingInterval")) ?? str(dig(p, "interval")) }]; });
  return { title: planTitle(body), trialDays: num(dig(body, "trialPeriod")), userLimit: num(dig(body, "userLimit")), contactLimit: num(dig(body, "contactLimit")), prices };
}

/** Fetch every page of the SaaS accounts list and map it to one row per account id. `failed` carries the real HTTP status when the call did not succeed. */
export async function readSaasPlans(get: Getter, companyId: string): Promise<{ failed: number | null; rows: Map<string, SaasRow> }> {
  const rows = new Map<string, SaasRow>();
  const plans = new Map<string, PlanDetail | null>();
  const priceIds = new Map<string, string | null>();
  const base = `/saas/saas-locations/${encodeURIComponent(companyId)}`;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await call(get, `${base}?page=${page}`);
    if (r.status < 200 || r.status >= 300) return { failed: r.status, rows: page === 1 ? rows : rows };
    const list = dig(r.body, "locations");
    for (const l of Array.isArray(list) ? list : []) {
      const id = str(dig(l, "locationId"));
      if (!id) continue;
      const planId = str(dig(l, "subscriptionInfo", "saasPlanId")), status = str(dig(l, "subscriptionInfo", "subscriptionStatus"));
      priceIds.set(id, str(dig(l, "subscriptionInfo", "priceId")));
      rows.set(id, planId || status ? { state: "ok", planId, planName: null, status, subscriptionId: str(dig(l, "subscriptionId")) } : { state: "no_plan", planId: null, planName: null, status: null });
    }
    if (dig(r.body, "pagination", "hasNext") !== true) break;
  }
  for (const [id, row] of rows) {
    if (!row.planId) continue;
    if (!plans.has(row.planId)) {
      const p = await call(get, `/saas/saas-plan/${encodeURIComponent(row.planId)}?companyId=${encodeURIComponent(companyId)}`);
      plans.set(row.planId, p.status >= 200 && p.status < 300 ? planDetail(p.body) : null);
    }
    const d = plans.get(row.planId) ?? null;
    row.planName = d?.title ?? null;
    if (d) {
      const pid = priceIds.get(id), line = (pid ? d.prices.find((x) => x.id === pid) : null) ?? (d.prices.length === 1 ? d.prices[0] : null);
      row.price = line ? { amount: line.amount, currency: line.currency, interval: line.interval } : null;
      row.trialDays = d.trialDays; row.userLimit = d.userLimit; row.contactLimit = d.contactLimit;
    }
  }
  return { failed: null, rows };
}

/** State for an account the list did not contain, or for every account when the call failed. */
export function stateFor(result: { failed: number | null; rows: Map<string, SaasRow> }, locationId: string): SaasRow {
  if (result.failed !== null) {
    return { state: "not_available", planId: null, planName: null, status: null };
  }
  return result.rows.get(locationId) ?? { state: "no_plan", planId: null, planName: null, status: null };
}
