"use client";

import { useState } from "react";
import { PRODUCT_MARK, PRODUCT_MARK_FALLBACK, validLogoUrl } from "@/lib/brand-logo";

// The agency's logo. The browser loads the picture from the address (our server never fetches it). Only https addresses are used, the height is fixed,
// and when the picture cannot load the brand name is shown instead.
export function BrandLogo({ url, name, className = "", height = 32, fallback }: { url: string | null | undefined; name: string | null; className?: string; height?: number; fallback?: React.ReactNode }) {
  const safe = validLogoUrl(url);
  const [failed, setFailed] = useState<string | null>(null);
  if (!safe || failed === safe) return <>{fallback ?? (name ? <span className={className}>{name}</span> : null)}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={safe} alt={name ?? "Logo"} height={height} referrerPolicy="no-referrer" loading="lazy" className={className} style={{ maxHeight: height, width: "auto", maxWidth: "100%" }} onError={() => setFailed(safe)} />;
}

/** The SubSync mark. Loads /brand/subsync-logo.png and, until that file exists, the 512 picture. Nothing is drawn if neither loads. */
export function ProductMark({ height = 32, className = "" }: { height?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(PRODUCT_MARK);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden height={height} width={height} className={className} style={{ height, width: height }} onError={() => setSrc(src === PRODUCT_MARK ? PRODUCT_MARK_FALLBACK : null)} />;
}
