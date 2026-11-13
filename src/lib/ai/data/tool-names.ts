// The names of the read-only analytics tools "Ask your data" may call. Kept apart from the tool code (which reaches the database) so the job registry stays light; a unit test checks this list
// equals the registry in ask-tools.ts exactly, so a tool cannot be added to one and forgotten in the other.
export const ASK_TOOL_NAMES = [
  "accounts_in_scope", "leads_waiting", "first_reply_times", "appointments_summary", "deals_summary", "money_at_risk", "duplicates_counts", "workflow_health", "contacts_no_owner", "unassigned_deals", "data_quality", "alerts_report",
] as const;
