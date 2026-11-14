import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SubSync", short_name: "SubSync", description: "Know what is happening in every account you manage before a customer tells you.",
    start_url: "/", display: "standalone", background_color: "#0a101c", theme_color: "#0a101c",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
  };
}
