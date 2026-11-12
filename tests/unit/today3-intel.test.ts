import { describe, expect, it } from "vitest";
import { changeText, emailDue, emailText, headlineOf, localDay, localHour, MAX_ITEMS, medianOf, planRecord, proofLines, rankItems, recentWeeks, showRate } from "@/lib/analytics/today3-intel";
import type { Td3Kind } from "@/lib/analytics/today3-types";

const raw = (kind: Td3Kind, count: number, money: number | null, oldestHours: number | null, accounts = 2) => ({ kind, count, accounts, money, oldestHours, top: [{ locationId: "a", name: "A", count }] });

describe("today ranking", () => {
  it("money first, then the longest wait, then the fixed order", () => {
    const r = rankItems([raw("noshows", 3, null, 30), raw("waiting_old", 5, null, 50), raw("stale_deals", 4, 9000, 700), raw("unmarked", 9, null, 50)]);
    expect(r.map((x) => x.kind)).toEqual(["stale_deals", "waiting_old", "unmarked", "noshows"]);
    expect(r[0].rankWhy).toMatch(/\$9,000/);
    expect(r[0].rankWhy).toMatch(/estimate/i);
    expect(r[1].rankWhy).toMatch(/2 days/);
  });
  it("labels are plain words with the count in them", () => {
    const [a] = rankItems([raw("waiting_old", 1, null, 30)]);
    expect(a.label).toBe("1 person has waited over a day for a reply");
    expect(rankItems([raw("waiting_old", 14, null, 30)])[0].label).toContain("14 people");
  });
  it("the headline names the first two and the button carries the first count", () => {
    const items = rankItems([raw("waiting_old", 14, 12000, 40), raw("unmarked", 9, null, 10, 1)]);
    const h = headlineOf(items, 20);
    expect(h.headline).toContain("14 people have waited over a day");
    expect(h.headline).toContain("9 appointments with no outcome");
    expect(h.button).toMatchObject({ kind: "waiting_old", count: 14, module: "speed", locationId: null });
    expect(h.button?.label).toBe("Reply to the 14 people");
  });
  it("one account behind the first item: the button opens that account", () => {
    const h = headlineOf(rankItems([raw("waiting_old", 2, null, 5, 1)]), 3);
    expect(h.button?.locationId).toBe("a");
  });
  it("nothing to do and no accounts are different plain sentences", () => {
    expect(headlineOf([], 0).headline).toBe("No client accounts yet.");
    expect(headlineOf([], 4)).toEqual({ headline: "Nothing needs you right now.", button: null });
  });
  it("the list cap is five", () => { expect(MAX_ITEMS).toBe(5); });
});

describe("time zones: today is the account's day", () => {
  const t = Date.parse("2026-11-11T23:30:00Z");
  it("the same moment is two different days in two places", () => {
    expect(localDay(t, "UTC")).toBe("2026-11-11");
    expect(localDay(t, "Africa/Lagos")).toBe("2026-11-12");
    expect(localDay(t, "America/Los_Angeles")).toBe("2026-11-11");
    expect(localHour(t, "Africa/Lagos")).toBe(0);
  });
  it("a bad zone falls back to UTC instead of throwing", () => { expect(localDay(t, "Not/AZone")).toBe("2026-11-11"); });
});

describe("the ledger", () => {
  const now = Date.parse("2026-11-11T10:00:00Z");
  it("the first record is a baseline: what was already there is not 'found'", () => {
    const l = planRecord(null, 14, now, "2026-11-11");
    expect(l).toMatchObject({ baseline: true, found: 0, cleared: 0, lastCount: 14 });
  });
  it("a rise is found, a drop is cleared, and the same count twice changes nothing", () => {
    const a = planRecord(null, 10, now, "2026-11-11");
    const prev = (l: typeof a) => ({ ...l, openSince: l.openSince });
    const up = planRecord(prev(a), 13, now + 3_600_000, "2026-11-11");
    expect(up).toMatchObject({ found: 3, cleared: 0, lastCount: 13 });
    const again = planRecord(prev(up), 13, now + 7_200_000, "2026-11-11");
    expect(again).toMatchObject({ found: 3, cleared: 0 });
    const down = planRecord(prev(again), 9, now + 10_800_000, "2026-11-11");
    expect(down).toMatchObject({ found: 3, cleared: 4, lastCount: 9 });
  });
  it("reaching zero keeps how long it was open as a fix time, and a new day starts new totals", () => {
    const a = planRecord(null, 2, now, "2026-11-11");
    const z = planRecord({ ...a }, 0, now + 90 * 60_000, "2026-11-11");
    expect(z.fixMinutes).toEqual([90]);
    expect(z.resolvedAt).toBe(now + 90 * 60_000);
    const next = planRecord({ ...z }, 1, now + 24 * 3_600_000, "2026-11-12");
    expect(next).toMatchObject({ found: 1, cleared: 0, baseline: false, fixMinutes: [] });
    expect(next.openSince).toBe(now + 24 * 3_600_000);
  });
  it("median of fix times", () => { expect(medianOf([10, 30, 20])).toBe(20); expect(medianOf([10, 20])).toBe(15); expect(medianOf([])).toBeNull(); });
});

