import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { snapshotAccount, dayOf, outcomeStats } from "@/lib/data-health/store";
import { raiseSpikes } from "@/lib/data-health/cron";

// The Data health module against a real database, with two fake companies. Checks: tenant isolation (a company and a client's staff only see their own
// accounts, any id from the browser is checked against the session), numbers equal the rows behind them, history and fixed-at dates, the quality firewall
// alert (deduped, resolved, outcome recorded), safe fixes (admin only, preview token, protected contacts, rehearsal, idempotent, undo), benchmark k-anonymity.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
delete process.env.DATA_HEALTH_WRITE_LIVE;

const CO_A = "xtest-dh-a", CO_B = "xtest-dh-b";
const A1 = "xtestDhA1", A2 = "xtestDhA2", B1 = "xtestDhB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null, personRole = kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin") =>
  signSession({ companyId: company, userId: `u-${kind}-${company}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole } as never);
async function call(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const res = await handle(new Request(`http://localhost/api/app/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), path.split("?")[0].split("/"));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}
const seed = (inst: string, loc: string, n: number, bad: number) => sql()`
  insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, source, dnd, assigned_to, date_added, last_activity_at)
  select ${inst}, ${loc}, 'c' || g, case when g <= ${bad} then 'test' else 'Pat' end, 'Lee' || g, case when g <= ${bad} then null else 'p' || g || '@real.io' end,
    case when g % 10 = 0 then '(415) 555-' || lpad((1000 + g)::text, 4, '0') else '+1415555' || lpad((1000 + g)::text, 4, '0') end, case when g <= ${bad} then 'Import' else 'Form' end,
    g = 10, 'u1', now() - interval '3 days', now() - interval '1 day' from generate_series(1, ${n}) g`;

describe.skipIf(!HAS_DB)("Data health module", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzDh A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzDh B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzDh Client A1"], [instA, A2, "zzDh Client A2"], [instB, B1, "zzDh Client B1"]]) await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    await seed(instA, A1, 120, 15);
    await seed(instA, A2, 20, 0);
    await seed(instB, B1, 120, 40);
    await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, contact_id, status) values (${instA}, ${A1}, 'o1', 'c20', 'open')`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("each company and each client account sees only its own", async () => {
    const a = await call(session(CO_A, "agency", null), "GET", "data-health");
    expect(a.status).toBe(200);
    expect(a.body.accounts.map((x: Json) => x.name).sort()).toEqual(["zzDh Client A1", "zzDh Client A2"]);
    expect(JSON.stringify(a.body)).not.toContain("zzDh Client B1");
    const b = await call(session(CO_B, "agency", null), "GET", "data-health");
    expect(b.body.accounts.map((x: Json) => x.name)).toEqual(["zzDh Client B1"]);
    const client = await call(session(CO_A, "client", A2), "GET", "data-health");
    expect(client.body.accounts.map((x: Json) => x.name)).toEqual(["zzDh Client A2"]);
    // A2 is too small to score
    expect(client.body.accounts[0].score).toBeNull();
    // Attacks: another company's account, another account in the same company, with every endpoint.
    for (const path of [`data-health/records?loc=${B1}`, `data-health/sources?loc=${B1}`, `data-health/proof?loc=${B1}`, `data-health/export?loc=${B1}`, `data-health/fixes?loc=${B1}`]) expect((await call(session(CO_A, "agency", null), "GET", path)).status).toBe(404);
    for (const path of [`data-health/records?loc=${A1}`, `data-health/proof?loc=${A1}`, `data-health/export?loc=${A1}`]) expect((await call(session(CO_A, "client", A2), "GET", path)).status).toBe(404);
    expect((await call(session(CO_A, "agency", null), "POST", "data-health/mark", { locationId: B1, contactIds: ["c1"], state: "ignored" })).status).toBe(400);
    expect((await call(session(CO_A, "client", A2), "POST", "data-health/mark", { locationId: A2, contactIds: ["c1"], state: "ignored" })).status).toBe(403);
    // ?wa= can only narrow
    const wide = await call(session(CO_A, "agency", null), "GET", `data-health?wa=${B1}`);
    expect(JSON.stringify(wide.body)).not.toContain("zzDh Client B1");
  });

  it("every number equals the records behind it, and the score is explained", async () => {
    const v = await call(session(CO_A, "agency", null), "GET", `data-health?wa=${A1}`);
    const acc = v.body.accounts[0];
    expect(acc.score).not.toBeNull();
    expect(v.body.accounts[0].components.find((c: Json) => c.id === "junk").count).toBe(15);
    for (const c of acc.components.filter((x: Json) => x.count > 0)) {
      const r = await call(session(CO_A, "agency", null), "GET", `data-health/records?loc=${A1}&rule=${c.id}`);
      expect(r.status).toBe(200);
      expect(r.body.spec.count, c.id).toBe(c.count);
      expect(r.body.spec.rows.length, c.id).toBe(c.count);
    }
    const junk = (await call(session(CO_A, "agency", null), "GET", `data-health/records?loc=${A1}&rule=junk`)).body.spec;
    expect(junk.rows[0].url).toContain(A1);
    expect(JSON.stringify({ ...junk, rows: junk.rows.map((r: Json) => r.cells) })).not.toMatch(/gohighlevel|highlevel|ghl/i);
  });

  it("history: first seen and fixed-at, since install", async () => {
    const t0 = Date.now() + 10 * 86_400_000;
    const before = await snapshotAccount(instA, A1, t0);
    await sql()`update cached_contacts set first_name = 'Pat', email = 'fixed' || contact_id || '@real.io' where installation_id = ${instA} and location_id = ${A1} and first_name = 'test'`;
    const after = await snapshotAccount(instA, A1, t0 + 2 * 86_400_000);
    expect(after.score!).toBeGreaterThan(before.score!);
    const [f] = await sql()`select count(*) filter (where fixed_at is not null)::int fixed, count(*)::int found from dh_flags where installation_id = ${instA} and location_id = ${A1} and rule = 'junk'`;
    expect(f.found).toBe(15);
    expect(f.fixed).toBe(15);
    // The same day twice changes nothing (idempotent).
    await snapshotAccount(instA, A1, t0 + 2 * 86_400_000);
    const [n] = await sql()`select count(*)::int n from dh_snapshots where installation_id = ${instA} and location_id = ${A1} and day = ${dayOf(t0 + 2 * 86_400_000)}::date`;
    expect(n.n).toBe(1);
    const past = await call(session(CO_A, "agency", null), "GET", `data-health/records?loc=${A1}&rule=junk&day=${dayOf(t0 + 86_400_000)}`);
    expect(past.body.spec.count).toBe(15);
    const now = await call(session(CO_A, "agency", null), "GET", `data-health/records?loc=${A1}&rule=junk`);
    expect(now.body.spec.count).toBe(0);
    const v = await call(session(CO_A, "agency", null), "GET", `data-health?wa=${A1}`);
    expect(v.body.since.found).toBeGreaterThan(0);
    expect(v.body.since.fixed).toBeGreaterThanOrEqual(15);
  });

  it("quality firewall: alert raised once, resolved when it clears, outcome recorded", async () => {
    await sql()`update cached_contacts set first_name = 'test', date_added = now() - interval '2 hours', source = 'Bad Import' where installation_id = ${instA} and location_id = ${A1} and contact_id in (select 'c' || g from generate_series(61, 80) g)`;
    const r1 = await snapshotAccount(instA, A1, Date.now());
    expect(r1.spikes.length).toBe(1);
    expect(r1.spikes[0].source).toBe("Bad Import");
    const accts = [{ locationId: A1, name: "zzDh Client A1" }];
    expect((await raiseSpikes(instA, accts, [r1])).length).toBe(1);
    expect((await raiseSpikes(instA, accts, [r1])).length).toBe(0);
    const [open] = await sql()`select count(*)::int n from alerts where installation_id = ${instA} and kind = 'quality' and resolved_at is null`;
    expect(open.n).toBe(1);
    const src = await call(session(CO_A, "agency", null), "GET", `data-health/sources?loc=${A1}`);
    expect(src.body.sources.find((s: Json) => s.source === "Bad Import").count).toBe(20);
    await sql()`update cached_contacts set first_name = 'Pat' where installation_id = ${instA} and location_id = ${A1}`;
    const r2 = await snapshotAccount(instA, A1, Date.now());
    expect(r2.spikes.length).toBe(0);
    await raiseSpikes(instA, accts, [r2]);
    const [still] = await sql()`select count(*)::int n from alerts where installation_id = ${instA} and kind = 'quality' and resolved_at is null`;
    expect(still.n).toBe(0);
    const o = await outcomeStats(instA, [A1], 0);
    expect(o.raised).toBe(1);
    expect(o.fixed).toBe(1);
    expect(o.avgHoursToFix).not.toBeNull();
  });

  it("safe fixes: admin only, protected skipped, rehearsal, idempotent, undo", async () => {
    await sql()`update cached_contacts set first_name = 'JOHN' where installation_id = ${instA} and location_id = ${A1} and contact_id in ('c10', 'c20', 'c30')`;
    await sql()`update cached_contacts set phone = '(415) 555-2000' where installation_id = ${instA} and location_id = ${A1} and contact_id in ('c10', 'c20', 'c30', 'c40')`;
    const owner = session(CO_A, "agency", null);
    expect((await call(session(CO_A, "client", A1), "POST", "data-health/preview", { locationId: A1, kinds: ["phone"] })).status).toBe(403);
    expect((await call(session(CO_A, "agency", null, "agency_staff"), "POST", "data-health/preview", { locationId: A1, kinds: ["phone"] })).status).toBe(403);
    expect((await call(owner, "POST", "data-health/preview", { locationId: B1, kinds: ["phone"] })).status).toBe(400);
    const p = await call(owner, "POST", "data-health/preview", { locationId: A1, kinds: ["phone", "name"] });
    expect(p.status).toBe(200);
    const ids = new Set(p.body.changes.map((c: Json) => c.contactId));
    expect(ids.has("c10")).toBe(false); // do not disturb
    expect(ids.has("c20")).toBe(false); // open deal
    expect(ids.has("c30")).toBe(true);
    expect(p.body.skipped).toBeGreaterThanOrEqual(2);
    expect((await call(owner, "POST", "data-health/confirm", { locationId: A1, kinds: ["phone", "name"], token: "x.y" })).status).toBe(409);
    const ok = await call(owner, "POST", "data-health/confirm", { locationId: A1, kinds: ["phone", "name"], token: p.body.token });
    expect(ok.body.outcome).toBe("dry_run");
    expect(ok.body.done).toBe(p.body.changes.length);
    const again = await call(owner, "POST", "data-health/confirm", { locationId: A1, kinds: ["phone", "name"], token: p.body.token });
    expect(again.body.done).toBe(0);
    const [{ n }] = await sql()`select count(*)::int n from cached_contacts where installation_id = ${instA} and location_id = ${A1} and phone = '(415) 555-2000'`;
    expect(n).toBe(4); // nothing was changed in SubSync's copy or sent
    const h = await call(owner, "GET", `data-health/fixes?loc=${A1}`);
    expect(h.body.rows.some((r: Json) => r.undoable)).toBe(true);
    const u = await call(owner, "POST", "data-health/undo", { locationId: A1 });
    expect(u.body.undone).toBe(p.body.changes.length);
    expect((await call(owner, "POST", "data-health/undo", { locationId: A1 })).status).toBe(404);
  });

  it("benchmarks need 10 accounts from 3 companies and honour the opt out", async () => {
    const v = await call(session(CO_A, "agency", null), "GET", `data-health?wa=${A1}`);
    expect(v.body.benchmark.line).toBeNull();
    expect(JSON.stringify(v.body)).not.toContain(instB);
    const save = await call(session(CO_A, "agency", null), "PUT", "data-health/rules", { locationId: "*", optOut: true });
    expect(save.status).toBe(200);
    const v2 = await call(session(CO_A, "agency", null), "GET", `data-health?wa=${A1}`);
    expect(v2.body.benchmark.optedOut).toBe(true);
    // a single account cannot write a company wide rule
    expect((await call(session(CO_A, "business", A1), "PUT", "data-health/rules", { locationId: "*", optOut: false })).status).toBe(403);
  });
});
