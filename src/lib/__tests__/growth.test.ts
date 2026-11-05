import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boundsOf, buildGrowth, changesOf, classify, cleanDomain, dailySeries, goalStatus, isRoleAddress, normaliseEmail, signalsOf, sourceMix, weekBadge,
  type GrowthContact,
} from "../analytics/growth.ts";

const DAY = 86_400_000, HOUR = 3_600_000;
// Thursday 5 November 2026, 20:00 UTC = 3 pm in New York (EST, UTC-5).
const NOW = Date.UTC(2026, 10, 5, 20, 0, 0);
const NY = "America/New_York";
const c = (id: string, email: string | null, over: Partial<GrowthContact> = {}): GrowthContact => ({ id, locationId: "aaa", name: `Person ${id}`, email, source: "Facebook Ads", at: NOW - HOUR, ...over });
const rules = { excludeRoleAddresses: true, internalDomains: ["myagency.com"] };

test("one person, one form of the email: lower case, trimmed, +tag gone, Gmail dots gone", () => {
  assert.equal(normaliseEmail("  Ann.Lee+promo@Gmail.com "), "annlee@gmail.com");
  assert.equal(normaliseEmail("a.n.n@googlemail.com"), "ann@gmail.com");
  assert.equal(normaliseEmail("ann.lee@outlook.com"), "ann.lee@outlook.com", "dots matter outside Gmail");
  assert.equal(normaliseEmail("ann+x@outlook.com"), "ann@outlook.com");
  for (const bad of ["", "   ", null, undefined, "nope", "@x.com", "a@"]) assert.equal(normaliseEmail(bad as string | null), null);
});

test("shared mailboxes are recognised, people are not", () => {
  assert.equal(isRoleAddress("INFO@acme.com"), true);
  assert.equal(isRoleAddress("sales@acme.com"), true);
  assert.equal(isRoleAddress("no-reply@acme.com"), true);
  assert.equal(isRoleAddress("ann@acme.com"), false);
  assert.equal(cleanDomain(" @MyAgency.com "), "myagency.com");
  assert.equal(cleanDomain("not a domain"), null);
});

test("who counts: copies, test records, staff, shared mailboxes and no email are left out, with the reason", () => {
  const list = [
    c("1", "ann@gmail.com", { at: NOW - 3 * HOUR }),
    c("2", "A.nn+ad@gmail.com", { at: NOW - 2 * HOUR }),      // the same person: a copy
    c("3", "bob@outlook.com"),
    c("4", "test@acme.com", { name: "Test" }),                // test record
    c("5", "x@mailinator.com"),                               // junk domain
    c("6", "zed@myagency.com"),                               // staff
    c("7", "info@bakery.com"),                                // shared mailbox
    c("8", null),                                             // no email
    c("9", "   "),                                            // no email
    c("10", "not-an-email"),                                  // invalid: counted as junk
    c("11", "ann@gmail.com", { locationId: "bbb" }),          // the same person at ANOTHER client is that client's own lead
  ];
  const v = classify(list, rules);
  assert.deepEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"].map((id) => v.get(id)),
    ["counted", "duplicate", "counted", "junk", "junk", "staff", "role", "no_email", "no_email", "junk", "counted"]);
  assert.equal(classify([c("7", "info@bakery.com")], { ...rules, excludeRoleAddresses: false }).get("7"), "counted", "role addresses count when the setting says so");
});

test("the earliest record of a person is the lead, whatever order the rows come in", () => {
  const a = c("late", "ann@gmail.com", { at: NOW - HOUR }), b = c("early", "ann@gmail.com", { at: NOW - 5 * HOUR });
  assert.equal(classify([a, b], rules).get("early"), "counted");
  assert.equal(classify([b, a], rules).get("late"), "duplicate");
});

test("periods start at local midnight, Monday, and the first of the month, in the client's own zone", () => {
  const b = boundsOf(NOW, NY);
  assert.equal(new Date(b.todayStart).toISOString(), "2026-11-05T05:00:00.000Z");
  assert.equal(new Date(b.weekStart).toISOString(), "2026-11-02T05:00:00.000Z"); // Monday 2 Nov 00:00 EST (clocks went back on 1 Nov)
  assert.equal(new Date(b.monthStart).toISOString(), "2026-11-01T04:00:00.000Z"); // 1 Nov 00:00 EDT, before the clocks changed at 2 am
  assert.equal(b.hour, 15);
  assert.equal(b.daysInMonth, 30);
  assert.equal(new Date(boundsOf(NOW, "UTC").todayStart).toISOString(), "2026-11-05T00:00:00.000Z");
});