describe("proof", () => {
  it("says history starts when there is not enough record", () => {
    expect(proofLines({ found: 0, cleared: 0, stillOpen: 0, medianFixMinutes: null, enough: false }, null, "2026-11-10")[0]).toContain("2026-11-10");
  });
  it("plain lines a client can read", () => {
    const l = proofLines({ found: 31, cleared: 24, stillOpen: 7, medianFixMinutes: 180, enough: true }, "Acme Dental", "2026-11-01");
    expect(l[0]).toBe("This week we found 31 problems in Acme Dental.");
    expect(l[1]).toContain("24 were fixed");
    expect(l[1]).toContain("3 hours");
    expect(l[2]).toBe("7 are still open.");
  });
  it("weeks are Mondays, newest first", () => {
    const w = recentWeeks(Date.parse("2026-11-11T10:00:00Z"), 3);
    expect(w).toEqual(["2026-11-09", "2026-11-02", "2026-10-26"]);
  });
});

describe("numbers rules", () => {
  it("a show rate needs 20 marked outcomes", () => {
    expect(showRate(8, 4)).toMatchObject({ enough: false, rate: null });
    expect(showRate(8, 4).caption).toBe("Needs 20 marked outcomes (12 so far)");
    expect(showRate(15, 5)).toMatchObject({ enough: true, rate: 75, value: "75%" });
  });
  it("a change only with a real base", () => { expect(changeText(10, 3, 5)).toBeNull(); expect(changeText(12, 10, 5)).toBe("+20%"); });
});

describe("the daily email", () => {
  const t = Date.parse("2026-11-11T07:10:00Z"); // a Wednesday
  it("is due at the chosen local hour, once per day", () => {
    expect(emailDue(t, "UTC", 7, [], null)).toEqual({ due: true, key: "2026-11-11" });
    expect(emailDue(t, "UTC", 7, [], "2026-11-11").due).toBe(false);
    expect(emailDue(t, "UTC", 9, [], null).due).toBe(false);
  });
  it("skips a quiet weekday and follows the business's own zone", () => {
    expect(emailDue(t, "UTC", 7, [3], null).due).toBe(false);
    expect(emailDue(t, "Africa/Lagos", 8, [], null).due).toBe(true);
  });
  it("the text carries the ranked list, one link and a way to stop, never a vendor word", () => {
    const items = rankItems([raw("waiting_old", 4, 5000, 30)]);
    const m = emailText({ headline: "x", items, scope: "All 3 client accounts", allClear: null }, "https://x.test/app#today", "https://x.test/stop");
    expect(m.subject).toContain("4 people");
    expect(m.text).toContain("https://x.test/stop");
    expect(m.text).toMatch(/estimate/);
    expect(m.text).not.toMatch(/gohighlevel|highlevel|ghl|sub-account/i);
  });
});

import { MAX_TILES, overviewMerged } from "@/lib/analytics/today3-intel";
import { sample } from "@/app/app/views/td3/fixtures";

describe("Overview merged into Today > Numbers", () => {
  it("redirects only when Today and Numbers are on and the old page's own flag is off", () => {
    expect(overviewMerged({ td_module: true, td_numbers: true })).toBe(true);
    expect(overviewMerged({ td_module: true, td_numbers: true, ov_screen: true })).toBe(false);
    expect(overviewMerged({ td_module: true })).toBe(false);
    expect(overviewMerged({})).toBe(false);
  });
  it("shows at most six tiles, each with a formula one tap away", () => {
    const n = sample("numbers", {}, false) as { tiles: Array<{ formula: string }> };
    expect(n.tiles.length).toBeLessThanOrEqual(MAX_TILES);
    expect(n.tiles.every((t) => t.formula.length > 20)).toBe(true);
  });
  it("the sample screens carry no vendor words", () => {
    const all = JSON.stringify([sample("today", {}, false), sample("proof", {}, false), sample("numbers", {}, false), sample("list", { kind: "waiting_old" }, false)]);
    expect(all).not.toMatch(/gohighlevel|highlevel|\bghl\b|sub-account/i);
  });
});
