import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { recordDealHistory, sweepDealHistory } from "@/lib/analytics/pipeline3-record";
import { diffDeal } from "@/lib/analytics/pipeline3-diff";

// Pipeline round 3 against the real database: two fixture companies (removed afterwards). Skipped when no database is configured or the migration
// 20261126090000_pipeline3.sql is not applied yet.
//   1. A company sees only its own deals in every part; asking for another company's account gives nothing, and a deal detail is "not found".
//   2. The overview counts equal the rows of the lists they open (stuck, no owner, open); $0, ownerless and test deals are left out of the dollar tiles.
//   3. The recorder and the sweep are idempotent: running twice writes nothing new.
//   4. A client's staff get no ranking of people and no account ranking.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
const CO_A = "xtest-pl3-a", CO_B = "xtest-pl3-b", A1 = "xtestPl3A1", B1 = "xtestPl3B1";
let instA = "", instB = "", applied = false;
const DAY = 86_400_000;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, path: string) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } }), p.split("/"));
  const t = await res.text();
  return { status: res.status, body: (t ? JSON.parse(t) : {}) as Json };
}
const deal = (inst: string, loc: string, id: string, stage: string, o: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, opportunity_id: id, pipeline_id: `${loc}-pl`, pipeline_name: "Sales", stage_id: stage, stage_name: stage, contact_id: `c-${id}`, contact_name: `Person ${id}`,
  name: `Deal ${id}`, monetary_value: 1000, status: "open", assigned_to: "closer1", created_remote_at: new Date(Date.now() - 40 * DAY), last_stage_change_at: new Date(Date.now() - 2 * DAY), last_status_change_at: null, ...o,
});