test("today, this week and this month are compared with the same stretch of the period before, never with a whole one", () => {
  const b = boundsOf(NOW, NY);
  const at = (ms: number) => ({ at: ms, zone: NY });
  const leads = [
    at(b.todayStart + HOUR), at(b.todayStart + 2 * HOUR),                       // today: 2
    at(b.yesterdayStart + HOUR),                                                // yesterday, before this time: 1
    at(b.yesterdayStart + 23 * HOUR),                                           // yesterday, after this time of day: not compared
  ];
  const ch = changesOf(leads, NOW);
  assert.equal(ch.today.count, 2);
  assert.equal(ch.today.previous, 1);
  assert.equal(ch.today.pct, null, "one earlier lead is too few for a percentage");
  assert.match(ch.today.note ?? "", /too few/);
  assert.equal(ch.all.count, 4);
  assert.equal(ch.all.previous, null);
  const many = Array.from({ length: 10 }, (_, k) => at(b.lastWeekStart + k * HOUR)).concat(Array.from({ length: 15 }, (_, k) => at(b.weekStart + k * HOUR)));
  const w = changesOf(many, NOW).week;
  assert.deepEqual([w.count, w.previous, w.pct, w.direction], [15, 10, 50, "up"]);
  assert.equal(changesOf(Array.from({ length: 5 }, (_, k) => at(b.weekStart + k * HOUR)).concat(Array.from({ length: 10 }, (_, k) => at(b.lastWeekStart + k * HOUR))), NOW).week.direction, "down");
});

test("the daily line: 30 days ending today, today is partial, the 7 day average uses complete days only", () => {
  const b = boundsOf(NOW, NY);
  const leads = [];
  for (let d = 1; d <= 29; d++) for (let k = 0; k < 2; k++) leads.push({ at: b.todayStart - d * DAY + (k + 1) * HOUR, zone: NY });
  leads.push({ at: b.todayStart + HOUR, zone: NY });
  const s = dailySeries(leads, NOW, NY);
  assert.equal(s.length, 30);
  assert.equal(s[29].partial, true);
  assert.equal(s[29].count, 1);
  assert.equal(s[29].avg7, null, "no average for the unfinished day");
  assert.equal(s[28].count, 2);
  assert.equal(s[28].avg7, 2);
  assert.equal(s[3].avg7, null, "an average needs 7 days behind it");
  assert.deepEqual(weekBadge(s), { pct: 0, direction: "same" });
  const drop = dailySeries(leads.filter((l) => l.at > b.todayStart - 7 * DAY ? false : true), NOW, NY);
  assert.equal(weekBadge(drop)?.direction, "down");
});

test("goal: reached, on track, behind, and 'not enough data' while the month is young", () => {
  const b = boundsOf(NOW, "UTC"); // 5 Nov, 20:00 UTC: 4.83 days of a 30-day month
  const young = goalStatus(60, 20, b, NOW, b.monthStart);
  assert.equal(young.state, "not_enough");
  assert.equal(young.forecast, null);
  const later = Date.UTC(2026, 10, 15, 12, 0, 0), b2 = boundsOf(later, "UTC");
  const on = goalStatus(60, 30, b2, later, b2.monthStart);  // 14.5 days elapsed: pace 62
  assert.equal(on.state, "on_track");
  assert.equal(on.forecast, 62);
  assert.equal(goalStatus(60, 20, b2, later, b2.monthStart).state, "behind");
  assert.equal(goalStatus(60, 60, b2, later, b2.monthStart).state, "reached");
  assert.equal(goalStatus(60, 12, b2, later, b2.monthStart).share, 0.2);
});

test("sources: share, best and worst against the 30 days before, quiet when thin", () => {
  const mk = (source: string | null, n: number, daysAgo: number) => Array.from({ length: n }, () => ({ at: NOW - daysAgo * DAY, source }));
  const leads = [...mk("Facebook Ads", 20, 3), ...mk("Facebook Ads", 8, 40), ...mk("Walk-in", 4, 3), ...mk("Walk-in", 12, 40), ...mk("Referral", 6, 5), ...mk("Referral", 6, 45)];
  const m = sourceMix(leads, NOW);
  assert.equal(m.total, 30);
  assert.equal(m.rows[0].source, "Facebook Ads");
  assert.equal(Math.round(m.rows[0].share * 100), 67);
  assert.equal(m.best?.source, "Facebook Ads");
  assert.equal(m.worst?.source, "Walk-in");
  assert.match(m.line, /Facebook Ads grew most \(\+12\), Walk-in fell most \(-8\)/);
  assert.match(sourceMix(mk("Facebook Ads", 4, 2), NOW).line, /Not enough email leads/);
});

