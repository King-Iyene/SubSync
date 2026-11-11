import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// The Pipeline module against two fixture companies (removed afterwards), written after an earlier module leaked across tenants through a trusted `location` query parameter.
// Every part of GET /api/app/pipeline3, every address word it takes (location, owner, stage, source, reason, pipeline, bucket, q, deal) and every change route (pipeline3/act/...) is
// asked for another company's data and another account's data, and must give nothing, never an error page; an account with no deals gives 200 with nothing in it.
// Skipped when no database is configured or the migrations 20261126090000_pipeline3.sql and 20261126100000_pipeline_actions.sql are not applied yet.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 480_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
const CO_A = "xtest-pls-a", CO_B = "xtest-pls-b", CO_C = "xtest-pls-c";
const A1 = "xtestPlsA1", A2 = "xtestPlsA2", B1 = "xtestPlsB1", C1 = "xtestPlsC1";
const DAY = 86_400_000;
const PARTS = ["overview", "money-flow", "attention", "won-lost", "forecast", "people", "sources", "stage-history", "health", "receipt", "list", "detail", "replay"] as const;
const LEAK_B = /zzSecB|xtestPlsB1|xtestplsb1|secb-/i, LEAK_A2 = /zzSecA2|xtestPlsA2|xtestplsa2|seca2-/i;
let instA = "", instB = "", instC = "", applied = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null, demo = false) =>
  signSession({ companyId: company, userId: `u-${kind}-${company}`, role: "admin", userName: "T", demo, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { parsed = { raw: t }; }
  return { status: res.status, text: t, body: parsed };
}
const deal = (inst: string, loc: string, id: string, stage: string, o: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, opportunity_id: id, pipeline_id: `${loc}-pl`, pipeline_name: "Sales", stage_id: stage, stage_name: stage, contact_id: `c-${id}`, contact_name: `Person ${id}`,
  name: `Deal ${id}`, monetary_value: 1000, status: "open", assigned_to: "closer1", created_remote_at: new Date(Date.now() - 40 * DAY), last_stage_change_at: new Date(Date.now() - 2 * DAY), last_status_change_at: null, ...o,
});

