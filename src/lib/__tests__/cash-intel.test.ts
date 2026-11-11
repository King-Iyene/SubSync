import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AT_RISK_POINTS, cashReceiptLines, dealFlag, dealsAtRisk, digestDue, digestEmail, dollarLine, evidenceOf, makeCursor, parseCursor, rankSave, SAVE_MAX, slaSlip, valuePerLead, type SaveInput,
} from "../analytics/cash-intel.ts";

// Cash features, pure rules. No database. The sentences, the minimums ("not enough data"), the ranking, the schedule and the email text are all held here.

const calm = (o: Partial<SaveInput> = {}): SaveInput => ({
  locationId: "loc1", name: "Acme Roofing", waiting: 0, waitingOld: 0, unmarked: 0, noshows: 0, staleDeals: 0, openDeals: 0,
  newLeads: { current: 20, previous: 20, enough: true }, staffMessages: { current: 50, previous: 50, enough: true }, needsPermission: false, syncOld: false,
  sla: { enough: false, from: null, to: null, slipped: false }, recoverValue: null, dealsValue: null, recoverCount: 0, dealCount: 0, ...o,
});

test("value per lead needs 5 wins and 50 leads, else it is null (not enough data)", () => {
  assert.equal(valuePerLead({ wonValue: 50_000, won: 4, newLeads: 500 }), null);
  assert.equal(valuePerLead({ wonValue: 50_000, won: 10, newLeads: 49 }), null);
  assert.equal(valuePerLead({ wonValue: 0, won: 10, newLeads: 500 }), null);
  assert.equal(valuePerLead({ wonValue: 50_000, won: 10, newLeads: 500 }), 100);
});

test("the dollar line is an estimate, and says plainly when there is no figure", () => {
  assert.match(dollarLine(4200, 3).text, /About \$4,200 could be at stake \(estimate\)/);
  assert.equal(dollarLine(null, 3).enough, false);
  assert.match(dollarLine(null, 3).text, /not enough deal history/);
  assert.equal(dollarLine(null, 0).text, "Nothing to estimate.");
  assert.equal(dollarLine(0, 2).enough, false);
});

test("reply speed slipping needs 20 answered leads in each week and a 15 point fall", () => {
  assert.equal(slaSlip({ answered: 19, within: 5 }, { answered: 50, within: 45 }).enough, false);
  assert.equal(slaSlip({ answered: 40, within: 24 }, { answered: 40, within: 36 }).slipped, true); // 60% from 90%
  const s = slaSlip({ answered: 40, within: 24 }, { answered: 40, within: 36 });
  assert.deepEqual([s.from, s.to], [90, 60]);
  assert.equal(slaSlip({ answered: 40, within: 34 }, { answered: 40, within: 36 }).slipped, false); // only 5 points
});

test("evidence names each problem with its own number, and a calm account has none", () => {
  assert.deepEqual(evidenceOf(calm()), []);
  const e = evidenceOf(calm({ waitingOld: 9, noshows: 4, sla: { enough: true, from: 92, to: 61, slipped: true } }));
  const keys = e.map((x) => x.key);
  assert.deepEqual(keys.sort(), ["noshows", "sla", "waiting_old"]);
  assert.match(e.find((x) => x.key === "sla")?.text ?? "", /92% answered in time last week, 61% this week/);
  assert.match(e.find((x) => x.key === "waiting_old")?.text ?? "", /9 people have waited over a day/);
  // no activity needs a normal week before it, so a new account is not flagged
  assert.equal(evidenceOf(calm({ newLeads: { current: 0, previous: 3, enough: false }, staffMessages: { current: 0, previous: 4, enough: true } })).some((x) => x.key === "no_activity"), false);
  assert.equal(evidenceOf(calm({ newLeads: { current: 0, previous: 12, enough: true }, staffMessages: { current: 0, previous: 40, enough: true } })).some((x) => x.key === "no_activity"), true);
  assert.equal(evidenceOf(calm({ needsPermission: true })).some((x) => x.key === "setup"), true);
});

