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
  // Release 1.1.0, OPTIONAL, for coming features (AI data cleaning changes custom field values after a preview). Not used yet. Together with
  // conversations/reports.readonly, locations/tasks.readonly, locations/tasks.write and locations/tags.write above, asked for now so no install has to approve again later.
  // NEVER add conversations/message.write, invoices.write or conversations.write (delete): see NOT_REQUESTED in scope-groups.ts.
  "locations/customFields.write",
  // Workflows module (optional): read the list and history, then change after a preview. Campaigns are read only.
  "workflows.readonly",
  "workflows.logs",
  "workflows.write",
  "workflows.publish",
  "workflows.delete",
  "campaigns.readonly",
  "emails/campaigns.readonly",
  "emails/stats.readonly",
  "saas/location.read",
  // Payments module (version 2.1.0, all OPTIONAL, all read only): failed and late payments, repeat payments, invoices, the credit balance, and our own plan check.
  "payments/transactions.readonly",
  "payments/subscriptions.readonly",
  "invoices.readonly",
  "wallet.readonly",
  "marketplace-installer-details.readonly",
  // Lead intake (version 2.2.0, all OPTIONAL, all read only): which form, survey or funnel each lead came from, for the Lead intake tab in Clean-up.
  "forms.readonly",
  "surveys.readonly",
  "funnels/funnel.readonly",
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
