// What each plan can use. One price per client account per month (the marketplace bills each
// install), in three tiers that both agencies and single businesses share:
//   free    - the basics, up to 5 client accounts when an agency installs
//   starter - the daily working tools
//   pro     - everything, including reports, exports and the AI connector
// Enforcement is OFF by default (ENFORCE_PLANS=true turns it on at launch) so pilots and testing
// see every feature. "paid" is the old single paid tier and is treated as pro.

export type Plan = "free" | "starter" | "pro";

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
  "calls",
  "settings",
  "appointments",
  "team",
  "builder",
  "meetings",
] as const;
export type Feature = (typeof FEATURES)[number];

export const FREE_ACCOUNT_LIMIT = 5;

const FREE_FEATURES: ReadonlySet<Feature> = new Set(["overview", "search", "onboarding", "settings"]);
const STARTER_FEATURES: ReadonlySet<Feature> = new Set([
  ...FREE_FEATURES, "health", "stale", "activity", "inbox", "pipelines", "duplicates", "email", "alerts", "calls", "appointments",
]);
// pro = everything

const BY_PLAN: Record<Plan, ReadonlySet<Feature> | "all"> = { free: FREE_FEATURES, starter: STARTER_FEATURES, pro: "all" };

export function enforcementOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.ENFORCE_PLANS === "true";
}

export function normalisePlan(value: string | null | undefined): Plan {
  if (value === "pro" || value === "paid") return "pro";
  if (value === "starter") return "starter";
  return "free";
}

// Turn the marketplace's plan id into a tier. The ids come from GHL_PLAN_IDS, a JSON object such
// as {"6650...":"starter","6651...":"pro"}. An unknown or missing id is "free".
export function planFromMarketplaceId(planId: string | null | undefined, env: Record<string, string | undefined> = process.env): Plan | null {
  if (!planId || !env.GHL_PLAN_IDS) return null;
  try {
    const map = JSON.parse(env.GHL_PLAN_IDS) as Record<string, string>;
    return planId in map ? normalisePlan(map[planId]) : null;
  } catch {
    return null;
  }
}

export function canUse(feature: Feature, plan: Plan, enforce = enforcementOn()): boolean {
  if (!enforce) return true;
  const allowed = BY_PLAN[normalisePlan(plan)];
  return allowed === "all" || allowed.has(feature);
}

// Only the free tier limits how many client accounts an agency can see.
export function accountLimit(plan: Plan, enforce = enforcementOn()): number | null {
  if (!enforce || normalisePlan(plan) !== "free") return null;
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
