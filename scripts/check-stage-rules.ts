import assert from "node:assert/strict";
import { encryptSecret } from "../src/lib/crypto";
import { closeDb, sql } from "../src/lib/db";
import { signSession } from "../src/lib/session";

// The owner's stage rules over HTTP, with two real separate agencies in the database (stage F1, N37 and N38): the rule changes every figure at once
// on every page, an invalid change is refused, a client's staff can neither see the controls nor change them, a business can change its own, and one
// agency's rules never touch another's. Everything created is removed afterwards (no refresh token, so the production scheduler ignores it).
// Usage: BASE_URL=http://localhost:3100 node --env-file=.env.local --import tsx scripts/check-stage-rules.ts
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

async function main() {
  const db = sql();
  const cos = ["xtest-rules-a", "xtest-rules-b"];
  const ids: Record<string, string> = {};
  for (const co of cos) await db`delete from installations where company_id = ${co}`;
  try {
    for (const [k, co] of cos.entries()) {
      const [inst] = await db`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${co}, ${"zzRules" + k}, 'pro', ${encryptSecret("not-a-real-token")}, now() + interval '1 hour') returning id`;
      ids[co] = inst.id as string;
      await db`insert into settings (installation_id) values (${inst.id}) on conflict do nothing`;
      const loc = `xtestRulesLoc${k}`;
      await db`insert into locations (installation_id, location_id, name, timezone, client_view, pipeline_count) values (${inst.id}, ${loc}, ${"zzRules account " + k}, 'UTC', true, 1)`;
      await db`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values (${inst.id}, ${loc}, 'p1', 'Sales', ${db.json([{ id: "s1", name: "New" }, { id: "s3", name: "Disqualified" }] as never)})`;
      const deal = (n: string, stage: string, value: number) => db`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, assigned_to, last_stage_change_at, last_action_at, updated_remote_at, last_status_change_at, created_remote_at)
        values (${inst.id}, ${loc}, ${loc + n}, 'p1', ${stage}, ${loc + "c"}, 'Pat', ${"Deal " + n}, ${value}, 'open', 'u1', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days', now() - interval '20 days')`;
      await deal("new", "s1", 1000);
      await deal("dq", "s3", 5000);
    }
    const [A, B] = cos;
    const locA = "xtestRulesLoc0";
    const sess = (co: string, kind: "agency" | "business" | "client", loc?: string) => signSession({ companyId: co, userId: "u-" + kind, role: "admin", userName: "Tester", demo: false, kind, locationId: loc ?? null, dataOwner: false });
    const call = async (path: string, token: string, init: RequestInit = {}) => {
      const res = await fetch(`${BASE}/api/app/${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
      const text = await res.text();
      let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, body, text };
    };
    const put = (token: string, body: unknown) => call("stage-rules", token, { method: "PUT", body: JSON.stringify(body) });
    const agencyA = sess(A, "agency");
    const agencyB = sess(B, "agency");

    // 1. The starting point: the name says Disqualified is closed out, so only the 1,000 deal counts.
    let p = (await call("pipeline-intel", agencyA)).body;
    assert.equal(p.totals.openValue, 1000);
    assert.deepEqual(p.excluded, { count: 1, closedOut: 1, noValue: 0, noOwner: 0 });
    const dq = p.stageControls.stages.find((s: { stage: string }) => s.stage === "Disqualified");
    assert.deepEqual([dq.treatment, dq.out, dq.source], ["Closed out", true, "name"]);
    assert.equal(p.forecast.method, "none");

    // 2. The owner says it is still worked: every page follows at once.
    assert.equal((await put(agencyA, { pipeline: "Sales", stage: "Disqualified", cls: "active" })).status, 200);
    p = (await call("pipeline-intel", agencyA)).body;
    const ov = (await call("overview", agencyA)).body;
    assert.equal(p.totals.openValue, 6000);
    assert.equal(ov.kpis.openValue, 6000, "Overview agrees with Pipeline");
    assert.equal(ov.kpis.excludedByStage, 0);
    const dq2 = p.stageControls.stages.find((s: { stage: string }) => s.stage === "Disqualified");
    assert.deepEqual([dq2.treatment, dq2.out, dq2.source], ["Active", false, "owner"]);
    const [rev] = await db`select deal_rules_revision n from settings where installation_id = ${ids[A]}`;
    assert.equal(rev.n, 1, "changing a class is a new definition version");

    // 3. A win probability is the owner's assumption: it makes a labelled forecast, leaves out stages without one, and is not a new version.
    assert.equal((await put(agencyA, { pipeline: "Sales", stage: "New", winProbability: 30 })).status, 200);
    p = (await call("pipeline-intel", agencyA)).body;
    assert.equal(p.forecast.method, "owner");
    assert.deepEqual(p.forecast.range, { low: 200, likely: 300, high: 400 }, "1,000 at 30 percent, 10 points either way");
    assert.equal(p.forecast.ownerUnsetDeals, 1, "the 5,000 deal sits in a stage with no probability and is left out, not guessed");
    assert.ok(String(p.forecast.basis).startsWith("Your own assumptions"));
    const [rev2] = await db`select deal_rules_revision n from settings where installation_id = ${ids[A]}`;
    assert.equal(rev2.n, 1, "a probability does not change the version");

    // 4. Bad changes are refused.
    for (const bad of [{ pipeline: "Sales", stage: "New", cls: "banana" }, { pipeline: "Sales", stage: "New", winProbability: 150 }, { pipeline: "Sales", stage: null, cls: "closed_out" }, { pipeline: "", stage: null, cls: "in_use" }, {}]) {
      assert.equal((await put(agencyA, bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await put(agencyA, { pipeline: "No such pipeline", stage: null, cls: "not_in_use" })).status, 404, "a name nobody has cannot fill the table");
    assert.equal((await put(agencyA, { pipeline: "Sales", stage: "No such stage", cls: "ignore" })).status, 404);

    // 5. One agency's rules never reach another's: B has the same pipeline name and still counts by the name rule.
    p = (await call("pipeline-intel", agencyB)).body;
    assert.equal(p.totals.openValue, 1000, "agency B is untouched by agency A's rule");
    const [other] = await db`select count(*)::int n from stage_rules where installation_id = ${ids[B]}`;
    assert.equal(other.n, 0);

    // 6. A client's own staff can neither change a rule nor see the controls or the owner's assumptions; the numbers they see are still counted the same way.
    const client = sess(A, "client", locA);
    assert.equal((await put(client, { pipeline: "Sales", stage: "New", winProbability: 90 })).status, 403);
    const cp = (await call("pipeline-intel", client)).body;
    assert.equal(cp.stageControls, null, "no controls for a client");
    assert.equal(cp.forecast.method, "none", "the owner's assumptions are not applied to, or leaked into, a client's view");
    assert.ok(!JSON.stringify(cp).includes("Your own assumptions"));
    assert.equal(cp.totals.openValue, 6000, "the client sees the same counted deals the owner does");
    const cs = await call("contact-intel", client);
    assert.equal(cs.body.canEditCold, false);

    // 7. A business that installed for itself may change its own rules (and only its own).
    const business = sess(A, "business", locA);
    assert.equal((await put(business, { pipeline: "Sales", stage: "Disqualified", cls: "closed_out" })).status, 200);
    p = (await call("pipeline-intel", agencyA)).body;
    assert.equal(p.totals.openValue, 1000, "back to the 1,000 deal after the owner closes the stage out again");
    // 8. Taking the rule off puts the name back in charge, and the rule row is gone.
    assert.equal((await put(agencyA, { pipeline: "Sales", stage: "Disqualified", cls: null })).status, 200);
    const [left] = await db`select count(*)::int n from stage_rules where installation_id = ${ids[A]} and stage_key = 'disqualified'`;
    assert.equal(left.n, 0);
    p = (await call("pipeline-intel", agencyA)).body;
    assert.equal(p.stageControls.stages.find((s: { stage: string }) => s.stage === "Disqualified").source, "name");

    console.log("stage rules: the owner's rule changes every page at once, a probability makes a labelled forecast without a new version, bad changes are refused (400, 404), a client can neither see nor change them, agencies are separate, a business changes its own: ok");
  } finally {
    for (const co of cos) await db`delete from installations where company_id = ${co}`;
    await closeDb();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
