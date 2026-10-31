import { sql } from "./db";
import { entitlements, FEATURES, type Feature, type Plan } from "./entitlements";
import { lockedFeatures } from "./entitlements-core";
import { entitlementsMode, tierForInstallation } from "./entitlements-queries";
import { resolveFeatures } from "./flags-core";

// Reads the feature switches from the database. A short cache keeps this off the hot path; demo mode
// reads fresh every time so a change shows immediately. If the table cannot be read, the defaults apply.
let cache: { at: number; map: Record<string, boolean> } | null = null;
const TTL_MS = 15_000;

async function overrides(): Promise<Record<string, boolean>> {
  const demo = process.env.DEMO_MODE === "true";
  if (!demo && cache && Date.now() - cache.at < TTL_MS) return cache.map;
  try {
    const rows = await sql()`select key, enabled from feature_flags`;
    const map = Object.fromEntries(rows.map((r) => [r.key as string, r.enabled === true]));
    if (!demo) cache = { at: Date.now(), map };
    return map;
  } catch {
    return cache?.map ?? {};
  }
}

// `off` are features switched off for everyone (flags). `locked` are features this install's plan does not
// include (only in enforced mode). Both read as false in `features`; the screen hides the first and shows
// the second with an upgrade note. A demo install is always on the paid plan.
export async function resolveEntitlements(plan: Plan, installationId?: string, demo = false) {
  const base = entitlements(plan);
  const flagged = resolveFeatures(FEATURES, await overrides(), process.env.FLAGS_ALL_ON === "true");
  const mode = entitlementsMode();
  const tier = mode === "open" || demo || !installationId ? "pro" : await tierForInstallation(installationId);
  const locked = lockedFeatures(FEATURES, tier, mode).filter((f) => flagged[f]);
  const features = { ...flagged };
  for (const f of locked) features[f] = false;
  return { ...base, enforced: mode === "enforced", features, off: FEATURES.filter((f) => !flagged[f]) as string[], locked: locked as string[] };
}

export async function featureOn(feature: Feature): Promise<boolean> {
  return (await resolveEntitlements("pro")).features[feature];
}
