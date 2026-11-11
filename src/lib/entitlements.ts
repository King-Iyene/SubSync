// One product, one price, every feature open. SubSync is billed by the marketplace per client account
// per month, so the app has no tiers and never locks anything: an agency that has installed it has
// everything. (Earlier versions had free, starter and pro tiers; those are gone. Old database values
// of "starter", "pro" and "paid" are all read as the one plan.)
//
// The shapes below are kept so the rest of the app and the sign-in response do not need to change.

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
  "cleanup",
  "setup_compare",
  "playbooks",
  "connections",
  "clients",
  "audit",
  "speed",
  "zoom_meet",
  // Workflows module: the page is the first (default off, free plan reads the list), health alerts and labels are the second, changes the third.
  "workflows",
  "workflows_pro",
  "workflows_write",
  // Data health module: score and trend (free, one account), then alerts, digest and finders, then safe fixes (administrators).
  "data_health",
  "data_health_pro",
  "data_health_fix",
  // Unanswered Messages Round 2 (docs/features/UNANSWERED2.md): each behind its own flag, default off.
  "inbox_per_client_sla",
  "inbox_sql_aggregates",
  "inbox_breach_alert",
  "inbox_ball_in_court",
  "inbox_working_hours",
  "inbox_hide_noise",
  "inbox_workload",
  "inbox_snooze",
  "inbox_channel_mix",
  "inbox_digest",
  "inbox_assign",
  // Unanswered round 3, slices A and C (redesign, filters, search): each default off.
  "inbox_control_room",
  "inbox_filters",
  "inbox_views",
  "inbox_search",
  "inbox_quiet",
  "inbox_keys",
  "inbox_bulk",
] as const;
export type Feature = (typeof FEATURES)[number];

export function enforcementOn(): boolean {
  return false;
}

export function normalisePlan(value: string | null | undefined): Plan {
  if (value === "pro" || value === "paid") return "pro";
  if (value === "starter") return "starter";
  return "free";
}

// The marketplace tells us which plan an install is on. We keep the value for reference only.
export function planFromMarketplaceId(planId: string | null | undefined, env: Record<string, string | undefined> = process.env): Plan | null {
  if (!planId || !env.GHL_PLAN_IDS) return null;
  try {
    const map = JSON.parse(env.GHL_PLAN_IDS) as Record<string, string>;
    return planId in map ? normalisePlan(map[planId]) : null;
  } catch {
    return null;
  }
}

export function canUse(_feature: Feature, _plan: Plan = "pro", _enforce = false): boolean {
  return true;
}

export function accountLimit(_plan: Plan = "pro", _enforce = false): number | null {
  return null;
}

export function entitlements(plan: Plan, enforce = false) {
  return {
    plan,
    enforced: enforce,
    accountLimit: null as number | null,
    features: Object.fromEntries(FEATURES.map((f) => [f, true])) as Record<Feature, boolean>,
    /** Features that are switched off (see flags.ts). */
    off: [] as string[],
    /** Features this install's plan does not include (enforced mode only). */
    locked: [] as string[],
  };
}
