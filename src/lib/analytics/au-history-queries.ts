import { sql } from "../db";
import { AUDIT_RULES_VERSION, type RunInput, type RunRow, type Stored } from "./au-history";

// The database side of the Account audit history (docs/features/AUDIT_BRIEF.md). Every query names the installation and a list of account ids that the caller's
// session decided (never ids from the request), so one company's history can never be read for another. Writes touch only SubSync's own tables (au_runs, au_prefs,
// au_account_prefs); nothing here reaches the CRM.

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

const countsOf = (v: unknown): RunRow["counts"] => {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" ? x : null);
  return { replies: n(o.replies), stale: n(o.stale), noshows: n(o.noshows), appointments: n(o.appointments) };
};
const rowOf = (r: Record<string, unknown>): RunRow => ({
  locationId: r.location_id as string, runDay: String(r.run_day).slice(0, 10), rulesVersion: r.rules_version as number, baseline: r.is_baseline as boolean, counts: countsOf(r.counts),
  staleDollars: Number(r.stale_dollars ?? 0), estimate: r.est_dollars === null ? null : Number(r.est_dollars), estLow: r.est_low === null ? null : Number(r.est_low), estHigh: r.est_high === null ? null : Number(r.est_high),
  closedDeals: r.closed_deals as number, partial: r.partial as boolean,
});

/**
 * Records one run per account for today, once: a second call the same day changes nothing (first read of the day stands), and the first row an account ever gets is
 * its baseline. Only accounts that belong to the installation are written. Returns how many rows were new.
 */
export async function recordRuns(installationId: string, runs: RunInput[], now: number, source: "view" | "sweep"): Promise<number> {
  if (runs.length === 0) return 0;
  const body = runs.map((r) => ({
    location_id: r.locationId, counts: r.counts, stale_dollars: r.staleDollars, est_dollars: r.estimate, est_low: r.estLow, est_high: r.estHigh, closed_deals: r.closedDeals, partial: r.partial,
  }));
  const db = sql();
  const done = await db`
    insert into au_runs (installation_id, location_id, run_day, run_at, rules_version, is_baseline, counts, stale_dollars, est_dollars, est_low, est_high, closed_deals, partial, source)
    select ${installationId}, v.location_id, ${today(now)}::date, ${new Date(now)}, ${AUDIT_RULES_VERSION},
      not exists (select 1 from au_runs p where p.installation_id = ${installationId} and p.location_id = v.location_id),
      v.counts, v.stale_dollars, v.est_dollars, v.est_low, v.est_high, v.closed_deals, v.partial, ${source}
    from jsonb_to_recordset(${db.json(body as never)}::jsonb) as v(location_id text, counts jsonb, stale_dollars numeric, est_dollars numeric, est_low numeric, est_high numeric, closed_deals int, partial boolean)
    where exists (select 1 from locations l where l.installation_id = ${installationId} and l.location_id = v.location_id)
    on conflict (installation_id, location_id, run_day) do nothing
    returning 1`;
  return done.length;
}

/** For each account: its first stored run (the baseline) and its latest run before today, plus the daily totals of the last 90 days. */
export async function readStored(installationId: string, ids: string[], now: number): Promise<Stored> {
  const runs: Stored["runs"] = new Map(ids.map((id) => [id, { first: null, before: null }]));
  if (ids.length === 0) return { runs, series: [] };
  const day = today(now);
  const db = sql();
  const [first, before, series] = await Promise.all([
    db`select distinct on (location_id) * from au_runs where installation_id = ${installationId} and location_id = any(${ids}::text[]) order by location_id, run_day asc`,
    db`select distinct on (location_id) * from au_runs where installation_id = ${installationId} and location_id = any(${ids}::text[]) and run_day < ${day}::date order by location_id, run_day desc`,
    db`select run_day, count(*)::int accounts,
         sum(coalesce((counts->>'replies')::int, 0) + coalesce((counts->>'stale')::int, 0) + coalesce((counts->>'noshows')::int, 0) + coalesce((counts->>'appointments')::int, 0))::int things
       from au_runs where installation_id = ${installationId} and location_id = any(${ids}::text[]) and not partial and run_day >= ${day}::date - 90
       group by run_day order by run_day`,
  ]);
  for (const r of first) { const e = runs.get(r.location_id as string); if (e) e.first = rowOf(r); }
  for (const r of before) { const e = runs.get(r.location_id as string); if (e) e.before = rowOf(r); }
  return { runs, series: series.map((r) => ({ day: String(r.run_day).slice(0, 10), things: r.things as number, accounts: r.accounts as number })) };
}

/** The run of `daysBack` days ago or the nearest earlier one, per account (for the monthly message). */
export async function runsNear(installationId: string, ids: string[], now: number, daysBack: number): Promise<Map<string, RunRow>> {
  const out = new Map<string, RunRow>();
  if (ids.length === 0) return out;
  const rows = await sql()`select distinct on (location_id) * from au_runs where installation_id = ${installationId} and location_id = any(${ids}::text[]) and run_day <= ${today(now)}::date - ${daysBack}::int order by location_id, run_day desc`;
  for (const r of rows) out.set(r.location_id as string, rowOf(r));
  return out;
}

export async function latestRuns(installationId: string, ids: string[]): Promise<Map<string, RunRow>> {
  const out = new Map<string, RunRow>();
  if (ids.length === 0) return out;
  const rows = await sql()`select distinct on (location_id) * from au_runs where installation_id = ${installationId} and location_id = any(${ids}::text[]) order by location_id, run_day desc`;
  for (const r of rows) out.set(r.location_id as string, rowOf(r));
  return out;
}

// ---------- settings of the monthly message ----------

export type MonthlyPrefs = { on: boolean; muted: string[] };

export async function readPrefs(installationId: string, ids: string[]): Promise<MonthlyPrefs> {
  const db = sql();
  const [p] = await db`select monthly_on from au_prefs where installation_id = ${installationId}`;
  const muted = ids.length ? await db`select location_id from au_account_prefs where installation_id = ${installationId} and monthly_muted and location_id = any(${ids}::text[])` : [];
  return { on: p ? (p.monthly_on as boolean) : true, muted: muted.map((r) => r.location_id as string) };
}

export async function setMonthlyOn(installationId: string, on: boolean): Promise<void> {
  await sql()`insert into au_prefs (installation_id, monthly_on) values (${installationId}, ${on}) on conflict (installation_id) do update set monthly_on = ${on}, updated_at = now()`;
}

/** `locationId` must already have passed ownedLocation. */
export async function setAccountMute(installationId: string, locationId: string, muted: boolean): Promise<void> {
  await sql()`insert into au_account_prefs (installation_id, location_id, monthly_muted) values (${installationId}, ${locationId}, ${muted})
    on conflict (installation_id, location_id) do update set monthly_muted = ${muted}, updated_at = now()`;
}

/** Claims this month's message: true for the first caller only, so two runs in the same hour (or a retry) cannot send twice. */
export async function claimMonthly(installationId: string, key: string): Promise<boolean> {
  const done = await sql()`insert into au_prefs (installation_id, last_monthly_key) values (${installationId}, ${key})
    on conflict (installation_id) do update set last_monthly_key = ${key}, updated_at = now() where au_prefs.last_monthly_key is distinct from ${key} and au_prefs.monthly_on returning 1`;
  return done.length > 0;
}
