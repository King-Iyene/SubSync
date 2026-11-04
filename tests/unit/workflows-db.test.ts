import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// The Workflows module against a real database, with two fake companies:
//   1. A company sees only its own client accounts' workflows, and a client's staff only their own account. Every id that comes from the browser is checked
//      against the signed session, so another company's id answers like one that does not exist.
//   2. A change needs an administrator, the paid plan, a matching preview token and (for a delete) the typed name; with live changes off it is a rehearsal
//      that changes nothing in SubSync's copy; confirming twice does nothing the second time.
//   3. A missing table (migration not applied) shows an empty page, not an error.
// Fixture companies only, removed afterwards. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
delete process.env.WORKFLOWS_WRITE_LIVE;

const CO_A = "xtest-wf-a", CO_B = "xtest-wf-b";
const A1 = "xtestWfA1", A2 = "xtestWfA2", B1 = "xtestWfB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null, personRole = kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin") =>
  signSession({ companyId: company, userId: `u-${kind}-${company}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole } as never);
async function call(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await handle(new Request(`http://localhost/api/app/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), path.split("?")[0].split("/"));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}
const names = (b: Json) => (b.items as Array<{ name: string }>).map((i) => i.name).sort();

describe.skipIf(!HAS_DB)("Workflows module", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzWf A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzWf B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzWf Client A1"], [instA, A2, "zzWf Client A2"], [instB, B1, "zzWf Client B1"]]) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    }
    const w = (inst: string, loc: string, id: string, name: string, status: string, runs: number | null, failed: number | null) =>
      sql()`insert into workflow_items (installation_id, location_id, workflow_id, name, status, ui_url, remote_updated_at, runs_30d, enrolled_30d, failed_30d) values (${inst}, ${loc}, ${id}, ${name}, ${status}, '#crm', now() - interval '2 days', ${runs}, ${runs}, ${failed})`;
    await w(instA, A1, "a1-w1", "Missed Call Text Back", "published", 40, 30);
    await w(instA, A1, "a1-w2", "Old Draft", "draft", null, null);
    await w(instA, A2, "a2-w1", "Second Account Flow", "published", 10, 0);
    await w(instB, B1, "b1-w1", "Other Company Secret Flow", "published", 5, 0);
    await sql()`insert into workflow_items (installation_id, location_id, workflow_id, name, status, kind) values (${instA}, ${A1}, 'campaign:c1', 'Spring Promo', 'done', 'campaign:email')`;
    await sql()`insert into campaign_stats (installation_id, location_id, campaign_id, day, sent, delivered, bounced) values (${instA}, ${A1}, 'campaign:c1', current_date, 200, 100, 80)`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("each company and each client account sees only its own", async () => {
    const a = await call(session(CO_A, "agency", null), "GET", "workflows");
    expect(a.status).toBe(200);
    expect(names(a.body)).toEqual(["Missed Call Text Back", "Old Draft", "Second Account Flow", "Spring Promo"]);
    const b = await call(session(CO_B, "agency", null), "GET", "workflows");
    expect(names(b.body)).toEqual(["Other Company Secret Flow"]);
    const client = await call(session(CO_A, "client", A2), "GET", "workflows");
    expect(names(client.body)).toEqual(["Second Account Flow"]);
    expect(client.body.can).toEqual({ organise: false, change: false, health: true, sync: false });
    // The page's own account choice can narrow, never widen: another company's id changes nothing.
    const widen = await call(session(CO_A, "agency", null), "GET", `workflows?wa=${B1}`);
    expect(widen.body.items).toEqual([]);
    const narrow = await call(session(CO_A, "agency", null), "GET", `workflows?wa=${A2}`);
    expect(names(narrow.body)).toEqual(["Second Account Flow"]);
    // A client's staff pass their own account in the address and still see only theirs.
    const sneaky = await call(session(CO_A, "client", A2), "GET", `workflows?wa=${A1}`);
    expect(names(sneaky.body)).toEqual(["Second Account Flow"]);
  });

  it("another company's ids and a sibling account's ids are refused on every route", async () => {
    const agencyA = session(CO_A, "agency", null);
    const pick = [{ locationId: B1, workflowId: "b1-w1" }];
    expect((await call(agencyA, "POST", "workflows/preview", { kind: "publish", items: pick })).status).toBe(404);
    expect((await call(agencyA, "POST", "workflows/preview", { kind: "rename", items: pick, rule: { prefix: "X " }, allowPaused: true })).status).toBe(404);
    expect((await call(agencyA, "PUT", "workflows/labels", { items: pick, patch: { decision: "retire" } })).status).toBe(404);
    expect((await call(agencyA, "POST", "workflows/mark", { locationId: B1, workflowId: "b1-w1", action: "fixed" })).status).toBe(404);
    expect((await call(agencyA, "POST", "workflows/mark", { locationId: B1, workflowId: "coverage", action: "snooze", choice: "week" })).status).toBe(404);
    expect((await call(agencyA, "GET", `workflows/detail?locationId=${B1}&workflowId=b1-w1`)).status).toBe(404);
    expect((await call(agencyA, "POST", "workflows/undo", { changeId: 1 })).status).toBeGreaterThanOrEqual(400);
    const clientA2 = session(CO_A, "client", A2);
    const sibling = [{ locationId: A1, workflowId: "a1-w1" }];
    expect((await call(clientA2, "POST", "workflows/preview", { kind: "publish", items: sibling })).status).toBe(403);
    expect((await call(clientA2, "PUT", "workflows/labels", { items: sibling, patch: { decision: "retire" } })).status).toBeGreaterThanOrEqual(403);
    expect((await call(clientA2, "POST", "workflows/sync", {})).status).toBeGreaterThanOrEqual(403);
    const businessA2 = session(CO_A, "business", A2);
    expect((await call(businessA2, "POST", "workflows/preview", { kind: "publish", items: sibling })).status).toBe(404);
    expect((await call(businessA2, "GET", `workflows/detail?locationId=${A1}&workflowId=a1-w1`)).status).toBe(404);
    expect(await sql()`select 1 from workflow_labels where installation_id in (${instA}, ${instB})`).toHaveLength(0);
    expect(await sql()`select 1 from workflow_changes where installation_id in (${instA}, ${instB}) and source = 'subsync'`).toHaveLength(0);
  });

  it("publish: preview, confirm as a rehearsal, never twice, never with a changed request", async () => {
    const t = session(CO_A, "agency", null);
    const items = [{ locationId: A1, workflowId: "a1-w2" }];
    const p = await call(t, "POST", "workflows/preview", { kind: "publish", items });
    expect(p.status).toBe(200);
    expect(p.body.rows[0].to).toBe("Published");
    expect(p.body.dryRun).toBe(true);
    expect(p.body.token).toBeTruthy();
    const body = { kind: "publish", items, token: p.body.token };
    expect((await call(t, "POST", "workflows/confirm", { ...body, kind: "unpublish" })).status).toBe(409);
    expect((await call(session(CO_A, "business", A1), "POST", "workflows/confirm", body)).status).toBe(409);
    const first = await call(t, "POST", "workflows/confirm", body);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.dryRun).toBe(true);
    expect(first.body.results[0].outcome).toBe("dry_run");
    const [kept] = await sql()`select status from workflow_items where installation_id = ${instA} and workflow_id = 'a1-w2'`;
    expect(kept.status).toBe("draft");
    const second = await call(t, "POST", "workflows/confirm", body);
    expect(second.body.results[0].message).toMatch(/Already done/);
    const rows = await sql()`select kind, outcome from workflow_changes where installation_id = ${instA} and workflow_id = 'a1-w2' and source = 'subsync'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe("dry_run");
  });

  it("rename shows the preview with collisions and pauses, and nothing is sent without a key", async () => {
    const t = session(CO_A, "agency", null);
    const p = await call(t, "POST", "workflows/preview", { kind: "rename", items: [{ locationId: A1, workflowId: "a1-w2" }, { locationId: A1, workflowId: "a1-w1" }], rule: { prefix: "[Sales] " } });
    expect(p.status).toBe(200);
    expect(p.body.rows.map((r: Json) => r.status)).toEqual(["change", "blocked"]);
    expect(p.body.rows[0].to).toBe("[Sales] Old Draft");
    expect(p.body.rows[1].problem).toMatch(/Published/);
    const run = await call(t, "POST", "workflows/confirm", { kind: "rename", items: [{ locationId: A1, workflowId: "a1-w2" }], rule: { prefix: "[Sales] " }, token: (await call(t, "POST", "workflows/preview", { kind: "rename", items: [{ locationId: A1, workflowId: "a1-w2" }], rule: { prefix: "[Sales] " } })).body.token });
    expect(run.status).toBe(200);
    expect(run.body.results[0].outcome).not.toBe("done");
    const [kept] = await sql()`select name from workflow_items where installation_id = ${instA} and workflow_id = 'a1-w2'`;
    expect(kept.name).toBe("Old Draft");
  });

  it("delete needs the typed name and, for one that ran recently, a second tick; a campaign cannot be changed from here", async () => {
    const t = session(CO_A, "agency", null);
    const items = [{ locationId: A1, workflowId: "a1-w2" }];
    const p = await call(t, "POST", "workflows/preview", { kind: "delete", items });
    expect(p.body.phrase).toBe("Old Draft");
    expect((await call(t, "POST", "workflows/confirm", { kind: "delete", items, token: p.body.token, typed: "old draft" })).status).toBe(400);
    const done = await call(t, "POST", "workflows/confirm", { kind: "delete", items, token: p.body.token, typed: "Old Draft" });
    expect(done.status).toBe(200);
    expect(done.body.results[0].outcome).not.toBe("done");
    expect(await sql()`select 1 from workflow_items where installation_id = ${instA} and workflow_id = 'a1-w2' and removed_seen_at is null`).toHaveLength(1);
    expect((await call(t, "POST", "workflows/preview", { kind: "publish", items: [{ locationId: A1, workflowId: "campaign:c1" }] })).status).toBe(400);
    const active = await call(t, "POST", "workflows/preview", { kind: "delete", items: [{ locationId: A1, workflowId: "a1-w1" }] });
    expect(active.body.active).toBe(1);
    expect((await call(t, "POST", "workflows/confirm", { kind: "delete", items: [{ locationId: A1, workflowId: "a1-w1" }], token: active.body.token, typed: "Missed Call Text Back" })).body.needsActiveConfirm).toBe(true);
  });

  it("labels, marks and the health list work inside the signed session", async () => {
    const t = session(CO_A, "agency", null);
    expect((await call(t, "PUT", "workflows/labels", { items: [{ locationId: A1, workflowId: "a1-w1" }], patch: { decision: "keep", rating: 4, labels: ["lead handling"], note: "Core" } })).status).toBe(200);
    expect((await call(t, "PUT", "workflows/labels", { items: [{ locationId: A1, workflowId: "a1-w1" }], patch: { rating: 9 } })).status).toBe(400);
    let v = await call(t, "GET", "workflows");
    expect(v.body.labels[`${A1}|a1-w1`].decision).toBe("keep");
    expect(v.body.findings.some((f: Json) => f.kind === "failing" && f.workflowId === "a1-w1")).toBe(true);
    expect((await call(t, "POST", "workflows/mark", { locationId: A1, workflowId: "a1-w1", action: "fixed" })).status).toBe(200);
    v = await call(t, "GET", "workflows");
    expect(v.body.findings.some((f: Json) => f.workflowId === "a1-w1")).toBe(false);
    expect(v.body.muted.some((f: Json) => f.workflowId === "a1-w1" && f.why === "fixed")).toBe(true);
    await call(t, "POST", "workflows/mark", { locationId: A1, workflowId: "a1-w1", action: "reopen" });
    expect((await call(session(CO_A, "client", A1), "POST", "workflows/mark", { locationId: A1, workflowId: "a1-w1", action: "fixed" })).status).toBe(403);
    const client = await call(session(CO_A, "client", A1), "GET", "workflows");
    expect(client.body.labels).toEqual({});
  });

  it("campaign delivery: totals only, flagged when it looks sent but did not arrive, scoped to the company", async () => {
    const d = await call(session(CO_A, "agency", null), "GET", "workflows/delivery");
    expect(d.status).toBe(200);
    expect(d.body.camps).toHaveLength(1);
    expect(d.body.totals.sent).toBe(200);
    expect(d.body.totals.opened).toBeNull();
    expect(d.body.flags.map((f: Json) => f.kind)).toContain("not_delivered");
    expect(d.body.notAvailable.people).toMatch(/not available from the platform yet/);
    const other = await call(session(CO_B, "agency", null), "GET", "workflows/delivery");
    expect(other.body.camps).toHaveLength(0);
    const p = await call(session(CO_A, "agency", null), "GET", "workflows/proof?days=7");
    expect(p.status).toBe(200);
  });

  it("round 2: tidy, turned off and saved views stay inside the session", async () => {
    await sql()`insert into workflow_items (installation_id, location_id, workflow_id, name, status, remote_updated_at) values
      (${instA}, ${A1}, 'a1-w3', 'Missed Call Text Back (copy)', 'draft', now()), (${instA}, ${A2}, 'a2-w2', 'Missed Call Text Back', 'published', now()),
      (${instA}, ${A2}, 'a2-w3', 'Welcome  Message ', 'draft', now()), (${instB}, ${B1}, 'b1-w2', 'Missed Call Text Back', 'published', now())`;
    await sql()`insert into workflow_changes (installation_id, location_id, workflow_id, kind, source, before, after, created_at) values (${instA}, ${A1}, 'a1-w3', 'status', 'observed', ${sql().json({ status: "published" } as never)}, ${sql().json({ status: "draft" } as never)}, now() - interval '1 day')`;
    const t = session(CO_A, "agency", null);
    const v = await call(t, "GET", "workflows");
    expect(v.body.findings.some((f: Json) => f.kind === "turned_off" && f.workflowId === "a1-w3")).toBe(true);
    const cmp = v.body.tidy.compare.find((g: Json) => g.name.startsWith("Missed Call Text Back"));
    expect(cmp.items.map((i: Json) => i.locationId).sort()).toEqual([A1, A1, A2].sort());
    expect(cmp.items.some((i: Json) => i.locationId === B1)).toBe(false);
    expect(v.body.tidy.names.map((n: Json) => n.issue).sort()).toEqual(expect.arrayContaining(["copy", "spaces"]));
    expect(v.body.tidy.dupes.length).toBeGreaterThan(0);
    expect((await call(session(CO_A, "client", A2), "GET", "workflows")).body.tidy).toBeNull();
    // saved views: only the person's own choices, another company's account id is dropped, a client may not save, and a view is private to its owner
    const save = await call(t, "POST", "workflows/views", { name: "Mine", filters: { show: "both", tab: "tidy", picked: [A1, B1, "nonsense"] } });
    expect(save.status).toBe(200);
    const list = await call(t, "GET", "workflows/views");
    expect(list.body.views).toHaveLength(1);
    expect(list.body.views[0].filters.picked).toEqual([A1]);
    expect((await call(session(CO_A, "client", A1), "POST", "workflows/views", { name: "x", filters: {} })).status).toBeGreaterThanOrEqual(403);
    expect((await call(session(CO_A, "client", A1), "GET", "workflows/views")).body.views).toEqual([]);
    expect((await call(session(CO_B, "agency", null), "GET", "workflows/views")).body.views).toEqual([]);
    expect((await call(t, "POST", "workflows/views", { name: " ", filters: {} })).status).toBe(400);
    expect((await call(t, "DELETE", "workflows/views?name=Mine")).status).toBe(200);
    expect((await call(t, "GET", "workflows/views")).body.views).toEqual([]);
  });

  it("the scheduled refresh answers only to the secret, and only touches companies that have the module on", async () => {
    const { GET } = await import("@/app/api/cron/workflows/route");
    process.env.CRON_SECRET = "test-secret-for-workflows";
    expect((await GET(new Request("http://localhost/api/cron/workflows"))).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/cron/workflows", { headers: { Authorization: "Bearer wrong" } }))).status).toBe(401);
    const ok = await GET(new Request("http://localhost/api/cron/workflows", { headers: { Authorization: "Bearer test-secret-for-workflows" } }));
    expect(ok.status).toBe(200);
    const b = (await ok.json()) as Json;
    expect(typeof b.companies).toBe("number");
  });

  it("with the tables missing the page still opens, empty", async () => {
    await sql()`alter table workflow_items rename to workflow_items_hidden`;
    try {
      const v = await call(session(CO_A, "agency", null), "GET", "workflows");
      expect(v.status).toBe(200);
      expect(v.body.available).toBe(false);
      expect(v.body.items).toEqual([]);
      const d = await call(session(CO_A, "agency", null), "GET", "workflows/delivery");
      expect(d.status).toBe(200);
    } finally { await sql()`alter table workflow_items_hidden rename to workflow_items`; }
  });
});
