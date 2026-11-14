// Where /install sends a visitor. One stable address on the site, so no page ever holds a long install URL, and the destination can change without touching a page.
// Order: (1) MARKETPLACE_LISTING_URL when King sets it (the listing link shown in the developer portal), (2) the install URL the app already builds
// (client id, redirect address and permissions; src/lib/ghl/scopes.ts), (3) the Support page with the steps, when the app is not configured for installs.
// The optional `crm` value (a visitor's own CRM domain) is validated as a host only. The docs do not state an install address per white-label domain,
// so the domain is NOT used to build one (see docs/SITE.md, TODO). No secret is ever logged or put in an address by this file.
import { validDomain } from "./links.ts";

export type InstallInput = { listingUrl?: string | null; clientId?: string | null; redirectUri?: string | null; crm?: string | null };
export type InstallTarget = { href: string; source: "listing" | "install-url" | "support"; crmDomain: string | null };

/** A listing address must be https, have a plain host, no credentials and no port. Anything else is ignored. */
export function validListingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > 600 || /[\s\\<>"']/.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || u.port || !validDomain(u.hostname)) return null;
    return u.href;
  } catch { return null; }
}

export function installTarget(input: InstallInput, buildInstallUrl: (clientId: string, redirectUri: string) => string): InstallTarget {
  const asked = validDomain(input.crm ?? null);
  const crmDomain = asked && !/^\d+\.\d+\.\d+\.\d+$/.test(asked) ? asked : null; // a host name only, never an IP address
  const listing = validListingUrl(input.listingUrl);
  if (listing) return { href: listing, source: "listing", crmDomain };
  if (input.clientId && input.redirectUri) return { href: buildInstallUrl(input.clientId, input.redirectUri), source: "install-url", crmDomain };
  return { href: "/support#install", source: "support", crmDomain };
}
