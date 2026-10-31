import { sql } from "./db";
import { agencyTier, modeFrom, parsePlanEvent, tierForPlan, type Mode, type Tier } from "./entitlements-core";

// Reads and writes for plans. Every read falls back to "free" (which only matters in enforced mode) if the
// tables are missing or the database is unreachable, and the mode defaults to open.

export const entitlementsMode = (): Mode => modeFrom(process.env.ENTITLEMENTS_MODE);

async function planMap(): Promise<Record<string, Tier>> {
  const rows = await sql()`select plan_id, tier from plan_entitlements`;
  return Object.fromEntries(rows.map((r) => [r.plan_id as string, r.tier === "pro" ? "pro" : "free"])) as Record<string, Tier>;
}

// The tier an install is on: the best of the plan on the install itself and the plan of each account.
export async function tierForInstallation(installationId: string): Promise<Tier> {
  try {
    const [map, own, rows] = await Promise.all([
      planMap(),
      sql()`select plan_id from installations where id = ${installationId}`,
      sql()`select plan_id from install_plans where installation_id = ${installationId}`,
    ]);
    const ids = [own[0]?.plan_id as string | null | undefined, ...rows.map((r) => r.plan_id as string | null)];
    return agencyTier(ids.map((id) => tierForPlan(id, map)));
  } catch {
    return "free";
  }
}

// Record the plan from an install or plan-change event. Returns false when the event named no plan.
export async function recordPlanEvent(installationId: string, body: unknown): Promise<boolean> {
  const e = parsePlanEvent(body);
  if (!e.planId) return false;
  await sql()`
    insert into install_plans (installation_id, location_id, plan_id, on_trial, trial_days)
    values (${installationId}, ${e.locationId ?? ""}, ${e.planId}, ${e.onTrial}, ${e.trialDays})
    on conflict (installation_id, location_id) do update set plan_id = excluded.plan_id, on_trial = excluded.on_trial, trial_days = excluded.trial_days, updated_at = now()`;
  return true;
}
