// Where a link in an email or a chat message goes. SubSync opens only inside the CRM (it signs the person in there), so a link to the SubSync address can never sign
// anyone in. Every link therefore opens the CRM, on the company's OWN domain (white label), on the right account: the lead, the conversations list, the calendar, the deals.
// Things that exist only in SubSync (email health, sync status, proof) link to that account's CRM dashboard and say in plain words which menu to open next.
// Pure. The only host ever used comes from `deepLinks` / `crmUrl` (links.ts), never a typed-in address.

import { deepLinks, crmUrl, type DomainSource } from "../links.ts";

export type Target = { view: string | null; locationId: string | null; /** A single lead (contact). Only used together with an account. */ contactId?: string | null };
export type Resolved = { url: string; label: string; /** true = a CRM page that matches; false = the CRM dashboard plus words for the SubSync menu. */ crm: boolean };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The CRM page that matches an in-app link, on that alert's own account and the company's own CRM domain. null = the CRM has no equivalent (or no single account). */
export function crmLinkFor(source: DomainSource, link: Target): string | null {
  const loc = link.locationId;
  if (!loc || !ID.test(loc)) return null; // an odd id can never become part of a link
  const d = deepLinks(source);
  if (link.contactId && ID.test(link.contactId)) return d.contact(loc, link.contactId);
  if (!link.view) return null;
  switch (link.view) {
    case "speed": case "sla": case "unanswered": case "inbox": return d.conversations(loc);
    case "appointments": return d.calendar(loc);
    case "deals": case "pipeline": return d.opportunities(loc);
    case "account": return d.account(loc);
    case "data-health": case "cleanup": return d.contacts(loc);
    default: return null;
  }
}

/** Where a SubSync-only view lives in the app menu, in words. */
export function menuFor(view: string | null): string {
  switch (view) {
    case "email": return "SubSync > Clients > Email health";
    case "sync": case "settings": return "SubSync > Settings > Sync status";
    case "connections": return "SubSync > Settings > Integrations";
    case "alerts": case "today": return "SubSync > Today";
    case "speed": case "sla": case "unanswered": case "inbox": return "SubSync > Speed to lead";
    case "appointments": return "SubSync > Appointments";
    case "deals": case "pipeline": return "SubSync > Pipeline and deals";
    case "clients": case "accounts": case "account": return "SubSync > Clients";
    case "audit": return "SubSync > Account audit";
    case "workflows": return "SubSync > Workflows";
    case "data-health": case "cleanup": return "SubSync > Clean-up > Data health";
    case "payments": case "finance": return "SubSync > Money";
    default: return "SubSync";
  }
}

/** The view name inside an in-app hash such as "#today?tab=recover" or "/app#speed". null when there is none. */
export const viewOfHash = (hash: string): string | null => (/#([a-z][a-z-]*)/.exec(hash)?.[1] ?? null);

/** Words only, with the company's CRM start page as the one link (no single account, so no account page). */
export function wordsLink(source: DomainSource, path: string): Resolved {
  return { url: crmUrl(source, "/"), label: `Open your CRM, then ${path}`, crm: false };
}

/**
 * The one link for one item: the lead, or the CRM page that matches, in that account; else that account's CRM dashboard with words; with no single account, the CRM start page with words.
 * `verb` is how the sentence starts ("Open the list"); crm links always end "in your CRM".
 */
export function resolveTarget(source: DomainSource, t: Target, verb = "Open it"): Resolved {
  const crm = crmLinkFor(source, t);
  const clean = `${verb.replace(/ in (your CRM|SubSync)$/, "")} in your CRM`;
  if (crm) return { url: crm, label: clean, crm: true };
  const words = `Open your CRM, then ${menuFor(t.view)}`;
  if (t.locationId && ID.test(t.locationId)) return { url: deepLinks(source).account(t.locationId), label: words, crm: false };
  return { url: crmUrl(source, "/"), label: words, crm: false };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Plain-text form of a link. Matches the HTML form word for word. */
export const linkText = (r: Resolved) => `${r.label}: ${r.url}`;
/** HTML form of a link (an anchor). `style` is an optional inline style for a button look. */
export const linkHtml = (r: Resolved, style?: string) => `<a href="${esc(r.url)}"${style ? ` style="${style}"` : ""}>${esc(r.label)}</a>`;
