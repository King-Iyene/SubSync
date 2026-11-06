import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bookingByReplyTime, bucketOf, DEFAULT_LADDER, duplicateOf, escalate, flagPenalty, ladderStep, leadFlags, minutesToNextStep, moneyAtRisk, normLadder, repeatBoost, roundRobinPick, targetOf,
  type BookingLead,
} from "../analytics/speed5.ts";
import { computeAlerts, deriveAccount, type AccountRow, type AccountSettings } from "../analytics/derive.ts";
import { comingLeads, sinceVisitOf, type LeadRow } from "../analytics/today-smart.ts";
import { withinTargetShare } from "../analytics/today-queue.ts";
import { leadQuality } from "../analytics/speed-v4.ts";
import type { Person } from "../analytics/dedupe.ts";

const many = (n: number, replySeconds: number | null, booked: number): BookingLead[] => Array.from({ length: n }, (_, i) => ({ replySeconds, booked: i < booked }));

test("buckets: the boundary belongs to the faster side, no reply is its own group", () => {
  assert.equal(bucketOf(0), "m5"); assert.equal(bucketOf(300), "m5"); assert.equal(bucketOf(301), "m15"); assert.equal(bucketOf(900), "m15");
  assert.equal(bucketOf(3600), "h1"); assert.equal(bucketOf(3601), "h4"); assert.equal(bucketOf(14_400), "h4"); assert.equal(bucketOf(14_401), "late"); assert.equal(bucketOf(null), "none");
  assert.equal(bucketOf(-5), "m5", "a clock that ran backwards counts as instant, never crashes");
});

test("booking chart: a group under 10 leads shows no rate; under 30 leads the chart makes no claim", () => {
  const tiny = bookingByReplyTime([...many(9, 60, 9), ...many(9, 20_000, 0)]);
  assert.equal(tiny.buckets.find((b) => b.key === "m5")?.rate, null, "9 leads is below the group minimum");
  assert.equal(tiny.enough, false); assert.equal(tiny.multiple, null);
  const empty = bookingByReplyTime([]);
  assert.equal(empty.total, 0); assert.ok(empty.buckets.every((b) => b.rate === null));
});

test("booking chart: fast against slow, each pooled and each needing its own 10 leads", () => {
  const r = bookingByReplyTime([...many(20, 120, 10), ...many(10, 600, 5), ...many(20, 20_000, 2), ...many(5, null, 0)]);
  assert.equal(r.total, 55); assert.equal(r.enough, true);
  assert.equal(r.buckets.find((b) => b.key === "m5")?.rate, 50);
  assert.equal(r.buckets.find((b) => b.key === "none")?.rate, null, "5 unanswered leads is too few to show");
  assert.equal(r.fastRate, 0.5); assert.equal(r.slowRate, 0.1); assert.equal(r.multiple, 5);
});

test("booking chart: a slow group that never books gives no multiple, and a thin slow group gives none", () => {
  const zero = bookingByReplyTime([...many(20, 100, 10), ...many(20, 30_000, 0)]);
  assert.equal(zero.slowRate, 0); assert.equal(zero.multiple, null);
  const thin = bookingByReplyTime([...many(25, 100, 10), ...many(9, 30_000, 1)]);
  assert.equal(thin.multiple, null, "9 slow leads is below the minimum");
});

test("booking chart: a tie between fast and slow is a multiple of 1, not an invented win", () => {
  const r = bookingByReplyTime([...many(20, 100, 4), ...many(20, 30_000, 4)]);
  assert.equal(r.multiple, 1);
});

test("money at risk: counted is a fact; the estimate needs a measured booking gap and an average deal, and is never negative", () => {
  assert.deepEqual(moneyAtRisk({ waiting: 4, fastRate: 0.5, slowRate: 0.1, avgDeal: 1000, openDealDollars: 2500 }), { counted: 2500, estimate: 1600 });
  assert.equal(moneyAtRisk({ waiting: 4, fastRate: null, slowRate: null, avgDeal: 1000, openDealDollars: 0 }).estimate, null);
  assert.equal(moneyAtRisk({ waiting: 4, fastRate: 0.5, slowRate: 0.1, avgDeal: null, openDealDollars: 0 }).estimate, null);
  assert.equal(moneyAtRisk({ waiting: 4, fastRate: 0.1, slowRate: 0.3, avgDeal: 1000, openDealDollars: 0 }).estimate, null, "slow replies booking better is no loss to claim");
  assert.equal(moneyAtRisk({ waiting: 0, fastRate: 0.5, slowRate: 0.1, avgDeal: 1000, openDealDollars: -5 }).counted, 0);
});

