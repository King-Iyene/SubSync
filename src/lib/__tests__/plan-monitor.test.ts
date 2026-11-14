import assert from "node:assert/strict";
import { test } from "node:test";
import { monitorAlerts, monitorRow, parseCharges, planObservation, readCharges, type ChargeInfo, type MonitorInput } from "../analytics/plan-monitor-core.ts";
import { GROWTH_PLAN_ID } from "../entitlements-core.ts";
import type { Getter } from "../analytics/clients3-saas.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z"), DAY = 86_400_000;
const none: ChargeInfo = { state: "none", lastAt: null, amount: null, currency: null };
const inp = (o: Partial<MonitorInput> = {}): MonitorInput => ({ locationId: "a", name: "Acme", installed: true, planId: GROWTH_PLAN_ID, onTrial: false, trialEndsAt: null, charge: none, planChangedAt: null, paymentProblem: false, installsRead: true, ...o });

test("active: installed, no trial, nothing wrong", () => {
  const r = monitorRow(inp(), NOW);
  assert.equal(r.chip, "active"); assert.equal(r.planLabel, "Growth plan"); assert.equal(r.chargeNote, "No charge recorded");
});

test("trial ending: 2 days left shows the days in the chip and the row", () => {
  const r = monitorRow(inp({ onTrial: true, trialEndsAt: new Date(NOW + 1.5 * DAY).toISOString() }), NOW);
  assert.equal(r.chip, "trial"); assert.equal(r.trialDaysLeft, 2); assert.equal(r.chipLabel, "Trial ends in 2 days");
});

test("trial far away is a plain trial chip; no end date is said plainly, never invented", () => {
  assert.equal(monitorRow(inp({ onTrial: true, trialEndsAt: new Date(NOW + 10 * DAY).toISOString() }), NOW).chipLabel, "On a trial, 10 days left");
  const r = monitorRow(inp({ onTrial: true }), NOW);
  assert.equal(r.trialDaysLeft, null); assert.match(r.trialNote ?? "", /end date not given/);
});

test("plan changed, payment problem and not installed, in that priority", () => {
  assert.equal(monitorRow(inp({ planChangedAt: "2026-11-12T00:00:00Z" }), NOW).chip, "plan_changed");
  assert.equal(monitorRow(inp({ planChangedAt: "2026-11-12T00:00:00Z", paymentProblem: true }), NOW).chip, "payment_problem");
  assert.equal(monitorRow(inp({ installed: false, paymentProblem: true }), NOW).chip, "not_installed");
});

test("no data: unknown install says so, never Active", () => {
  const r = monitorRow(inp({ installed: null, planId: null, installsRead: false }), NOW);
  assert.equal(r.chip, "unknown"); assert.equal(r.planLabel, null); assert.equal(r.installStatus, "unknown"); assert.match(r.chipLabel, /needs permission/);
});

test("charges: newest charge wins, refunds are skipped, empty list is none", () => {
  const c = parseCharges({ charges: [
    { createdAt: "2026-11-01T00:00:00Z", amountCharged: 11.5, currency: "USD" },
    { createdAt: "2026-11-10T00:00:00Z", amountCharged: 11.5, currency: "USD" },
    { createdAt: "2026-11-12T00:00:00Z", amountCharged: 11.5, currency: "USD", transactionType: "refund" },
  ] });
  assert.deepEqual(c, { state: "ok", lastAt: "2026-11-10T00:00:00.000Z", amount: 11.5, currency: "USD" });
  assert.equal(parseCharges({ charges: [] }).state, "none");
  assert.equal(parseCharges(null).state, "none");
});

test("charges: documented path and version; permission refusal and other refusals are different states", async () => {
  const calls: string[] = [];
  const ok: Getter = async (p, v) => { calls.push(`${v} ${p}`); return { status: 200, body: { charges: [] } }; };
  assert.equal((await readCharges(ok, null)).state, "none");
  assert.deepEqual(calls, ["v3 /marketplace/billing/charges?skip=0&limit=100"]);
  const scope: Getter = async () => ({ status: 401, body: { message: "The token is not authorized for this scope." } });
  assert.equal((await readCharges(scope, null)).state, "needs_permission");
  const declined: Getter = async () => ({ status: 403, body: { message: "Forbidden" } });
  assert.equal((await readCharges(declined, ["oauth.readonly"])).state, "needs_permission");
  assert.equal((await readCharges(declined, ["charges.readonly"])).state, "not_available");
  assert.equal((await readCharges(async () => { throw new Error("x"); }, null)).state, "not_available");
});

test("plan observation: only a real change is recorded", () => {
  assert.equal(planObservation(undefined, GROWTH_PLAN_ID), null);
  assert.equal(planObservation(GROWTH_PLAN_ID, GROWTH_PLAN_ID), null);
  assert.deepEqual(planObservation(null, GROWTH_PLAN_ID), { from: null, to: "Growth plan" });
  assert.deepEqual(planObservation(GROWTH_PLAN_ID, "zzz"), { from: "Growth plan", to: "Other plan" });
});

test("alerts: trial ending in 3 days, plan changed, uninstall detected; old changes and healthy accounts raise nothing", () => {
  const trial = monitorRow(inp({ locationId: "t", name: "Trial Co", onTrial: true, trialEndsAt: new Date(NOW + 2.2 * DAY).toISOString() }), NOW);
  const far = monitorRow(inp({ locationId: "f", name: "Far Co", onTrial: true, trialEndsAt: new Date(NOW + 9 * DAY).toISOString() }), NOW);
  const changed = monitorRow(inp({ locationId: "c", name: "Change Co" }), NOW);
  const gone = monitorRow(inp({ locationId: "g", name: "Gone Co", installed: false }), NOW);
  const stale = monitorRow(inp({ locationId: "s", name: "Old Co", installed: false }), NOW);
  const recent = {
    planChanges: new Map([["c", { from: "Earlier test plan", to: "Growth plan", at: "2026-11-12T08:00:00.000Z" }]]),
    removed: new Map([["g", "2026-11-13T08:00:00.000Z"], ["s", "2026-10-01T08:00:00.000Z"]]),
  };
  const a = monitorAlerts([trial, far, changed, gone, stale], recent, NOW);
  assert.deepEqual(a.map((x) => x.kind).sort(), ["plan_changed", "plan_trial_ending", "plan_uninstalled"]);
  assert.ok(a.every((x) => x.dedupeKey.startsWith("pm:")));
  assert.equal(monitorAlerts([changed], { planChanges: new Map([["c", { from: null, to: null, at: "2026-10-01T00:00:00.000Z" }]]), removed: new Map() }, NOW).length, 0);
});
