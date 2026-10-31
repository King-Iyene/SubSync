import { defineConfig } from "@playwright/test";

// The demo tenant at the three widths the runbook requires: phone 390, tablet 768, desktop 1440.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:3100", screenshot: "only-on-failure", trace: "off" },
  projects: [
    { name: "phone-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: "node scripts/e2e-server.mjs", url: "http://localhost:3100/app", reuseExistingServer: true, timeout: 180_000 },
});
