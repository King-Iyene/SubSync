import { describe, expect, it } from "vitest";
import {
  autoVsHuman, classifySource, firstTouches, hasNoSource, isNeverAnswered, judge, membersOf, peopleProgress, progressToward, rankPeople, sourceLabel, summarise, topSourceNames, unknownSource,
  type Msg, type TouchRow,
} from "@/lib/analytics/speed-intel";
import { accountsPart, leadOut, membersPart, peoplePart, sourcePart, summaryPart, type LoadedRow, type Lookups } from "@/lib/analytics/speed-parts";
import { parseWindow } from "@/lib/analytics/speed-window";
import { autoLine, autoVsHumanLines, copyLine, leadStatus, measuringSentence, personProgressText, unknownSourceAction } from "@/lib/design/speed-text";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const MIN = 60_000;
const TARGET = 15;

type Spec = { id: string; loc?: string; ageMin: number; replyMin?: number | null; user?: string | null; source?: string | null; tags?: string[]; assigned?: string | null; autoSec?: number | null; humanMin?: number | null; detailed?: boolean; name?: string };
const row = (s: Spec): LoadedRow => {
  const leadAt = NOW - s.ageMin * MIN;
  const reply = s.replyMin ?? null;
  return {
    locationId: s.loc ?? "A", contactId: s.id, leadAt, touchAt: reply === null ? null : leadAt + reply * MIN, userId: reply === null ? null : (s.user === undefined ? "u1" : s.user),
    source: s.source ?? null, tags: s.tags ?? [], assigned: s.assigned !== undefined && s.assigned !== null, assignedTo: s.assigned ?? null, name: s.name ?? `Lead ${s.id}`,
    detailed: s.detailed ?? true, autoAt: s.autoSec == null ? null : leadAt + s.autoSec * 1000, humanAt: s.humanMin == null ? (reply === null ? null : leadAt + reply * MIN) : leadAt + s.humanMin * MIN,
  };
};

const lk = (over: Partial<Lookups> = {}): Lookups => ({
  now: NOW, targetMinutes: TARGET,
  locationNames: new Map([["A", "Blue Door Realty"], ["B", "Bright Smile Dental"], ["C", "Harbor Law"]]),
  usersAccess: new Map([["A", "ok"], ["B", "ok"], ["C", "needs_permission"]]),
  team: new Map([["u1", { name: "dana brooks", photoUrl: "https://cdn.example.org/dana.png" }], ["u2", { name: "Sam Lee" }]]),
  ...over,
});

// 30 leads over two accounts: some answered in time, some late, some waiting, some inside their window, a few missed (older than three days).
function fixture(): LoadedRow[] {
  const rows: LoadedRow[] = [];
  const sources = ["Facebook Lead Form", "Zillow Premier Agent", "", null, "referral", "Instagram DM", "Website form"];
  for (let i = 0; i < 30; i++) {
    const loc = i % 2 === 0 ? "A" : "B";
    const kind = i % 6; // 0 in time, 1 in time, 2 late, 3 waiting, 4 missed (4 days), 5 too new to judge
    const spec: Spec = { id: `c${i}`, loc, ageMin: 120 + i * 30, source: sources[i % sources.length], assigned: i % 4 === 0 ? null : "u1", autoSec: i % 3 === 0 ? 8 : null };
    if (kind === 0 || kind === 1) { spec.replyMin = 3 + kind * 4; spec.user = i % 5 === 0 ? "u2" : "u1"; }
    else if (kind === 2) { spec.replyMin = 90; spec.user = "u2"; }
    else if (kind === 3) spec.ageMin = 200 + i;
    else if (kind === 4) spec.ageMin = 4 * 24 * 60 + i * 10;
    else spec.ageMin = 5;
    rows.push(row(spec));
  }
  return rows;
}

