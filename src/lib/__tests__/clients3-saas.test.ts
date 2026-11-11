import assert from "node:assert/strict";
import { test } from "node:test";
import { readSaasPlans, stateFor, type Getter } from "../analytics/clients3-saas.ts";

const page = (ids: Array<[string, string | null]>, next: boolean) => ({ locations: ids.map(([id, plan]) => ({ locationId: id, saasMode: "activated", subscriptionInfo: plan ? { saasPlanId: plan, subscriptionStatus: "active" } : {} })), pagination: { hasNext: next } });

test("reads every page with companyId, v3, and maps plan names and three states", async () => {
  const calls: string[] = [];
  const get: Getter = async (path, version) => {
    calls.push(`${version} ${path}`);
    if (path.includes("page=1")) return { status: 200, body: page([["a", "p1"], ["b", null]], true) };
    if (path.includes("page=2")) return { status: 200, body: page([["c", "p1"]], false) };
    return { status: 200, body: { title: "Growth" } };
  };
  const r = await readSaasPlans(get, "co1");
  assert.equal(r.failed, null);
  assert.deepEqual(calls.filter((c) => c.includes("saas-locations")), ["v3 /saas/saas-locations/co1?page=1", "v3 /saas/saas-locations/co1?page=2"]);
  assert.ok(calls.includes("v3 /saas/saas-plan/p1?companyId=co1") && calls.filter((c) => c.includes("saas-plan")).length === 1);
  assert.deepEqual(stateFor(r, "a"), { state: "ok", planId: "p1", planName: "Growth", status: "active" });
  assert.equal(stateFor(r, "b").state, "no_plan");
  assert.equal(stateFor(r, "zzz").state, "no_plan");
});

test("needs permission only for 401 or 403; other failures are not available", async () => {
  for (const [status, want] of [[401, "needs_permission"], [403, "needs_permission"], [500, "not_available"], [429, "not_available"]] as const) {
    const r = await readSaasPlans(async () => ({ status, body: null }), "co1");
    assert.equal(stateFor(r, "a").state, want);
  }
});

test("retries with the older version header when the platform rejects the new one", async () => {
  const seen: string[] = [];
  const r = await readSaasPlans(async (_p, v) => { seen.push(v); return v === "v3" ? { status: 422, body: null } : { status: 200, body: page([["a", null]], false) }; }, "co1");
  assert.deepEqual(seen, ["v3", "2021-07-28"]);
  assert.equal(stateFor(r, "a").state, "no_plan");
});
