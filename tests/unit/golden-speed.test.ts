import { describe, expect, it } from "vitest";
import { isNeverAnswered, summarise } from "@/lib/analytics/speed-intel";
import { GOLDEN_ANSWERS, GOLDEN_LEADS, GOLDEN_NOW } from "../fixtures/golden";

describe("golden dataset: speed to lead", () => {
  const s = summarise(GOLDEN_LEADS, GOLDEN_ANSWERS.targetMinutes, GOLDEN_NOW);

  it("counts ten leads, and judges nine (one is still inside its window)", () => {
    expect(GOLDEN_LEADS).toHaveLength(GOLDEN_ANSWERS.total);
    expect(s.leads).toBe(GOLDEN_ANSWERS.judged);
  });
  it("one answered inside the target, none late, eight waiting", () => {
    expect(s.withinTarget).toBe(GOLDEN_ANSWERS.withinTarget);
    expect(s.answeredLate).toBe(GOLDEN_ANSWERS.answeredLate);
    expect(s.stillWaiting).toBe(GOLDEN_ANSWERS.stillWaiting);
  });
  it("shows a hit rate of one in nine, and no typical time on one reply", () => {
    expect(s.hitRate).toBeCloseTo(GOLDEN_ANSWERS.hitRate, 10);
    expect(s.medianSeconds).toBeNull();
  });
  it("all eight unanswered leads are never answered (older than three days)", () => {
    const never = GOLDEN_LEADS.filter((l) => l.touchAt === null && isNeverAnswered((GOLDEN_NOW - l.leadAt) / 60_000)).length;
    expect(never).toBe(GOLDEN_ANSWERS.neverAnswered);
  });
});
