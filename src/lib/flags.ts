import { sql } from "./db";
import { entitlements, FEATURES, type Feature, type Plan } from "./entitlements";
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

export async function resolveEntitlements(plan: Plan) {
  const base = entitlements(plan);
  const features = resolveFeatures(FEATURES, await overrides(), process.env.FLAGS_ALL_ON === "true");
  return { ...base, features, off: FEATURES.filter((f) => !features[f]) as string[] };
}

export async function featureOn(feature: Feature): Promise<boolean> {
  return (await resolveEntitlements("pro")).features[feature];
}
