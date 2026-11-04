import { describe, expect, it } from "vitest";
import { NAV_FOR } from "@/lib/access";
import { NAV, PARENT, visibleNav } from "@/app/app/nav";
import { cleanupTabs } from "@/app/app/views/cleanup-hub";

// Clean-up is ONE menu entry (stage CLEANUP). The old ids stay so every old address still lands somewhere, the flags of the two old pages still apply, and a client's staff
// (who have no Clean-up of their own) still reach Duplicates, as decided in the Duplicates stage.
const names = (kind: "agency" | "business" | "client", off: (f: string) => boolean = () => false) =>
  visibleNav(NAV_FOR[kind], { limited: kind !== "agency", off: (f) => (f === "cleanup" ? off("cleanup") && off("duplicates") : off(f)) }).map((n) => n.label);

describe("the Clean-up menu entry", () => {
  it("every kind of person sees exactly one entry called Clean-up, and no Duplicates or Data cleanup entry", () => {
    for (const kind of ["agency", "business", "client"] as const) {
      const labels = names(kind);
      expect(labels.filter((l) => l === "Clean-up"), kind).toHaveLength(1);
      expect(labels, kind).not.toContain("Duplicates");
      expect(labels, kind).not.toContain("Data cleanup");
    }
  });

  it("the old ids still exist and the duplicates page lives inside Clean-up", () => {
    expect(NAV.some((n) => n.id === "cleanup")).toBe(true);
    expect(NAV.find((n) => n.id === "duplicates")?.parent).toBe("cleanup");
    expect(PARENT.duplicates).toBe("cleanup");
  });

  it("switching one feature off keeps the entry while the other is on, and switching both off removes it", () => {
    expect(names("agency", (f) => f === "cleanup")).toContain("Clean-up");
    expect(names("agency", (f) => f === "duplicates")).toContain("Clean-up");
    expect(names("agency", (f) => f === "cleanup" || f === "duplicates")).not.toContain("Clean-up");
  });

  it("the tabs follow what each kind may do, and a switched-off feature leaves its tabs out", () => {
    expect(cleanupTabs({ kind: "agency", duplicatesOn: true, cleanupOn: true })).toEqual(["duplicates", "quality", "history", "rules"]);
    expect(cleanupTabs({ kind: "business", duplicatesOn: true, cleanupOn: true })).toEqual(["duplicates", "quality", "history", "rules"]);
    expect(cleanupTabs({ kind: "client", duplicatesOn: true, cleanupOn: true })).toEqual(["duplicates", "history"]);
    expect(cleanupTabs({ kind: "agency", duplicatesOn: false, cleanupOn: true })).toEqual(["quality", "history", "rules"]);
    expect(cleanupTabs({ kind: "agency", duplicatesOn: true, cleanupOn: false })).toEqual(["duplicates", "history"]);
    expect(cleanupTabs({ kind: "agency", duplicatesOn: false, cleanupOn: false })).toEqual([]);
  });
});
