import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { slicesOf, type Totals } from "@/lib/analytics/today-queue";
import type { TodayData } from "@/lib/analytics/today-types";

// The rebuilt Today against the real database: two companies, each with client accounts that have conversations waiting for a reply. It proves three things.
//   1. An agency reads only its own company's accounts, and an account id from another company in `accounts=` changes nothing (no leak, no error).
//   2. A business or a client's staff (a signed session limited to one account) gets ONLY that account's rows, whatever `accounts=` says: the tampered
//      parameter naming the sibling account, the other company's account, or a list of both returns the same single account.
//   3. The count on every donut slice is the number of rows in the list behind it, and the queue's counts add up to the same totals.
// Fixture companies only, removed afterwards (deleting the installation cascades). Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CO_A = "xtest-today-a", CO_B = "xtest-today-b";
const A1 = "xtestTodayA1", A2 = "xtestTodayA2", B1 = "xtestTodayB1";
let instA = "", instB = "";

async function call(token: string, query = ""): Promise<{ status: number; body: TodayData & { error?: string } }> {
  const res = await handle(new Request(`http://localhost/api/app/today${query}`, { headers: { Authorization: `Bearer ${token}` } }), ["today"]);
  return { status: res.status, body: (await res.json()) as TodayData & { error?: string } };
}
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: kind === "client" ? "user" : "admin", userName: "Test", demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "account_user" : "account_admin" });
const accountsIn = (d: TodayData) => [...new Set(d.items.map((i) => i.locationId))].sort();

describe.skipIf(!HAS_DB)("Today reads only the accounts the signed session may read", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzToday A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzToday B', 'pro') returning id` as unknown as Array<{ id: string }>;
    await sql()`insert into settings (installation_id) values (${instA}) on conflict do nothing`;
    await sql()`insert into settings (installation_id) values (${instB}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzToday Client A1"], [instA, A2, "zzToday Client A2"], [instB, B1, "zzToday Client B1"]]) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
      // Three conversations whose last message is the customer's, older than the reply target: they are "unanswered messages" in the account.
      for (let i = 0; i < 3; i++) {
        await sql()`insert into cached_conversations (installation_id, location_id, conversation_id, contact_id, contact_name, last_message_type, last_message_direction, last_message_at)
          values (${inst}, ${loc}, ${`${loc}-c${i}`}, ${`${loc}-p${i}`}, ${`Person ${loc} ${i}`}, 'TYPE_SMS', 'inbound', now() - interval '3 days')`;
      }
    }
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("an agency sees its own two accounts, never the other company's", async () => {
    const r = await call(session(CO_A, "agency", null));
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe("all");
    expect(accountsIn(r.body)).toEqual([A1, A2]);
    expect(r.body.accounts.map((a) => a.id).sort()).toEqual([A1, A2]);
    expect(JSON.stringify(r.body)).not.toContain(B1);
  });

  it("an agency that names an account of another company gets nothing from it, and naming its own narrows to that one", async () => {
    const foreign = await call(session(CO_A, "agency", null), `?accounts=${B1}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body.items).toEqual([]);
    expect(JSON.stringify(foreign.body)).not.toContain(B1);
    const mixed = await call(session(CO_A, "agency", null), `?accounts=${A2},${B1}`);
    expect(accountsIn(mixed.body)).toEqual([A2]);
  });

  for (const kind of ["business", "client"] as const) {
    it(`${kind}: only their own account comes back, whatever the accounts parameter says`, async () => {
      const token = session(CO_A, kind, A1);
      for (const query of ["", `?accounts=${A2}`, `?accounts=${B1}`, `?accounts=${A1},${A2},${B1}`, `?accounts=%2e%2e%2f${A2}`, `?industry=x&owner=y&hideTest=1`]) {
        const r = await call(token, query);
        expect(r.status, query).toBe(200);
        expect(r.body.scope, query).toBe("account");
        expect(accountsIn(r.body), query).toEqual([A1]);
        expect(r.body.accounts.map((a) => a.id), query).toEqual([A1]);
        const text = JSON.stringify(r.body);
        expect(text, query).not.toContain(A2);
        expect(text, query).not.toContain(B1);
        expect(text, query).not.toContain("zzToday Client A2");
      }
    });
    it(`${kind}: the read holds no fees, plan, settings or other-account fields`, async () => {
      const r = await call(session(CO_A, kind, A1));
      const keys = Object.keys(r.body);
      for (const forbidden of ["plan", "settings", "fees", "monthlyFee", "owner", "billing", "entitlements"]) expect(keys, forbidden).not.toContain(forbidden);
      expect(JSON.stringify(r.body)).not.toMatch(/monthly_fee|monthlyFee|"plan"|slackWebhook|api[_-]?key/i);
    });
  }

  it("a client's staff get no alerts block (only a business administrator does); a business and an agency do", async () => {
    expect((await call(session(CO_A, "client", A1))).body.proof).toBeNull();
    expect((await call(session(CO_A, "business", A1))).body.proof).not.toBeNull();
    expect((await call(session(CO_A, "agency", null))).body.proof).not.toBeNull();
  });

  it("a session for an account of ANOTHER company's installation cannot read this company: the business session of B reads B only", async () => {
    const r = await call(session(CO_B, "business", B1), `?accounts=${A1}`);
    expect(accountsIn(r.body)).toEqual([B1]);
    expect(JSON.stringify(r.body)).not.toContain(A1);
  });

  it("the count on each slice is the number of rows in the list behind it, and the queue adds up to the same totals", async () => {
    const r = await call(session(CO_A, "agency", null));
    const totals: Totals = r.body.totals;
    for (const s of slicesOf(totals)) {
      const rows = r.body.items.filter((i) => i.kind === s.kind);
      expect(s.count, `${s.kind}: slice count vs rows in its list`).toBe(rows.length);
      expect(r.body.queue.filter((q) => q.kind === s.kind).reduce((n, q) => n + q.count, 0), `${s.kind}: queue rows add up`).toBe(s.count);
    }
    expect(totals.unanswered.count).toBe(6);
    // Narrowing to one account narrows every number with it.
    const one = await call(session(CO_A, "agency", null), `?accounts=${A1}`);
    expect(one.body.totals.unanswered.count).toBe(3);
    expect(one.body.queue.every((q) => q.locationId === A1)).toBe(true);
  });
  it("marks set aside on one account never reach a business or client view of another account of the same installation", async () => {
    // A team-lane mark on A2 (an agency pressed Done there). A business or a client's staff reading A1 must not learn the account, the row or the item ids from it.
    const [ev] = await sql()`insert into today_actions (installation_id, location_id, row_key, kind, action, lane, actor_key, item_ids) values (${instA}, ${A2}, ${`${A2}|unanswered`}, 'unanswered', 'done', 'team', 'u-agency', ${["unanswered:secret-item-id"]}::text[]) returning id`;
    try {
      for (const kind of ["business", "client"] as const) {
        const r = await call(session(CO_A, kind, A1));
        expect(JSON.stringify(r.body), kind).not.toContain("secret-item-id");
        expect(JSON.stringify(r.body.holds), kind).not.toContain(A2);
        expect(r.body.assigned, kind).toEqual({});
      }
      expect((await call(session(CO_A, "agency", null))).status).toBe(200);
    } finally {
      await sql()`delete from today_actions where id = ${ev.id as number}`;
    }
  });
});