describe("one judgement behind every figure and every list (KF-6)", () => {
  const rows = fixture();
  const s = summarise(rows, TARGET, NOW);
  it("the figures add up", () => {
    expect(s.leads).toBe(s.withinTarget + s.answeredLate + s.stillWaiting);
    expect(s.answered).toBe(s.withinTarget + s.answeredLate);
    expect(rows.length - s.leads, "five leads are still inside their window").toBe(5);
  });
  it("each list has exactly as many leads as its figure", () => {
    expect(membersOf(rows, TARGET, NOW, (_r, st) => st === "within").count).toBe(s.withinTarget);
    expect(membersOf(rows, TARGET, NOW, (_r, st) => st === "late").count).toBe(s.answeredLate);
    expect(membersOf(rows, TARGET, NOW, (_r, st) => st === "waiting").count).toBe(s.stillWaiting);
    expect(membersOf(rows, TARGET, NOW, () => true).count).toBe(s.leads);
  });
  it("a lead still inside its window is in no list", () => {
    const young = row({ id: "young", ageMin: 5 });
    expect(judge(young, TARGET, NOW)).toBeNull();
    expect(membersOf([young], TARGET, NOW, () => true).count).toBe(0);
  });
  it("waiting leads come longest wait first, and a cap says how many there really are", () => {
    const many = Array.from({ length: 130 }, (_, i) => row({ id: `w${i}`, ageMin: 30 + i }));
    const m = membersPart(many, lk(), (_r, st) => st === "waiting", 100);
    expect(m.count).toBe(130);
    expect(m.shown).toBe(100);
    expect(m.rows[0].minutes).toBeGreaterThan(m.rows[99].minutes);
    expect(m.rows[0].minutes).toBe(30 + 129);
  });
});

describe("summary card", () => {
  const rows = fixture();
  const p = summaryPart(rows, lk());
  it("every tile's list equals its figure", () => {
    expect(p.lists.within.count).toBe(p.summary.withinTarget);
    expect(p.lists.late.count).toBe(p.summary.answeredLate);
    expect(p.lists.waiting.count).toBe(p.summary.stillWaiting);
    expect(p.lists.within.rows).toHaveLength(p.lists.within.shown);
  });
  it("the list of leads with only an automatic message is the same set the figure counts", () => {
    expect(p.lists.onlyAuto.count).toBe(p.autoVsHuman.onlyAutoPastTarget);
    expect(p.lists.onlyAuto.rows.every((l) => l.autoSeconds !== null && l.personSeconds === null)).toBe(true);
  });
  it("progress toward the typical reply names what is missing (N22)", () => {
    const few = summaryPart(rows.slice(0, 2).map((r) => ({ ...r })), lk());
    expect(few.typical.met).toBe(false);
    expect(few.typical.text).toMatch(/of 5 repl/);
    expect(progressToward(1, 5, "replies").text).toBe("1 of 5 replies so far. Shows once there are 5.");
    expect(progressToward(5, 5, "replies")).toMatchObject({ met: true, text: "5 replies" });
  });
});

describe("source card", () => {
  const rows = fixture();
  const p = sourcePart(rows, lk());
  it("a source row's list equals its own count", () => {
    for (const r of p.rows) expect(r.members.count, r.label).toBe(r.leads);
  });
  it("the leads with no source have a list equal to the count", () => {
    expect(p.unknown.members.count).toBe(p.unknown.n);
    expect(p.unknown.total).toBe(p.total);
    expect(p.unknown.members.rows.every((l) => l.source === "No source recorded")).toBe(true);
  });
  it("Facebook and Instagram lead forms are their own row, with the raw source names under it", () => {
    const meta = p.rows.find((r) => r.cls === "meta");
    expect(meta?.label).toBe("Facebook and Instagram lead forms");
    expect(meta?.names[0].label).toBe("Facebook Lead Form");
  });
});

