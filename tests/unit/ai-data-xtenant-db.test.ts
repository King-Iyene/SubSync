import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { saveTurn, listTurns } from "@/lib/ai/data/ask-store";
import { saveConnection } from "@/lib/ai/store";

// Cross-tenant test for the AI data jobs (Ask your data and the others), with tiny fixtures (prefix xtest-) removed afterwards. Skips until the migration is applied.
//   1. The rows behind a number are only ever the caller's own: a client account sees its own account, a company sees its own accounts, another company sees nothing of theirs, and a request
//      that names another account cannot widen what a client session reads.
//   2. A person's question history is theirs alone: not another person's, another account's staff, or another company's. Deleting needs the typed word.
//   3. The jobs refuse the people who must not run them (staff without the owner role, a client's staff for cleaning and duplicates), and without a connection nothing is sent anywhere.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const CO_A = "xtest-aid-a", CO_B = "xtest-aid-b", A1 = "xtestAidA1", A2 = "xtestAidA2", B1 = "xtestAidB1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const owner = (company: string, user = `u-${company}`) => signSession({ companyId: company, userId: user, role: "admin", userName: "T", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
const staff = (company: string) => signSession({ companyId: company, userId: `staff-${company}`, role: "user", userName: "S", demo: false, kind: "agency", locationId: null, personRole: "agency_staff" });
const clientUser = (company: string, loc: string) => signSession({ companyId: company, userId: `cu-${company}`, role: "user", userName: "C", demo: false, kind: "client", locationId: loc, personRole: "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body: parsed };
}
const ROWS = "aid?part=rows&hash=" + encodeURIComponent("accounts_in_scope~from=2026-11-01~to=2026-11-07");
const answer = { answer: "14 leads are waiting.", citations: [], cannotAnswer: false };

describe.skipIf(!HAS_DB)("AI data jobs cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from ai_ask_turns limit 1`; await sql()`select 1 from ai_connections limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAid A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAid B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, last_synced_at) values
      (${instA}, ${A1}, 'zzAid Client A1', 'UTC', true, now()), (${instA}, ${A2}, 'zzAid Client A2', 'UTC', true, now()), (${instB}, ${B1}, 'zzAid Client B1', 'UTC', true, now())`;
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("the rows behind a number are only the caller's own", async () => {
    if (!ready) return;
    const a = await call(owner(CO_A), "GET", ROWS);
    expect(a.status).toBe(200);
    expect(a.body.total).toBe(2);
    expect(a.text).toContain("zzAid Client A1");
    expect(a.text).not.toContain("zzAid Client B1");
    const c = await call(clientUser(CO_A, A1), "GET", ROWS);
    expect(c.body.total).toBe(1);
    expect(c.text).toContain("zzAid Client A1");
    expect(c.text).not.toContain("A2");
    // A client session that names another account (or another company's) is still pinned to its own.
    const widened = await call(clientUser(CO_A, A1), "GET", `${ROWS}&account=${A2}`);
    expect(widened.body.total).toBe(1);
    expect(widened.text).not.toContain("zzAid Client A2");
    expect((await call(clientUser(CO_A, A1), "GET", `${ROWS}&account=${B1}`)).text).not.toContain("zzAid Client B1");
    // An owner cannot name another company's account.
    expect((await call(owner(CO_A), "GET", `${ROWS}&account=${B1}`)).status).toBe(404);
    const b = await call(owner(CO_B), "GET", ROWS);
    expect(b.body.total).toBe(1);
    expect(b.text).not.toContain("zzAid Client A");
    // A forged address is refused, not run.
    expect((await call(owner(CO_A), "GET", "aid?part=rows&hash=" + encodeURIComponent("run_sql~from=2026-11-01~to=2026-11-07"))).status).toBe(404);
  });

  it("a person's question history is theirs alone, and deleting needs the typed word", async () => {
    if (!ready) return;
    const turn = await saveTurn(instA, `u-${CO_A}`, "", "SECRET-QUESTION", answer, null, { from: "2026-11-01", to: "2026-11-07" });
    const mine = await call(owner(CO_A), "GET", "aid?part=history");
    expect(mine.body.turns).toHaveLength(1);
    expect(mine.body.turns[0].question).toBe("SECRET-QUESTION");
    expect((await call(owner(CO_A, "someone-else"), "GET", "aid?part=history")).body.turns).toEqual([]);
    expect((await call(staff(CO_A), "GET", "aid?part=history")).body.turns).toEqual([]);
    expect((await call(owner(CO_B), "GET", "aid?part=history")).body.turns).toEqual([]);
    expect(await listTurns(instB, `u-${CO_A}`)).toEqual([]);
    const raw = await sql()`select question_enc, answer_enc from ai_ask_turns where id = ${turn}::uuid`;
    expect(String(raw[0].question_enc)).not.toContain("SECRET-QUESTION");
    // Another person, or another company, cannot delete it, even with the typed word; the owner needs the word.
    expect((await call(owner(CO_A, "someone-else"), "POST", "aid/act/history-delete", { id: turn, confirm: "delete" })).status).toBe(404);
    expect((await call(owner(CO_B), "POST", "aid/act/history-delete", { id: turn, confirm: "delete" })).status).toBe(404);
    expect((await call(owner(CO_A), "POST", "aid/act/history-delete", { id: turn })).status).toBe(400);
    expect((await call(owner(CO_A), "GET", "aid?part=history")).body.turns).toHaveLength(1);
    expect((await call(owner(CO_A), "POST", "aid/act/history-delete", { id: turn, confirm: "delete" })).status).toBe(200);
    expect((await call(owner(CO_A), "GET", "aid?part=history")).body.turns).toEqual([]);
    await saveTurn(instA, `u-${CO_A}`, "", "Q2", answer, null, { from: "2026-11-01", to: "2026-11-07" });
    expect((await call(owner(CO_A), "POST", "aid/act/history-delete", { all: true, confirm: "delete" })).status).toBe(400);
    expect((await call(owner(CO_A), "POST", "aid/act/history-delete", { all: true, confirm: "delete all" })).body.deleted).toBe(1);
  });

  it("the jobs refuse people who must not run them, and nothing is sent without a connection", async () => {
    if (!ready) return;
    expect((await call(staff(CO_A), "POST", "aid/act/review", {})).status).toBe(403);
    expect((await call(staff(CO_A), "POST", "aid/act/setup-audit", { account: A1 })).status).toBe(403);
    expect((await call(clientUser(CO_A, A1), "POST", "aid/act/review", {})).status).toBe(403);
    expect((await call(clientUser(CO_A, A1), "POST", "aid/act/clean", { account: A1 })).status).toBe(403);
    expect((await call(clientUser(CO_A, A1), "POST", "aid/act/clean-preview", { account: A1, actions: ["set_phone"] })).status).toBe(403);
    expect((await call(clientUser(CO_A, A1), "POST", "aid/act/dup-judge", { account: A1, key: "k" })).status).toBe(404);
    // No connection: the question is refused in words by the gateway (the provider is never called) and nothing is saved.
    const ask = await call(owner(CO_A), "POST", "aid/act/ask", { question: "How many leads are waiting?" });
    expect(ask.status).toBe(200);
    expect(ask.body).toMatchObject({ ok: false, code: "no_connection" });
    expect(await listTurns(instA, `u-${CO_A}`)).toEqual([]);
    // Another company's connection never serves this company, and the job is off until the account turns it on.
    await saveConnection(instB, "", { provider: "openai", baseUrl: null, apiKey: "sk-BBBB-secret-key-B2222", model: "m", by: "u-b" });
    expect((await call(owner(CO_A), "POST", "aid/act/ask", { question: "How many leads are waiting?" })).body).toMatchObject({ ok: false, code: "no_connection" });
    expect((await call(owner(CO_B), "POST", "aid/act/ask", { question: "How many leads are waiting?" })).body).toMatchObject({ ok: false, code: "job_off" });
    const st = await call(owner(CO_B), "GET", "aid?part=status");
    expect(st.body.jobs.ask_data).toMatchObject({ connected: true, on: false });
    expect(st.text).not.toContain("sk-BBBB");
  });
});
