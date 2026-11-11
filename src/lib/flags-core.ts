import type { Feature } from "./entitlements.ts";

// Which features are visible, as a pure function so it is easy to test. A feature is on unless it is in
// DEFAULT_OFF, and a row in the database (feature_flags) overrides that either way, so switching one on
// or off never needs a deploy. Setting FLAGS_ALL_ON=true makes every default "on" (the automated checks
// use it); database rows still win. The code stays in place for everything switched off.

// Brief v3, sections 7 and 8: these are deferred or avoided for now. See docs/FEATURE_STATUS.md for why.
export const DEFAULT_OFF: ReadonlySet<Feature> = new Set<Feature>([
  // Provider integrations stay hidden until pilots confirm them; core modules remain available for production pilot testing.
  // Zoom and Google Meet stay hidden everywhere (card, text, emails, privacy page); Slack and Fathom stay visible.
  // A new feature goes in this list until it is verified.
  "zoom_meet",
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
  // Unanswered round 3, slice D and E.
  "moat_record",
  "moat_receipt",
  "moat_curve",
  "moat_scorecards",
  "moat_benchmark",
  "moat_proof_page",
  "moat_alert_feedback",
  "inbox_wait_clock",
  "inbox_reply_target",
  "inbox_proof_email",
  // Unanswered round 3, slice B (actions): each behind its own flag, default off.
  "inbox_open_lead",
  // Speed to lead: the river view of the lead journey (the dots view shows when off).
  "lead_journey_pro",
  // Appointments module round 3 (docs/features/APPOINTMENTS_BRIEF.md): each behind its own flag, default off.
  "appt_overview",
  "appt_needs_outcome",
  "appt_noshow_recovery",
  "appt_booking_share",
  "appt_flow_tree",
  "appt_health",
  "appt_sources",
  "appt_calendars",
  "appt_reminders",
  "appt_meetings",
  "appt_proof",
  "appt_actions",
  "appt_history",
  "inbox_claim",
  "inbox_note",
  "inbox_outcome_ui",
  "inbox_clear_junk",
  // Unanswered round 3, slices A and C (redesign, filters, search): each default off.
  "inbox_control_room",
  "inbox_filters",
  "inbox_views",
  "inbox_search",
  "inbox_quiet",
  "inbox_keys",
  "inbox_bulk",
]);

export function resolveFeatures(all: readonly Feature[], overrides: Record<string, boolean>, allOn = false): Record<Feature, boolean> {
  const out = {} as Record<Feature, boolean>;
  for (const f of all) out[f] = f in overrides ? overrides[f] : allOn ? true : !DEFAULT_OFF.has(f);
  return out;
}