describe("recognising where a lead came from (N47)", () => {
  it("reads the source field, then a lead-form tag when the field is empty", () => {
    expect(classifySource("Facebook Lead Form")).toBe("meta");
    expect(classifySource("Instagram Lead Ad")).toBe("meta");
    expect(classifySource("Instagram DM")).toBe("social");
    expect(classifySource("", ["fb lead"])).toBe("meta");
    expect(classifySource(null, ["facebook lead form"])).toBe("meta");
    expect(classifySource("", ["Instagram Ad"])).toBe("meta");
    expect(classifySource("", ["newsletter", "vip"])).toBe("other");
    expect(classifySource("Zillow", ["facebook lead"]), "a tag never overrides a named source").toBe("portal");
    expect(classifySource("Referral", ["facebook lead"])).toBe("other");
  });
  it("a source is shown as typed, in proper case when it was all lower case, and blank reads No source recorded", () => {
    expect(sourceLabel("kd squares website subscription form")).toBe("Kd Squares Website Subscription Form");
    expect(sourceLabel("Facebook Lead Form")).toBe("Facebook Lead Form");
    expect(sourceLabel("  ")).toBe("No source recorded");
    expect(sourceLabel(null)).toBe("No source recorded");
    expect(hasNoSource({ source: "  " })).toBe(true);
    expect(hasNoSource({ source: "Referral" })).toBe(false);
  });
  it("the most common raw names are listed under their row", () => {
    const rows = ["Referral", "Referral", "Walk-in", "Referral", "walk-in"].map((s, i) => row({ id: `n${i}`, ageMin: 300, source: s }));
    expect(topSourceNames(rows, 2)).toEqual([{ label: "Referral", n: 3 }, { label: "Walk-in", n: 2 }]);
  });
  it("mostly unknown turns into an action, and only with enough leads", () => {
    const mostly = [...Array.from({ length: 17 }, (_, i) => row({ id: `u${i}`, ageMin: 300 })), row({ id: "k1", ageMin: 300, source: "Referral" }), row({ id: "k2", ageMin: 300, source: "Website" })];
    const u = unknownSource(mostly);
    expect(u).toMatchObject({ n: 17, total: 19, actionable: true });
    expect(unknownSourceAction(u).title).toBe("17 of 19 new leads (89%) have no source recorded.");
    expect(unknownSource(mostly.slice(0, 3)).actionable, "three leads are too few to nag about").toBe(false);
    expect(unknownSource(Array.from({ length: 10 }, (_, i) => row({ id: `s${i}`, ageMin: 300, source: i < 2 ? "" : "Referral" }))).actionable).toBe(false);
    expect(unknownSource([]).share).toBeNull();
  });
});

describe("the automatic first message apart from the person's reply (N78)", () => {
  const t0 = NOW - 3_600_000;
  const m = (offsetSec: number, over: Partial<Msg> = {}): Msg => ({ at: t0 + offsetSec * 1000, direction: "outbound", userId: null, source: "workflow", type: "TYPE_SMS", ...over });
  it("keeps the robot's first message and the person's first reply apart", () => {
    const f = firstTouches([m(10), m(3 * 3600, { userId: "u7", source: "app" })], t0);
    expect(f.autoAt).toBe(t0 + 10_000);
    expect(f.humanAt).toBe(t0 + 3 * 3600_000);
    expect(f.humanUserId).toBe("u7");
  });
  it("a person only, a robot only, nothing, and messages before the lead are ignored", () => {
    expect(firstTouches([m(5, { userId: "u1", source: "app" })], t0)).toEqual({ autoAt: null, humanAt: t0 + 5000, humanUserId: "u1" });
    expect(firstTouches([m(5), m(9)], t0)).toEqual({ autoAt: t0 + 5000, humanAt: null, humanUserId: null });
    expect(firstTouches([], t0)).toEqual({ autoAt: null, humanAt: null, humanUserId: null });
    expect(firstTouches([m(-60)], t0).autoAt, "a message from before the lead arrived").toBeNull();
    expect(firstTouches([{ at: t0 + 1000, direction: "inbound", userId: null, source: null, type: "SMS" }], t0).autoAt, "inbound is never a touch").toBeNull();
  });
  it("a call placed by a person is the person's touch; a call with nobody attached is automatic", () => {
    expect(firstTouches([m(20, { type: "TYPE_CALL", userId: "u1", source: null })], t0).humanAt).toBe(t0 + 20_000);
    expect(firstTouches([m(20, { type: "TYPE_CALL", userId: null, source: null })], t0)).toMatchObject({ autoAt: t0 + 20_000, humanAt: null });
  });
  it("counts leads that got an automatic message first, and those with nothing since", () => {
    const rows: TouchRow[] = [
      { ...row({ id: "a", ageMin: 400, autoSec: 8, replyMin: 180 }) }, { ...row({ id: "b", ageMin: 400, autoSec: 9 }) }, { ...row({ id: "c", ageMin: 400, replyMin: 5 }) },
      { ...row({ id: "d", ageMin: 400 }) }, { ...row({ id: "old", ageMin: 400, autoSec: 5, replyMin: 4, detailed: false }) },
    ];
    const a = autoVsHuman(rows, TARGET, NOW);
    expect(a).toMatchObject({ read: 4, notRead: 1, autoSent: 2, alsoPerson: 1, onlyAutoPastTarget: 1, personOnly: 1, autoMedianSeconds: null });
  });
  it("says what it knows in plain words, and says nothing it cannot back", () => {
    const base = { read: 0, notRead: 0, autoSent: 0, alsoPerson: 0, onlyAutoPastTarget: 0, personOnly: 0, autoMedianSeconds: null, personMedianSeconds: null };
    expect(autoVsHumanLines(base)).toEqual([]);
    expect(autoVsHumanLines({ ...base, notRead: 12 })[0]).toMatch(/Not recorded yet for these 12 leads/);
    expect(autoVsHumanLines({ ...base, read: 20 })[0]).toMatch(/No automatic first message was seen/);
    const l = autoVsHumanLines({ ...base, read: 20, autoSent: 12, alsoPerson: 5, onlyAutoPastTarget: 7, autoMedianSeconds: 10, personMedianSeconds: 10_800 });
    expect(l[0]).toBe("12 of 20 leads got an automatic message first, typically after 10 sec.");
    expect(l[1]).toBe("5 of them were later answered by a person (a person's typical first reply: 3 h). 7 still have only the automatic message, past your target.");
  });
  it("a lead's automatic message is shown only when it was recorded", () => {
    expect(autoLine({ autoSeconds: 10, detailed: true })).toBe("Automatic message after 10 sec");
    expect(autoLine({ autoSeconds: 10, detailed: false })).toBeNull();
    expect(autoLine({ autoSeconds: null, detailed: true })).toBeNull();
  });
});

