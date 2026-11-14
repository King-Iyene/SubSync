import assert from "node:assert/strict";
import { test } from "node:test";
import { accessState, installLine, readInstalls, scopeRefusal, trialEnd, trialEndingSoon } from "../analytics/clients3-installs.ts";
import { readSaasPlans, stateFor, type Getter } from "../analytics/clients3-saas.ts";
import { appPlanLabel, bucketsOf, moneyRow, plansCountsLine, planReadOf, todayLine } from "../analytics/cl3-money-core.ts";
import { GROWTH_PLAN_ID } from "../entitlements-core.ts";

// The real refusal the platform gave on 13 Nov 2026 when the install had not granted the permission.
const SCOPE_401 = { status: 401, body: { statusCode: 401, message: "The token is not authorized for this scope." } };
const item = (id: string, o: Record<string, unknown> = {}) => ({ _id: id, name: `Acct ${id}`, isInstalled: true, versionId: "v1", installedAt: "2026-10-30T10:00:00.000Z", planId: "p1", trial: { onTrial: false }, ...o });

test("reads the installed list with the documented path, params and version, then maps each field", async () => {
  const calls: string[] = [];
  const get: Getter = async (path, version) => { calls.push(`${version} ${path}`); return { status: 200, body: { locations: [item("a", { trial: { onTrial: true } }), item("b", { isInstalled: false, installedAt: "bad", planId: undefined })], count: 2 } }; };
  const r = await readInstalls(get, "co1", "app1");
  assert.equal(r.failed, null);
  assert.deepEqual(calls, ["2021-07-28 /oauth/installedLocations?companyId=co1&appId=app1&skip=0&limit=100"]);
  assert.deepEqual(r.rows[0], { locationId: "a", name: "Acct a", installed: true, versionId: "v1", installedAt: "2026-10-30T10:00:00.000Z", planId: "p1", onTrial: true });
  assert.equal(r.rows[1].installed, false);
  assert.equal(r.rows[1].installedAt, null);
  assert.equal(r.rows[1].planId, null);
});

test("pages until the count is reached", async () => {
  const get: Getter = async (path) => {
    const skip = Number(/skip=(\d+)/.exec(path)?.[1]);
    const n = skip === 0 ? 100 : 5;
    return { status: 200, body: { locations: Array.from({ length: n }, (_, i) => item(`x${skip + i}`)), count: 105 } };
  };
  const r = await readInstalls(get, "co1", "app1");
  assert.equal(r.rows.length, 105);
});

test("a refusal is returned with its real status, never an empty success", async () => {
  const r = await readInstalls(async () => SCOPE_401, "co1", "app1");
  assert.equal(r.failed?.status, 401);
  assert.equal(r.rows.length, 0);
});

test("three honest states: needs permission, not available, ok", () => {
  assert.equal(scopeRefusal(401, SCOPE_401.body), true);
  assert.equal(accessState(SCOPE_401, null, "saas/company.read"), "needs_permission");
  // Scope not granted on this install, platform words unknown: still needs permission.
  assert.equal(accessState({ status: 403, body: null }, ["oauth.readonly"], "saas/company.read"), "needs_permission");
  // Scope granted, platform still refuses: it does not give this to this account.
  assert.equal(accessState({ status: 403, body: { message: "Forbidden" } }, ["saas/company.read"], "saas/company.read"), "not_available");
  assert.equal(accessState({ status: 500, body: null }, null, "x"), "not_available");
  assert.equal(accessState({ status: 200, body: {} }, null, "x"), "ok");
});

test("the plan list: a scope refusal is needs_permission for every account; other refusals are not_available", async () => {
  const a = await readSaasPlans(async () => SCOPE_401, "co1", null);
  assert.equal(a.failed, 401);
  assert.equal(stateFor(a, "loc1").state, "needs_permission");
  const b = await readSaasPlans(async () => ({ status: 403, body: { message: "Forbidden" } }), "co1", ["saas/company.read"]);
  assert.equal(stateFor(b, "loc1").state, "not_available");
  const c = await readSaasPlans(async () => ({ status: 403, body: null }), "co1", ["oauth.readonly"]);
  assert.equal(stateFor(c, "loc1").state, "needs_permission");
});

