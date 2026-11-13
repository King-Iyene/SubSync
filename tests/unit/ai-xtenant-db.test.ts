import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { dbStore, publicConnection, saveConnection, startPending, takePending, historyFor } from "@/lib/ai/store";

// Cross-tenant test for bring-your-own-AI, with tiny fixtures (prefix xtest-) removed afterwards. Skips until the migration is applied.
//   1. One company's connection, key, runs, history and "what was sent" are never readable by another company, by a client account of the same company, or by another person.
//   2. A key is never returned to a browser (last four characters only), and a client account's administrator manages only their own account's connection.
//   3. A sign-in in progress is single-use and expires; the wrong state gives nothing.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const CO_A = "xtest-ai-a", CO_B = "xtest-ai-b", A1 = "xtestAiA1", B1 = "xtestAiB1";
const KEY_A = "sk-AAAA-secret-key-A1111", KEY_B = "sk-BBBB-secret-key-B2222", KEY_C = "sk-CCCC-secret-key-C3333";
let instA = "", instB = "", ready = false, runA = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const owner = (company: string, user = `u-${company}`) => signSession({ companyId: company, userId: user, role: "admin", userName: "T", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
const staff = (company: string) => signSession({ companyId: company, userId: `staff-${company}`, role: "user", userName: "S", demo: false, kind: "agency", locationId: null, personRole: "agency_staff" });
const clientAdmin = (company: string, loc: string) => signSession({ companyId: company, userId: `ca-${company}`, role: "admin", userName: "C", demo: false, kind: "client", locationId: loc, personRole: "account_admin" });
const clientUser = (company: string, loc: string) => signSession({ companyId: company, userId: `cu-${company}`, role: "user", userName: "C", demo: false, kind: "client", locationId: loc, personRole: "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body: parsed };
}

describe.skipIf(!HAS_DB)("bring your own AI cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from ai_connections limit 1`; await sql()`select 1 from ai_runs limit 1`; await sql()`select 1 from ai_oauth_pending limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAi A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAi B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, last_synced_at) values (${instA}, ${A1}, 'zzAi Client A1', 'UTC', true, now()), (${instB}, ${B1}, 'zzAi Client B1', 'UTC', true, now())`;
    await saveConnection(instA, "", { provider: "openai", baseUrl: null, apiKey: KEY_A, model: "model-a", by: "u-a" });
    await saveConnection(instB, "", { provider: "anthropic", baseUrl: null, apiKey: KEY_B, model: "model-b", by: "u-b" });
    runA = await dbStore.insertRun({ installationId: instA, scope: "", userKey: `u-${CO_A}`, job: "brief", trigger: "preview", method: "key", provider: "openai", model: "model-a", idempotencyKey: "k-a", inputHash: "h", tokensIn: 10, tokensOut: 5, costUsd: 0.01, status: "ok", reason: null, sentFields: ["day"], includesNames: false, prompt: "PROMPT-A-SECRET", output: "OUTPUT-A-SECRET", toolCalls: 0 });
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("each company sees only its own connection, and never a key", async () => {
    if (!ready) return;
    const a = await call(owner(CO_A), "GET", "ai?part=status"), b = await call(owner(CO_B), "GET", "ai?part=status");
    expect(a.status).toBe(200);
    expect(a.body.connection).toMatchObject({ provider: "openai", last4: "1111", model: "model-a", method: "key" });
    expect(b.body.connection).toMatchObject({ provider: "anthropic", last4: "2222" });
    for (const r of [a, b]) for (const secret of [KEY_A, KEY_B, "sk-AAAA", "sk-BBBB", "key_enc", "verifier_enc"]) expect(r.text).not.toContain(secret);
  });
  it("the key is stored encrypted, and another company's connection cannot be read through the store", async () => {
    if (!ready) return;
    const [row] = await sql()`select key_enc from ai_connections where installation_id = ${instA} and location_id = ''`;
    expect(String(row.key_enc)).not.toContain("sk-AAAA");
    expect((await dbStore.connection(instA, ""))?.apiKey).toBe(KEY_A);
    expect(await dbStore.connection(instA, B1)).toBeNull();
    expect(await publicConnection(instB, A1)).toBeNull();
  });
  it("runs, history, what-was-sent and thumbs never cross companies or people", async () => {
    if (!ready) return;
    const own = await call(owner(CO_A), "GET", `ai?part=sent&run=${runA}`);
    expect(own.status).toBe(200);
    expect(own.text).toContain("PROMPT-A-SECRET");
    expect((await call(owner(CO_B), "GET", `ai?part=sent&run=${runA}`)).status).toBe(404);
    expect((await call(owner(CO_B), "POST", "ai/act/feedback", { runId: runA, value: 1 })).status).toBe(404);
    expect((await call(owner(CO_A, "someone-else"), "GET", "ai?part=history")).body.rows).toEqual([]);
    const mine = await call(owner(CO_A), "GET", "ai?part=history");
    expect(mine.body.rows).toHaveLength(1);
    expect(mine.body.rows[0].text).toBe("OUTPUT-A-SECRET");
    expect((await call(owner(CO_A), "POST", "ai/act/feedback", { runId: runA, value: 1 })).status).toBe(200);
    expect(await historyFor(instB, "", `u-${CO_A}`)).toEqual([]);
    expect((await call(owner(CO_B), "GET", "ai?part=usage")).text).not.toContain("0.01");
  });
  it("a client account's administrator manages only their own account, never the company's", async () => {
    if (!ready) return;
    const s = await call(clientAdmin(CO_A, A1), "GET", "ai?part=status");
    expect(s.body.level).toBe("account");
    expect(s.body.connection).toBeNull();
    expect(s.text).not.toContain("sk-AAAA");
    expect(s.body.usage.runs).toBe(0);
    await saveConnection(instA, A1, { provider: "gemini", baseUrl: null, apiKey: KEY_C, model: "model-c", by: "ca" });
    const s2 = await call(clientAdmin(CO_A, A1), "GET", "ai?part=status");
    expect(s2.body.connection).toMatchObject({ provider: "gemini", last4: "3333" });
    expect((await call(owner(CO_A), "GET", "ai?part=status")).body.connection).toMatchObject({ last4: "1111" });
    expect((await call(clientAdmin(CO_A, A1), "GET", `ai?part=sent&run=${runA}`)).status).toBe(404);
    // Disconnecting the account's connection leaves the company's alone.
    expect((await call(clientAdmin(CO_A, A1), "POST", "ai/act/disconnect", { confirm: "disconnect" })).status).toBe(200);
    expect(await publicConnection(instA, A1)).toBeNull();
    expect(await publicConnection(instA, "")).not.toBeNull();
  });
  it("people who are not administrators get nothing and can change nothing", async () => {
    if (!ready) return;
    for (const t of [staff(CO_A), clientUser(CO_A, A1)]) {
      expect((await call(t, "GET", "ai?part=status")).body).toMatchObject({ canManage: false });
      expect((await call(t, "POST", "ai/act/update", { paused: true })).status).toBe(403);
      expect((await call(t, "POST", "ai/act/disconnect", { confirm: "disconnect" })).status).toBe(403);
    }
    expect((await publicConnection(instA, ""))?.paused).toBe(false);
  });
  it("disconnecting needs the typed word, and deletes only that company's key", async () => {
    if (!ready) return;
    expect((await call(owner(CO_B), "POST", "ai/act/disconnect", {})).status).toBe(400);
    expect(await publicConnection(instB, "")).not.toBeNull();
    expect((await call(owner(CO_B), "POST", "ai/act/disconnect", { confirm: "disconnect" })).status).toBe(200);
    expect(await publicConnection(instB, "")).toBeNull();
    expect(await publicConnection(instA, "")).not.toBeNull();
  });
  it("a sign-in in progress is single-use, expires, and the wrong state gives nothing", async () => {
    if (!ready) return;
    const state = "S".repeat(40);
    await startPending({ state, installationId: instA, scope: "", userKey: "u", method: "openrouter", verifier: "VERIFIER-SECRET" });
    const [raw] = await sql()`select verifier_enc from ai_oauth_pending where state = ${state}`;
    expect(String(raw.verifier_enc)).not.toContain("VERIFIER");
    expect(await takePending("T".repeat(40))).toBeNull();
    expect(await takePending(state)).toMatchObject({ installationId: instA, verifier: "VERIFIER-SECRET", method: "openrouter" });
    expect(await takePending(state)).toBeNull();
    const old = "E".repeat(40);
    await startPending({ state: old, installationId: instA, scope: "", userKey: "u", method: "openrouter", verifier: "v" });
    await sql()`update ai_oauth_pending set expires_at = now() - interval '1 minute' where state = ${old}`;
    expect(await takePending(old)).toBeNull();
    expect(await takePending("short")).toBeNull();
  });
});
