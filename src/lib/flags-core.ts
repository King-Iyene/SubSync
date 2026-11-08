import type { Feature } from "./entitlements.ts";

// Which features are visible, as a pure function so it is easy to test. A feature is on unless it is in
// DEFAULT_OFF, and a row in the database (feature_flags) overrides that either way, so switching one on
// or off never needs a deploy. Setting FLAGS_ALL_ON=true makes every default "on" (the automated checks
// use it); database rows still win. The code stays in place for everything switched off.

// Brief v3, sections 7 and 8: these are deferred or avoided for now. See docs/FEATURE_STATUS.md for why.
export const DEFAULT_OFF: ReadonlySet<Feature> = new Set<Feature>([
  // King's decision of 1 Nov 2026 (docs/ROADMAP_V2.md, stage S0.2b): the Meeting notes page stays off until stage E2a has passed, and
  // Zoom and Google Meet stay hidden everywhere (card, text, emails, privacy page) until a pilot user asks for them. Slack and Fathom stay visible.
  // A new feature goes in this list until it is verified.
  "meetings",
  "zoom_meet",
  // The Workflows module (docs/features/WORKFLOWS.md): off until King switches it on. Its paid parts (workflows_pro, workflows_write) sit behind it.
  "workflows",
  // The Data health module (docs/features/DATA_HEALTH.md): off until King switches it on.
  "data_health",
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
]);

export function resolveFeatures(all: readonly Feature[], overrides: Record<string, boolean>, allOn = false): Record<Feature, boolean> {
  const out = {} as Record<Feature, boolean>;
  for (const f of all) out[f] = f in overrides ? overrides[f] : allOn ? true : !DEFAULT_OFF.has(f);
  return out;
}