test("ladder: inside the target nothing; then owner, next person, manager at the configured minutes past the target", () => {
  const L = { enabled: true, nextAfterMin: 15, managerAfterMin: 45 };
  assert.equal(ladderStep(5, 5, L), 0, "exactly at the target is still inside it");
  assert.equal(ladderStep(6, 5, L), 1);
  assert.equal(ladderStep(5 + 14.9, 5, L), 1);
  assert.equal(ladderStep(5 + 15, 5, L), 2);
  assert.equal(ladderStep(5 + 44, 5, L), 2);
  assert.equal(ladderStep(5 + 45, 5, L), 3);
  assert.equal(ladderStep(9999, 5, L), 3);
});

test("ladder: off means past the target is step 1 and stays there; a different target moves every step", () => {
  assert.equal(ladderStep(500, 15, { ...DEFAULT_LADDER, enabled: false }), 1);
  assert.equal(ladderStep(30, 15, DEFAULT_LADDER), 2); assert.equal(ladderStep(30, 30, DEFAULT_LADDER), 0);
});

test("ladder: saved values are clamped and the manager step is always later than the next-person step", () => {
  assert.deepEqual(normLadder(null), DEFAULT_LADDER);
  assert.deepEqual(normLadder({ enabled: false, nextAfterMin: 20, managerAfterMin: 10 }), { enabled: false, nextAfterMin: 20, managerAfterMin: 21 });
  assert.equal(normLadder({ nextAfterMin: -4, managerAfterMin: 99_999 }).nextAfterMin, 1);
  assert.equal(normLadder({ nextAfterMin: "x", managerAfterMin: "y" }).managerAfterMin, 45);
  assert.equal(normLadder({ nextAfterMin: 1440, managerAfterMin: 1440 }).managerAfterMin, 1440);
});

test("ladder: minutes to the next step, and the highest step per account", () => {
  assert.equal(minutesToNextStep(3, 5, DEFAULT_LADDER), 2);
  assert.equal(minutesToNextStep(10, 5, DEFAULT_LADDER), 10);
  assert.equal(minutesToNextStep(60, 5, DEFAULT_LADDER), null, "at the top there is no next step");
  const e = escalate([
    { locationId: "A", contactId: "1", waitedMin: 4, targetMin: 5, ownerId: null },
    { locationId: "A", contactId: "2", waitedMin: 30, targetMin: 5, ownerId: "u1" },
    { locationId: "B", contactId: "3", waitedMin: 70, targetMin: 10, ownerId: null },
  ], DEFAULT_LADDER);
  assert.equal(e.leads.length, 2, "a lead still inside its target is not escalated");
  assert.equal(e.topByAccount.get("A"), 2); assert.equal(e.topByAccount.get("B"), 3);
});

test("round robin: fewest waiting first, then fewest recent, then the smaller id; the owner can be skipped; nobody gives null", () => {
  assert.equal(roundRobinPick([{ userId: "b", open: 2, recent: 1 }, { userId: "a", open: 1, recent: 9 }]), "a");
  assert.equal(roundRobinPick([{ userId: "b", open: 1, recent: 3 }, { userId: "a", open: 1, recent: 5 }]), "b");
  assert.equal(roundRobinPick([{ userId: "b", open: 1, recent: 3 }, { userId: "a", open: 1, recent: 3 }]), "a", "a full tie is decided by id so the answer never flips");
  assert.equal(roundRobinPick([{ userId: "a", open: 0, recent: 0 }, { userId: "b", open: 5, recent: 5 }], new Set(["a"])), "b");
  assert.equal(roundRobinPick([]), null); assert.equal(roundRobinPick([{ userId: "a", open: 0, recent: 0 }], new Set(["a"])), null);
});

