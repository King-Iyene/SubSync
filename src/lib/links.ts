// Every "open this in your CRM" link is built here, from the domain the agency uses. An agency that
// resells the platform under its own brand has its own domain; the platform's default domain is only
// used when no other domain is known. The domain comes from sign-in (the white-label details the host
// page sends) unless the agency typed one in Settings, which always wins.

export const DEFAULT_APP_DOMAIN = "app.gohighlevel.com";

const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

// A bare host name such as "crm.youragency.com", or null. Schemes, paths, ports and spaces are refused.
export function validDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const d = value.trim().toLowerCase();
  return d.length <= 253 && HOST.test(d) ? d : null;
}

export function deepLinks(appDomain: string | null | undefined) {
  const base = `https://${validDomain(appDomain) ?? DEFAULT_APP_DOMAIN}/v2/location`;
  return {
    account: (loc: string) => `${base}/${loc}/dashboard`,
    contact: (loc: string, id: string) => `${base}/${loc}/contacts/detail/${id}`,
    opportunities: (loc: string) => `${base}/${loc}/opportunities/list`,
    conversation: (loc: string, id: string) => `${base}/${loc}/conversations/conversations/${id}`,
  };
}
