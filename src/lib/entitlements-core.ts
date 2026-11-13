import type { Feature } from "./entitlements.ts";

// What each plan is allowed to use. Pure (no database), so it can be unit tested. The platform bills and
// installs; it does not switch features on or off. Our code decides, from the plan an install is on.
//
// Two modes, set by ENTITLEMENTS_MODE:
//   open      everything is unlocked (development, and until pricing is final). The default.
//   enforced  a feature outside the limited list needs the Growth plan (or a running trial).
// 13 Nov 2026: there is no free plan any more. The only plan is Growth ($11.50 per client account per month)
// with a 14-day free trial. The ids below are the marketplace's own labels, kept here so the mapping works even
// before the table is filled; the table plan_entitlements can add more rows. The database tier column only
// allows 'free' or 'pro', so the Growth plan is stored as 'pro' and named "growth" by planName().

export type Tier = "free" | "pro";
export type Mode = "open" | "enforced";

// Features that stay open to an install with no plan or an ended trial (its data is always kept and readable).
export const FREE_FEATURES: ReadonlySet<Feature> = new Set<Feature>(["overview", "audit", "search", "health", "settings", "workflows", "data_health"]);

export const modeFrom = (value: string | undefined): Mode => (value === "enforced" ? "enforced" : "open");

export const GROWTH_PLAN_ID = "6af521842a5c6a72fd97d767";
// LEGACY: the deleted Free Plan. King's own test installs still sit on it, so it keeps full access.
// The deleted $5 plan id is not recorded in the repo: map it with a plan_entitlements row (tier 'pro') if an install names it.
export const LEGACY_PLAN_IDS: readonly string[] = ["6ae40eb4f65e3c03823476b8"];
const BUILTIN_PLANS: Record<string, Tier> = Object.fromEntries([GROWTH_PLAN_ID, ...LEGACY_PLAN_IDS].map((id) => [id, "pro" as Tier]));

export type PlanName = "growth" | "legacy" | null;
export function planName(planId: string | null | undefined): PlanName {
  if (!planId) return null;
  return planId === GROWTH_PLAN_ID ? "growth" : LEGACY_PLAN_IDS.includes(planId) ? "legacy" : null;
}

// The trial is over when the install was on a trial, we know when it started, and its length has passed with no
// later event saying it converted (a converted install is reported with onTrial false). INFERENCE: we have not
// confirmed a separate "trial ended" event from the CRM, so a still-on-trial row past its end reads as ended.
export function trialEnded(row: { onTrial: boolean; trialStartedAt: Date | null; trialDays: number | null }, now: Date = new Date()): boolean {
  if (!row.onTrial || !row.trialStartedAt || !row.trialDays) return false;
  return now.getTime() > row.trialStartedAt.getTime() + row.trialDays * 86_400_000;
}

// A running trial is full access. An unknown or missing plan id, or an ended trial, is the limited tier: the safe
// side when a charge cannot be confirmed (it only matters in enforced mode; open mode unlocks everything).
export function tierForPlan(planId: string | null | undefined, map: Record<string, Tier>, trial?: { onTrial: boolean; ended: boolean }): Tier {
  if (trial?.onTrial) return trial.ended ? "free" : "pro";
  if (!planId) return "free";
  if (Object.hasOwn(BUILTIN_PLANS, planId)) return "pro";
  return Object.hasOwn(map, planId) && map[planId] === "pro" ? "pro" : "free";
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

export type PlanEvent = { planId: string | null; locationId: string | null; onTrial: boolean; trialDays: number | null; trialStartedAt: string | null };

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
    trialStartedAt: typeof trial.trialStartDate === "string" && !Number.isNaN(Date.parse(trial.trialStartDate)) ? new Date(trial.trialStartDate).toISOString() : null,
  };
}
