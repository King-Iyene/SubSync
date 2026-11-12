import { sql } from "../db";
import { atRiskOf, decodeCursor, facetsOf, pageAfter, sortRows } from "./clients2-core";
import { bucketsOf, historyText, moneyRow, todayLine, type MoneyExtras } from "./cl3-money-core";
import { roster } from "./clients2-queries";
import { cleanId, type Links, type Scope } from "./clients3-queries";
import type { Cl3Bucket, Cl3HistoryList, Cl3Money, Cl3MoneyRow } from "./clients3-types";

// Clients v3, money: ONE table of every client account with plan, payment status, credit balance, whether SubSync is installed, and health. Built on the Clients roster (a few grouped
// queries, cached a minute), so the first screen does not depend on how many leads sit behind it. Every filter count equals the rows it opens. What the platform cannot give (next charge
// date, why a payment failed, apps other than SubSync) is null and never guessed. Money figures are the PLAN PRICE per month (a yearly price / 12): estimates, per currency, never summed across currencies.

export async function extrasFor(inst: string, ids: string[]): Promise<MoneyExtras> {
  const db = sql();
  const [w, a] = await Promise.all([
    ids.length ? db`select location_id, wallet_balance, wallet_state from client_billing where installation_id = ${inst} and location_id = any(${ids}::text[])`.catch(() => []) : [],
    ids.length ? db`select location_id, is_installed, version_id from cl3_app_installs where installation_id = ${inst} and location_id = any(${ids}::text[])`.catch(() => []) : [],
  ]);
  const num = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    wallet: new Map((w as Record<string, unknown>[]).map((r) => [r.location_id as string, { balance: num(r.wallet_balance), state: (r.wallet_state as string | null) ?? null }])),
    installs: new Map((a as Record<string, unknown>[]).map((r) => [r.location_id as string, { installed: r.is_installed === true, version: (r.version_id as string | null) ?? null }])),
  };
}

export async function money(s: Scope, links: Links, f: { bucket: Cl3Bucket; plan: string | null; q: string | null }, o: { cursor: string | null; size: number }, now = Date.now()): Promise<Cl3Money> {
  const r = await roster(s, links, now);
  const x = await extrasFor(s.inst, r.rows.map((y) => y.locationId));
  const all = r.rows.map((y) => ({ y, m: moneyRow(y, x) }));
  const counts = Object.fromEntries((["all", "unpaid", "failing", "no_plan", "paid", "empty_wallet", "app_missing"] as Cl3Bucket[]).map((k) => [k, 0])) as Record<Cl3Bucket, number>;
  for (const { m } of all) for (const k of bucketsOf(m)) counts[k]++;
  const q = (f.q ?? "").trim().toLowerCase();
  const hit = all.filter(({ m }) => bucketsOf(m).includes(f.bucket) && (!f.plan || (m.plan.name ?? "") === f.plan) && (!q || m.name.toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)));
  // Longest in the current state first for the unpaid lists, plan trouble first otherwise.
  const byId = new Map(hit.map((h) => [h.y.locationId, h.m]));
  const sorted = sortRows(hit.map((h) => h.y), "attention");
  const page = pageAfter(sorted, "attention", decodeCursor(o.cursor), o.size);
  const paidRows = r.rows.filter((y) => y.plan.pay === "paid");
  const expected = new Map<string, { monthly: number; accounts: number }>();
  for (const y of paidRows) { const c = y.plan.currency ?? "USD", e = expected.get(c) ?? { monthly: 0, accounts: 0 }; e.accounts++; e.monthly += y.plan.monthly ?? 0; expected.set(c, e); }
  const expectedMonthly = [...expected.entries()].map(([currency, v]) => ({ currency, monthly: Math.round(v.monthly * 100) / 100, accounts: v.accounts })).sort((a, b) => b.monthly - a.monthly);
  const atRisk = atRiskOf(r.rows);
  const needs = new Set<string>();
  if (r.rows.some((y) => y.plan.state === "needs_permission")) needs.add("saas/company.read");
  if ([...x.wallet.values()].some((v) => v.state === "needs_permission")) needs.add("wallet.readonly");
  const installRows = [...x.installs.values()];
  const hist = await sql()`select min(at) m from cl3_history where installation_id = ${s.inst}`.catch(() => []);
  return {
    rows: page.rows.map((y) => byId.get(y.locationId) as Cl3MoneyRow), total: hit.length, next: page.next, size: o.size,
    summary: {
      accounts: r.rows.length, counts, expectedMonthly, atRisk,
      plans: facetsOf(r.rows, (y) => y.plan.name),
      apps: { state: installRows.length ? "ok" : "not_read", installed: installRows.filter((v) => v.installed).length, missing: installRows.filter((v) => !v.installed).length, unknown: r.rows.filter((y) => !x.installs.has(y.locationId)).length },
      needsPermission: [...needs], today: todayLine(counts, atRisk, r.rows.some((y) => y.plan.state === "needs_permission") ? "needs_permission" : r.rows.length > 0 && r.rows.every((y) => y.plan.state === "ok" || y.plan.state === "no_plan") ? "ok" : "not_checked"),
      historyStarts: hist[0]?.m ? new Date(hist[0].m as string).toISOString().slice(0, 10) : null,
    },
  };
}

/** Our own record of changes, newest first, keyset paged by id. One account when `location` is given (already checked by the caller). */
export async function moneyHistory(s: Scope, links: Links, f: { location: string | null }, o: { cursor: string | null; size: number }): Promise<Cl3HistoryList> {
  const db = sql();
  if (s.allowed && s.allowed.length === 0) return { rows: [], next: null, size: o.size, historyStarts: null };
  const cur = o.cursor && /^\d{1,18}$/.test(o.cursor) ? o.cursor : null;
  const loc = cleanId(f.location);
  const rows = await db`
    select h.id::text id, h.location_id, coalesce(nullif(l.name, ''), 'Client account') name, h.kind, h.from_value, h.to_value, h.at
    from cl3_history h left join locations l on l.installation_id = h.installation_id and l.location_id = h.location_id
    where h.installation_id = ${s.inst}
      ${s.allowed ? db`and h.location_id = any(${s.allowed}::text[])` : db``}
      ${loc ? db`and h.location_id = ${loc}` : db``}
      ${cur ? db`and h.id < ${cur}::bigint` : db``}
    order by h.id desc limit ${o.size + 1}`.catch(() => []);
  const more = rows.length > o.size, page = rows.slice(0, o.size);
  const first = await db`select min(at) m from cl3_history where installation_id = ${s.inst}`.catch(() => []);
  return {
    rows: page.map((r) => ({ id: r.id as string, locationId: r.location_id as string, name: r.name as string, kind: r.kind as string, text: historyText(r.kind as string, r.from_value as string | null, r.to_value as string | null), at: new Date(r.at as string).toISOString(), url: links.account(r.location_id as string) })),
    next: more ? (page[page.length - 1].id as string) : null, size: o.size,
    historyStarts: first[0]?.m ? new Date(first[0].m as string).toISOString().slice(0, 10) : null,
  };
}
