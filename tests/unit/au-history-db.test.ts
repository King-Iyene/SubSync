import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { ownedLocation } from "@/lib/api/tenant-guard";
import { AUDIT_RULES_VERSION, type RunInput } from "@/lib/analytics/au-history";
import { readPrefs, readStored, recordRuns, setAccountMute } from "@/lib/analytics/au-history-queries";

// Account audit history, cross-tenant (docs/features/AUDIT_BRIEF.md). Company A (an agency, and a client of A) and company B: nothing written for A can land in B, nothing
// read for A can show B, the monthly settings refuse B's account by id, and a shared one-pager holds counts only. Small xtest- fixtures, removed afterwards. DB tests
// skip until the au_runs migration is applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features, locked: [], off: [] }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-au-a", CO_B = "xtest-au-b", A1 = "xtestAuA1", A2 = "xtestAuA2", B1 = "xtestAuB1";
const NAME_A1 = "zzAu Client A1", NAME_B = "zzAu Client B";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", loc: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: "admin", userName: "T", demo: false, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), p.split("/"));
  const t = await res.text();
  let parsed: Json = {};
  try { parsed = t ? JSON.parse(t) : {}; } catch { /* not json */ }
  return { status: res.status, text: t, body: parsed };
}
const run = (loc: string, over: Partial<RunInput> = {}): RunInput => ({ locationId: loc, counts: { replies: 4, stale: 2, noshows: 1, appointments: 0 }, staleDollars: 5000, estimate: 1500, estLow: 900, estHigh: 2100, closedDeals: 30, partial: false, ...over });

describe("ownedLocation guard shape checks (no database needed)", () => {
  it("refuses malformed ids before any query", async () => {
    for (const v of [null, undefined, 5, "", "a", "x y", "a'; drop table x;--"]) expect(await ownedLocation("inst", null, v)).toBeNull();
    expect(await ownedLocation("inst", [A1], B1)).toBeNull();
  });
});

describe.skipIf(!HAS_DB)("account audit history cross-tenant", () => {
  let ok = false;
  beforeAll(async () => {
    try { await sql()`select 1 from au_runs limit 1`; await sql()`select 1 from au_prefs limit 1`; ok = true; } catch { ok = false; }
    if (!ok) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzAu A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzAu B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A1}, ${NAME_A1}, 'UTC', true), (${instA}, ${A2}, 'zzAu Client A2', 'UTC', true), (${instB}, ${B1}, ${NAME_B}, 'UTC', true)`;
  });
  afterAll(async () => {
    if (ok) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("recording writes only accounts of the installation, once a day, and the first row is the baseline", async () => {
    if (!ok) return;
    const now = Date.parse("2026-11-11T10:00:00Z");
    expect(await recordRuns(instA, [run(A1), run(A2), run(B1)], now, "view")).toBe(2); // B's account is not A's: not written
    expect(await recordRuns(instA, [run(A1, { counts: { replies: 99, stale: 99, noshows: 99, appointments: 99 } })], now, "view")).toBe(0); // same day: unchanged
    const rows = await sql()`select location_id, is_baseline, rules_version, counts from au_runs where installation_id = ${instA} order by location_id`;
    expect(rows.map((r) => r.location_id)).toEqual([A1, A2]);
    expect(rows.every((r) => r.is_baseline === true && r.rules_version === AUDIT_RULES_VERSION)).toBe(true);
    expect((rows[0].counts as { replies: number }).replies).toBe(4);
    expect(await sql()`select 1 from au_runs where location_id = ${B1}`).toHaveLength(0);
    // The next day the account is not a baseline again.
    expect(await recordRuns(instA, [run(A1)], now + 86_400_000, "sweep")).toBe(1);
    const two = await sql()`select is_baseline from au_runs where installation_id = ${instA} and location_id = ${A1} order by run_day`;
    expect(two.map((r) => r.is_baseline)).toEqual([true, false]);
  });

  it("reading for A never returns B, even when B's id is asked for", async () => {
    if (!ok) return;
    await recordRuns(instB, [run(B1)], Date.parse("2026-11-11T10:00:00Z"), "view");
    const now = Date.parse("2026-11-20T10:00:00Z");
    const s = await readStored(instA, [A1, A2, B1], now);
    expect(s.runs.get(B1)?.first).toBeNull();
    expect(JSON.stringify([...s.runs.values()])).not.toContain(B1);
    expect(s.runs.get(A1)?.first?.baseline).toBe(true);
    const other = await readStored(instB, [A1], now);
    expect(other.runs.get(A1)?.first).toBeNull();
    expect(other.series).toEqual([]);
  });

  it("the monthly settings refuse another company's account and never echo it", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    const bad = await call(t, "POST", "audit/prefs", { location: B1, muted: true });
    expect(bad.status).toBe(404);
    expect(bad.text).not.toContain(B1);
    expect(await sql()`select 1 from au_account_prefs where location_id = ${B1}`).toHaveLength(0);
    const get = await call(t, "GET", `audit/prefs?location=${B1}`);
    expect(get.status).toBe(200);
    expect(get.text).not.toContain(B1);
    expect(get.text).not.toContain(NAME_B);
    const good = await call(t, "POST", "audit/prefs", { location: A1, muted: true });
    expect(good.status).toBe(200);
    expect((await readPrefs(instA, [A1, A2])).muted).toEqual([A1]);
    expect((await readPrefs(instB, [B1, A1])).muted).toEqual([]);
    await setAccountMute(instA, A1, false);
    // A client's own staff cannot read or change them.
    const c = session(CO_A, "client", A1);
    expect((await call(c, "GET", "audit/prefs")).status).toBe(403);
    expect((await call(c, "POST", "audit/prefs", { monthly: false })).status).toBe(403);
  });

  it("the audit page of A never shows B, with the history on", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    for (const q of ["", `?location=${B1}`, `?location=${B1}&history=1&q=${B1}`]) {
      const r = await call(t, "GET", `audit${q}`);
      expect(r.status, q).toBe(200);
      expect(r.text, q).not.toContain(B1);
      expect(r.text, q).not.toContain(NAME_B);
    }
    const c = await call(session(CO_A, "client", A1), "GET", `audit?location=${A2}`);
    expect(c.text).not.toContain(A2);
    expect(c.text).not.toContain("zzAu Client A2");
  });

  it("a shared one-pager holds no names, B cannot switch it off, and a mistyped confirmation switches nothing off", async () => {
    if (!ok) return;
    const t = session(CO_A, "agency", null);
    const made = await call(t, "POST", "audit/share", {});
    expect(made.status).toBe(200);
    const id = String(made.body.url).split("/").pop() as string;
    const [row] = await sql()`select payload from shared_audits where id = ${id} and installation_id = ${instA}`;
    const text = JSON.stringify(row.payload);
    for (const n of [NAME_A1, NAME_B, B1, A1, "zzAu Client A2"]) expect(text).not.toContain(n);
    expect(text).not.toMatch(/gohighlevel|highlevel|\bghl\b/i);
    expect((await call(session(CO_B, "agency", null), "POST", "audit/revoke", { id })).status).toBe(404);
    expect((await call(t, "POST", "audit/revoke", { id, typed: "wrong1" })).status).toBe(400);
    expect((await sql()`select revoked_at from shared_audits where id = ${id}`)[0].revoked_at).toBeNull();
    expect((await call(t, "POST", "audit/revoke", { id, typed: id.slice(-6) })).status).toBe(200);
    expect((await sql()`select revoked_at from shared_audits where id = ${id}`)[0].revoked_at).not.toBeNull();
  });
});
