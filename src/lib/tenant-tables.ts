// The single list of every table that holds tenant data, and what happens to it. All three purge functions read these
// lists, and a test compares them with the database schema, so a new table cannot be forgotten. Pure constants.
//
// Order matters: a table that points to another is deleted before the one it points to.

/** Copied customer data. "Delete my data" removes exactly this, and so does an uninstall. */
export const SYNCED_DELETE = [
  "cleanup_changes", "cleanup_runs", "duplicate_reviews",
  "cached_contacts", "cached_opportunities", "cached_conversations", "cached_appointments", "pipelines",
  "account_metrics_daily", "alerts", "domain_checks", "onboarding_tasks",
  "deal_events", "appointment_events", "lead_touches", "call_outcomes", "contact_tag_events",
  "notification_states", "notifications", "notification_deliveries",
  "meeting_deliveries", "crm_writes", "meetings", "meeting_notes", "shared_audits", "sync_jobs", "locations",
] as const;

/** Settings, credentials and the agency's own notes. Kept by "delete my data" (the app keeps working), removed on uninstall. */
export const CONFIG_DELETE_ON_UNINSTALL = [
  "call_lists", "account_profiles", "goals", "annotations", "usage_events", "team_names", "report_templates",
  "api_keys", "connections", "user_connections", "notification_prefs", "notification_destinations", "meeting_note_settings", "meeting_ignored_emails", "meeting_policies", "meeting_hooks", "roadmap_votes", "saved_views", "feedback_items", "roadmap_suggestions", "stage_rules", "client_notes", "onboarding_templates", "client_steps", "client_step_history", "settings",
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
  "cleanup_changes", "cleanup_runs", "duplicate_reviews",
  "cached_contacts", "cached_opportunities", "cached_conversations", "cached_appointments", "pipelines",
  "account_metrics_daily", "alerts", "domain_checks", "onboarding_tasks",
  "deal_events", "appointment_events", "lead_touches", "call_outcomes", "contact_tag_events",
  "notification_states", "notifications", "notification_deliveries", "notification_destinations",
  "crm_writes", "meeting_policies", "meeting_notes", "meeting_hooks", "account_profiles", "client_notes", "client_steps", "client_step_history", "sync_jobs", "locations",
] as const;

/** Tables with a location column that the per-account purge leaves alone, with the reason. */
export const LOCATION_KEEP: readonly string[] = ["install_plans"]; // billing record
