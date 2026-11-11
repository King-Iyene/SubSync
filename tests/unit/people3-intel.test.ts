import { describe, expect, it } from "vitest";
import {
  boardView, decodeCursor, encodeCursor, fairRank, headlineOf, idleOf, loadState, moves, normaliseSource, oneThing, parseWindow, quietHours, roleOf, risksOf, singlePoint, suggestNextLead, todayLines,
  MIN_DAYS, MIN_LEADS, type NextCandidate, type RankInput,
} from "@/lib/analytics/people3-intel";

// The pure rules behind the Team screens. Definitions: docs/METRICS.md "Team 3".
const person = (userId: string, bySource: RankInput["bySource"], o: Partial<RankInput> = {}): RankInput => ({ userId, name: userId, isAdmin: false, daysOfHistory: 30, bySource, ...o });
const mixed = (n: number, hit: number, source = "google") => ({ [source]: { n, hit } });

describe("fair ranking", () => {
  it("ranks on the gap to what the team does on the SAME sources, not on raw totals", () => {
    // Ann only gets easy leads (90% for everybody), Bo only gets hard ones (30% for everybody). Raw rates would put Ann far ahead; against the mix Bo is better.
    const out = fairRank([
      person("ann", { easy: { n: 40, hit: 34 } }), person("cy", { easy: { n: 40, hit: 38 } }),
      person("bo", { hard: { n: 40, hit: 20 } }), person("di", { hard: { n: 40, hit: 8 } }),
    ], { kind: "setters" });
    const r = new Map(out.map((o) => [o.userId, o]));
    expect(r.get("ann")!.vsMix).toBeCloseTo(-10, 5); // 85% against cy's 95%
    expect(r.get("cy")!.vsMix).toBeCloseTo(10, 5);
    expect(r.get("bo")!.vsMix).toBeCloseTo(30, 5); // 50% against di's 20%
    expect(r.get("di")!.vsMix).toBeCloseTo(-30, 5);
    expect([r.get("bo")!.rank, r.get("cy")!.rank, r.get("ann")!.rank, r.get("di")!.rank]).toEqual([1, 2, 3, 4]);
  });
  it("does not rank anyone under the minimum, and needs two people with enough data", () => {
    const out = fairRank([person("a", mixed(MIN_LEADS - 1, 10)), person("b", mixed(40, 20))], { kind: "setters" });
    expect(out.find((o) => o.userId === "a")!.enough).toBe(false);
    expect(out.every((o) => o.rank === null)).toBe(true);
    expect(out.find((o) => o.userId === "a")!.why).toMatch(/Not enough data/);
    expect(out.find((o) => o.userId === "b")!.why).toMatch(/at least two people/);
    const young = fairRank([person("a", mixed(40, 20), { daysOfHistory: MIN_DAYS - 1 }), person("b", mixed(40, 10))], { kind: "setters" });
    expect(young.find((o) => o.userId === "a")!.enough).toBe(false);
  });
  it("leaves ties unranked", () => {
    const out = fairRank([person("a", mixed(40, 20)), person("b", mixed(40, 20)), person("c", mixed(40, 8))], { kind: "setters" });
    expect(out.find((o) => o.userId === "a")!.rank).toBeNull();
    expect(out.find((o) => o.userId === "a")!.tied).toBe(true);
    expect(out.find((o) => o.userId === "c")!.rank).toBe(3);
  });
  it("leaves owners and admins out of the comparison unless asked", () => {
    const people = [person("boss", mixed(60, 58), { isAdmin: true }), person("a", mixed(40, 20)), person("b", mixed(40, 10))];
    const out = fairRank(people, { kind: "setters" });
    expect(out.find((o) => o.userId === "a")!.vsMix).toBeCloseTo(25, 5); // only b is the comparison
    expect(out.find((o) => o.userId === "boss")!.rank).toBeNull();
    const withBoss = fairRank(people, { kind: "setters", includeAdmins: true });
    expect(withBoss.find((o) => o.userId === "boss")!.rank).not.toBeNull();
  });
  it("says there is nothing fair to compare when nobody else answered those sources", () => {
    const out = fairRank([person("a", { only: { n: 40, hit: 20 } }), person("b", { other: { n: 40, hit: 20 } })], { kind: "closers" });
    expect(out.every((o) => o.vsMix === null && o.rank === null)).toBe(true);
    expect(out[0].why).toMatch(/nothing fair to compare/);
  });
  it("merges source labels", () => {
    expect(normaliseSource(" Facebook ")).toBe("facebook");
    expect(normaliseSource(null)).toBe("unknown");
  });
});

