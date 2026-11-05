// Logo web addresses. Only https, no credentials, no query or fragment (no tracking pixels), a plain host name, a sane length.
// The server never fetches one: the browser loads the image and falls back to the brand name if it fails.
import { validDomain } from "./links.ts";

export function validLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 500 || /[\s\\<>"']/.test(v)) return null;
  let u: URL;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
  if (!validDomain(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null;
  return u.href;
}

/** The logo to show: only the address the owner typed in Settings. The logo the platform sent is kept but never shown on its own: without a chosen logo the SubSync logo shows. */
export function effectiveLogo(brandLogoUrl: string | null | undefined, _detectedLogoUrl?: string | null | undefined): string | null {
  return validLogoUrl(brandLogoUrl);
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email header: the logo with a fixed height, or an empty string when there is none. The picture loads from the owner's own address. */
export const PRODUCT_MARK = "/brand/subsync-logo.png";
export const PRODUCT_MARK_FALLBACK = "/brand/subsync-logo-512.png";

export function emailLogoHtml(logoUrl: string | null | undefined, name: string): string {
  const url = validLogoUrl(logoUrl);
  return url ? `<p style="margin:0 0 16px"><img src="${escAttr(url)}" alt="${escAttr(name)}" height="40" style="max-height:40px;width:auto;border:0"></p>` : "";
}
