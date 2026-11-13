import { describe, expect, it } from "vitest";
import { moveHighlight, pickRows, pickStatus } from "@/lib/design/filter-picker";
import { cleanPrefix, isOptionKind, mergeSources, mergeTags, OPTION_CAP } from "@/lib/analytics/filter-options";

describe("filter picker rows", () => {
  const values = [{ value: "Facebook Ads", count: 40 }, { value: "Website form", count: 9 }];
  it("lists the suggestions in the order given and adds a Use row for new text", () => {
    expect(pickRows("zillow", values)).toEqual([
      { kind: "value", value: "Facebook Ads", count: 40 }, { kind: "value", value: "Website form", count: 9 }, { kind: "use", value: "zillow" },
    ]);
  });
  it("adds no Use row when nothing is typed or the typed text is already a suggestion (any case)", () => {
    expect(pickRows("", values)).toHaveLength(2);
    expect(pickRows("  ", values)).toHaveLength(2);
    expect(pickRows("website FORM", values)).toHaveLength(2);
  });
  it("can match exactly when case matters", () => {
    expect(pickRows("website form", values, true).at(-1)).toEqual({ kind: "use", value: "website form" });
  });
  it("a Use row is the only row when nothing matches", () => {
    expect(pickRows("abc", [])).toEqual([{ kind: "use", value: "abc" }]);
  });
});

describe("filter picker keys", () => {
  it("arrow keys wrap, Home and End jump, other keys keep the row", () => {
    expect(moveHighlight(0, "ArrowDown", 3)).toBe(1);
    expect(moveHighlight(2, "ArrowDown", 3)).toBe(0);
    expect(moveHighlight(0, "ArrowUp", 3)).toBe(2);
    expect(moveHighlight(1, "Home", 3)).toBe(0);
    expect(moveHighlight(0, "End", 3)).toBe(2);
    expect(moveHighlight(1, "a", 3)).toBe(1);
    expect(moveHighlight(0, "ArrowDown", 0)).toBe(-1);
  });
  it("says in plain words what the list is", () => {
    expect(pickStatus(0, false, true, "")).toBe("Looking...");
    expect(pickStatus(30, true, false, "")).toContain("Type to search for more");
    expect(pickStatus(3, false, false, "")).toBe("3 found in your account.");
    expect(pickStatus(0, false, false, "zz")).toContain("You can still use what you typed");
  });
});

describe("filter option merging", () => {
  it("merges spellings of one source, adds counts, drops blanks, most used first", () => {
    const r = mergeSources([{ value: "facebook  ads", count: 5 }, { value: "facebook ads", count: 7 }, { value: "Website", count: 20 }, { value: " ", count: 99 }, { value: null, count: 3 }]);
    expect(r.values).toEqual([{ value: "Website", count: 20 }, { value: "Facebook Ads", count: 12 }]);
    expect(r.more).toBe(false);
  });
  it("lower-cases and merges tags, breaks ties A to Z", () => {
    const r = mergeTags([{ value: "Hot", count: 2 }, { value: "hot", count: 3 }, { value: "cold", count: 5 }, { value: "alpha", count: 5 }]);
    expect(r.values).toEqual([{ value: "alpha", count: 5 }, { value: "cold", count: 5 }, { value: "hot", count: 5 }]);
  });
  it("caps the list and says there is more", () => {
    const rows = Array.from({ length: OPTION_CAP + 5 }, (_, i) => ({ value: `t${String(i).padStart(3, "0")}`, count: 1000 - i }));
    const r = mergeTags(rows);
    expect(r.values).toHaveLength(OPTION_CAP);
    expect(r.more).toBe(true);
    expect(r.values[0]!.value).toBe("t000");
  });
  it("cleans the typed prefix and only knows two kinds", () => {
    expect(cleanPrefix("  FaceBook   ")).toBe("facebook");
    expect(cleanPrefix(null)).toBe("");
    expect(cleanPrefix("x".repeat(200))).toHaveLength(60);
    expect(isOptionKind("tag")).toBe(true);
    expect(isOptionKind("owner")).toBe(false);
  });
});
