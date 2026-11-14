import { sql } from "../db";
import { GHL_API } from "../ghl/client";
import { ghlFetch } from "../ghl/http";
import { parseGranted } from "../scope-groups";
import { locationAccessToken } from "../sync/engine";
import { accountsIn, type Links, type Scope } from "./clients3-queries";
import { trialEnd } from "./clients3-installs";
import type { Getter } from "./clients3-saas";
import { monitorAlerts, monitorRow, readCharges, SAAS_PENDING_NOTE, type ChargeInfo, type MonitorRow, type RecentChanges } from "./plan-monitor-core";

// Plan monitor (Clients): ONE table, a row per client account. Read only. Every read starts from accountsIn (the caller's own installation, inside `allowed`), so an account the
// caller may not see is never read. Alerts go through the existing alerts table with keys that start with pm: (only those are ever resolved here).
export type Cl3PlanMonitor = { rows: Array<MonitorRow & { url: string | null }>; total: number; pendingNote: string; counts: { trialEnding: number; planChanged: number; paymentProblem: number; notInstalled: number }; historyStarts: string | null };

const num = (v: unknown) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

async function gather(inst: string, ids: string[], now: number) {
  const db = sql();
  const [inst3, trial, bill, hist] = await Promise.all([
    db`select location_id, is_installed, plan_id, on_trial, charges_state, last_charge_at, last_charge_amount, last_charge_currency from cl3_app_installs where installation_id = ${inst} and location_id = any(${ids}::text[])`
      .catch(async () => db`select location_id, is_installed, plan_id, on_trial from cl3_app_installs where installation_id = ${inst} and location_id = any(${ids}::text[])`.catch(() => [])),
    db`select location_id, trial_days, trial_started_at from install_plans where installation_id = ${inst} and location_id = any(${ids}::text[])`.catch(() => []),
    db`select location_id, subscription_status from client_billing where installation_id = ${inst} and location_id = any(${ids}::text[])`.catch(() => []),
    db`select location_id, kind, from_value, to_value, at from cl3_history where installation_id = ${inst} and location_id = any(${ids}::text[]) and kind in ('app_plan', 'app_removed') and at > ${new Date(now - 7 * 86_400_000)} order by id`.catch(() => []),
  ]);
  const recent: RecentChanges = { planChanges: new Map(), removed: new Map() };
  for (const h of hist as Record<string, unknown>[]) {
    if (h.kind === "app_plan") recent.planChanges.set(h.location_id as string, { from: (h.from_value as string | null) ?? null, to: (h.to_value as string | null) ?? null, at: iso(h.at) as string });
    else recent.removed.set(h.location_id as string, iso(h.at) as string);
  }
  return {
    installs: new Map((inst3 as Record<string, unknown>[]).map((r) => [r.location_id as string, r])),
    trial: new Map((trial as Record<string, unknown>[]).map((r) => [r.location_id as string, trialEnd((r.trial_started_at as Date | null) ?? null, num(r.trial_days))])),
    late: new Set((bill as Record<string, unknown>[]).filter((r) => /^(past_due|unpaid)$/i.test(String(r.subscription_status ?? ""))).map((r) => r.location_id as string)),
    recent,
  };
}

export async function monitorRows(s: Scope, f: { q?: string | null }, now = Date.now()): Promise<{ rows: MonitorRow[]; recent: RecentChanges }> {
  const accts = await accountsIn(s, { q: f.q });
  if (!accts.length) return { rows: [], recent: { planChanges: new Map(), removed: new Map() } };
  const g = await gather(s.inst, accts.map((a) => a.id), now);
  const installsRead = g.installs.size > 0;
  const rows = accts.map((a) => {
    const i = g.installs.get(a.id);
    const cs = i?.charges_state as string | null | undefined;
    const charge: ChargeInfo = i && cs ? { state: cs as ChargeInfo["state"], lastAt: iso(i.last_charge_at), amount: num(i.last_charge_amount), currency: (i.last_charge_currency as string | null) ?? null } : { state: "not_checked", lastAt: null, amount: null, currency: null };
    return monitorRow({
      locationId: a.id, name: a.name, installed: i ? i.is_installed === true : null, planId: (i?.plan_id as string | null | undefined) ?? null, onTrial: typeof i?.on_trial === "boolean" ? (i.on_trial as boolean) : null,
      trialEndsAt: g.trial.get(a.id) ?? null, charge, planChangedAt: g.recent.planChanges.get(a.id)?.at ?? null, paymentProblem: g.late.has(a.id), installsRead,
    }, now);
  });
  return { rows, recent: g.recent };
}

