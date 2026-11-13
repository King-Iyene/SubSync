import { sql } from "./db";
import { cachedRead } from "./read-cache";
import { agencyTier, modeFrom, parsePlanEvent, tierForPlan, trialEnded, type Mode, type Tier } from "./entitlements-core";

// Reads and writes for plans. Every read falls back to "free" (which only matters in enforced mode) if the
// tables are missing or the database is unreachable, and the mode defaults to open.

export const entitlementsMode = (): Mode => modeFrom(process.env.ENTITLEMENTS_MODE);

async function planMap(): Promise<Record<string, Tier>> {
  const rows = await sql()`select plan_id, tier from plan_entitlements`;
  return Object.fromEntries(rows.map((r) => [r.plan_id as string, r.tier === "pro" ? "pro" : "free"])) as Record<string, Tier>;
}

// The tier an install is on: the best of the plan on the install itself and the plan of each account.
export type PlanState = { tier: Tier; trialEnded: boolean };

export async function tierForInstallation(installationId: string): Promise<Tier> {
  return (await planStateForInstallation(installationId)).tier;
}

export function planStateForInstallation(installationId: string): Promise<PlanState> {
  return cachedRead(installationId, "plan_state", () => loadPlanState(installationId));
}

async function loadPlanState(installationId: string): Promise<PlanState> {
  try {
    const [map, own, rows] = await Promise.all([
      planMap(),
      sql()`select plan_id from installations where id = ${installationId}`,
      sql()`select plan_id, on_trial, trial_days, trial_started_at from install_plans where installation_id = ${installationId}`,
    ]);
    const tiers: Tier[] = [];
    let ended = false;
    for (const r of rows) {
      const row = { onTrial: r.on_trial === true, trialDays: (r.trial_days as number | null) ?? null, trialStartedAt: r.trial_started_at ? new Date(r.trial_started_at as string) : null };
      const e = trialEnded(row);
      ended = ended || e;
      tiers.push(tierForPlan(r.plan_id as string | null, map, row.onTrial ? { onTrial: true, ended: e } : undefined));
    }
    // The install's own plan id can still name the trial's plan after the trial ended, so it only counts when no trial ended.
    if (!ended) tiers.push(tierForPlan(own[0]?.plan_id as string | null | undefined, map));
    const tier = agencyTier(tiers);
    return { tier, trialEnded: ended && tier === "free" };
  } catch {
    return { tier: "free", trialEnded: false };
  }
}

// Record the plan from an install or plan-change event. Returns false when the event named no plan.
export async function recordPlanEvent(installationId: string, body: unknown): Promise<boolean> {
  const e = parsePlanEvent(body);
  if (!e.planId) return false;
  await sql()`
    insert into install_plans (installation_id, location_id, plan_id, on_trial, trial_days, trial_started_at)
    values (${installationId}, ${e.locationId ?? ""}, ${e.planId}, ${e.onTrial}, ${e.trialDays}, ${e.trialStartedAt})
    on conflict (installation_id, location_id) do update set plan_id = excluded.plan_id, on_trial = excluded.on_trial, trial_days = excluded.trial_days, trial_started_at = excluded.trial_started_at, updated_at = now()`;
  return true;
}
