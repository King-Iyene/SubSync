import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site/config";
import { DISALLOWED_PREFIXES } from "@/lib/site/routes";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: [...DISALLOWED_PREFIXES] }], sitemap: `${SITE.url}/sitemap.xml` };
}