describe.skipIf(!HAS_DB)("pipeline round 3", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from deal_history limit 1`; applied = true; } catch { applied = false; }
    if (!applied) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzPl3 A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzPl3 B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A1}, 'zzPl3 Client A', 'UTC', true), (${instB}, ${B1}, 'zzPl3 Client B', 'UTC', true)`;
    await sql()`insert into team_names (installation_id, user_id, name) values (${instA}, 'closer1', 'Zed Closer')`;
    await sql()`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values
      (${instA}, ${A1}, ${`${A1}-pl`}, 'Sales', ${JSON.stringify([{ id: "new", name: "New" }, { id: "proposal", name: "Proposal" }])}::jsonb),
      (${instB}, ${B1}, ${`${B1}-pl`}, 'Sales', ${JSON.stringify([{ id: "new", name: "New" }])}::jsonb)`;
    await sql()`insert into cached_opportunities ${sql()([
      deal(instA, A1, "a1", "new"), deal(instA, A1, "a2", "new", { last_stage_change_at: new Date(Date.now() - 40 * DAY) }), deal(instA, A1, "a3", "proposal", { last_stage_change_at: new Date(Date.now() - 60 * DAY), monetary_value: 3000 }),
      deal(instA, A1, "a4", "proposal", { assigned_to: null }), deal(instA, A1, "a5", "new", { monetary_value: 0 }), deal(instA, A1, "a6", "new", { name: "Test deal" }),
      deal(instA, A1, "a7", "proposal", { status: "won", monetary_value: 5000, last_status_change_at: new Date(Date.now() - 3 * DAY) }),
      deal(instA, A1, "a8", "proposal", { status: "lost", monetary_value: 2000, last_status_change_at: new Date(Date.now() - 4 * DAY) }),
      deal(instB, B1, "b1", "new"), deal(instB, B1, "b2", "new", { last_stage_change_at: new Date(Date.now() - 50 * DAY) }),
    ] as never)}`;
  });
  afterAll(async () => {
    if (applied) {
      for (const i of [instA, instB]) for (const t of ["deal_history", "deal_facts", "deal_stage_stats", "deal_forecast_log", "deal_record_state"]) await sql()`delete from ${sql()(t)} where installation_id = ${i}`;
      for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    }
    await closeDb();
  });

  it("isolates companies and keeps counts equal to rows", async () => {
    if (!applied) return;
    const t = session(CO_A, "agency", null);
    const o = await call(t, "pipeline3?part=overview");
    expect(o.status).toBe(200);
    // Counted open deals: a1, a2, a3 (value above zero, an owner, not a test). a4 has no owner, a5 no value, a6 is a test.
    expect(o.body.openCount).toBe(3);
    expect(o.body.openValue.value).toBe(5000);
    expect(o.body.health.noOwner).toBe(1);
    expect(o.body.health.noValue).toBe(1);
    expect(o.body.health.test).toBe(1);
    const stuck = await call(t, "pipeline3?part=list&bucket=stale&size=100");
    expect(stuck.body.total).toBe(o.body.stale.count);
    expect(stuck.body.rows.every((r: Json) => r.stale === true)).toBe(true);
    for (const [bucket, n] of [["open", o.body.openCount], ["no_owner", o.body.health.noOwner], ["no_value", o.body.health.noValue], ["test", o.body.health.test]] as const) {
      expect((await call(t, `pipeline3?part=list&bucket=${bucket}&size=100`)).body.total).toBe(n);
    }
    const all = await call(t, "pipeline3?part=list&size=100");
    expect(JSON.stringify(all.body)).not.toContain("b1");
    expect((await call(t, `pipeline3?part=list&location=${B1}`)).body.rows).toEqual([]);
    expect((await call(t, `pipeline3?part=detail&location=${B1}&id=b1`)).status).toBe(404);
    expect((await call(t, `pipeline3?part=detail&location=${A1}&id=a1`)).status).toBe(200);
    expect((await call(t, "pipeline3?part=forecast")).body.next30.enough).toBe(false);
  });

  it("the money flow lists stages, the drain and the vault from the account's own deals", async () => {
    if (!applied) return;
    const m = await call(session(CO_A, "agency", null), "pipeline3?part=money-flow");
    expect(m.status).toBe(200);
    expect(m.body.stages.map((s: Json) => s.name)).toEqual(["New", "Proposal"]);
    expect(m.body.vault.won.value).toBe(5000);
    expect(m.body.drainTotal.value).toBe(2000);
    expect(m.body.drain[0].reason).toBe("No reason recorded");
    expect(m.body.enoughHistory).toBe(false);
  });

  it("the recorder and the sweep are idempotent", async () => {
    if (!applied) return;
    const next = { stageId: "proposal", pipelineId: `${A1}-pl`, status: "open", value: 1000, ownerId: "closer1", source: null, lostReasonId: null, contactId: "c-a1", lastStageChangeAt: Date.now() - 1000, lastStatusChangeAt: null, createdAt: Date.now() - 40 * DAY };
    const prev = { ...next, stageId: "new", lastStageChangeAt: Date.now() - 2 * DAY };
    const ev = diffDeal("a1", prev, next, { at: Date.now() });
    const meta = { installationId: instA, locationId: A1, opportunityId: "a1", contactId: "c-a1" };
    expect(await recordDealHistory(meta, ev)).toBe(1);
    expect(await recordDealHistory(meta, ev)).toBe(0);
    await sweepDealHistory(instA);
    const second = await sweepDealHistory(instA);
    expect((second.created ?? 0) + (second.stages ?? 0) + (second.statuses ?? 0)).toBe(0);
    const [n] = await sql()`select count(*)::int n from deal_history where installation_id = ${instA} and opportunity_id = 'a1' and kind = 'stage'`;
    expect(n.n).toBe(1);
    const d = await call(session(CO_A, "agency", null), `pipeline3?part=detail&location=${A1}&id=a1`);
    expect(d.body.timeline.some((e: Json) => e.kind === "stage")).toBe(true);
  });

  it("gives a client's staff no ranking of people or accounts", async () => {
    if (!applied) return;
    const c = session(CO_A, "client", A1);
    expect((await call(c, "pipeline3?part=people")).body.rows).toEqual([]);
    expect((await call(c, "pipeline3?part=health")).body.rows).toEqual([]);
    expect((await call(c, "pipeline3?part=money-flow")).body.people).toEqual([]);
  });
});