describe("people (N21, S3-a, N22)", () => {
  const rows = [
    ...[3, 4, 5, 6].map((n, i) => row({ id: `d${i}`, ageMin: 400, replyMin: n, user: "u1" })),
    ...[20, 30, 40].map((n, i) => row({ id: `s${i}`, ageMin: 400, replyMin: n, user: "u2" })),
    ...[2, 2].map((n, i) => row({ id: `g${i}`, ageMin: 400, replyMin: n, user: "uGONE-9f3k" })),
    row({ id: "x", loc: "C", ageMin: 400, replyMin: 2, user: "uBLOCKED-zw01" }),
  ];
  const p = peoplePart(rows, lk());
  it("ranks people with enough replies, then lists the rest with their progress", () => {
    expect(p.map((x) => [x.userId, x.ranked])).toEqual([["u1", true], ["u2", true], ["uGONE-9f3k", false], ["uBLOCKED-zw01", false]]);
    expect(p[0].medianSeconds).toBe(4 * 60);
    expect(p[2].progress.text).toMatch(/^2 of 3 replies so far/);
    expect(personProgressText(1, 3)).toBe("1 of 3 replies so far");
  });
  it("each person's list is the leads they answered, as many as their count", () => {
    for (const x of p) expect(x.members.count, x.label).toBe(x.replies);
    expect(peopleProgress(rows).filter((x) => x.ranked).map((x) => x.userId)).toEqual(rankPeople(rows).map((x) => x.userId));
  });
  it("names come from the team list in proper case with their picture; the rest say why, never the id", () => {
    expect(p[0]).toMatchObject({ label: "Dana Brooks", state: "named", photoUrl: "https://cdn.example.org/dana.png", initials: "DB" });
    expect(p[1].label).toBe("Sam Lee");
    expect(p[2]).toMatchObject({ label: "Former team member", state: "former" });
    expect(p[3]).toMatchObject({ label: "Needs permission: reconnect", state: "needs_permission" });
    for (const x of p.slice(2)) expect(x.label).not.toMatch(/GONE|BLOCKED|9f3k|zw01/);
  });
  it("a lead never carries the raw user id to the screen", () => {
    const r = row({ id: "z", ageMin: 400, replyMin: 5, user: "uSECRET-77aa", assigned: "uOWNER-55bb" });
    const out = JSON.stringify(leadOut(r, "within", lk()));
    expect(out).not.toMatch(/SECRET|77aa|OWNER|55bb/);
    expect(JSON.parse(out).repliedBy.label).toBe("Former team member");
    expect(JSON.parse(out).owner.label).toBe("Former team member");
  });
});

describe("account card", () => {
  const rows = fixture();
  const accounts = [{ locationId: "A", name: "Blue Door Realty", access: "ok" }, { locationId: "B", name: "Bright Smile Dental", access: "ok" }, { locationId: "C", name: "Harbor Law", access: "needs_permission" }];
  const a = accountsPart(rows, lk(), accounts);
  it("each account's list equals its leads, and the accounts add up to the whole", () => {
    for (const x of a.filter((y) => y.access === "ok")) expect(x.members.count, x.name).toBe(x.leads);
    expect(a.reduce((s, x) => s + x.leads, 0)).toBe(summarise(rows, TARGET, NOW).leads);
  });
  it("an account that needs permission is kept so the screen can say so", () => {
    expect(a.some((x) => x.locationId === "C" && x.access === "needs_permission")).toBe(true);
  });
});