test("ranking: points first, then dollars; muted and calm accounts are left out; at most five", () => {
  const a = calm({ locationId: "a", name: "A", waitingOld: 2 }); // 3 points
  const b = calm({ locationId: "b", name: "B", waitingOld: 6, recoverValue: 900, recoverCount: 6 }); // 5
  const c = calm({ locationId: "c", name: "C", waitingOld: 6, recoverValue: 5000, recoverCount: 6 }); // 5, more money
  const muted = calm({ locationId: "m", name: "M", waitingOld: 9, muted: true });
  const fine = calm({ locationId: "f", name: "F", waiting: 1 });
  const r = rankSave([a, b, c, muted, fine]);
  assert.deepEqual(r.accounts.map((x) => x.locationId), ["c", "b", "a"]);
  assert.equal(r.checked, 4); // the muted one is not checked
  assert.ok(r.accounts.every((x) => x.points >= AT_RISK_POINTS));
  const many = Array.from({ length: 9 }, (_, i) => calm({ locationId: `x${i}`, name: `X${i}`, waitingOld: 6 }));
  const big = rankSave(many);
  assert.equal(big.accounts.length, SAVE_MAX);
  assert.equal(big.more, 4);
});

test("an account with no honest dollar figure says so, never a made-up number", () => {
  const r = rankSave([calm({ waitingOld: 7, recoverCount: 7 })]);
  assert.equal(r.accounts[0].dollars, null);
  assert.match(r.accounts[0].dollarText, /No dollar estimate yet/);
});

test("the digest goes once a day at the chosen local hour, never on quiet days or inside quiet hours", () => {
  const at = (iso: string) => Date.parse(iso);
  // 07:30 UTC Monday 2026-12-14, hour 7
  assert.equal(digestDue(at("2026-12-14T07:30:00Z"), "UTC", 7, [], null, null, null).due, true);
  assert.equal(digestDue(at("2026-12-14T07:30:00Z"), "UTC", 7, [], null, null, "2026-12-14").due, false); // already sent today
  assert.equal(digestDue(at("2026-12-14T07:30:00Z"), "UTC", 7, [1], null, null, null).due, false); // Monday is a quiet day
  assert.equal(digestDue(at("2026-12-14T06:30:00Z"), "UTC", 7, [], null, null, null).due, false); // too early
  assert.equal(digestDue(at("2026-12-14T11:00:00Z"), "UTC", 7, [], null, null, null).due, false); // too late (more than 2 hours)
  // quiet hours 22 to 8 wrap midnight: 07:30 is inside them
  assert.equal(digestDue(at("2026-12-14T07:30:00Z"), "UTC", 7, [], 22, 8, null).due, false);
  assert.equal(digestDue(at("2026-12-14T08:30:00Z"), "UTC", 7, [], 22, 8, null).due, true);
  // the business's own day: 07:30 in Lagos is 06:30 UTC
  assert.equal(digestDue(at("2026-12-14T06:30:00Z"), "Africa/Lagos", 7, [], null, null, null).due, true);
});