describe("the board shows the top half, or everyone, or only your own place", () => {
  const rows = ["a", "b", "c", "d"].map((userId, i) => ({ userId, rank: i + 1 as number | null }));
  it("top half by default", () => {
    const v = boardView(rows, { all: false, viewerId: "d", selfOnly: false });
    expect(v.shown.map((r) => r.userId)).toEqual(["a", "b"]);
    expect(v.hidden).toBe(2);
    expect(v.visibility).toBe("top_half");
    expect(v.you).toEqual({ rank: 4, of: 4 });
  });
  it("everyone when the owner asks", () => expect(boardView(rows, { all: true, viewerId: null, selfOnly: false }).shown).toHaveLength(4));
  it("a person who may see only themselves gets no names", () => {
    const v = boardView(rows, { all: true, viewerId: "c", selfOnly: true });
    expect(v.shown).toEqual([]);
    expect(v.you).toEqual({ rank: 3, of: 4 });
  });
});

describe("workload balance", () => {
  it("flags over and under loaded against the team's own middle", () => {
    const team = [10, 12, 11, 30, 3];
    expect(loadState(30, team).state).toBe("over");
    expect(loadState(30, team).why).toMatch(/times the team's middle/);
    expect(loadState(3, team).state).toBe("under");
    expect(loadState(11, team).state).toBe("normal");
  });
  it("is unknown for a small team or a tiny middle", () => {
    expect(loadState(20, [20, 1]).state).toBe("unknown");
    expect(loadState(9, [1, 2, 1, 9]).state).toBe("unknown");
  });
});

describe("idle", () => {
  const open = { zone: "UTC", businessHours: true, openHour: 9, closeHour: 17 };
  const t = (iso: string) => Date.parse(iso);
  it("counts only working hours when the account uses them", () => {
    // Friday 16:00 to Monday 11:00 is one hour on Friday and two on Monday.
    expect(quietHours(t("2026-11-06T16:00:00Z"), t("2026-11-09T11:00:00Z"), open)).toBe(3);
    expect(quietHours(t("2026-11-06T16:00:00Z"), t("2026-11-09T11:00:00Z"), { ...open, businessHours: false })).toBe(67);
  });
  it("is idle only with leads waiting, no recent touch, and not away", () => {
    const now = t("2026-11-09T15:00:00Z"), last = t("2026-11-09T09:30:00Z");
    expect(idleOf({ lastTouchMs: last, now, clock: open, waitingLeads: 4 })).toEqual({ hours: 5.5, waitingLeads: 4 });
    expect(idleOf({ lastTouchMs: last, now, clock: open, waitingLeads: 0 })).toBeNull();
    expect(idleOf({ lastTouchMs: now - 3_600_000, now, clock: open, waitingLeads: 4 })).toBeNull();
    expect(idleOf({ lastTouchMs: last, now, clock: open, waitingLeads: 4, awayUntilMs: now + 3_600_000 })).toBeNull();
    expect(idleOf({ lastTouchMs: null, now, clock: open, waitingLeads: 4 })).toBeNull(); // never judged without a recorded touch
    expect(idleOf({ lastTouchMs: last, now, clock: open, waitingLeads: 4, deleted: true })).toBeNull();
  });
});

describe("single point of failure and nobody active", () => {
  it("flags one person sending 80 percent or more, with at least 20 replies", () => {
    expect(singlePoint([{ userId: "a", name: "Ann", n: 40 }, { userId: "b", name: "Bo", n: 8 }])).toEqual({ userId: "a", name: "Ann", sharePct: 83 });
    expect(singlePoint([{ userId: "a", name: "Ann", n: 15 }, { userId: "b", name: "Bo", n: 1 }])).toBeNull();
    expect(singlePoint([{ userId: "a", name: "Ann", n: 20 }, { userId: "b", name: "Bo", n: 20 }])).toBeNull();
  });
  it("describes both risks in plain words", () => {
    const loc = { locationId: "L", name: "Acme Roofing" };
    expect(risksOf({ location: loc, people: 3, activePeople: 0, replies30: [] })[0].line).toMatch(/Nobody in Acme Roofing/);
    expect(risksOf({ location: loc, people: 3, activePeople: 2, replies30: [{ userId: "a", name: "Ann", n: 90 }, { userId: "b", name: "Bo", n: 10 }] })[0].kind).toBe("single_point");
  });
});

describe("who should get the next lead", () => {
  const c = (o: Partial<NextCandidate>): NextCandidate => ({ userId: "x", name: "X", waiting: 0, sourceN: 0, sourceMedianSec: null, overallN: 30, overallMedianSec: 600, away: false, deleted: false, isAdmin: false, ...o });
  it("picks the person with the fewest waiting leads, then the fastest on that source", () => {
    const r = suggestNextLead([c({ userId: "a", name: "Ann", waiting: 5 }), c({ userId: "b", name: "Bo", waiting: 1, sourceN: 12, sourceMedianSec: 300 }), c({ userId: "c", name: "Cy", waiting: 1, sourceN: 12, sourceMedianSec: 900 })], { source: "facebook" });
    expect(r.pick?.userId).toBe("b");
    expect(r.reasons[0]).toMatch(/1 lead waiting/);
    expect(r.reasons[1]).toMatch(/facebook leads fastest/);
  });
  it("skips people who are away, gone or owners, and hides itself without enough data", () => {
    expect(suggestNextLead([c({ userId: "a", away: true }), c({ userId: "b", deleted: true }), c({ userId: "o", isAdmin: true })], { source: null }).hidden).toBe("nobody_available");
    expect(suggestNextLead([c({ userId: "a", overallN: 3 }), c({ userId: "b", overallN: 9 })], { source: null }).hidden).toBe("not_enough_data");
    expect(suggestNextLead([c({ userId: "a", away: true }), c({ userId: "b", name: "Bo" })], { source: null }).pick?.userId).toBe("b");
  });
});

describe("coaching: one thing, from their own history", () => {
  const base = { firstReplies: 40, typicalReplySec: 300, inTime: 36, apptsSet: 8, held: 12, noShow: 4, weeks: 4 };
  it("names the metric that got worst against their own previous four weeks", () => {
    const m = moves({ ...base, typicalReplySec: 900, inTime: 24 }, base);
    expect(m.find((x) => x.metric === "reply_minutes")!.better).toBe(false);
    const one = oneThing(m);
    expect(one?.metric).toBe("reply_minutes"); // 3 times slower is a bigger slip than 90% to 60% in time
    expect(one?.line).toMatch(/faster/);
    expect(one?.evidence).toMatch(/minutes now/);
  });
  it("says nothing when nothing got clearly worse, or there is not enough history", () => {
    expect(oneThing(moves(base, base))).toBeNull();
    const thin = moves({ ...base, firstReplies: 4 }, base);
    expect(thin.find((x) => x.metric === "reply_minutes")!.better).toBeNull();
    expect(oneThing(thin)).toBeNull();
  });
});

describe("the Today lines", () => {
  const loc = { userId: "u1", name: "Priya", locationId: "L1", locationName: "Acme Roofing" };
  it("worst first, at most three, in plain words", () => {
    const lines = todayLines({
      waitingOld: [{ ...loc, count: 14 }], idle: [{ ...loc, userId: "u2", name: "Marcus", hours: 5.2, waiting: 4 }], over: [{ ...loc, userId: "u3", name: "Joy", items: 40, why: "" }],
      risks: [{ location: { locationId: "L2", name: "Bright Smiles" }, kind: "nobody_active", person: null, sharePct: null, line: "Nobody in Bright Smiles has a recorded reply in the last 14 days. No activity recorded in your CRM." }], newPeople: 2, selfId: null,
    });
    expect(lines).toHaveLength(3);
    expect(lines[0].text).toBe("Priya has 14 leads waiting more than 2 hours in Acme Roofing.");
    expect(lines[1].text).toMatch(/No activity recorded in your CRM for Marcus for 5 hours/);
    expect(lines[2].kind).toBe("nobody_active");
  });
  it("speaks to a person about themselves", () => {
    const lines = todayLines({ waitingOld: [{ ...loc, count: 3 }], idle: [], over: [], risks: [], newPeople: 0, selfId: "u1" });
    expect(lines[0].text).toBe("You have 3 leads waiting more than 2 hours.");
  });
});

describe("small rules", () => {
  it("reads the CRM role record without guessing", () => {
    expect(roleOf("agency", "admin")).toBe("agency_admin");
    expect(roleOf("agency", "user")).toBe("agency_staff");
    expect(roleOf("account", "admin")).toBe("account_admin");
    expect(roleOf("location", "user")).toBe("account_user");
    expect(roleOf(null, "admin")).toBe("unknown");
    expect(roleOf("agency", null)).toBe("unknown");
  });
  it("round-trips cursors and rejects bad ones", () => {
    expect(decodeCursor(encodeCursor({ v: 4.5, id: "u1|L1" }))).toEqual({ v: 4.5, id: "u1|L1" });
    expect(decodeCursor(encodeCursor({ v: "ann", id: "u2" }))).toEqual({ v: "ann", id: "u2" });
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify([{ a: 1 }, "x"])).toString("base64url"))).toBeNull();
    expect(decodeCursor("a".repeat(500))).toBeNull();
  });
  it("defaults to 28 days and refuses over a year", () => {
    const now = Date.parse("2026-11-11T12:00:00Z");
    expect(parseWindow(null, null, now).days).toBe(28);
    expect(parseWindow("2020-01-01", "2026-11-11", now).days).toBe(366);
    expect(parseWindow("2026-11-10", "2026-11-01", now).problem).toMatch(/last 28 days/);
  });
  it("writes a headline that never claims more than the numbers", () => {
    expect(headlineOf({ name: "Sam", answered: 0, typicalReplySec: null, inTimePct: null, apptsSet: 0, waiting: 0, enough: false, days: 28 })).toMatch(/not enough recorded activity/);
    expect(headlineOf({ name: "Sam", answered: 25, typicalReplySec: 300, inTimePct: 0.8, apptsSet: 2, waiting: 3, enough: true, days: 28 })).toBe(
      "Sam answered 25 new leads first, typically within 5 minutes, 80% in time, set 2 appointments in the last 28 days; 3 leads are waiting for a reply now.",
    );
  });
});
