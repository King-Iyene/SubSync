import { describe, expect, it } from "vitest";
import { safeError } from "@/lib/safe-log";

describe("safeError never lets customer data or a token reach a log", () => {
  it("removes the values from a database key message", () => {
    const m = safeError(new Error('duplicate key value violates unique constraint "contacts_email" Key (email)=(jane.doe@example.com) already exists.'));
    expect(m).not.toContain("jane.doe@example.com");
    expect(m).toContain("duplicate key value violates unique constraint");
  });
  it("removes bearer tokens and long token-like strings", () => {
    const secret = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuvwxyz0123456789";
    expect(safeError(new Error(`401 from the platform: Authorization: Bearer ${secret}`))).not.toContain(secret);
    expect(safeError(new Error(`bad token ${secret}`))).not.toContain(secret);
  });
  it("removes email addresses and phone-like numbers", () => {
    const m = safeError(new Error("could not send to bob@example.org or +1 555 010 1234"));
    expect(m).not.toContain("bob@example.org");
    expect(m).not.toContain("555 010 1234");
  });
  it("keeps short, useful words and never throws", () => {
    expect(safeError(new Error("connection closed"))).toBe("connection closed");
    expect(safeError("a string")).toBe("unknown");
    expect(safeError(null)).toBe("unknown");
    expect(safeError({ message: "not an Error" })).toBe("unknown");
  });
  it("caps the length", () => {
    expect(safeError(new Error("x ".repeat(2000))).length).toBeLessThanOrEqual(300);
  });
});