test("real data: a past-due plan is a defaulter and a trialing plan is counted as a trial", async () => {
  const pages = { locations: [{ locationId: "a", subscriptionId: "s1", subscriptionInfo: { saasPlanId: "p1", subscriptionStatus: "past_due", priceId: "pr" } }, { locationId: "b", subscriptionInfo: { saasPlanId: "p1", subscriptionStatus: "trialing" } }], pagination: { hasNext: false } };
  const get: Getter = async (path) => (path.includes("saas-locations") ? { status: 200, body: pages } : { status: 200, body: { title: "Growth", prices: [{ _id: "pr", amount: 100, currency: "USD", billingInterval: "month" }] } });
  const r = await readSaasPlans(get, "co1", ["saas/company.read"]);
  assert.equal(stateFor(r, "a").status, "past_due");
  const base = { plan: { name: "Growth", pay: "past_due", payLabel: "Past due", statusRaw: "past_due", monthly: 100, currency: "USD", interval: "month", daysInStatus: 2, since: null, state: "ok", explain: "" }, wallet: { balance: 5, state: "ok" }, subsync: "installed" as const };
  assert.ok(bucketsOf(base).includes("failing") && !bucketsOf(base).includes("trial"));
  assert.ok(bucketsOf({ ...base, plan: { ...base.plan, pay: "paid", statusRaw: "trialing" } }).includes("trial"));
});

test("plan read state never reassures when nothing was read", () => {
  assert.equal(planReadOf(["needs_permission", "needs_permission"]), "needs_permission");
  assert.equal(planReadOf(["not_available"]), "not_available");
  assert.equal(planReadOf(["not_checked"]), "not_checked");
  assert.equal(planReadOf(["no_plan", "not_available"]), "ok");
  assert.match(todayLine({ all: 3, unpaid: 0, failing: 0, no_plan: 0, paid: 0, empty_wallet: 0, app_missing: 0, trial: 0, app_trial: 0 }, [], "not_available").headline, /Not known/);
});

test("counts line only counts what the platform supports and never mentions payments due", () => {
  const line = plansCountsLine({ all: 9, unpaid: 3, failing: 2, no_plan: 0, paid: 5, empty_wallet: 0, app_missing: 0, trial: 1, app_trial: 0 });
  assert.equal(line, "2 past due, 1 cancelled, paused or to check, 1 on a trial");
  assert.doesNotMatch(line, /due in|next payment/i);
});

test("install block: plan label, trial flag, trial end only when the install event gave start and length", () => {
  assert.equal(appPlanLabel(GROWTH_PLAN_ID), "Growth plan");
  assert.equal(appPlanLabel("zzz"), "Other plan");
  assert.equal(appPlanLabel(null), null);
  const end = trialEnd("2026-11-01T00:00:00.000Z", 14);
  assert.equal(end, "2026-11-15T00:00:00.000Z");
  assert.equal(trialEnd(null, 14), null);
  assert.equal(trialEndingSoon(end, Date.parse("2026-11-13T00:00:00.000Z"), 3), true);
  assert.equal(trialEndingSoon(end, Date.parse("2026-11-05T00:00:00.000Z"), 3), false);
  assert.equal(trialEndingSoon(end, Date.parse("2026-11-20T00:00:00.000Z"), 3), false);
  assert.equal(installLine({ installed: false, versionId: null, installedAt: null, planLabel: null, onTrial: null, trialEndsAt: null }), "Not installed");
  assert.match(installLine({ installed: true, versionId: "v", installedAt: "2026-10-30T10:00:00.000Z", planLabel: "Growth plan", onTrial: true, trialEndsAt: null }), /on a trial \(end date not given by the platform\)/);
  const cl2 = { locationId: "a", name: "A", email: null, plan: { state: "ok", name: null, pay: "paid", payLabel: "Paid up", statusRaw: "active", monthly: null, currency: null, interval: null, priceAmount: null, since: null, daysInStatus: null, explain: "", checkedAt: null }, level: "ok", summary: null, url: null } as never;
  const row = moneyRow(cl2, { wallet: new Map(), installs: new Map([["a", { installed: true, version: "v", installedAt: "2026-10-30T10:00:00.000Z", planId: GROWTH_PLAN_ID, onTrial: true, trialEndsAt: end }]]) }, Date.parse("2026-11-13T00:00:00.000Z"));
  assert.equal(row.install?.endingSoon, true);
  assert.ok(bucketsOf(row).includes("app_trial"));
  assert.equal(moneyRow(cl2, { wallet: new Map(), installs: new Map() }).install, null);
});
