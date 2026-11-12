import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "./db";
import { createLimiter } from "./rate-limit";

// The front door of the public monthly report (/proof/<token>), run by src/proxy.ts before any page is drawn. The page itself streams its first bytes before the database answers, so it could only
// ever say 200, even for a wrong link. This gate looks the link up first and answers a real 404 for every wrong, malformed, switched-off, replaced, unknown or rate-limited link, with the SAME
// generic page each time: it never repeats the address, never says which kind of failure it was and never names a company. A link that exists is passed on to the page, which looks it up again.

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/; // same shape as the one in analytics/proof-core.ts (a unit test keeps them equal)
const SAMPLE = "sample";
const lookups = createLimiter(30, 60_000);

export const gateHash = (t: string) => createHash("sha256").update(t).digest("hex");

/** Equal-length digests compared in constant time, so the answer never depends on how many leading characters matched. */
export function sameText(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%230a658b'/%3E%3C/svg%3E";
const BODY = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Monthly report</title>`
  + `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark">`
  + `<link rel="icon" href="${ICON}" type="image/svg+xml">`
  + `<style>html,body{margin:0}body{background:#ffffff;color:#21201d;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:32rem;margin:0 auto;padding:4rem 1rem}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0;color:#6c685f;line-height:1.5}`
  + `@media (prefers-color-scheme:dark){body{background:#201f1c;color:#f5f4f1}p{color:#bab7b1}}</style></head>`
  + `<body><main><h1>This page is not available</h1><p>The link may have been switched off or replaced. Please ask the sender for a new one.</p></main></body></html>`;

/** The one answer for every bad link: a real 404, the same body every time. */
export function notFoundPage(): Response {
  return new Response(BODY, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}

/** Returns the 404 answer for a link that must not open, or null when the request may go on to the page. */
export async function proofGate(pathname: string, ip: string): Promise<Response | null> {
  const m = /^\/proof\/([^/]+)\/?$/.exec(pathname);
  if (!m) return notFoundPage();
  if (!lookups.allow(ip || "unknown")) return notFoundPage();
  let id: string;
  try { id = decodeURIComponent(m[1]); } catch { return notFoundPage(); }
  if (sameText(id, SAMPLE)) return null;
  if (!TOKEN_SHAPE.test(id)) return notFoundPage();
  try {
    const rows = await sql()`select 1 as ok from pr_links where token_hash = ${gateHash(id)} and revoked_at is null`;
    return rows.length ? null : notFoundPage();
  } catch {
    // The database could not be asked. That says nothing about the link, so let the page answer (it also fails closed).
    return null;
  }
}
