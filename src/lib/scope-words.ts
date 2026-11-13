// Plain words for a permission name, so a screen never shows "workflows.readonly" to a person who just wants to know what to allow. The settings permission list is the one
// place the technical names are shown next to these words, for people who want to check.
const WORDS: Record<string, string> = {
  "workflows.readonly": "read your workflows",
  "workflows.write": "copy or rename a workflow",
  "workflows.publish": "publish or pause a workflow",
  "workflows.delete": "delete a workflow",
  "workflows.logs": "read what your workflows did",
  "emails/stats.readonly": "read how many emails were sent and opened",
  "wallet.readonly": "read your credit balance",
  "contacts.write": "change contacts",
  "contacts.readonly": "read contacts",
  "payments/transactions.readonly": "read payments",
  "payments/subscriptions.readonly": "read repeat payments",
  "payments/orders.readonly": "read orders and payments",
  "invoices.readonly": "read invoices",
  "saas/company.read": "read the plan each client account is on",
  "users.readonly": "read team members",
  "calendars.readonly": "read calendars",
  "calendars/events.readonly": "read appointments",
  "locations/customFields.readonly": "read custom fields",
  "locations/tags.readonly": "read tags",
  "conversations.readonly": "read conversations",
  "conversations/message.readonly": "read messages",
  "conversations/message.write": "add a note to a conversation",
  "opportunities.readonly": "read deals",
  "conversations/reports.readonly": "read conversation reports (coming feature, not used yet)",
  "locations/tasks.readonly": "read tasks (coming feature, not used yet)",
  "locations/tasks.write": "create tasks (coming feature, not used yet)",
  "locations/tags.write": "change tags (coming feature, not used yet)",
  "locations/customFields.write": "change custom field values (coming feature, not used yet)",
};

/** "read your workflows" for "workflows.readonly"; an unknown name falls back to a generic phrase (never the raw name). */
export function scopeWords(scope: string): string {
  return WORDS[scope] ?? "read this part of your account";
}

/** Several permissions as one phrase: "read your workflows and read your credit balance". */
export function scopeList(scopes: readonly string[]): string {
  const w = [...new Set(scopes.map(scopeWords))];
  return w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}