test("lead validity: disposable, shared mailbox, made-up phone are flagged; empty fields are not", () => {
  assert.deepEqual(leadFlags({ email: "ann@mailinator.com", phone: "(415) 555-2671" }), ["email_disposable", "phone_fake"]);
  assert.deepEqual(leadFlags({ email: "info@acme.com" }), ["email_role"]);
  assert.deepEqual(leadFlags({ email: "not an email" }), ["email_format"]);
  assert.deepEqual(leadFlags({ phone: "1234567890" }), ["phone_fake"]);
  assert.deepEqual(leadFlags({ phone: "12345" }), ["phone_short"]);
  assert.deepEqual(leadFlags({ phone: "000-000-0000" }), ["phone_fake"]);
  assert.deepEqual(leadFlags({ email: "", phone: null }), []);
  assert.deepEqual(leadFlags({ email: "ann.lee@gmail.com", phone: "+1 415 867 5309" }), []);
});

test("lead validity lowers the quality score quietly and never below 0", () => {
  const good = leadQuality({ phone: "4158675309", email: "ann.lee@gmail.com", source: "Facebook" });
  const role = leadQuality({ phone: "4158675309", email: "info@acme.com", source: "Facebook" });
  assert.equal(good.score, 100); assert.equal(role.score, 90); assert.deepEqual(role.flags, ["email_role"]);
  assert.equal(flagPenalty(["email_disposable", "email_role", "phone_fake"]), 45);
  assert.equal(leadQuality({}).score, 0);
});

const person = (over: Partial<Person>): Person => ({ contactId: "x", name: "Ann Lee", email: null, phone: null, tags: [], createdAt: null, lastActivityAt: null, source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...over });

test("duplicate guard: the same email and phone is found, and the OLDER record is the one to reply to", () => {
  const lead = person({ contactId: "new", name: "Ann Lee", email: "ann@x.com", phone: "4158675309", createdAt: "2026-11-06T10:00:00Z" });
  const old = person({ contactId: "old", name: "Ann Lee", email: "ann@x.com", phone: "4158675309", createdAt: "2026-09-01T10:00:00Z" });
  const older = person({ contactId: "older", name: "Ann Lee", email: "ann@x.com", phone: "4158675309", createdAt: "2026-05-01T10:00:00Z" });
  const hit = duplicateOf(lead, [old, older]);
  assert.ok(hit); assert.equal(hit.tier, "sure"); assert.equal(hit.contactId, "older", "equal evidence: the oldest wins");
  assert.equal(repeatBoost(hit), 30);
});

test("duplicate guard: a record created AFTER the lead, an unrelated person, a household phone, and the lead itself are not flagged", () => {
  const lead = person({ contactId: "new", name: "Ann Lee", email: "ann@x.com", phone: "4158675309", createdAt: "2026-11-06T10:00:00Z" });
  assert.equal(duplicateOf(lead, [person({ contactId: "later", email: "ann@x.com", createdAt: "2026-11-07T10:00:00Z" })]), null);
  assert.equal(duplicateOf(lead, [person({ contactId: "other", name: "Bob Smith", email: "bob@y.com", phone: "2125550101", createdAt: "2026-01-01T00:00:00Z" })]), null);
  assert.equal(duplicateOf(lead, [person({ contactId: "kid", name: "Tom Lee", email: null, phone: "4158675309", createdAt: "2026-01-01T00:00:00Z" })]), null, "a shared home phone with a different first name is a household");
  assert.equal(duplicateOf(lead, [lead]), null, "a record is never its own duplicate");
  assert.equal(duplicateOf(lead, []), null); assert.equal(repeatBoost(null), 0);
});

// ---- breach alerts and Today judge each account against ITS OWN target ----
const NOW = Date.parse("2026-11-06T12:00:00Z");
const base: AccountSettings = { staleDays: 30, dormantDays: 30, slaHours: 4, speedTargetMinutes: 15 };
const row = (over: Partial<AccountRow>): AccountRow => ({
  locationId: "L1", name: "Acme Roofing", email: null, phone: null, website: null, ignored: false, owner: null, contacts: 100, withEmail: 90, withPhone: 80, withTags: 50,
  new30d: 10, active90d: 80, openOpps: 6, openValue: 12_000, staleOpps: 0, staleValue: 0, wonCount: 0, lostCount: 0, wonValue: 0, unread: 0, unanswered: 0,
  calendars: 1, pipelines: 1, lastActivityAt: new Date(NOW - 86_400_000).toISOString(), syncError: null, contactsSyncedAt: new Date(NOW).toISOString(), ...over,
});
const speed = (over: Partial<AccountRow>, s: AccountSettings = base) => computeAlerts([deriveAccount(row(over), s, [], NOW)], [], s).filter((a) => a.kind === "speed");

