import { validLogoUrl } from "./brand-logo.ts";

// The logo rule: the SubSync logo and name are shown everywhere (sidebar, tab icon, emails, shared reports, print) unless THIS company has turned its own brand on
// (a name, a logo or a colour saved in its Settings). Then, and only then, its own brand is shown, and only its own. One function so every place agrees.
export type BrandSettings = { brandName?: string | null; brandColor?: string | null; brandLogoUrl?: string | null };
export type Brand = { whiteLabel: boolean; name: string | null; color: string | null; logoUrl: string | null };

export const PRODUCT_NAME = "SubSync";
export const NO_BRAND: Brand = { whiteLabel: false, name: null, color: null, logoUrl: null };

export function resolveBrand(s: BrandSettings | null | undefined): Brand {
  if (!s) return NO_BRAND;
  const name = typeof s.brandName === "string" && s.brandName.trim() ? s.brandName.trim().slice(0, 60) : null;
  const color = typeof s.brandColor === "string" && /^#[0-9a-f]{6}$/i.test(s.brandColor) ? s.brandColor : null;
  const logoUrl = validLogoUrl(s.brandLogoUrl);
  return name || color || logoUrl ? { whiteLabel: true, name, color, logoUrl } : NO_BRAND;
}

/** The name to print: the company's own when it is white-labelled, ours otherwise. */
export const brandDisplayName = (b: Brand) => (b.whiteLabel && b.name ? b.name : PRODUCT_NAME);
/** True when the SubSync mark should be drawn: always, unless the company's own logo is on. */
export const showProductMark = (b: Brand) => !(b.whiteLabel && b.logoUrl);
