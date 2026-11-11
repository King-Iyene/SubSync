import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant regression for Clients v2 (client-account management): company A's agency asks for company B's account on every part and write. Nothing of B may come back (data, name,
// plan or its id echoed) and B's rows must not change. Also the positive controls: A can read and change its own account. Skips until the Clients v2 migration is applied. Tiny xtest- fixtures, removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-cl2-a", CO_B = "xtest-cl2-b", A1 = "xtestCl2A1", B1 = "xtestCl2B1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* csv */ }
  return { status: res.status, text: t, body: parsed };
}

describe.skipIf(!HAS_DB)("clients v2 cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from cl2_notes limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzC2 A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzC2 B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, email, timezone) values (${instA}, ${A1}, 'zzC2 Client A1', 'a1@xtest.test', 'UTC'), (${instB}, ${B1}, 'zzC2 Secret B', 'b1@xtest.test', 'UTC')`;
    await sql()`insert into client_billing (installation_id, location_id, state, plan_name, subscription_status, price_amount, price_currency, billing_interval, status_since)
      values (${instA}, ${A1}, 'ok', 'zzPlanA', 'past_due', 50, 'USD', 'month', now() - interval '3 days'), (${instB}, ${B1}, 'ok', 'zzSecretPlanB', 'past_due', 999, 'USD', 'month', now())`;
    await sql()`insert into cl2_notes (installation_id, location_id, kind, body) values (${instB}, ${B1}, 'note', 'zzSecretNoteB')`;
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("reads: another company's account is not found and nothing of it leaks in any part", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    const mine = await call(t, "GET", `clients2?part=account&id=${A1}`);
    expect(mine.status).toBe(200);
    expect(mine.body.plan.name).toBe("zzPlanA");
    const other = await call(t, "GET", `clients2?part=account&id=${B1}`);
    expect(other.status).toBe(404);
    expect(other.text).not.toContain("zzSecret");
    expect(other.text).not.toContain(B1);
    for (const part of ["list", "options", "today", "plans", "views", "export"]) {
      for (const extra of ["", `&q=zzSecret&manager=zzSecret`, `&cursor=${B1}`, `&location=${B1}`]) {
        const r = await call(t, "GET", `clients2?part=${part}${extra}`);
        expect(r.text, `${part}${extra}`).not.toContain("zzSecret");
        expect(r.text, `${part}${extra}`).not.toContain(B1);
      }
    }
    const list = await call(t, "GET", "clients2?part=list");
    expect(list.body.total).toBe(1);
    expect(list.body.rows[0].name).toBe("zzC2 Client A1");
    const plans = await call(t, "GET", "clients2?part=plans");
    expect(plans.body.total).toBe(1);
    expect(plans.body.atRisk).toEqual([{ currency: "USD", monthly: 50, accounts: 1 }]);
  });

  it("a client's own staff get nothing from this module", async () => {
    if (!ok) return;
    const t = session(CO_A, "client", A1);
    const r = await call(t, "GET", "clients2?part=list");
    expect([200, 403, 404]).toContain(r.status);
    expect(r.body.rows ?? []).toEqual([]);
  });

  it("writes: notes, tags and views aimed at another company's account change nothing and say not found", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    const before = (await sql()`select count(*)::int c from cl2_notes where installation_id = ${instB}`)[0].c;
    const calls: Array<[string, unknown]> = [
      ["note-add", { location: B1, kind: "note", body: "hacked" }],
      ["note-update", { location: B1, id: "00000000-0000-0000-0000-000000000000", body: "hacked" }],
      ["note-delete", { location: B1, id: "00000000-0000-0000-0000-000000000000", confirm: "x" }],
      ["tag", { locations: [B1], vertical: "solar", step: "do" }],
    ];
    for (const [op, body] of calls) {
      const r = await call(t, "POST", `clients2/${op}`, body);
      expect(r.status, op).toBe(404);
      expect(r.text).not.toContain("zzSecret");
    }
    expect((await sql()`select count(*)::int c from cl2_notes where installation_id = ${instB}`)[0].c).toBe(before);
    expect((await sql()`select vertical from account_profiles where installation_id = ${instB} and location_id = ${B1}`).length).toBe(0);
    // a note id that belongs to B, asked through A's own account, is not reachable either
    const bId = (await sql()`select id from cl2_notes where installation_id = ${instB} limit 1`)[0].id as string;
    const del = await call(t, "POST", "clients2/note-delete", { location: A1, id: bId, confirm: "zzSecretNoteB" });
    expect(del.status).toBe(404);
    expect((await sql()`select 1 from cl2_notes where id = ${bId}::uuid`).length).toBe(1);
  });

  it("positive controls: add, edit and delete a note (typed confirmation) and tag an account of one's own", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    const add = await call(t, "POST", "clients2/note-add", { location: A1, kind: "next_step", body: "Call the owner about the card" });
    expect(add.status).toBe(200);
    const id = add.body.note.id as string;
    expect((await call(t, "POST", "clients2/note-update", { location: A1, id, done: true })).body.note.done).toBe(true);
    const bad = await call(t, "POST", "clients2/note-delete", { location: A1, id, confirm: "nope" });
    expect(bad.status).toBe(400);
    expect(bad.body.confirmWith).toBe("Call the owner about the card");
    expect((await call(t, "POST", "clients2/note-delete", { location: A1, id, confirm: "call the owner about the card" })).status).toBe(200);
    const pre = await call(t, "POST", "clients2/tag", { locations: [A1, B1], vertical: "solar", step: "preview" });
    expect(pre.body.count).toBe(1);
    expect(pre.body.skipped).toBe(1);
    expect(JSON.stringify(pre.body)).not.toContain(B1);
    expect((await call(t, "POST", "clients2/tag", { locations: [A1, B1], vertical: "solar", step: "do" })).body.done).toBe(1);
    expect((await call(t, "GET", `clients2?part=account&id=${A1}`)).body.row.vertical).toBe("solar");
  });
});
