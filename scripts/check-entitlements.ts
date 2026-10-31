import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto";
import { closeDb, sql } from "../src/lib/db";
import { recordPlanEvent } from "../src/lib/entitlements-queries";
import { signSession } from "../src/lib/session";

// Plan entitlements in ENFORCED mode, with real (non-demo) installs and simulated plan ids, the way the
// pre-pilot gate asks. The dev server must run with ENTITLEMENTS_MODE=enforced, so this is not part of the
// default run:
//   ENTITLEMENTS_MODE=enforced CHECKS=check-entitlements node --env-file=.env.local scripts/with-dev-server.mjs
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const COMPANIES = ["xtest-plan-a", "xtest-plan-b"];
const PLANS = ["xtest-plan-free", "xtest-plan-pro", "xtest-plan-old5"];

async function main() {
  const call = async (path: string, token: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const clean = async () => {
    await sql()`delete from installations where company_id = any(${COMPANIES}::text[])`;
    await sql()`delete from plan_entitlements where plan_id = any(${PLANS}::text[])`;
  };
  const make = async (company: string, planId: string | null) => {
    const [i] = await sql()`insert into installations (company_id, company_name, plan, plan_id, access_token_enc, refresh_token_enc, token_expires_at)
      values (${company}, ${company}, 'free', ${planId}, ${encryptSecret("x")}, ${encryptSecret("y")}, now() + interval '1 hour') returning id`;
    await sql()`insert into locations (installation_id, location_id, name) values (${i.id}, ${"xtestLoc" + company.slice(-1).toUpperCase() + "0001"}, ${company + " account"})`;
    return { id: i.id as string, token: signSession({ companyId: company, userId: "u", role: "admin", userName: "T", demo: false, kind: "agency", locationId: null }) };
  };
  const demo = ((await (await fetch(`${BASE}/api/sso`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ demo: true }) })).json()) as { session: string }).session;

  await clean();
  try {
    await sql()`insert into plan_entitlements (plan_id, tier, note) values ('xtest-plan-free', 'free', 'check'), ('xtest-plan-pro', 'pro', 'check'), ('xtest-plan-old5', 'free', 'check')`;
    const A = await make("xtest-plan-a", "xtest-plan-free");
    const B = await make("xtest-plan-b", "xtest-plan-pro");

    // free plan: the free list works, everything else is a plain upgrade message, not an error
    for (const p of ["/api/app/overview", "/api/app/search?q=zz", "/api/app/accounts", "/api/app/settings"]) assert.equal((await call(p, A.token)).status, 200, `free: ${p}`);
    for (const p of ["/api/app/inbox", "/api/app/appointments", "/api/app/appointment-insights", "/api/app/call-queue", "/api/app/alerts"]) {
      const r = await call(p, A.token);
      assert.equal(r.status, 402, `free: ${p} -> ${r.status}`);
      assert.equal(r.body.upgrade, true);
    }
    const ov = await call("/api/app/overview", A.token);
    assert.ok(ov.body.entitlements.locked.includes("inbox") && !ov.body.entitlements.locked.includes("search"), "the sign-in data says what is locked");
    assert.equal(ov.body.entitlements.enforced, true);

    // the paid plan, mapped by table: everything open
    assert.equal((await call("/api/app/inbox", B.token)).status, 200, "pro: inbox");
    assert.equal((await call("/api/app/appointments", B.token)).status, 200, "pro: appointments");
    assert.deepEqual((await call("/api/app/overview", B.token)).body.entitlements.locked, []);

    // the two agencies do not affect each other, and the demo stays fully unlocked
    assert.equal((await call("/api/app/inbox", A.token)).status, 402);
    assert.equal((await call("/api/app/inbox", demo)).status, 200, "a demo install is always on the paid plan");

    // a plan swap is a table row: re-map the pro plan to free and the paid agency locks at once, no deploy
    await sql()`update plan_entitlements set tier = 'free' where plan_id = 'xtest-plan-pro'`;
    assert.equal((await call("/api/app/inbox", B.token)).status, 402, "re-mapping a plan takes effect immediately");
    await sql()`update plan_entitlements set tier = 'pro' where plan_id = 'xtest-plan-pro'`;
    assert.equal((await call("/api/app/inbox", B.token)).status, 200);

    // the old $5 plan mapped to free, an unknown id and no plan at all are all free
    await sql()`update installations set plan_id = 'xtest-plan-old5' where id = ${A.id}`;
    assert.equal((await call("/api/app/inbox", A.token)).status, 402);
    await sql()`update installations set plan_id = 'never-heard-of-it' where id = ${A.id}`;
    assert.equal((await call("/api/app/inbox", A.token)).status, 402, "an unknown plan id fails closed");
    await sql()`update installations set plan_id = null where id = ${A.id}`;
    assert.equal((await call("/api/app/inbox", A.token)).status, 402, "no plan recorded fails closed");

    // per-account plans from install and plan-change events: one paid account unlocks the agency view
    assert.equal(await recordPlanEvent(A.id, { type: "AppInstall", planId: "xtest-plan-pro", locationId: "xtestLocA0001", trial: { onTrial: true, trialDuration: 14 } }), true);
    assert.equal((await call("/api/app/inbox", A.token)).status, 200, "one paid account unlocks the agency");
    const [row] = await sql()`select on_trial, trial_days from install_plans where installation_id = ${A.id}`;
    assert.deepEqual([row.on_trial, row.trial_days], [true, 14], "trial details are kept");
    assert.equal(await recordPlanEvent(A.id, { type: "PlanChange", data: { newPlanId: "xtest-plan-free", locationId: "xtestLocA0001" } }), true);
    assert.equal((await call("/api/app/inbox", A.token)).status, 402, "a downgrade locks it again");
    assert.equal((await sql()`select count(*)::int n from install_plans where installation_id = ${A.id}`)[0].n, 1, "one row per account, updated in place");
    assert.equal(await recordPlanEvent(A.id, { type: "PlanChange" }), false, "an event with no plan changes nothing");

    console.log("entitlements (enforced): free list works, the rest answers 402, plan swap is a row, unknown plans fail closed, per-account plans, demo unlocked, agencies independent: ok");
  } finally {
    await clean();
    await closeDb();
  }
}

main().catch(async (error) => {
  console.error("FAILED:", error instanceof Error ? error.stack : error);
  try { await sql()`delete from installations where company_id = any(${COMPANIES}::text[])`; await sql()`delete from plan_entitlements where plan_id = any(${PLANS}::text[])`; await closeDb(); } catch { /* best effort */ }
  process.exit(1);
});
