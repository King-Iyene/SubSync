import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/entitlements";
import { DEFAULT_OFF } from "@/lib/flags-core";

// Runbook rule: a new feature ships behind a flag that defaults to off. To add a feature you must either put it in
// DEFAULT_OFF (the normal case) or, for a bug fix to something already live, consciously add it to this reviewed list.
const REVIEWED_ALWAYS_ON_BASELINE = new Set([
  "overview", "search", "onboarding", "health", "stale", "activity", "inbox", "pipelines", "duplicates", "email", "alerts", "reports", "builder",
  "exports", "ai", "meetings", "connections", "cleanup", "setup_compare", "playbooks", "clients", "team", "calls", "appointments", "audit", "speed", "settings",
]);

describe("new features default off", () => {
  it("every feature is either default-off or on the reviewed baseline", () => {
    const unreviewed = (FEATURES as readonly string[]).filter((f) => !DEFAULT_OFF.has(f as never) && !REVIEWED_ALWAYS_ON_BASELINE.has(f));
    expect(unreviewed, `New feature(s) ${unreviewed.join(", ")} must be added to DEFAULT_OFF in src/lib/flags-core.ts`).toEqual([]);
  });
  it("the default-off names are real features", () => {
    for (const f of DEFAULT_OFF) expect((FEATURES as readonly string[]).includes(f)).toBe(true);
  });
});
