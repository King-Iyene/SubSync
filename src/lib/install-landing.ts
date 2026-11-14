// What the install callback tells the /installed page, so the page can send the person back into their CRM. It carries NO token or secret: only what kind of
// install it was, the one account (for an account install), and the CRM domain the server worked out from the stored company domain (see companyDomain).
// The values are signed and expire after an hour, so a made-up address cannot send anyone to a host we did not choose (no open redirect).
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { crmUrl, deepLinks, validDomain } from "./links.ts";

export type Landing = { kind: "account" | "company"; locationId: string | null; domain: string | null };
const TTL_SECONDS = 60 * 60;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Missing environment variable TOKEN_ENCRYPTION_KEY");
  const material = Buffer.from(raw, "base64");
  if (material.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return Buffer.from(hkdfSync("sha256", material, Buffer.alloc(0), "subsync-install-landing-v1", 32));
}
const mac = (body: string) => createHmac("sha256", key()).update(body).digest();

const safeId = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(v) ? v : null);

export function signLanding(l: Landing, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ k: l.kind, l: l.locationId, d: l.domain, exp: Math.floor(now / 1000) + TTL_SECONDS })).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function readLanding(token: string | null | undefined, now = Date.now()): Landing | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const want = mac(body);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { k?: unknown; l?: unknown; d?: unknown; exp?: unknown };
    if (typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    const kind = s.k === "account" ? "account" : s.k === "company" ? "company" : null;
    if (!kind) return null;
    const locationId = safeId(s.l);
    if (kind === "account" && !locationId) return null;
    return { kind, locationId: kind === "account" ? locationId : null, domain: validDomain(s.d) };
  } catch { return null; }
}

/**
 * Where "Open SubSync in your CRM" goes. An account install goes to that account's dashboard, a company install to the start page of the company's own domain.
 * The default host is used only when no company domain is known. With no landing details at all it is the plain start page, and `auto` is false: the page
 * never redirects by itself unless the callback gave it the details.
 */
export function crmTarget(landing: Landing | null): { href: string; auto: boolean } {
  if (!landing) return { href: crmUrl(null, "/"), auto: false };
  if (landing.kind === "account" && landing.locationId) return { href: deepLinks(landing.domain).account(landing.locationId), auto: true };
  return { href: crmUrl(landing.domain, "/"), auto: true };
}
