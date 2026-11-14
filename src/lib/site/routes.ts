// The list of public pages: the sitemap reads it, and a test crawls it (every route must exist, every internal link on it must resolve).
import { DOC_PAGES } from "./docs.ts";

export const STATIC_ROUTES = ["/", "/pricing", "/support", "/support/glossary", "/support/changelog", "/trust", "/privacy", "/terms"] as const;

export const publicRoutes = (): string[] => [...STATIC_ROUTES, ...DOC_PAGES.map((p) => `/support/${p.slug}`)];

/** Routes that exist but are not for search engines or the sitemap. */
export const HIDDEN_ROUTES = ["/installed", "/installed/error"] as const;
/** Prefixes that belong to the app and its machine endpoints: robots.txt asks crawlers to stay out. */
export const DISALLOWED_PREFIXES = ["/app", "/api/", "/audit/", "/proof/", "/r/", "/reply-proof", "/installed", "/design"] as const;