/** The table. A client account session passes allowed = its own account only (the route sets it), so it can only ever get its own row. */
export async function planMonitor(s: Scope, links: Links, f: { q?: string | null }, now = Date.now()): Promise<Cl3PlanMonitor> {
  const { rows } = await monitorRows(s, f, now);
  const order = { payment_problem: 0, not_installed: 1, trial: 2, plan_changed: 3, unknown: 4, active: 5 } as const;
  const sorted = [...rows].sort((a, b) => order[a.chip] - order[b.chip] || a.name.localeCompare(b.name)).slice(0, 500);
  const hist = await sql()`select min(at) m from cl3_history where installation_id = ${s.inst} and kind = 'app_plan'`.catch(() => []);
  return {
    rows: sorted.map((r) => ({ ...r, url: links.account(r.locationId) })), total: rows.length, pendingNote: SAAS_PENDING_NOTE,
    counts: { trialEnding: rows.filter((r) => r.chip === "trial" && r.trialDaysLeft !== null && r.trialDaysLeft <= 3).length, planChanged: rows.filter((r) => r.chip === "plan_changed").length, paymentProblem: rows.filter((r) => r.chip === "payment_problem").length, notInstalled: rows.filter((r) => r.chip === "not_installed").length },
    historyStarts: hist[0]?.m ? iso(hist[0].m)!.slice(0, 10) : null,
  };
}

const CHARGES_EVERY_HOURS = 6, CHARGES_PER_RUN = 100, CHARGES_PACE_MS = 120;
const tokenGetter = (token: string): Getter => async (path, version) => {
  const res = await ghlFetch(`${GHL_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" }, cache: "no-store" });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
};

/** Sweep step, after the install list is stored: read the last charge per installed account (own token, optional permission charges.readonly; at most 100 a run, each every 6 hours, stops at the first
 *  permission refusal), then raise the pm: alerts. Never throws into the caller. */
export async function refreshPlanMonitor(inst: string, companyKey: string, now = Date.now()): Promise<void> {
  const db = sql();
  const scopeRow = await db`select scope from installations where id = ${inst}`.catch(() => []);
  const granted = typeof scopeRow[0]?.scope === "string" && (scopeRow[0].scope as string).trim() ? parseGranted(scopeRow[0].scope as string) : null;
  const due = await db`select location_id from cl3_app_installs where installation_id = ${inst} and is_installed and (charges_at is null or charges_at < now() - ${`${CHARGES_EVERY_HOURS} hours`}::interval) order by charges_at nulls first limit ${CHARGES_PER_RUN}`.catch(() => []);
  for (const d of due) {
    const id = d.location_id as string;
    let c: ChargeInfo;
    try { c = await readCharges(tokenGetter(await locationAccessToken(companyKey, id)), granted); } catch { c = { state: "not_available", lastAt: null, amount: null, currency: null }; }
    await db`update cl3_app_installs set charges_state = ${c.state}, charges_at = now(), last_charge_at = ${c.lastAt}, last_charge_amount = ${c.amount}, last_charge_currency = ${c.currency} where installation_id = ${inst} and location_id = ${id}`.catch(() => undefined);
    if (c.state === "needs_permission") break;
    await new Promise((res) => setTimeout(res, CHARGES_PACE_MS));
  }
  await raisePlanAlerts(inst, now).catch(() => undefined);
}

/** Raises trial-ending, plan-changed and uninstall alerts and clears pm: alerts whose condition went away. Only keys that start with pm: are touched. */
export async function raisePlanAlerts(inst: string, now = Date.now()): Promise<number> {
  const { rows, recent } = await monitorRows({ inst, allowed: null }, {}, now);
  const drafts = monitorAlerts(rows, recent, now);
  await sql().begin(async (tx) => {
    for (const d of drafts) {
      await tx`insert into alerts (installation_id, location_id, kind, severity, title, detail, dedupe_key) values (${inst}, ${d.locationId}, ${d.kind}, ${d.severity}, ${d.title}, ${tx.json(d.detail as never)}, ${d.dedupeKey})
        on conflict (installation_id, dedupe_key) where resolved_at is null do update set severity = excluded.severity, title = excluded.title, detail = excluded.detail`;
    }
    await tx`update alerts set resolved_at = now() where installation_id = ${inst} and resolved_at is null and dedupe_key like 'pm:%' and not (dedupe_key = any(${drafts.map((d) => d.dedupeKey)}::text[]))`;
  });
  return drafts.length;
}
