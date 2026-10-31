import { describe, expect, it } from "vitest";
import { demoAllowed, isProduction, maintenanceOn } from "@/lib/runtime-guards";

describe("demo mode can never be enabled in production", () => {
  it("is on only when DEMO_MODE is exactly true and nothing says production", () => {
    expect(demoAllowed({ DEMO_MODE: "true", NODE_ENV: "development" })).toBe(true);
    expect(demoAllowed({ DEMO_MODE: "true" })).toBe(true);
  });
  it("is off when NODE_ENV is production, even with DEMO_MODE=true", () => {
    expect(demoAllowed({ DEMO_MODE: "true", NODE_ENV: "production" })).toBe(false);
  });
  it("is off when VERCEL_ENV is production, even with DEMO_MODE=true", () => {
    expect(demoAllowed({ DEMO_MODE: "true", VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(false);
  });
  it("is off on a preview build (NODE_ENV is production there)", () => {
    expect(demoAllowed({ DEMO_MODE: "true", VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(false);
  });
  it("needs the exact word true", () => {
    for (const v of ["TRUE", "True", "1", "yes", " true", "true ", "", undefined]) {
      expect(demoAllowed({ DEMO_MODE: v, NODE_ENV: "development" })).toBe(false);
    }
  });
  it("detects production from either variable alone", () => {
    expect(isProduction({ NODE_ENV: "production" })).toBe(true);
    expect(isProduction({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProduction({ NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("kill switch", () => {
  it("is on only for the exact value maintenance", () => {
    expect(maintenanceOn({ APP_MODE: "maintenance" })).toBe(true);
    for (const v of ["Maintenance", "on", "true", "", undefined, "maintenance "]) expect(maintenanceOn({ APP_MODE: v })).toBe(false);
  });
});
