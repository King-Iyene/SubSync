import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Cross-tenant test for the team and client AI jobs, with tiny fixtures (prefix xtest-) removed afterwards. Skips until the migration is applied.
//   1. A company never reads or writes another company's accounts through any part or act (an account id from another company answers "not found").
//   2. An account's administrator reaches only their own account; an account user reaches no settings, no list and nobody else's coaching note.
//   3. A person's meeting is theirs alone. Choices saved by one company are never visible to another.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const CO_A = "xtest-aitm-a", CO_B = "xtest-aitm-b", A1 = "xtestTmA1", A2 = "xtestTmA2", B1 = "xtestTmB1";
let instA = "", instB = "", ready = false, meetingId = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const owner = (company: string, user = `u-${company}`) => signSession({ companyId: company, userId: user, role: "admin", userName: "T", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
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
const month = (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 1); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; })();

describe.skipIf(!HAS_DB)("team and client AI jobs cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from ai_team_prefs limit 1`; await sql()`select summary from pr_reports limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzTm A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzTm B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, last_synced_at) values (${instA}, ${A1}, 'zzTm Client A1', 'UTC', true, now()), (${instA}, ${A2}, 'zzTm Client A2', 'UTC', true, now()), (${instB}, ${B1}, 'zzTm Client B1', 'UTC', true, now())`;
    await sql()`insert into pr_reports (installation_id, location_id, period, status, payload) values (${instB}, ${B1}, ${month + "-01"}::date, 'draft', '{}'::jsonb)`;
    [{ id: meetingId }] = (await sql()`insert into meetings (installation_id, owner_ghl_user_id, provider, provider_meeting_id, summary, status) values (${instA}, 'u-owner-1', 'fathom', 'xtest-m1', 'A call about pricing', 'saved') returning id::text id`) as unknown as Array<{ id: string }>;
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("a company reads and writes only its own accounts, through every part and act", async () => {
    if (!ready) return;
    const o = owner(CO_A);
    const list = await call(o, "GET", "ai-team?part=prefs");
    expect(list.status).toBe(200);
    expect(list.text).toContain("zzTm Client A1");
    expect(list.text).not.toContain("zzTm Client B1");
    for (const path of [`ai-team?part=report&account=${B1}&period=${month}`, `ai-team?part=leads&account=${B1}`, `ai-team?part=one-thing&account=${B1}`, `ai-team?part=anomalies&account=${B1}`]) expect((await call(o, "GET", path)).status).toBe(404);
    for (const [act, body] of [["prefs", { location: B1, jobs: { coach_note: true } }], ["report-summary", { account: B1, month }], ["save-summary", { account: B1, month, text: "x" }], ["lead-stories", { account: B1 }], ["anomaly", { account: B1, key: "leads" }], ["one-thing", { account: B1 }]] as const)
      expect((await call(o, "POST", `ai-team/act/${act}`, body)).status, act).toBe(404);
    expect((await sql()`select 1 from ai_team_prefs where installation_id = ${instB}`).length).toBe(0);
    expect((await sql()`select summary, summary_draft from pr_reports where installation_id = ${instB}`)[0]).toMatchObject({ summary: null, summary_draft: null });
  });
  it("choices saved by one company are never visible to another", async () => {
    if (!ready) return;
    expect((await call(owner(CO_A), "POST", "ai-team/act/prefs", { location: "", jobs: { coach_note: true }, tone: "warm" })).status).toBe(200);
    expect((await call(owner(CO_A), "POST", "ai-team/act/prefs", { location: A1, jobs: { report_summary: false } })).status).toBe(200);
    const a = await call(owner(CO_A), "GET", "ai-team?part=prefs"), b = await call(owner(CO_B), "GET", "ai-team?part=prefs");
    expect(a.body.company).toMatchObject({ tone: "warm", jobs: { coach_note: true } });
    expect(a.body.rows.find((r: Json) => r.locationId === A1).effectiveJobs.report_summary).toBe(false);
    expect(b.body.company.jobs).toEqual({});
    expect(b.body.company.tone).toBeNull();
  });
  it("an account's administrator reaches only their own account, and an account user reaches no settings", async () => {
    if (!ready) return;
    const ca = clientAdmin(CO_A, A1);
    const own = await call(ca, "GET", "ai-team?part=prefs");
    expect(own.status).toBe(200);
    expect(own.text).toContain("zzTm Client A1");
    expect(own.text).not.toContain("zzTm Client A2");
    expect((await call(ca, "POST", "ai-team/act/prefs", { location: A2, jobs: { coach_note: false } })).status).toBe(404);
    expect((await call(ca, "GET", `ai-team?part=leads&account=${A2}`)).status).toBe(404);
    const cu = clientUser(CO_A, A1);
    expect((await call(cu, "GET", "ai-team?part=prefs")).status).toBe(403);
    expect((await call(cu, "GET", "ai-team?part=anomalies")).status).toBe(403);
    expect((await call(cu, "POST", "ai-team/act/prefs", { jobs: { coach_note: true } })).status).toBe(403);
    expect((await call(cu, "GET", "ai-team?part=coach&user=someone-else")).status).toBe(403);
    expect((await call(cu, "GET", `ai-team?part=report&account=${A1}&period=${month}`)).status).toBe(403);
  });
  it("a person's meeting is theirs alone", async () => {
    if (!ready) return;
    expect((await call(owner(CO_A, "someone-else"), "GET", `ai-team?part=meeting&id=${meetingId}`)).status).toBe(404);
    expect((await call(owner(CO_B, "u-owner-1"), "GET", `ai-team?part=meeting&id=${meetingId}`)).status).toBe(404);
    expect((await call(owner(CO_A, "someone-else"), "POST", "ai-team/act/meeting", { id: meetingId })).status).toBe(404);
    const mine = await call(owner(CO_A, "u-owner-1"), "GET", `ai-team?part=meeting&id=${meetingId}`);
    expect(mine.status).toBe(200);
    expect(mine.body.ok).toBe(false);
  });
});
