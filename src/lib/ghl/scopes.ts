// Keep in sync with the scopes ticked on the app in the developer portal.
export const GHL_SCOPES = [
  "locations.readonly",
  "contacts.readonly",
  "opportunities.readonly",
  "calendars.readonly",
  "conversations.readonly",
  "oauth.write",
  "oauth.readonly",
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
