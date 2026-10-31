import { describe, expect, it } from "vitest";
import { countedOpen, isCounted, MIN_CLOSED_DEALS, openPipeline, outlier, winRate, winRateOf, type DealLike } from "@/lib/analytics/metrics";

// Golden dataset: every answer below is known by hand.
//   open and counted:  $1,000 (a), $2,000 (a), $500 (b), $100 (b)  -> 4 deals, $3,600
//   open, left out:    $0 with an owner, $5,000 with no owner, $0 with no owner -> 3 deals (2 with no value, 1 with no owner)
//   closed:            3 won, 2 lost -> 5 closed, below the minimum of 20
const d = (status: string, value: number, assignedTo: string | null = "a"): DealLike => ({ status, value, assignedTo });
const golden: DealLike[] = [
  d("open", 1000), d("open", 2000), d("open", 500, "b"), d("open", 100, "b"),
  d("open", 0), d("open", 5000, null), d("open", 0, null),
  d("won", 900), d("won", 100), d("won", 50, null), d("lost", 400), d("lost", 0, null),
];

describe("counted deal and open pipeline (one definition for every screen)", () => {
  it("counts only open deals with a value above zero and an owner", () => {
    expect(countedOpen(golden)).toHaveLength(4);
    expect(isCounted(d("open", 0))).toBe(false);
    expect(isCounted(d("open", 10, null))).toBe(false);
    expect(isCounted(d("open", 10, ""))).toBe(false);
    expect(isCounted(d("open", Number.NaN))).toBe(false);
    expect(isCounted(d("open", -5))).toBe(false);
    expect(isCounted(d("open", 10))).toBe(true);
  });

  it("sums only counted deals and says how many were left out and why", () => {
    expect(openPipeline(golden)).toEqual({ count: 4, value: 3600, excludedCount: 3, noValue: 2, noOwner: 1 });
  });

  it("an empty account is zero, not an error", () => {
    expect(openPipeline([])).toEqual({ count: 0, value: 0, excludedCount: 0, noValue: 0, noOwner: 0 });
  });

  it("a $5,000 ownerless deal never reaches the total", () => {
    expect(openPipeline([d("open", 5000, null)]).value).toBe(0);
  });
});

describe("win rate has one minimum everywhere", () => {
  it("the minimum is 20 closed deals", () => expect(MIN_CLOSED_DEALS).toBe(20));

  it("the golden dataset has 5 closed deals, so there is no win rate and 15 more are needed", () => {
    expect(winRate(golden)).toBeNull();
    expect(winRateOf(3, 2)).toEqual({ rate: null, closed: 5, needed: 15 });
  });

  it("19 closed is not enough, 20 is", () => {
    expect(winRateOf(10, 9)).toEqual({ rate: null, closed: 19, needed: 1 });
    expect(winRateOf(12, 8)).toEqual({ rate: 0.6, closed: 20, needed: 0 });
  });

  it("a 3 won and 3 lost account never shows 50%", () => {
    expect(winRateOf(3, 3).rate).toBeNull();
  });

  it("works from a list of deals", () => {
    const many = [...Array.from({ length: 12 }, () => d("won", 1)), ...Array.from({ length: 8 }, () => d("lost", 1))];
    expect(winRate(many)).toBe(0.6);
  });
});

describe("outlier guard on dollar figures", () => {
  it("flags one deal that is at least half the total", () => {
    const o = outlier([d("open", 1_000_000), d("open", 100), d("open", 200)]);
    expect(o).not.toBeNull();
    expect(o?.value).toBe(1_000_000);
    expect(o?.share).toBeGreaterThan(0.99);
  });

  it("does not flag an even spread", () => expect(outlier([d("open", 1000), d("open", 900), d("open", 800)])).toBeNull());

  it("does not flag an account with fewer than 3 deals", () => expect(outlier([d("open", 1_000_000), d("open", 1)])).toBeNull());

  it("ignores deals that are not counted", () => {
    expect(outlier([d("open", 1_000_000, null), d("open", 100), d("open", 200), d("open", 300), d("open", 400)])).toBeNull();
  });

  it("exactly half is flagged", () => expect(outlier([d("open", 300), d("open", 100), d("open", 100), d("open", 100)])).not.toBeNull());
});
