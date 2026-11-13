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

// The one place a CRM address is made. `source` is a domain, or anything that carries one: the signed-in identity
// (whitelabelDomain) or the saved settings (appDomain, which wins because the agency typed it).
export type DomainSource = string | null | undefined | { appDomain?: string | null; whitelabelDomain?: string | null };

export function crmUrl(source: DomainSource, path: string): string {
  const domain = source && typeof source === "object" ? validDomain(source.appDomain) ?? validDomain(source.whitelabelDomain) : validDomain(source);
  const clean = /[\s\\]/.test(path) ? "/" : path.replace(/^\/*/, "/"); // always one leading slash; the host can never be changed by the path
  return `https://${domain ?? DEFAULT_APP_DOMAIN}${clean}`;
}

export function deepLinks(source: DomainSource) {
  const base = crmUrl(source, "/v2/location");
  return {
    account: (loc: string) => `${base}/${loc}/dashboard`,
    contact: (loc: string, id: string) => `${base}/${loc}/contacts/detail/${id}`,
    /** The CRM's own call and text task list (manual actions from workflows). */
    manualActions: (loc: string) => `${base}/${loc}/conversations/manual_actions`,
    opportunities: (loc: string) => `${base}/${loc}/opportunities/list`,
    /** The CRM's conversations list for one account (CHECK the exact path against a live CRM). */
    conversations: (loc: string) => `${base}/${loc}/conversations/conversations`,
    /** The CRM calendar of one account (CHECK). */
    calendar: (loc: string) => `${base}/${loc}/calendars/view`,
    /** The CRM contacts list of one account (CHECK). */
    contacts: (loc: string) => `${base}/${loc}/contacts/smart_list/All`,
    conversation: (loc: string, id: string) => `${base}/${loc}/conversations/conversations/${id}`,
  };
}

// ---- One CRM domain per COMPANY, not per install ----
// A white-labelled company has many installs (its own, plus one per client account that opened the app). The domain is seen on only some of them (sign-in or the install
// event), so a link about any account of the company must use the company's domain. Pure rule, unit tested; the database read lives in analytics/queries.ts.
export type DomainRow = { own: boolean; source: string | null; appDomain: string | null; detected: string | null };
export type ResolvedDomain = { appDomain: string; source: "manual" | "sso" | "install" | "default"; detected: string | null };

/** Order: this install's own typed domain, any sibling's typed domain, this install's detected domain, any sibling's detected domain, then the default. Rows must all be of ONE company. */
export function resolveCompanyDomain(rows: DomainRow[]): ResolvedDomain {
  const typed = (r: DomainRow) => (r.source === "manual" ? validDomain(r.appDomain) : null);
  const seen = (r: DomainRow) => validDomain(r.detected);
  const detected = rows.filter((r) => r.own).map(seen).find(Boolean) ?? rows.map(seen).find(Boolean) ?? null;
  const own = rows.filter((r) => r.own).map(typed).find(Boolean);
  if (own) return { appDomain: own, source: "manual", detected };
  const sib = rows.map(typed).find(Boolean);
  if (sib) return { appDomain: sib, source: "manual", detected };
  if (detected) {
    const from = rows.find((r) => seen(r) === detected);
    return { appDomain: detected, source: from?.source === "install" ? "install" : "sso", detected };
  }
  return { appDomain: DEFAULT_APP_DOMAIN, source: "default", detected: null };
}
