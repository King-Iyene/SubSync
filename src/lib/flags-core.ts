import type { Feature } from "./entitlements.ts";

// Which features are visible, as a pure function so it is easy to test. A feature is on unless it is in
// DEFAULT_OFF, and a row in the database (feature_flags) overrides that either way, so switching one on
// or off never needs a deploy. Setting FLAGS_ALL_ON=true makes every default "on" (the automated checks
// use it); database rows still win. The code stays in place for everything switched off.

// Brief v3, sections 7 and 8: these are deferred or avoided for now. See docs/FEATURE_STATUS.md for why.
export const DEFAULT_OFF: ReadonlySet<Feature> = new Set<Feature>([
  // King switched everything built back on (31 Oct). Only these stay off: Connections needs the Slack, Zoom and
  // Fathom apps created first, and AI has no screen yet.
  "connections", "ai",
]);

export function resolveFeatures(all: readonly Feature[], overrides: Record<string, boolean>, allOn = false): Record<Feature, boolean> {
  const out = {} as Record<Feature, boolean>;
  for (const f of all) out[f] = f in overrides ? overrides[f] : allOn ? true : !DEFAULT_OFF.has(f);
  return out;
}
