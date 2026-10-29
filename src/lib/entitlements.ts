// What each plan can use. Pricing model: free for up to 5 client accounts with search and
// onboarding only; paid unlocks everything for unlimited accounts. Enforcement is OFF by
// default (ENFORCE_PLANS=true turns it on at launch) so pilots and testing see every feature.

export type Plan = "free" | "paid";

export const FEATURES = [
  "overview",
  "search",
  "onboarding",
  "health",
  "stale",
  "activity",
  "inbox",
  "pipelines",
  "duplicates",
  "email",
  "alerts",
  "reports",
  "exports",
  "ai",
  "settings",
] as const;
export type Feature = (typeof FEATURES)[number];

export const FREE_ACCOUNT_LIMIT = 5;
const FREE_FEATURES: ReadonlySet<Feature> = new Set(["overview", "search", "onboarding", "settings"]);

export function enforcementOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.ENFORCE_PLANS === "true";
}

export function normalisePlan(value: string | null | undefined): Plan {
  return value === "paid" ? "paid" : "free";
}

export function canUse(feature: Feature, plan: Plan, enforce = enforcementOn()): boolean {
  if (!enforce) return true;
  return plan === "paid" || FREE_FEATURES.has(feature);
}

export function accountLimit(plan: Plan, enforce = enforcementOn()): number | null {
  if (!enforce || plan === "paid") return null;
  return FREE_ACCOUNT_LIMIT;
}

export function entitlements(plan: Plan, enforce = enforcementOn()) {
  return {
    plan,
    enforced: enforce,
    accountLimit: accountLimit(plan, enforce),
    features: Object.fromEntries(FEATURES.map((f) => [f, canUse(f, plan, enforce)])) as Record<Feature, boolean>,
  };
}
