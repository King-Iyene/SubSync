import type { Cl2Plan, Cl2Row, PayKey, PlanState } from "./clients2-types";

// Clients v2, pure logic (no database): payment status mapping, plan explanations, money at risk, sorting and keyset paging. Unit tested with fixtures.
// Rules: the status the platform returns is stored raw and mapped here; an unknown value shows as "Other: <raw>" (never hidden, never guessed). "Needs permission"
// is shown ONLY when the platform answered 401 or 403. Money at risk is the plan price per month (a yearly price / 12): an estimate, per currency, never summed across currencies.

export const DAY = 86_400_000;
export const DEFAULT_QUIET_DAYS = 14;

const PAID = /^(active|trialing|trial|paid|succeeded)$/i;
const PAST_DUE = /^(past[_ ]?due|unpaid|incomplete|failed|overdue)$/i;
const CANCELLED = /^(canceled|cancelled|incomplete[_ ]?expired|expired|terminated)$/i;
const PAUSED = /^paused$/i;

/** Map the platform's raw subscription status to one of our plain states. */
export function payStatus(raw: string | null, state: PlanState): { key: PayKey; label: string } {
  if (state === "no_plan") return { key: "none", label: "Not on a paid plan from you" };
  if (state === "needs_permission") return { key: "unknown", label: "Needs permission: reconnect" };
  if (state === "not_available") return { key: "unknown", label: "Not available for this kind of app" };
  if (state === "not_checked" || raw === null) return { key: "unknown", label: "Not checked yet" };
  if (PAID.test(raw)) return { key: "paid", label: "Paid up" };
  if (PAST_DUE.test(raw)) return { key: "past_due", label: "Past due" };
  if (CANCELLED.test(raw)) return { key: "cancelled", label: "Cancelled" };
  if (PAUSED.test(raw)) return { key: "paused", label: "Paused" };
  return { key: "other", label: `Other: ${raw.slice(0, 40)}` };
}

/** True when the owner should look at this plan (not paid up and not simply "no plan"). */
export const needsPlanLook = (k: PayKey) => k === "past_due" || k === "cancelled" || k === "paused" || k === "other";

/** Price per month: a yearly price divided by 12. Null when there is no price. */
export function monthlyOf(amount: number | null, interval: string | null): number | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  const i = (interval ?? "month").toLowerCase();
  return Math.round((i.startsWith("year") ? amount / 12 : i.startsWith("week") ? amount * 4.33 : amount) * 100) / 100;
}

/** One plain line for the plan block: what this means and what to do next. */
export function explainPlan(state: PlanState, key: PayKey, httpStatus: number | null, reason: string | null): string {
  if (state === "needs_permission") return "The platform refused this read (permission). Reconnect SubSync and allow plan access, then this fills in.";
  if (state === "not_available") return reason ?? "Not available for this kind of app. The platform only gives plan details to company-level apps.";
  if (state === "not_checked") return "Not read yet. The next hourly read will fill this in.";
  if (state === "no_plan") return "This client is not on a paid plan you sell in your CRM, or paid plans are not switched on there.";
  switch (key) {
    case "paid": return "The platform reports this client's paid plan as active.";
    case "past_due": return "The last payment did not go through. Check the card in your payment dashboard, ask the client to update it, and SubSync will show when it is paid.";
    case "cancelled": return "This client's paid plan was cancelled. Check whether they still use your tools.";
    case "paused": return "This client's paid plan is paused.";
    default: return "The platform returned a status SubSync does not recognise. It is shown as it came, so nothing is hidden.";
  }
}

export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY));
}

export type BillingRow = {
  state?: string | null; plan_name?: string | null; plan_id?: string | null; subscription_status?: string | null; price_amount?: number | string | null; price_currency?: string | null; billing_interval?: string | null;
  status_since?: Date | string | null; http_status?: number | null; reason?: string | null; fetched_at?: Date | string | null;
};
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
const num = (v: unknown) => { const n = v === null || v === undefined ? NaN : Number(v); return Number.isFinite(n) ? n : null; };

