// Keep in sync with the scopes ticked on the app in the developer portal.
export const GHL_SCOPES = [
  "locations.readonly",
  "contacts.readonly",
  "opportunities.readonly",
  "calendars.readonly",
  "calendars/events.readonly",
  "conversations.readonly",
  "users.readonly",
  "oauth.write",
  "oauth.readonly",
  // Added in version 2.0.0, all OPTIONAL in the listing. A feature that needs one says "needs permission"
  // when it was declined. Read access first, then change access, which is only ever used after a preview
  // and a typed confirmation (see docs/SCOPE_PLAN.md).
  "conversations/message.readonly",
  "conversations/reports.readonly",
  "locations/tags.readonly",
  "locations/customFields.readonly",
  "locations/tasks.readonly",
  "calendars/groups.readonly",
  "calendars/resources.readonly",
  "calendars/events.write",
  "contacts.write",
  "opportunities.write",
  "locations/tags.write",
  "locations/tasks.write",
] as const;

export function buildInstallUrl(clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    client_id: clientId,
    scope: GHL_SCOPES.join(" "),
  });
  return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params.toString()}`;
}