describe.skipIf(!HAS_DB)("pipeline module: nothing crosses a company or an account", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from deal_history limit 1`; await sql()`select 1 from pipeline_actions limit 1`; applied = true; } catch { applied = false; }
    if (!applied) return;
    for (const co of [CO_A, CO_B, CO_C]) await sql()`delete from installations where company_id = ${co}`;
    const mk = async (co: string, name: string) => ((await sql()`insert into installations (company_id, company_name, plan) values (${co}, ${name}, 'pro') returning id`) as unknown as Array<{ id: string }>)[0].id;
    instA = await mk(CO_A, "zzSecA"); instB = await mk(CO_B, "zzSecB"); instC = await mk(CO_C, "zzSecC");
    for (const i of [instA, instB, instC]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A1}, 'zzSecA1 Client', 'UTC', true), (${instA}, ${A2}, 'zzSecA2 Client', 'UTC', true), (${instB}, ${B1}, 'zzSecB Client', 'UTC', true), (${instC}, ${C1}, 'zzSecC Client', 'UTC', true)`;
    await sql()`insert into team_names (installation_id, user_id, name) values (${instA}, 'closer1', 'Zed Closer'), (${instB}, 'closer1', 'zzSecB Closer')`;
    const stages = (n: string) => sql().json([{ id: "new", name: "New" }, { id: "proposal", name: n }]);
    await sql()`insert into pipelines (installation_id, location_id, pipeline_id, name, stages) values
      (${instA}, ${A1}, ${`${A1}-pl`}, 'Sales', ${stages("Proposal")}), (${instA}, ${A2}, ${`${A2}-pl`}, 'Sales', ${stages("Proposal")}), (${instB}, ${B1}, ${`${B1}-pl`}, 'Sales', ${stages("zzSecB stage")})`;
    await sql()`insert into cached_opportunities ${sql()([
      deal(instA, A1, "a1", "new"), deal(instA, A1, "a2", "proposal", { last_stage_change_at: new Date(Date.now() - 50 * DAY) }), deal(instA, A1, "a3", "proposal", { status: "won", monetary_value: 4000, last_status_change_at: new Date(Date.now() - 3 * DAY) }),
      deal(instA, A2, "seca2-1", "new", { name: "zzSecA2 deal one" }), deal(instA, A2, "seca2-2", "proposal", { name: "zzSecA2 deal two", last_stage_change_at: new Date(Date.now() - 60 * DAY) }),
      deal(instB, B1, "secb-1", "new", { name: "zzSecB deal one", source: "zzSecB source", assigned_to: "zzsecb-owner" }), deal(instB, B1, "secb-2", "proposal", { name: "zzSecB deal two", last_stage_change_at: new Date(Date.now() - 60 * DAY) }),
      deal(instB, B1, "secb-3", "proposal", { name: "zzSecB lost", status: "lost", monetary_value: 3000, last_status_change_at: new Date(Date.now() - 4 * DAY) }),
    ] as never)}`;
  });
  afterAll(async () => {
    if (applied) {
      for (const i of [instA, instB, instC]) for (const t of ["pipeline_actions", "deal_history", "deal_facts", "deal_stage_stats", "deal_forecast_log", "deal_record_state"]) await sql()`delete from ${sql()(t)} where installation_id = ${i}`.catch(() => undefined);
      for (const co of [CO_A, CO_B, CO_C]) await sql()`delete from installations where company_id = ${co}`;
    }
    await closeDb();
  });

  it("every part, as company A, asking for company B's account or B's words, shows nothing of B and never errors", async () => {
    if (!applied) return;
    const tok = session(CO_A, "agency", null);
    const asks = [
      "location=" + B1, "location=" + B1 + "&deal=secb-1", "location=" + B1 + "&id=secb-1", "id=secb-1", "deal=secb-1", "owner=zzsecb-owner", "source=zzSecB%20source", "stage=proposal", "stage=" + encodeURIComponent("sales|zzsecb stage"),
      "pipeline=zzSecB", "reason=zzSecB", "bucket=lost", "q=zzSecB", "location=" + B1 + "&bucket=won&owner=none&page=0&size=100", "location=%27%3B%20select%201", "location=" + "x".repeat(200),
    ];
    for (const part of PARTS) for (const extra of asks) {
      const r = await call(tok, "GET", `pipeline3?part=${part}&${extra}`);
      expect(r.status, `${part} ${extra}`).toBeLessThan(500);
      expect(r.text, `${part} ${extra}`).not.toMatch(LEAK_B);
    }
  });

  it("receipt and every part never echo a foreign account id, as agency or client, and a foreign owner or pipeline word finds nothing", async () => {
    if (!applied) return;
    for (const tok of [session(CO_A, "agency", null), session(CO_A, "client", A1)]) {
      for (const part of PARTS) {
        const r = await call(tok, "GET", `pipeline3?part=${part}&location=${B1}`);
        expect(r.text, part).not.toContain(B1);
        expect(r.body.locationId ?? null, part).toBeNull();
      }
    }
    const own = await call(session(CO_A, "agency", null), "GET", `pipeline3?part=receipt&location=${A1}`);
    expect(own.body.locationId).toBe(A1);
  });

  it("a deal's detail: by its own id in its own account it is found, by a foreign id or a foreign account it is not found", async () => {
    if (!applied) return;
    const a = session(CO_A, "agency", null);
    expect((await call(a, "GET", `pipeline3?part=detail&location=${A1}&id=a1`)).status).toBe(200);
    expect((await call(a, "GET", `pipeline3?part=detail&location=${A1}&id=secb-1`)).status).toBe(404);
    expect((await call(a, "GET", `pipeline3?part=detail&location=${B1}&id=secb-1`)).text).not.toMatch(LEAK_B);
    expect((await call(a, "GET", `pipeline3?part=detail&location=${A2}&id=a1`)).status).toBe(404);
    const b = session(CO_B, "agency", null);
    expect((await call(b, "GET", `pipeline3?part=detail&location=${A1}&id=a1`)).text).not.toMatch(/Deal a1/);
  });

  it("a client's staff in account A1 see nothing of A2 (the same agency) or of B, in any part or by any word", async () => {
    if (!applied) return;
    const tok = session(CO_A, "client", A1);
    const asks = ["location=" + A2, "location=" + B1, "location=" + A2 + "&id=seca2-1", "deal=seca2-1&location=" + A1, "q=zzSecA2", "owner=closer1&location=" + A2, "stage=proposal&location=" + A2, ""];
    for (const part of PARTS) for (const extra of asks) {
      const r = await call(tok, "GET", `pipeline3?part=${part}&${extra}`);
      expect(r.status, `${part} ${extra}`).toBeLessThan(500);
      expect(r.text, `${part} ${extra}`).not.toMatch(LEAK_A2);
      expect(r.text, `${part} ${extra}`).not.toMatch(LEAK_B);
    }
    expect((await call(tok, "GET", `pipeline3?part=detail&location=${A2}&id=seca2-1`)).status).toBeGreaterThanOrEqual(200);
    expect((await call(tok, "GET", `pipeline3?part=detail&location=${A2}&id=seca2-1`)).text).not.toMatch(LEAK_A2);
    // and no ranking of people or accounts
    expect((await call(tok, "GET", `pipeline3?part=people`)).body.rows ?? []).toEqual([]);
    expect((await call(tok, "GET", `pipeline3?part=health`)).body.rows ?? []).toEqual([]);
  });

  it("the change routes refuse a foreign account and a foreign deal, for every route and every id, and change nothing", async () => {
    if (!applied) return;
    const a = session(CO_A, "agency", null);
    const before = ((await sql()`select count(*)::int n from pipeline_actions where installation_id in (${instA}, ${instB})`) as unknown as Array<{ n: number }>)[0].n;
    for (const path of [`pipeline3/act/panel?locationId=${B1}&id=secb-1`, `pipeline3/act/panel?locationId=${A1}&id=secb-1`, `pipeline3/act/panel?locationId=${A2}&id=a1`, `pipeline3/act/meta?locationId=${B1}`]) {
      const r = await call(a, "GET", path);
      expect(r.status, path).toBeGreaterThanOrEqual(400);
      expect(r.status, path).toBeLessThan(500);
      expect(r.text, path).not.toMatch(LEAK_B);
    }
    const act = (kind: string) => ({ kind, ...(kind === "stage" ? { pipelineId: `${B1}-pl`, stageId: "proposal" } : kind === "owner" ? { userId: "closer1" } : kind === "value" ? { value: 1 } : kind === "status" ? { status: "won" } : kind === "note" ? { text: "x" } : kind === "delete" ? { typed: "Deal secb-1" } : { title: "t", dueDate: new Date(Date.now() + DAY).toISOString() }) });
    for (const kind of ["stage", "owner", "value", "status", "note", "task", "delete"]) {
      for (const [loc, opp] of [[B1, "secb-1"], [A1, "secb-1"], [A2, "a1"]] as const) {
        for (const step of ["preview", "do"]) {
          const r = await call(a, "POST", "pipeline3/act/apply", { locationId: loc, opportunityId: opp, step, action: act(kind) });
          expect([400, 403, 404], `${kind} ${loc} ${opp} ${step}: ${r.text}`).toContain(r.status);
          expect(r.text).not.toMatch(LEAK_B);
        }
      }
    }
    for (const bulk of [{ locationId: B1, ids: ["secb-1", "secb-2"] }, { locationId: A1, ids: ["secb-1", "secb-2"] }, { locationId: A2, ids: ["a1"] }]) {
      for (const kind of ["stage", "owner", "status", "task", "delete"]) {
        const r = await call(a, "POST", "pipeline3/act/bulk", { ...bulk, kind, step: "do", stageId: "proposal", pipelineId: `${B1}-pl`, userId: "closer1", status: "won", title: "t", dueDate: new Date(Date.now() + DAY).toISOString(), typed: "delete 2" });
        expect([400, 403, 404, 422], `${kind} ${JSON.stringify(bulk)}: ${r.text}`).toContain(r.status);
      }
    }
    const un = await call(a, "POST", "pipeline3/act/undo", { locationId: B1, batchId: "00000000-0000-4000-8000-000000000000" });
    expect([400, 403, 404, 410]).toContain(un.status);
    const after = ((await sql()`select count(*)::int n from pipeline_actions where installation_id in (${instA}, ${instB})`) as unknown as Array<{ n: number }>)[0].n;
    expect(after, "no foreign write was logged").toBe(before);
    expect(((await sql()`select count(*)::int n from cached_opportunities where installation_id = ${instB}`) as unknown as Array<{ n: number }>)[0].n).toBe(3);
  });

  it("a client's staff cannot reach an account of the same agency through the change routes either", async () => {
    if (!applied) return;
    const tok = session(CO_A, "client", A1);
    for (const path of [`pipeline3/act/panel?locationId=${A2}&id=seca2-1`, `pipeline3/act/meta?locationId=${A2}`, `pipeline3/act/panel?locationId=${B1}&id=secb-1`]) {
      const r = await call(tok, "GET", path);
      expect(r.status, path).toBeGreaterThanOrEqual(400);
      expect(r.text).not.toMatch(LEAK_A2);
    }
    const r = await call(tok, "POST", "pipeline3/act/apply", { locationId: A2, opportunityId: "seca2-1", step: "preview", action: { kind: "value", value: 5 } });
    expect([400, 403, 404]).toContain(r.status);
  });

  it("an account with no deals answers 200 for every part, empty, never a 500", async () => {
    if (!applied) return;
    for (const tok of [session(CO_C, "agency", null), session(CO_C, "client", C1)]) {
      for (const part of PARTS) {
        const r = await call(tok, "GET", `pipeline3?part=${part}&id=none&location=${C1}`);
        if (part === "detail") { expect(r.status).toBe(404); continue; }
        expect(r.status, part + ": " + r.text.slice(0, 200)).toBe(200);
      }
      expect((await call(tok, "GET", "pipeline3?part=list&bucket=open&stage=" + encodeURIComponent("sales|new"))).status).toBe(200);
    }
  });

  it("the demo account answers 200 for every part too", async () => {
    if (!applied) return;
    const tok = session(CO_A, "agency", null, true);
    for (const part of PARTS) {
      const r = await call(tok, "GET", `pipeline3?part=${part}`);
      expect(r.status, part + ": " + r.text.slice(0, 200)).toBeLessThan(500);
    }
  });

  it("A sees its own deals in every list part (the guard blocks the foreign, not the own)", async () => {
    if (!applied) return;
    const tok = session(CO_A, "agency", null);
    const r = await call(tok, "GET", "pipeline3?part=list&bucket=open&size=100");
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).toMatch(/Deal a1/);
    const byStage = await call(tok, "GET", "pipeline3?part=list&bucket=open&size=100&stage=" + encodeURIComponent("sales|new"));
    expect(byStage.status).toBe(200);
    expect(byStage.body.rows.every((x: Json) => x.stageName === "New")).toBe(true);
    expect(byStage.body.total).toBe(byStage.body.rows.length);
  });
});
