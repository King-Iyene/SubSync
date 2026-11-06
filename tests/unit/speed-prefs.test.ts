import { describe, expect, it } from "vitest";
import { cleanPref, isPrefKey } from "@/lib/analytics/speed-prefs-db";

describe("speed prefs are cleaned before they are stored", () => {
  it("only the four known keys", () => { expect(isPrefKey("cadence")).toBe(true); expect(isPrefKey("secrets")).toBe(false); });
  it("cadence and goals are clamped", () => {
    expect(cleanPref("cadence", { maxAttempts: 99, redialAfterHours: 0, nextDay: true })).toEqual({ maxAttempts: 10, redialAfterHours: 1, nextDay: true });
    expect(cleanPref("goals", { calls: 9999, reached: "x", booked: 0 })).toEqual({ calls: 500, reached: 10, booked: 1 });
  });
  it("scripts keep strings only, lower-case keys, capped length", () => {
    const v = cleanPref("scripts", { "Website Form": "Hi", bad: 5, long: "x".repeat(2000) }) as Record<string, string>;
    expect(v["website form"]).toBe("Hi"); expect(v.bad).toBeUndefined(); expect(v.long).toHaveLength(1000);
  });
  it("outcome sets fall back to the standard ones when junk", () => { expect((cleanPref("dispositions", "junk") as unknown[]).length).toBe(7); });
});