test("drop and spike alerts compare an account with its own normal and stay quiet when the data is thin", () => {
  const b = boundsOf(NOW, NY);
  const weekly = (thisWeek: number, perPastWeek: number) => {
    const ats: number[] = [];
    for (let k = 1; k <= 5; k++) for (let n = 0; n < perPastWeek; n++) ats.push(b.weekStart - k * 7 * DAY + (n + 1) * HOUR);
    for (let n = 0; n < thisWeek; n++) ats.push(b.weekStart + (n + 1) * HOUR);
    return ats;
  };
  const drop = signalsOf("aaa", "Bright Smile", weekly(3, 40), NY, NOW).filter((s) => s.scope === "week");
  assert.equal(drop.length, 1);
  assert.equal(drop[0].direction, "drop");
  assert.ok(drop[0].pct <= -40);
  assert.match(drop[0].text, /Bright Smile: 3 new email leads this week so far, \d+% under its usual/);
  const spike = signalsOf("aaa", "Bright Smile", weekly(70, 40), NY, NOW).filter((s) => s.scope === "week");
  assert.equal(spike[0]?.direction, "spike");
  assert.equal(signalsOf("aaa", "X", weekly(35, 40), NY, NOW).filter((s) => s.scope === "week").length, 0, "inside the normal range");
  assert.equal(signalsOf("aaa", "X", weekly(0, 6), NY, NOW).length, 0, "a normal under 10 a week is too thin to judge");
  assert.equal(signalsOf("aaa", "X", weekly(0, 40).filter((t) => t > b.weekStart - 20 * DAY), NY, NOW).length, 0, "under 28 days of history stays quiet");
  // Today: only after 3 pm local time.
  const morning = Date.UTC(2026, 10, 5, 14, 0, 0); // 9 am in New York
  const days: number[] = [];
  for (let d = 1; d <= 20; d++) for (let n = 0; n < 6; n++) days.push(boundsOf(morning, NY).todayStart - d * DAY + (n + 1) * HOUR);
  assert.equal(signalsOf("aaa", "X", days, NY, morning).filter((s) => s.scope === "day").length, 0, "9 am: the day is not over");
  const evening = signalsOf("aaa", "X", days, NY, NOW).filter((s) => s.scope === "day");
  assert.equal(evening[0]?.direction, "drop", "3 pm with none today against 6 a day");
});

test("the whole read: gross sign ups split into unique and what was removed, per client, and every record carries its reason", () => {
  const accounts = [{ id: "aaa", name: "Bright Smile", zone: NY, url: "u1" }, { id: "bbb", name: "Sunrise", zone: "UTC", url: "u2" }];
  const contacts = [
    c("1", "ann@gmail.com"), c("2", "a.nn@gmail.com", { at: NOW - 2 * HOUR }), c("3", "bob@outlook.com"), c("4", "test@acme.com", { name: "Test" }), c("5", "zed@myagency.com"), c("6", "info@x.com"), c("7", null),
    c("8", "cy@yahoo.com", { locationId: "bbb" }), c("9", "ann@gmail.com", { locationId: "bbb" }),
  ];
  const g = buildGrowth({ now: NOW, accounts, contacts, rules, goals: { aaa: 40 }, scope: "agency" });
  assert.equal(g.gross.signUps, 8, "the contact with no email is not a sign up");
  assert.deepEqual(g.gross.removed, { duplicate: 1, junk: 1, staff: 1, role: 1 });
  assert.equal(g.gross.unique, 4);
  assert.equal(g.gross.unique + Object.values(g.gross.removed).reduce((s, n) => s + n, 0), g.gross.signUps, "nothing is lost between sign ups and unique");
  assert.equal(g.changes.all.count, 4);
  assert.equal(g.records.filter((r) => r.verdict === "counted").length, 4);
  assert.equal(g.records.filter((r) => r.verdict !== "counted").length, 4);
  assert.ok(g.records.every((r) => r.url), "every record can be opened");
  assert.equal(g.league.length, 2);
  assert.equal(g.league.find((r) => r.locationId === "aaa")?.goal, 40);
  assert.equal(g.league.find((r) => r.locationId === "bbb")?.goal, null);
  assert.equal(g.goal.accountsWithGoal, 1);
});
