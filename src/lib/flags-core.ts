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
  "appt_record",
  "ap_exec",
  "ap_exec_targets",
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
  "appt_actions",
  "appt_delete",
  "appt_bulk",
  "appt_meetings",
  "appt_module",
  // Pipeline and deals module round 3 (docs/features/PIPELINE_BRIEF.md): each behind its own flag, default off.
  "pl_overview",
  "pl_money_flow",
  "pl_attention",
  "pl_won_lost",
  "pl_forecast",
  "pl_people",
  "pl_sources",
  "pl_stage_history",
  "pl_health",
  "pl_proof",
  "pl_actions",
  "pl_history",
  "pl_record",
  "pl_module",
  // Pipeline module, slice PB (deal actions): each default off.
  "pl_delete",
  "pl_bulk",
  // Clients module round 3 (docs/features/CLIENTS_BRIEF.md): each behind its own flag, default off.
  "cl_overview",
  "cl_attention",
  "cl_trends",
  "cl_compare",
  "cl_reports",
  "cl_people",
  "cl_setup",
  "cl_billing",
  "cl_rollup",
  "cl_module",
  "cl_actions",
  "cl_retention",
  "cl_workflows",
  // Clients v2 (client-account management): each behind its own flag, default off.
  "cl2_accounts",
  "cl2_account_page",
  "cl2_plans",
  "cl2_notes",
  "cl2_bulk",
  "cl2_team_move",
  "cl3_money",
  "cl3_apps",
  "cl3_history",
  "cl_onboarding",
  // Team (People) module (docs/features/PEOPLE_BRIEF.md): each behind its own flag, default off.
  "pp_module",
  "pp_today",
  "pp_scorecards",
  "pp_workload",
  "pp_leaderboard",
  "pp_money",
  "pp_coaching",
  "pp_access",
  "pp_proof",
  "pp_nextlead",
  "pp_idle",
  "pp_rollup",
  "pp_actions",
  "pp_roles",
  // Branded client Proof page and monthly report (stage PR): each behind its own flag, default off.
  "pr_report",
  "pr_page",
  "pr_auto",
  // Account audit (docs/features/AUDIT_BRIEF.md): each behind its own flag, default off.
  "au_history",
  "au_onepager",
  "au_monthly",
  // Today module (docs/features/TODAY_BRIEF.md): each behind its own flag, default off. ov_screen is the old Overview page (merged into Today, Numbers).
  "td_module",
  "td_today",
  "td_proof",
  "td_numbers",
  "td_email",
  "td_record",
  "ov_screen",
  // Find a lead (docs/features/FINDLEAD_BRIEF.md): fl_find is the search (keyset paging, pickers, copy); fl_bulk is bulk actions and export. Default off.
  "fl_find",
  "fl_bulk",
  // Workflows second pass (docs/features/WORKFLOWS_BRIEF.md): wf_outcomes is the Gaps tab and our daily outcome record; wf_library the template library; wf_bulk install in many accounts; wf_today the Today line. Default off.
  "wf_outcomes",
  "wf_library",
  "wf_bulk",
  "wf_today",
  // Payments module (docs/features/PAYMENTS_BRIEF.md): each behind its own flag, default off. pm_resend stays off until King approves messaging a customer.
  "pm_module",
  "pm_recovery",
  "pm_disputes",
  "pm_upcoming",
  "pm_resend",
  // Cash features (docs/features/CASH_FEATURES.md): the morning "save this account" digest, the missed-lead recovery list, stale and lost deal alerts. Default off until verified.
  "cf_save",
  "cf_recover",
  "cf_deals",
  "cf_email",
  "cf_record",
  // Wallet guard (wg_*: credit balance watchlist, our own record of it, alerts) and the 7 am brief (br_*: in-app brief, email, history). Default off until verified.
  "wg_wallet",
  "wg_record",
  "wg_alerts",
  "br_brief",
  "br_email",
  "br_record",
  // Settings rebuild, guides and the change log (stage ST): each default off.
  "st_settings",
  "st_guides",
  "st_news",
  // Clean-up (docs/features/CLEANUP_BRIEF.md): cu_fix is the fix lists, cu_health the Health tab and the daily record, cu_bulk the tag and remove runs, cu_confirm typed confirmation on merges. Default off.
  "cu_fix",
  "cu_health",
  "cu_bulk",
  "cu_confirm",
  // Meeting notes revamp (docs/features/MEETINGS_BRIEF.md): mn_logged is the calls held but not logged counts, mn_outcomes the history of what followed a call. Default off.
  "mn_logged",
  "mn_outcomes",
  // Clean-up v2 (docs/research/DATAQUALITY_R1.md): dq_module is the rebuilt Clean-up screen, dq_dupes duplicates with merge, delete and bulk, dq_intake the Lead intake tab, dq_alerts its alerts,
  // dq_gate the sorting-gate animation, dq_score the quality score. Default off.
  "dq_module",
  "dq_dupes",
  "dq_intake",
  "dq_alerts",
  "dq_gate",
  "dq_score",
  // Booking funnel (Appointments tab): bf_funnel the tab and its numbers, bf_cohorts the weekly cohorts, bf_forecast the 30 day forecast, bf_recover the tag-the-dropped-leads action,
  // bf_today the small version on Today. Default off.
  "bf_funnel",
  "bf_cohorts",
  "bf_forecast",
  "bf_recover",
  "bf_today",
]);

export function resolveFeatures(all: readonly Feature[], overrides: Record<string, boolean>, allOn = false): Record<Feature, boolean> {
  const out = {} as Record<Feature, boolean>;
  for (const f of all) out[f] = f in overrides ? overrides[f] : allOn ? true : !DEFAULT_OFF.has(f);
  return out;
}
