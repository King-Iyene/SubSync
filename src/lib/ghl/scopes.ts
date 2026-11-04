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
  // Workflows module (optional): read the list and history, then change after a preview. Campaigns are read only.
  "workflows.readonly",
  "workflows.logs",
  "workflows.write",
  "workflows.publish",
  "workflows.delete",
  "campaigns.readonly",
  "emails/campaigns.readonly",
  "emails/stats.readonly",
] as const;

// The platform's own help article (OAuth consent for marketplace apps) says branded installs use the leadconnectorhq host, which
// the platform allows under its white-label rules. The standard host names the platform, so it is only used when asked for.
export const BRANDED_INSTALL_HOST = "marketplace.leadconnectorhq.com";
export const STANDARD_INSTALL_HOST = "marketplace.gohighlevel.com";

export function buildInstallUrl(clientId: string, redirectUri: string, host: string = BRANDED_INSTALL_HOST): string {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: redirectUri,
    client_id: clientId,
    scope: GHL_SCOPES.join(" "),
  });
  return `https://${host}/oauth/chooselocation?${params.toString()}`;
}
