import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // The dashboard is iframed inside the host platform, which agencies
        // often serve from their own white-label domains, so any https origin
        // may frame it. Identity comes from SSO verification, not the origin.
        source: "/app/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self' https:" },
        ],
      },
      {
        source: "/((?!app).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