test("breach alert: names the account's own target, not the company default", () => {
  const [a] = speed({ speedWaiting: 4, oldestWaitMinutes: 40, speedTargetMinutes: 5 });
  assert.match(a.title, /waited more than 5 minutes/); assert.equal((a.detail as { targetMinutes: number }).targetMinutes, 5);
  const [b] = speed({ speedWaiting: 4, oldestWaitMinutes: 40 });
  assert.match(b.title, /more than 15 minutes/, "no own target: the default applies");
});

test("breach alert: the ladder climbs the wording and the severity, and off keeps the old behaviour", () => {
  const ladder = { enabled: true, nextAfterMin: 15, managerAfterMin: 45 };
  const s1 = speed({ speedWaiting: 3, oldestWaitMinutes: 12, speedTargetMinutes: 5 }, { ...base, escalation: ladder })[0];
  assert.equal(s1.severity, "warning"); assert.doesNotMatch(s1.title, /told/);
  const s2 = speed({ speedWaiting: 3, oldestWaitMinutes: 25, speedTargetMinutes: 5 }, { ...base, escalation: ladder })[0];
  assert.match(s2.title, /the next person is told/); assert.equal(s2.severity, "warning");
  const s3 = speed({ speedWaiting: 3, oldestWaitMinutes: 60, speedTargetMinutes: 5 }, { ...base, escalation: ladder })[0];
  assert.match(s3.title, /the manager is told/); assert.equal(s3.severity, "critical");
  const off = speed({ speedWaiting: 3, oldestWaitMinutes: 600, speedTargetMinutes: 5 }, { ...base, escalation: { ...ladder, enabled: false } })[0];
  assert.equal(off.severity, "warning"); assert.doesNotMatch(off.title, /told/);
  assert.equal(speed({ speedWaiting: 3, oldestWaitMinutes: 60 })[0].dedupeKey, "speed:L1", "one alert per account");
});

test("targetOf: an own target wins, zero or missing falls back", () => {
  assert.equal(targetOf({ targetMinutes: 5 }, 15), 5); assert.equal(targetOf({ targetMinutes: null }, 15), 15); assert.equal(targetOf({ targetMinutes: 0 }, 15), 15); assert.equal(targetOf({}, 15), 15);
});

const lead = (id: string, over: Partial<LeadRow>): LeadRow => ({ id, locationId: "L", accountName: "A", contactId: id, name: id, source: null, ownerName: null, touchBy: null, leadAt: NOW - 8 * 60_000, touchAt: null, url: "", zone: "UTC", ...over });

test("Today: the coming-breach countdown and the since-you-left breaches use each account's own target", () => {
  const rows = [lead("own", { targetMinutes: 5 }), lead("dflt", {})];
  const coming = comingLeads(rows, 15, NOW);
  assert.deepEqual(coming.map((c) => c.name), ["dflt"], "8 min waited: past its own 5-min target (no longer coming), still inside the 15-min default");
  const since = sinceVisitOf({ since: NOW - 60 * 60_000, ledger: rows, alerts: [], targetMinutes: 15, now: NOW });
  assert.deepEqual(since?.breached.map((b) => b.name), ["own"]);
});

test("Today: the within-target share judges each lead against its own target", () => {
  const mk = (n: number, reply: number, target: number | null) => Array.from({ length: n }, (_, i) => ({ leadAt: NOW - (i + 2) * 60_000, touchAt: NOW - (i + 2) * 60_000 + reply * 60_000, targetMinutes: target }));
  const rows = [...mk(5, 10, 5), ...mk(5, 10, null)];
  const r = withinTargetShare(rows, 15, NOW, 7);
  assert.equal(r.judged, 10); assert.equal(r.share, 0.5, "10-minute replies miss a 5-minute own target and meet the 15-minute default");
});
