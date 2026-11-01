import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { accountLimit, canUse, entitlements, FEATURES, normalisePlan, planFromMarketplaceId } from "../entitlements.ts";
import { actionFor, parseWebhook, verifyWebhook } from "../ghl/webhook.ts";
import { churnRisk, engagementScore, isDormant, scoreBand, type AccountMetrics } from "../scoring.ts";
import { bearerToken, signSession, verifySession } from "../session.ts";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

// --- session
test("a signed session verifies and carries its fields", () => {
  const token = signSession({ companyId: "c1", userId: "u1", role: "admin", userName: "A", demo: false });
  const s = verifySession(token);
  assert.equal(s?.companyId, "c1");
  assert.equal(s?.userName, "A");
});

test("a tampered or expired session is rejected", () => {
  const now = Date.now();
  const token = signSession({ companyId: "c1", userId: null, role: null, userName: null, demo: false }, 60, now);
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ companyId: "other", exp: 9999999999, demo: false })).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`, now), null);
  assert.equal(verifySession(`${body}.AAAA`, now), null);
  assert.equal(verifySession(token, now + 61_000), null);
  assert.equal(verifySession("garbage"), null);
  assert.equal(verifySession(null), null);
});

test("a session signed with another key is rejected", () => {
  const token = signSession({ companyId: "c1", userId: null, role: null, userName: null, demo: false });
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");
  assert.equal(verifySession(token), null);
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
});

test("bearerToken reads the Authorization header", () => {
  assert.equal(bearerToken(new Request("http://x", { headers: { authorization: "Bearer abc" } })), "abc");
  assert.equal(bearerToken(new Request("http://x", { headers: { authorization: "Basic abc" } })), null);
  assert.equal(bearerToken(new Request("http://x")), null);
});

// --- entitlements
test("one plan, every feature open: nothing is ever locked", () => {
  for (const plan of ["free", "starter", "pro"] as const) {
    for (const feature of FEATURES) assert.equal(canUse(feature, plan, true), true, plan + " " + feature);
    assert.equal(accountLimit(plan, true), null);
    assert.equal(Object.values(entitlements(plan, true).features).every(Boolean), true);
  }
  assert.equal(entitlements("free").accountLimit, null);
  assert.equal(entitlements("free").enforced, false);
  assert.equal(normalisePlan("paid"), "pro", "old stored values are still understood");
  assert.equal(normalisePlan("anything"), "free");
});

test("marketplace plan ids map to tiers through GHL_PLAN_IDS", () => {
  const env = { GHL_PLAN_IDS: JSON.stringify({ abc: "starter", def: "pro" }) };
  assert.equal(planFromMarketplaceId("abc", env), "starter");
  assert.equal(planFromMarketplaceId("def", env), "pro");
  assert.equal(planFromMarketplaceId("zzz", env), null);
  assert.equal(planFromMarketplaceId(undefined, env), null);
  assert.equal(planFromMarketplaceId("abc", {}), null);
  assert.equal(planFromMarketplaceId("abc", { GHL_PLAN_IDS: "not json" }), null);
});

// --- scoring
const healthy: AccountMetrics = {
  contacts: 400, newContacts30d: 30, openOpportunities: 20, staleOpportunities: 1,
  unansweredOverSla: 0, completenessPct: 90, daysInactive: 1,
};

test("a busy, tidy account scores high and a dead one scores low", () => {
  const good = engagementScore(healthy);
  const dead = engagementScore({ ...healthy, newContacts30d: 0, staleOpportunities: 20, unansweredOverSla: 6, completenessPct: 20, daysInactive: 90 });
  assert.ok(good >= 85, `good was ${good}`);
  assert.ok(dead <= 15, `dead was ${dead}`);
  assert.equal(scoreBand(good), "thriving");
  assert.equal(scoreBand(dead), "at_risk");
});

test("score is bounded and handles no activity", () => {
  const s = engagementScore({ contacts: 0, newContacts30d: 0, openOpportunities: 0, staleOpportunities: 0, unansweredOverSla: 0, completenessPct: 0, daysInactive: null });
  assert.ok(s >= 0 && s <= 100);
  assert.ok(engagementScore(healthy) <= 100);
});

test("dormant means no activity for the threshold or ever", () => {
  assert.equal(isDormant(null, 30), true);
  assert.equal(isDormant(29, 30), false);
  assert.equal(isDormant(30, 30), true);
});

test("churn risk escalates with inactivity, low score and score drops", () => {
  assert.equal(churnRisk({ score: 80, daysInactive: 2, dormantDays: 30, history: [78, 80, 82] }).level, "low");
  assert.equal(churnRisk({ score: 60, daysInactive: 35, dormantDays: 30, history: [] }).level, "medium");
  assert.equal(churnRisk({ score: 60, daysInactive: 70, dormantDays: 30, history: [] }).level, "high");
  assert.equal(churnRisk({ score: 20, daysInactive: 1, dormantDays: 30, history: [] }).level, "high");
  const drop = churnRisk({ score: 50, daysInactive: 2, dormantDays: 30, history: [80, 78, 82, 80] });
  assert.equal(drop.level, "high");
  assert.match(drop.reasons.join(" "), /fell/);
  assert.equal(churnRisk({ score: 70, daysInactive: null, dormantDays: 30, history: [] }).level, "high");
});

// --- webhooks
test("webhook signatures verify with Ed25519 and reject tampering", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const body = JSON.stringify({ type: "ContactCreate", webhookId: "w1", locationId: "l1" });
  const sig = sign(null, Buffer.from(body), privateKey).toString("base64");
  assert.equal(verifyWebhook(body, sig, pem), true);
  assert.equal(verifyWebhook(body.replace("l1", "l2"), sig, pem), false);
  assert.equal(verifyWebhook(body, null, pem), false);
  assert.equal(verifyWebhook(body, "N/A", pem), false);
  assert.equal(verifyWebhook(body, "not-base64!!", pem), false);
});

test("a signature over the re-serialised body also verifies", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const compact = JSON.stringify({ a: 1, b: { c: 2 } });
  const sig = sign(null, Buffer.from(compact), privateKey).toString("base64");
  assert.equal(verifyWebhook('{ "a": 1,  "b": {"c": 2} }', sig, pem), true);
});

test("webhook parsing and actions", () => {
  const e = parseWebhook({ type: "AppUninstall", webhookId: "w", companyId: "c", locationId: "l" });
  assert.deepEqual(e, { type: "AppUninstall", webhookId: "w", companyId: "c", locationId: "l", whitelabelDomain: null });
  assert.equal(parseWebhook({ data: { companyId: "c2" } }).companyId, "c2");
  assert.equal(parseWebhook(null).type, null);
  assert.deepEqual(actionFor("AppUninstall"), { kind: "uninstall" });
  assert.deepEqual(actionFor("OpportunityStageUpdate"), { kind: "resync", scope: "opportunities" });
  assert.deepEqual(actionFor("InboundMessage"), { kind: "resync", scope: "conversations" });
  assert.deepEqual(actionFor("SomethingNew"), { kind: "ignore" });
});
