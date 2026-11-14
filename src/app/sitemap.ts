import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site/config";
import { publicRoutes } from "@/lib/site/routes";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes().map((path) => ({ url: `${SITE.url}${path === "/" ? "" : path}`, changeFrequency: "weekly", priority: path === "/" ? 1 : path.startsWith("/support/") ? 0.6 : 0.8 }));
}