/** The plan block for one account from the stored row (no row = never read). */
export function planOf(r: BillingRow | undefined, now: number): Cl2Plan {
  const st = r?.state ?? "unknown";
  const state: PlanState = st === "ok" ? "ok" : st === "no_plan" ? "no_plan" : st === "unknown" || !r ? "not_checked" : st === "needs_permission" ? "needs_permission" : "not_available";
  const raw = (r?.subscription_status as string | null | undefined) ?? null;
  const p = payStatus(raw, state);
  const amount = num(r?.price_amount), interval = (r?.billing_interval as string | null | undefined) ?? null;
  const since = iso(r?.status_since) ?? null;
  return {
    state, name: (r?.plan_name as string | null | undefined) ?? null, pay: p.key, payLabel: p.label, statusRaw: raw,
    monthly: monthlyOf(amount, interval), currency: (r?.price_currency as string | null | undefined) ?? null, interval, priceAmount: amount,
    since, daysInStatus: daysSince(since, now), explain: explainPlan(state, p.key, (r?.http_status as number | null | undefined) ?? null, (r?.reason as string | null | undefined) ?? null), checkedAt: iso(r?.fetched_at),
  };
}

/** Money at risk per currency: the monthly price of every plan that needs a look. Estimate; never summed across currencies. */
export function atRiskOf(rows: Array<{ plan: Cl2Plan }>): Array<{ currency: string; monthly: number; accounts: number }> {
  const by = new Map<string, { monthly: number; accounts: number }>();
  for (const r of rows) {
    if (!needsPlanLook(r.plan.pay)) continue;
    const cur = r.plan.currency ?? "USD";
    const e = by.get(cur) ?? { monthly: 0, accounts: 0 };
    e.accounts++; e.monthly += r.plan.monthly ?? 0; by.set(cur, e);
  }
  return [...by.entries()].map(([currency, v]) => ({ currency, monthly: Math.round(v.monthly * 100) / 100, accounts: v.accounts })).sort((a, b) => b.monthly - a.monthly);
}

// ---------- filters, sorting, keyset paging ----------

export type Cl2Filter = { q?: string | null; status?: string | null; plan?: string | null; level?: string | null; vertical?: string | null; manager?: string | null; quiet?: boolean };
export function matches(r: Cl2Row, f: Cl2Filter): boolean {
  const q = (f.q ?? "").trim().toLowerCase();
  if (q && !(r.name.toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q))) return false;
  if (f.status) {
    if (f.status === "attention") { if (!needsPlanLook(r.plan.pay)) return false; } else if (r.plan.pay !== f.status) return false;
  }
  if (f.plan && (r.plan.name ?? "") !== f.plan) return false;
  if (f.level && r.level !== f.level) return false;
  if (f.vertical) { if (f.vertical === "none" ? r.vertical !== null : r.vertical !== f.vertical) return false; }
  if (f.manager) { if (f.manager === "none" ? r.manager !== null : r.manager !== f.manager) return false; }
  if (f.quiet && !r.quiet) return false;
  return true;
}

export const SORTS = ["attention", "name", "plan", "status", "activity", "health", "value"] as const;
export type Cl2Sort = (typeof SORTS)[number];
const PAY_RANK: Record<PayKey, number> = { past_due: 0, cancelled: 1, paused: 2, other: 3, unknown: 4, none: 5, paid: 6 };
const LEVEL_RANK = { act: 0, watch: 1, unknown: 2, ok: 3 } as const;

/** The sort key of a row (a number or a string); ties break on name then account id so the order is total and a cursor is exact. */
export function keyOf(r: Cl2Row, sort: Cl2Sort): number | string {
  switch (sort) {
    case "name": return r.name.toLowerCase();
    case "plan": return (r.plan.name ?? "~").toLowerCase();
    case "status": return PAY_RANK[r.plan.pay];
    case "activity": return r.lastActivityAt ? Date.parse(r.lastActivityAt) : 0; // oldest first = most quiet first
    case "health": return LEVEL_RANK[r.level];
    case "value": return -r.openValue;
    default: return PAY_RANK[r.plan.pay] * 10 + LEVEL_RANK[r.level]; // attention: plan trouble first, then outcome trouble
  }
}
const cmpKey = (a: number | string, b: number | string) => (a < b ? -1 : a > b ? 1 : 0);
export function sortRows(rows: Cl2Row[], sort: Cl2Sort): Cl2Row[] {
  return [...rows].sort((a, b) => cmpKey(keyOf(a, sort), keyOf(b, sort)) || cmpKey(a.name.toLowerCase(), b.name.toLowerCase()) || cmpKey(a.locationId, b.locationId));
}

export type Cursor = { k: number | string; n: string; id: string };
export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString("base64url");
export function decodeCursor(v: string | null | undefined): Cursor | null {
  if (!v || v.length > 400) return null;
  try {
    const o = JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as Partial<Cursor>;
    return (typeof o.k === "number" || typeof o.k === "string") && typeof o.n === "string" && typeof o.id === "string" ? { k: o.k, n: o.n, id: o.id } : null;
  } catch { return null; }
}

