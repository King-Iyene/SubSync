import type { Feature } from "./entitlements.ts";

// What each plan is allowed to use. Pure (no database), so it can be unit tested. The platform bills and
// installs; it does not switch features on or off. Our code decides, from the plan an install is on.
//
// Two modes, set by ENTITLEMENTS_MODE:
//   open      everything is unlocked (development, and until pricing is final). The default.
//   enforced  a feature outside the free list needs a paid plan.
// A plan id is never written in code: the table plan_entitlements maps each id to a tier, so swapping the
// $5 plan for the $9 plan is a row change.

export type Tier = "free" | "pro";
export type Mode = "open" | "enforced";

// Brief section 6: Free is Instant Audit, overview, contact search and data health.
export const FREE_FEATURES: ReadonlySet<Feature> = new Set<Feature>(["overview", "audit", "search", "health", "settings", "workflows", "data_health"]);

export const modeFrom = (value: string | undefined): Mode => (value === "enforced" ? "enforced" : "open");

// An unknown or missing plan id is treated as free: the safe side when a charge cannot be confirmed.
export function tierForPlan(planId: string | null | undefined, map: Record<string, Tier>): Tier {
  return planId && map[planId] === "pro" ? "pro" : "free";
}

// An agency-wide view unlocks when at least one of its accounts is on a paid plan (brief section 6).
export function agencyTier(tiers: Tier[]): Tier {
  return tiers.includes("pro") ? "pro" : "free";
}

// The features a tier may not use under the current mode.
export function lockedFeatures(all: readonly Feature[], tier: Tier, mode: Mode): Feature[] {
  if (mode === "open" || tier === "pro") return [];
  return all.filter((f) => !FREE_FEATURES.has(f));
}

// The one question every module asks.
export function can(feature: Feature, tier: Tier, mode: Mode): boolean {
  return mode === "open" || tier === "pro" || FREE_FEATURES.has(feature);
}

export type PlanEvent = { planId: string | null; locationId: string | null; onTrial: boolean; trialDays: number | null };

// Install and plan-change events carry the plan and trial under slightly different shapes; read both.
export function parsePlanEvent(body: unknown): PlanEvent {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const data = (root.data && typeof root.data === "object" ? root.data : {}) as Record<string, unknown>;
  const str = (...v: unknown[]) => v.find((x): x is string => typeof x === "string" && x.length > 0) ?? null;
  const trial = (root.trial && typeof root.trial === "object" ? root.trial : data.trial && typeof data.trial === "object" ? data.trial : {}) as Record<string, unknown>;
  return {
    planId: str(root.planId, data.planId, root.newPlanId, data.newPlanId),
    locationId: str(root.locationId, data.locationId),
    onTrial: trial.onTrial === true,
    trialDays: typeof trial.trialDuration === "number" && trial.trialDuration > 0 ? trial.trialDuration : null,
  };
}
