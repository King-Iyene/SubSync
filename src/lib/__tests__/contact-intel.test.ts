import assert from "node:assert/strict";
import { test } from "node:test";
import { daysIdle, emailProblem, isValidEmail, isValidPhone, leadScore, lifecycleOf, normaliseTag, tagVariants, vipScore, type LeadFacts } from "../analytics/contact-intel.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const DAY = 86_400_000;
const ago = (d: number) => NOW - d * DAY;

const lead = (over: Partial<LeadFacts> = {}): LeadFacts => ({
  email: "a@acme.com", phone: "+15551234567", tags: ["lead"], dateAdded: ago(60), lastActivityAt: ago(3), hasOpenDeal: false, openDealValue: 0,
  hasWonDeal: false, hasLostDeal: false, ...over,
});

test("email validation catches the common problems", () => {
  assert.equal(isValidEmail("sam@example.com"), true);
  for (const bad of ["", null, "sam", "sam@", "sam@example", "sam@@example.com", "sam @example.com", "sam@example..com", ".sam@example.com"]) {
    assert.equal(isValidEmail(bad as string | null), false, String(bad));
  }
});

test("disposable domains are flagged separately from invalid ones", () => {
  assert.equal(emailProblem("x@mailinator.com"), "disposable");
  assert.equal(emailProblem("nonsense"), "invalid");
  assert.equal(emailProblem("sam@example.com"), null);
  assert.equal(emailProblem(null), null);
});

test("phone validation rejects too short, too long and repeated digits", () => {
  assert.equal(isValidPhone("+1 (555) 123-4567"), true);
  assert.equal(isValidPhone("0803 339 2542"), true);
  assert.equal(isValidPhone("12345"), false);
  assert.equal(isValidPhone("1".repeat(16)), false);
  assert.equal(isValidPhone("0000000000"), false);
  assert.equal(isValidPhone(null), false);
});

test("tag variants group tags that differ only by case, spacing or punctuation", () => {
  assert.equal(normaliseTag("Hot-Lead "), "hot lead");
  const v = tagVariants([{ tag: "Hot Lead", count: 5 }, { tag: "hot-lead", count: 9 }, { tag: "hot_lead", count: 1 }, { tag: "vip", count: 3 }]);
  assert.equal(v.length, 1);
  assert.equal(v[0].total, 15);
  assert.equal(v[0].variants[0].tag, "hot-lead");
});

test("lead score rewards reachability, activity and an open deal, and zeroes customers", () => {
  assert.equal(leadScore(lead({ hasWonDeal: true }), NOW).score, 0);
  const cold = leadScore(lead({ email: null, phone: null, tags: [], lastActivityAt: ago(200) }), NOW).score;
  const warm = leadScore(lead(), NOW).score;
  const hot = leadScore(lead({ hasOpenDeal: true, openDealValue: 5000, dateAdded: ago(3) }), NOW).score;
  assert.ok(cold < warm && warm < hot, `${cold} ${warm} ${hot}`);
  assert.ok(hot <= 100);
  assert.equal(leadScore(lead({ hasLostDeal: true }), NOW).score, warm - 10);
});

test("lifecycle stage comes from the deals a contact has", () => {
  assert.equal(lifecycleOf({ hasOpenDeal: false, hasWonDeal: false, hasLostDeal: false }), "lead");
  assert.equal(lifecycleOf({ hasOpenDeal: true, hasWonDeal: false, hasLostDeal: true }), "opportunity");
  assert.equal(lifecycleOf({ hasOpenDeal: true, hasWonDeal: true, hasLostDeal: false }), "customer");
  assert.equal(lifecycleOf({ hasOpenDeal: false, hasWonDeal: false, hasLostDeal: true }), "lost");
});

test("VIP score ranks bigger customers higher, and idle days are counted", () => {
  assert.ok(vipScore({ wonValue: 10000, openValue: 0, wonCount: 1, lastActivityAt: null }) > vipScore({ wonValue: 1000, openValue: 0, wonCount: 1, lastActivityAt: null }));
  assert.equal(daysIdle(ago(12), NOW), 12);
  assert.equal(daysIdle(null, NOW), null);
});