/** Keyset page: the rows strictly after the cursor in sorted order (sorted comes from sortRows with the same sort). No offsets, so a list that changes between pages never repeats or skips a row. */
export function pageAfter(sorted: Cl2Row[], sort: Cl2Sort, cursor: Cursor | null, size: number): { rows: Cl2Row[]; next: string | null } {
  let start = 0;
  if (cursor) {
    start = sorted.findIndex((r) => (cmpKey(keyOf(r, sort), cursor.k) || cmpKey(r.name.toLowerCase(), cursor.n) || cmpKey(r.locationId, cursor.id)) > 0);
    if (start < 0) start = sorted.length;
  }
  const rows = sorted.slice(start, start + size);
  const last = rows[rows.length - 1];
  return { rows, next: last && start + size < sorted.length ? encodeCursor({ k: keyOf(last, sort), n: last.name.toLowerCase(), id: last.locationId }) : null };
}

// ---------- the "what to do today" line ----------

export type PlanAccess = "ok" | "needs_permission" | "no_data" | "not_checked";
export function planAccessOf(rows: Cl2Row[]): PlanAccess {
  if (rows.length === 0) return "no_data";
  if (rows.some((r) => r.plan.state === "ok")) return "ok";
  if (rows.some((r) => r.plan.state === "needs_permission")) return "needs_permission";
  if (rows.every((r) => r.plan.state === "not_checked")) return "not_checked";
  return "no_data";
}
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
export type TodayButton = { label: string; kind: "plans" | "attention" | "setup" | "accounts"; status?: string; level?: string; count: number };
export function todayOf(i: { rows: Cl2Row[]; planAccess: PlanAccess }): { headline: string; button: TodayButton | null } {
  const { rows } = i;
  if (rows.length === 0) return { headline: "No client accounts yet. They appear here after the first read finishes.", button: null };
  const past = rows.filter((r) => r.plan.pay === "past_due").length, trouble = rows.filter((r) => needsPlanLook(r.plan.pay)).length;
  if (trouble > 0) {
    return {
      headline: past > 0 ? `${plural(past, "client's paid plan is", "clients' paid plans are")} past due. Review ${past === 1 ? "it" : "them"} first.` : `${plural(trouble, "client's paid plan needs", "clients' paid plans need")} a look (cancelled or paused).`,
      button: { label: past > 0 ? "Review past due plans" : "Review plans", kind: "plans", status: past > 0 ? "past_due" : "attention", count: past > 0 ? past : trouble },
    };
  }
  const act = rows.filter((r) => r.level === "act");
  if (act.length > 0) return { headline: `${plural(act.length, "client account needs", "client accounts need")} you now: ${act[0].summary ?? "see why"}.`, button: { label: "See who needs you", kind: "attention", level: "act", count: act.length } };
  const reconnect = rows.filter((r) => r.plan.state === "needs_permission").length;
  if (reconnect > 0 && i.planAccess === "needs_permission") return { headline: "SubSync cannot read your clients' paid plans yet. Reconnect and allow plan access.", button: { label: "See why", kind: "setup", count: reconnect } };
  const watch = rows.filter((r) => r.level === "watch").length;
  if (i.planAccess === "not_checked" && watch === 0) return { headline: "Not known yet: the client plans have not been read. The next hourly read fills this in.", button: null };
  if (watch > 0) return { headline: `Nothing is urgent. ${plural(watch, "client account is", "client accounts are")} worth an eye.`, button: { label: "See them", kind: "attention", level: "watch", count: watch } };
  if (reconnect > 0) return { headline: "Not known: needs permission. Some client plans cannot be read, so SubSync cannot call every account fine.", button: { label: "See why", kind: "setup", count: reconnect } };
  return { headline: "All client accounts look fine today.", button: { label: "Open accounts", kind: "accounts", count: rows.length } };
}

export function facetsOf(rows: Cl2Row[], pick: (r: Cl2Row) => string | null, label: (k: string) => string = (k) => k): Array<{ key: string; label: string; count: number }> {
  const by = new Map<string, number>();
  for (const r of rows) { const k = pick(r); if (k) by.set(k, (by.get(k) ?? 0) + 1); }
  return [...by.entries()].map(([key, count]) => ({ key, label: label(key), count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