test("the email: evidence, dollar line, one button per account, a stop link, estimates labelled, and no vendor words", () => {
  const ranked = rankSave([calm({ locationId: "loc9", name: "Acme Roofing", waitingOld: 9, recoverValue: 4200, recoverCount: 9 })]);
  const m = digestEmail({ scope: "12 client accounts checked", accounts: ranked.accounts, more: 0, appUrl: "https://app.example.com", stopUrl: "https://app.example.com/stop?t=abc", deals: null, monday: false });
  assert.match(m.subject, /1 client account to save today: Acme Roofing/);
  assert.match(m.text, /9 people have waited over a day/);
  assert.match(m.text, /\(estimate\)/);
  assert.match(m.text, /#today\?tab=recover&account=loc9/);
  assert.match(m.text, /Stop these emails: https:\/\/app\.example\.com\/stop/);
  assert.match(m.html, /Open the list/);
  for (const text of [m.subject, m.text, m.html]) assert.doesNotMatch(text, /gohighlevel|highlevel|\bghl\b|sub-account|subaccount/i);
  // html is escaped
  const evil = digestEmail({ scope: "x", accounts: [{ ...ranked.accounts[0], name: "<script>alert(1)</script>" }], more: 0, appUrl: "https://a.test", stopUrl: "https://a.test/s", deals: null, monday: false });
  assert.doesNotMatch(evil.html, /<script>/);
  // Monday adds the deals line
  const mon = digestEmail({ scope: "x", accounts: ranked.accounts, more: 0, appUrl: "https://a.test", stopUrl: "https://a.test/s", deals: { staleCount: 4, staleValue: 12000, soonCount: 2, lostNoReason: 1, lostCount: 3 }, monday: true });
  assert.match(mon.text, /Deals slipping this week: 4 past their usual time in a stage \(about \$12,000, estimate\), 2 about to go quiet, 3 lost in the last 2 weeks \(1 with no reason recorded\)/);
});

test("a calm morning with nothing at risk says so", () => {
  const m = digestEmail({ scope: "3 client accounts checked", accounts: [], more: 0, appUrl: "https://a.test", stopUrl: "https://a.test/s", deals: null, monday: false });
  assert.match(m.subject, /nothing at risk today/);
});

test("deal flags: stale past the stage limit, soon within a week of it, assumed 30 days without history", () => {
  assert.equal(dealFlag(20, 14), "stale");
  assert.equal(dealFlag(10, 14), "soon"); // 10 + 7 > 14
  assert.equal(dealFlag(5, 14), null);
  assert.equal(dealFlag(25, null), "soon"); // limit 30 assumed: 25 + 7 > 30
  assert.equal(dealFlag(31, null), "stale");
  assert.equal(dealFlag(null, 14), null);
});

test("dollars at risk need 3 valued deals", () => {
  assert.equal(dealsAtRisk([1000, 2000]), null);
  assert.equal(dealsAtRisk([1000, 2000, 500, 0]), 3500);
});

test("the receipt lines are plain, labelled as estimates, and skip what has nothing behind it", () => {
  assert.deepEqual(cashReceiptLines({ recovered: 0, recoveredValue: null, moved: 0, movedValue: null, lostNoReason: 0 }), []);
  const l = cashReceiptLines({ recovered: 12, recoveredValue: 9600, moved: 3, movedValue: 14000, lostNoReason: 2 });
  assert.equal(l.length, 3);
  assert.match(l[0], /12 missed leads were followed up after we flagged them, worth about \$9,600 \(estimate\)/);
  assert.match(l[1], /3 flagged deals moved forward or closed, about \$14,000 \(estimate\)/);
  assert.match(l[2], /2 lost deals have no reason recorded in the CRM/);
  for (const x of l) assert.doesNotMatch(x, /gohighlevel|highlevel|\bghl\b|sub-account/i);
  assert.match(cashReceiptLines({ recovered: 1, recoveredValue: null, moved: 0, movedValue: null, lostNoReason: 0 })[0], /^1 missed lead was followed up after we flagged it\.$/);
});

test("the paging cursor round-trips and anything malformed is no cursor", () => {
  assert.deepEqual(parseCursor(makeCursor(1200.5, "loc~unanswered~c1~conv:1")), { v: 1200.5, id: "loc~unanswered~c1~conv:1" });
  assert.equal(parseCursor(null), null);
  assert.equal(parseCursor("abc"), null);
  assert.equal(parseCursor("x|id"), null);
  assert.equal(parseCursor("5|"), null);
  assert.equal(parseCursor(`5|${"a".repeat(200)}`), null);
});

// The words people read in the app must never name the vendor, and must never promise what is not live (principle 5). The screen and the email are scanned as written.
test("no vendor words and no sending promises in the cash screen text", () => {
  const src = readFileSync(new URL("../../app/app/views/td3/cash.tsx", import.meta.url), "utf8");
  const text = [...src.matchAll(/"([^"\n]{6,})"|`([^`\n]{6,})`|>([^<>{}\n]{6,})</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").join("\n");
  assert.doesNotMatch(text, /gohighlevel|high level|highlevel|\bghl\b|sub-account|subaccount/i);
  assert.doesNotMatch(text, /we (will )?(send|message|text) (your )?leads?/i);
});
