import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURES } from "../entitlements.ts";
import { agencyTier, can, FREE_FEATURES, GROWTH_PLAN_ID, LEGACY_PLAN_IDS, lockedFeatures, modeFrom, parsePlanEvent, planName, tierForPlan, trialEnded } from "../entitlements-core.ts";

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
  assert.deepEqual(parsePlanEvent({ type: "AppInstall", planId: "p1", locationId: "L1", trial: { onTrial: true, trialDuration: 14 } }), { planId: "p1", locationId: "L1", onTrial: true, trialDays: 14, trialStartedAt: null });
  assert.deepEqual(parsePlanEvent({ type: "PlanChange", data: { newPlanId: "p2", locationId: "L2" } }), { planId: "p2", locationId: "L2", onTrial: false, trialDays: null, trialStartedAt: null });
  assert.deepEqual(parsePlanEvent(null), { planId: null, locationId: null, onTrial: false, trialDays: null, trialStartedAt: null });
  assert.equal(parsePlanEvent({ planId: 12 }).planId, null);
});

const D = (iso: string) => new Date(iso);

test("Growth maps to full access and is named growth; the legacy Free Plan keeps full access", () => {
  assert.equal(tierForPlan(GROWTH_PLAN_ID, {}), "pro");
  assert.equal(planName(GROWTH_PLAN_ID), "growth");
  assert.equal(tierForPlan(LEGACY_PLAN_IDS[0], {}), "pro", "existing test installs on the deleted Free Plan keep working");
  assert.equal(planName(LEGACY_PLAN_IDS[0]), "legacy");
  assert.equal(tierForPlan(LEGACY_PLAN_IDS[0], { [LEGACY_PLAN_IDS[0]]: "free" }), "pro", "a stale table row cannot take legacy access away");
});

test("the old five dollar plan keeps access when it is mapped in the table", () => {
  assert.equal(tierForPlan("old-five-dollar-plan", { "old-five-dollar-plan": "pro" }), "pro");
});

test("an unknown or missing plan id never crashes and reads as the limited tier", () => {
  assert.equal(tierForPlan("never-seen", {}), "free");
  assert.equal(tierForPlan(undefined, {}), "free");
  assert.equal(tierForPlan("constructor", {}), "free");
  for (const f of FEATURES) assert.equal(can(f, tierForPlan("never-seen", {}), "open"), true, "open mode still unlocks everything");
});

test("a running trial is full access; an ended trial drops to limited and is reported as ended", () => {
  const row = { onTrial: true, trialStartedAt: D("2026-11-01T00:00:00Z"), trialDays: 14 };
  assert.equal(trialEnded(row, D("2026-11-10T00:00:00Z")), false);
  assert.equal(trialEnded(row, D("2026-11-16T00:00:00Z")), true);
  assert.equal(trialEnded({ ...row, onTrial: false }, D("2026-12-01T00:00:00Z")), false, "a converted install is never ended");
  assert.equal(trialEnded({ ...row, trialStartedAt: null }, D("2026-12-01T00:00:00Z")), false, "unknown start: stay safe, keep access");
  assert.equal(tierForPlan(null, {}, { onTrial: true, ended: false }), "pro");
  assert.equal(tierForPlan(GROWTH_PLAN_ID, {}, { onTrial: true, ended: true }), "free");
});

test("trial start date is read from the install event", () => {
  const e = parsePlanEvent({ planId: GROWTH_PLAN_ID, trial: { onTrial: true, trialDuration: 14, trialStartDate: "2026-11-01T00:00:00Z" } });
  assert.equal(e.trialStartedAt, "2026-11-01T00:00:00.000Z");
});
