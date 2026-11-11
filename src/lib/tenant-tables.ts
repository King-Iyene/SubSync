// The single list of every table that holds tenant data, and what happens to it. All three purge functions read these
// lists, and a test compares them with the database schema, so a new table cannot be forgotten. Pure constants.
//
// Order matters: a table that points to another is deleted before the one it points to.

/** Copied customer data. "Delete my data" removes exactly this, and so does an uninstall. */
export const SYNCED_DELETE = [
  "cleanup_changes", "cleanup_runs", "duplicate_reviews", "duplicate_snoozes", "cleanup_quality_snapshots", "possible_duplicates", "unanswered_outcomes", "unanswered_snoozes", "unanswered_actions", "appointment_meeting_links", "pipeline_actions", "appointment_actions",
  "calendar_members", "calendar_groups", "cached_calendars", // the full calendar list (metadata only)
  "cached_contacts", "cached_opportunities", "cached_conversations", "cached_appointments", "pipelines",
  "account_metrics_daily", "alerts", "domain_checks", "onboarding_tasks",
  "deal_events", "appointment_events", "appointment_history", "appointment_facts", "appointment_exec_daily", "appointment_exec_state", "appointment_exec_targets", "deal_history", "deal_facts", "deal_stage_stats", "pipeline_rollup", "pipeline_rollup_state", "deal_forecast_log", "deal_record_state", "lead_touches", "touch_events", "lead_events", "moat_events", "reply_proof_pages", "speed_daily", "speed_digest", "speed_prefs", "call_outcomes", "workflow_setup_settings", "workflow_setup", "call_queue_log", "call_queue_settings", "contact_tag_events", "location_users", "team_member_access", "user_daily", "user_rollup_state", "user_workload_daily", 
  "notification_states", "notifications", "notification_deliveries",
  "client_rollup_state", "client_daily", "client_risk_history", "client_billing", "client_actions", "team_members", "people_write_log", "au_runs", "au_prefs", "au_account_prefs", // Clients and Team: derived numbers, the people list, and the log of lead moves
  "pm_items", "pm_events", "pm_sync_state", "pm_rollup_daily", // Payments: the current state and the history of each payment, invoice and paid plan, and the daily totals
  "td_daily_items", "td_receipts", "td_snoozes", // Today: the daily record of what was found and cleared, the weekly receipts and the put-aside marks
  "campaign_stats", "workflow_snapshots", "workflow_changes", "workflow_daily", "workflow_items",
  "dh_snapshots", "dh_flags", "dh_changes", "dh_outcomes", // Data health (docs/features/DATA_HEALTH.md)
  "call_queue_log", "meeting_deliveries", "crm_writes", "contact_writes", "field_write_state", "meetings", "meeting_notes", "shared_audits", "sync_jobs", "locations",
] as const;

/** Settings, credentials and the agency's own notes. Kept by "delete my data" (the app keeps working), removed on uninstall. */
export const CONFIG_DELETE_ON_UNINSTALL = [
  "call_lists", "account_profiles", "goals", "annotations", "usage_events", "team_names", "report_templates",
  "pm_notes", "pm_disputes", // Payments: the notes and the dispute log you keep
  "td_prefs", "client_owners", "team_member_roles", "team_member_role_history", "client_alert_mutes", "coaching_notes", "user_targets", "user_away", "people_proof_prefs", // the agency's own choices and notes (Clients, Team)
  "api_keys", "connections", "user_connections", "notification_prefs", "notification_destinations", "meeting_note_settings", "meeting_ignored_emails", "meeting_policies", "field_mappings", "meeting_hooks", "roadmap_votes", "saved_views", "feedback_items", "roadmap_suggestions", "stage_rules", "client_notes", "today_actions", "growth_goals", "growth_settings", "client_departures", "workflow_labels", "dh_marks", "dh_rules", "onboarding_templates", "client_steps", "client_step_history", "workflow_setup", "workflow_setup_settings", "call_queue_settings", "settings", "unanswered_hide_settings",
] as const;

/** Everything an uninstall deletes. The installation row itself stays with its tokens emptied, so a reinstall starts clean. */
export const UNINSTALL_DELETE: readonly string[] = [...SYNCED_DELETE, ...CONFIG_DELETE_ON_UNINSTALL];

/** Kept on purpose, with the reason. None of these holds customer contacts, messages or credentials. */
export const KEEP_ON_UNINSTALL: readonly string[] = [
  "audit_log",    // the minimal audit record the brief asks us to keep (who did what, when)
  "install_plans", // plan and billing events, needed to reconcile what was charged
  "identity_log", // role and outcome of each sign-in; no names, emails or person ids
];

/** Removing one client account deletes its rows from these, children first, the account row last. */
export const LOCATION_DELETE = [
  "cleanup_changes", "cleanup_runs", "duplicate_reviews", "duplicate_snoozes", "cleanup_quality_snapshots", "possible_duplicates", "unanswered_outcomes", "unanswered_snoozes", "unanswered_actions", "appointment_meeting_links", "pipeline_actions", "appointment_actions",
  "calendar_members", "calendar_groups", "cached_calendars", // the full calendar list (metadata only)
  "cached_contacts", "cached_opportunities", "cached_conversations", "cached_appointments", "pipelines",
  "account_metrics_daily", "alerts", "domain_checks", "onboarding_tasks",
  "deal_events", "appointment_events", "appointment_history", "appointment_facts", "appointment_exec_daily", "appointment_exec_state", "appointment_exec_targets", "deal_history", "deal_facts", "deal_stage_stats", "pipeline_rollup", "pipeline_rollup_state", "deal_forecast_log", "deal_record_state", "lead_touches", "touch_events", "lead_events", "moat_events", "reply_proof_pages", "speed_daily", "speed_digest", "speed_prefs", "call_outcomes", "workflow_setup_settings", "workflow_setup", "call_queue_log", "call_queue_settings", "location_users", "contact_tag_events", "team_member_access", "user_daily", "user_rollup_state", "user_workload_daily",
  "pm_items", "pm_events", "pm_sync_state", "pm_rollup_daily", "pm_notes", "pm_disputes",
  "td_daily_items", "td_receipts", "td_snoozes", "notification_states", "notifications", "notification_deliveries", "notification_destinations", "client_departures", "client_rollup_state", "client_daily", "client_risk_history", "client_billing", "client_actions", "client_owners", "client_alert_mutes", "coaching_notes", "user_targets", "people_write_log", "people_proof_prefs",
  "crm_writes", "contact_writes", "field_write_state", "field_mappings", "meeting_policies", "meeting_notes", "meeting_hooks", "account_profiles", "client_notes", "today_actions", "growth_goals", "workflow_labels", "dh_snapshots", "dh_flags", "dh_changes", "dh_outcomes", "dh_marks", "dh_rules", "campaign_stats", "workflow_snapshots", "workflow_changes", "workflow_daily", "workflow_items", "feedback_items", "client_steps", "client_step_history", "workflow_setup", "workflow_setup_settings", "call_queue_settings", "call_queue_log", "sync_jobs", "locations",
] as const;

/** Tables with a location column that the per-account purge leaves alone, with the reason. */
export const LOCATION_KEEP: readonly string[] = ["install_plans"]; // billing record
