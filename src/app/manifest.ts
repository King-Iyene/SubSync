import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SubSync", short_name: "SubSync", description: "Your command center for every client account. See what needs attention, what it is costing you and what to do next.",
    start_url: "/", display: "standalone", background_color: "#0a101c", theme_color: "#0a101c",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
  };
}