describe("a lead on the screen", () => {
  it("is missed, not waiting, after three days, and its name is the one the lookup built", () => {
    expect(isNeverAnswered(4 * 24 * 60)).toBe(true);
    const l = leadOut(row({ id: "m", ageMin: 4 * 24 * 60, name: "The Real Estate Blueprint" }), "waiting", lk());
    expect(l).toMatchObject({ neverAnswered: true, name: "The Real Estate Blueprint", locationName: "Blue Door Realty", unassigned: true, source: "No source recorded" });
    expect(leadOut(row({ id: "w", ageMin: 60 }), "waiting", lk()).neverAnswered).toBe(false);
  });
  it("says what happened in words", () => {
    expect(leadStatus({ status: "within", minutes: 3, neverAnswered: false })).toEqual({ tone: "good", text: "replied in 3 min" });
    expect(leadStatus({ status: "late", minutes: 190, neverAnswered: false })).toEqual({ tone: "warn", text: "replied after 3 h 10 min" });
    expect(leadStatus({ status: "waiting", minutes: 60 * 26, neverAnswered: false })).toEqual({ tone: "bad", text: "waiting 1 day" });
    expect(leadStatus({ status: "waiting", minutes: 13 * 24 * 60, neverAnswered: true }).text).toBe("never answered (13 days)");
    expect(copyLine({ name: "Abbi", locationName: "Blue Door", source: "Referral", status: "waiting", minutes: 120, neverAnswered: false }, true)).toBe("Abbi, Blue Door, Referral, waiting 2 hours");
    expect(copyLine({ name: "Abbi", locationName: "Blue Door", source: "Referral", status: "waiting", minutes: 120, neverAnswered: false }, false)).toBe("Abbi, Referral, waiting 2 hours");
  });
});

describe("the sentence about how this is measured (N78)", () => {
  it("says SubSync measures and does not send, with the target and the automatic-message option", () => {
    const s = measuringSentence({ targetMinutes: 15, countAutomated: false, businessHours: false });
    expect(s).toContain("does not send any replies itself");
    expect(s).toContain("15 minutes");
    expect(s).toContain("Automatic messages do not count as a reply");
    expect(measuringSentence({ targetMinutes: 1, countAutomated: true, businessHours: true })).toMatch(/1 minute\. Automatic messages count as a reply, and leads that arrive out of hours/);
  });
  it("uses plain words only", () => {
    const all = [measuringSentence({ targetMinutes: 15, countAutomated: false, businessHours: true }), unknownSourceAction({ n: 3, total: 4, share: 0.75 }).body, ...autoVsHumanLines({ read: 9, notRead: 1, autoSent: 5, alsoPerson: 2, onlyAutoPastTarget: 3, personOnly: 1, autoMedianSeconds: 9, personMedianSeconds: 200 })].join(" ");
    expect(all).not.toMatch(/\bSLA\b|sub-?account|gohighlevel|highlevel|\bghl\b|\blocation\b/i);
  });
});

describe("the window a card asks for (KF-4)", () => {
  it("accepts a real range and ends it at the start of the next day", () => {
    const w = parseWindow("2026-10-03", "2026-11-01", NOW);
    expect(w.ok).toBe(true);
    if (w.ok) { expect(w.win.days).toBe(30); expect(w.win.fromMs).toBe(Date.parse("2026-10-03T00:00:00Z")); expect(w.win.toMs).toBe(Date.parse("2026-11-02T00:00:00Z")); }
  });
  it("refuses a missing, backwards, future, impossible or too long range with a plain reason", () => {
    expect(parseWindow(null, "2026-11-01", NOW)).toMatchObject({ ok: false, error: "Pick a start and an end date." });
    expect(parseWindow("2026-11-01", "2026-10-01", NOW)).toMatchObject({ ok: false, error: "The end date is before the start date." });
    expect(parseWindow("2026-10-01", "2026-11-02", NOW)).toMatchObject({ ok: false, error: "The end date is in the future." });
    expect(parseWindow("2026-02-30", "2026-03-01", NOW).ok).toBe(false);
    expect(parseWindow("2025-01-01", "2026-11-01", NOW)).toMatchObject({ ok: false, error: "A range can be at most 366 days." });
    expect(parseWindow("2026-10-01; drop table", "2026-11-01", NOW).ok).toBe(false);
    expect(parseWindow(["2026-10-01"], "2026-11-01", NOW).ok).toBe(false);
  });
});
