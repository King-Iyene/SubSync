import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Clean-up fix lists, Health and bulk runs against the real database, with tiny xtest- fixtures only (removed afterwards; deleting the installation cascades).
//   1. Lists only ever show the caller's own accounts; a forged account id answers "not found" and is never echoed.
//   2. Protected contacts (asked not to be contacted) show their reason and are left out of a bulk run.
//   3. A bulk run needs the typed words; with the switch or the account's opt-in off it is a dry run that changes nothing, and it is logged.
//   4. The daily record is idempotent per account and day.
// Skipped when no database is configured, or the migration 20261216090000_cu_cleanup.sql has not been applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";

const CO_A = "xtest-cu-a", CO_B = "xtest-cu-b";
const A1 = "xtestCuA1", B1 = "xtestCuB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string) => signSession({ companyId: company, userId: "u-agency", role: "admin", userName: "Test agency", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" } as never);
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), p.split("/"));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}
const contact = (inst: string, loc: string, id: string, first: string, last: string, email: string | null, phone: string | null, dnd = false) => ({ installation_id: inst, location_id: loc, contact_id: id, first_name: first, last_name: last, email, phone, tags: [] as string[], dnd });

describe.skipIf(!HAS_DB)("Clean-up fix lists, health and bulk runs", () => {
  beforeAll(async () => {
    const [t] = await sql()`select to_regclass('public.cu_scans') is not null as ok`;
    ready = t.ok === true;
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzCu A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzCu B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzCu A1"], [instB, B1, "zzCu B1"]]) await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    const rows = [
      contact(instA, A1, "a-junk", "Test", "Test", "x@y.co", "+15550101111"), contact(instA, A1, "a-junk-dnd", "Asdf", "Q", "q@y.co", "+15550101112", true),
      contact(instA, A1, "a-ok", "Ann", "Ames", "ann@x.co", "+15550101113"), contact(instB, B1, "b-junk", "Test", "Other", "t@y.co", "+15550202222"),
    ];
    for (const r of rows) await sql()`insert into cached_contacts ${sql()(r)}`;
  });
  afterAll(async () => { if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("lists only the caller's own contacts and marks protected ones", async () => {
    if (!ready) return;
    const r = await call(session(CO_A), "GET", "cu/list?kind=junk");
    expect(r.status).toBe(200);
    const ids = (r.body.rows as Json[]).map((x) => x.contactId);
    expect(ids).toContain("a-junk");
    expect(ids).not.toContain("b-junk");
    expect((r.body.rows as Json[]).find((x) => x.contactId === "a-junk-dnd")?.protect).toBe("dnd");
    expect(JSON.stringify(r.body)).not.toContain(B1);
  });

  it("a forged account id is not found and not echoed", async () => {
    if (!ready) return;
    for (const path of [`cu/list?kind=junk&account=${B1}`, `cu/home?account=${B1}`, `cu/csv?kind=junk&account=${B1}`]) {
      const r = await call(session(CO_A), "GET", path);
      expect(r.status, path).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain(B1);
    }
    const bad = await call(session(CO_A), "GET", "cu/list?kind=junk&after=zzz");
    expect(bad.status).toBe(400);
    expect((await call(session(CO_A), "GET", "cu/list?kind=drop_table")).status).toBe(400);
  });

  it("a bulk run leaves protected contacts out, needs the typed words, and is a dry run while switched off", async () => {
    if (!ready) return;
    const t = session(CO_A);
    const foreign = await call(t, "POST", "cu/bulk", { step: "preview", kind: "junk", action: "remove", account: B1 });
    expect(foreign.status).toBe(404);
    const p = await call(t, "POST", "cu/bulk", { step: "preview", kind: "junk", action: "remove", account: A1 });
    expect(p.status).toBe(200);
    expect(p.body.requested).toBe(1);
    expect(p.body.protectedSkipped).toBe(1);
    expect(p.body.mode).toBe("dry_run");
    expect(p.body.phrase).toBe("remove Test Test");
    const wrong = await call(t, "POST", "cu/bulk", { step: "do", kind: "junk", action: "remove", account: A1, typed: "remove 1 contact" });
    expect(wrong.status).toBe(400);
    const none = await call(t, "POST", "cu/bulk", { step: "do", kind: "junk", action: "remove", account: A1 });
    expect(none.status).toBe(400);
    const ok = await call(t, "POST", "cu/bulk", { step: "do", kind: "junk", action: "remove", account: A1, typed: "Remove Test Test" });
    expect(ok.status).toBe(200);
    expect(ok.body.mode).toBe("dry_run");
    expect(ok.body.done).toBe(0);
    const [still] = await sql()`select count(*)::int n from cached_contacts where installation_id = ${instA}`;
    expect(still.n).toBe(3);
    const [logged] = await sql()`select count(*)::int n from cu_actions where installation_id = ${instA} and mode = 'dry_run' and typed_ok`;
    expect(logged.n).toBe(1);
    const nonJunk = await call(t, "POST", "cu/bulk", { step: "preview", kind: "no_phone", action: "remove", account: A1 });
    expect(nonJunk.status).toBe(400);
  });

  it("the daily record is idempotent per account and day, and counts only", async () => {
    if (!ready) return;
    const t = session(CO_A);
    await call(t, "POST", "cu/scan", {});
    await call(t, "POST", "cu/scan", {});
    const rows = await sql()`select * from cu_scans where installation_id = ${instA}`;
    expect(rows.length).toBe(1);
    expect(rows[0].contacts).toBe(3);
    expect(rows[0].junk).toBe(2);
    expect(await sql()`select 1 from cu_scans where installation_id = ${instB}`).toHaveLength(0);
    const home = await call(t, "GET", "cu/home");
    expect(home.body.source).toBe("daily");
    expect(home.body.counts.junk.n).toBe(2);
    expect(JSON.stringify(home.body)).not.toContain("zzCu B1");
  });
});
