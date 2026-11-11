import { describe, expect, it } from "vitest";
import { delta, levelOf, parseWindow, rate, reasonsOf, receiptLines, todayOf, type AccountSignals } from "@/lib/analytics/clients3-intel";
import type { Cl3Account } from "@/lib/analytics/clients3-types";

const base = (o: Partial<AccountSignals> = {}): AccountSignals => ({
  newLeads: delta(20, 20), waiting: 0, waitingOld: 0, unmarked: 0, noshows: 0, staleDeals: 0, openDeals: 0, noOwner: rate(0, 100), noPhone: rate(0, 100), staffQuiet: 0, syncAgeHours: 1, needsPermission: [], hasAnyData: true, ...o,
});

describe("clients 3 rules", () => {
  it("a drop counts only with enough earlier leads", () => {
    expect(delta(2, 5).enough).toBe(false);
    expect(delta(2, 5).change).toBeNull();
    expect(delta(6, 12).change).toBe(-0.5);
    expect(reasonsOf(base({ newLeads: delta(2, 5) })).length).toBe(0);
    expect(reasonsOf(base({ newLeads: delta(6, 12) })).map((r) => r.reason)).toContain("leads_down");
  });
  it("shares need a minimum number of contacts", () => {
    expect(rate(10, 10).value).toBeNull();
    expect(reasonsOf(base({ noOwner: rate(5, 10) })).length).toBe(0);
    expect(reasonsOf(base({ noOwner: rate(50, 100) })).map((r) => r.reason)).toEqual(["no_owner"]);
  });
  it("levels: act for old waiting replies, watch for small flags, ok when clean, unknown without data", () => {
    const a = base({ waiting: 6, waitingOld: 6 });
    expect(levelOf(a, reasonsOf(a))).toBe("act");
    const w = base({ unmarked: 4 });
    expect(levelOf(w, reasonsOf(w))).toBe("watch");
    const ok = base();
    expect(levelOf(ok, reasonsOf(ok))).toBe("ok");
    const u = base({ hasAnyData: false, syncAgeHours: null });
    expect(levelOf(u, reasonsOf(u))).toBe("unknown");
    const p = base({ needsPermission: ["calendar"] });
    expect(levelOf(p, reasonsOf(p))).toBe("act");
  });
  it("what to do today names the biggest problem and the account when there is one", () => {
    const acct = (name: string, id: string, over: Partial<AccountSignals>) => {
      const s = base(over);
      const reasons = reasonsOf(s);
      return { locationId: id, name, level: levelOf(s, reasons), reasons } as unknown as Cl3Account;
    };
    const t = todayOf([acct("Acme", "a1", { waiting: 3, waitingOld: 3 }), acct("Zed", "z1", {})]);
    expect(t.button?.reason).toBe("waiting_old");
    expect(t.button?.locationId).toBe("a1");
    expect(todayOf([]).button).toBeNull();
  });
  it("windows: default 30 days, bad order falls back, capped at a year", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(parseWindow(null, null, now).days).toBe(30);
    expect(parseWindow("2026-11-09", "2026-11-01", now).problem).not.toBeNull();
    expect(parseWindow("2020-01-01", "2026-11-01", now).days).toBe(366);
  });
  it("the receipt reads in plain words", () => {
    const l = receiptLines({ cameIn: 1, cameInPrev: 3, answered: 1, stillWaiting: 0, medianReplyMinutes: 12, booked: 2, showed: 1, noshow: 1, won: 1, wonValue: 1500 });
    expect(l[0]).toBe("1 new enquiry came in (3 the week before).");
    expect(l.join(" ")).not.toMatch(/GoHighLevel|HighLevel|GHL|sub-account|location/i);
  });
});
