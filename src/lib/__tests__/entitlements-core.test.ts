import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURES } from "../entitlements.ts";
import { agencyTier, can, FREE_FEATURES, lockedFeatures, modeFrom, parsePlanEvent, tierForPlan } from "../entitlements-core.ts";

const MAP = { plan_free: "free", plan_pro_9: "pro", plan_pro_5_old: "free" } as const;

test("open mode unlocks everything for everyone; only the word enforced turns checks on", () => {
  assert.equal(modeFrom(undefined), "open");
  assert.equal(modeFrom("OPEN"), "open");
  assert.equal(modeFrom("enforced "), "open", "a typo never enforces by accident");
  assert.equal(modeFrom("enforced"), "enforced");
  for (const f of FEATURES) assert.equal(can(f, "free", "open"), true, f);
  assert.deepEqual(lockedFeatures(FEATURES, "free", "open"), []);
});

test("enforced: free keeps overview, search, data health and settings; everything else needs the paid plan", () => {
  for (const f of ["overview", "search", "health", "settings"] as const) assert.equal(can(f, "free", "enforced"), true, f);
  for (const f of ["inbox", "appointments", "calls", "alerts", "pipelines", "stale"] as const) assert.equal(can(f, "free", "enforced"), false, f);
  for (const f of FEATURES) assert.equal(can(f, "pro", "enforced"), true, f);
  const locked = lockedFeatures(FEATURES, "free", "enforced");
  assert.ok(locked.includes("inbox") && !locked.includes("search"));
  assert.equal(locked.length, FEATURES.length - FREE_FEATURES.size);
  assert.deepEqual(lockedFeatures(FEATURES, "pro", "enforced"), []);
});

test("a plan id maps to a tier through the table, and anything unknown is free", () => {
  assert.equal(tierForPlan("plan_pro_9", MAP), "pro");
  assert.equal(tierForPlan("plan_free", MAP), "free");
  assert.equal(tierForPlan("plan_pro_5_old", MAP), "free", "the old $5 plan can be mapped away without a deploy");
  assert.equal(tierForPlan("never-seen", MAP), "free");
  assert.equal(tierForPlan(null, MAP), "free");
  assert.equal(tierForPlan("toString", MAP), "free", "a plan id can never be an object property name");
});

test("an agency is paid when at least one of its accounts is", () => {
  assert.equal(agencyTier(["free", "free", "pro"]), "pro");
  assert.equal(agencyTier(["free", "free"]), "free");
  assert.equal(agencyTier([]), "free");
});

test("install and plan-change events are read from either shape", () => {
  assert.deepEqual(parsePlanEvent({ type: "AppInstall", planId: "p1", locationId: "L1", trial: { onTrial: true, trialDuration: 14 } }), { planId: "p1", locationId: "L1", onTrial: true, trialDays: 14 });
  assert.deepEqual(parsePlanEvent({ type: "PlanChange", data: { newPlanId: "p2", locationId: "L2" } }), { planId: "p2", locationId: "L2", onTrial: false, trialDays: null });
  assert.deepEqual(parsePlanEvent(null), { planId: null, locationId: null, onTrial: false, trialDays: null });
  assert.equal(parsePlanEvent({ planId: 12 }).planId, null);
});
