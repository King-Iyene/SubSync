import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { findSharedReport } from "@/lib/report-share-queries";

// Cross-tenant test for "Share a report" (the shared_reports table, /api/app/report-share and the public lookup):
//   1. A link made by company A shows company A's figures to anyone holding the id, and nothing of company B.
//   2. Company B cannot list, see or switch off company A's link; an account user and agency staff cannot make, list or switch off any link.
//   3. Names are hidden in the stored payload unless the owner chose to include them.
//   4. An expired link and a switched-off link open nothing, and a wrong or short id opens nothing.
// Fixtures are tiny (prefix xtest-) and removed afterwards. Skips until the migration is applied.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.mock("@/lib/flags", async (orig) => {
  const real = await orig<typeof import("@/lib/flags")>();
  return { ...real, resolveEntitlements: async (...a: Parameters<typeof real.resolveEntitlements>) => { const e = await real.resolveEntitlements(...a); return { ...e, features: Object.fromEntries(Object.keys(e.features).map((k) => [k, true])) as typeof e.features }; } };
});
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.ENTITLEMENTS_MODE = "open";
const CO_A = "xtest-rs-a", CO_B = "xtest-rs-b", LOC_A = "xtestRsA1";
let instA = "", instB = "", ready = false;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const owner = (company: string) => signSession({ companyId: company, userId: `${company}-u`, role: "admin", userName: "Xtest Owner", demo: false, kind: "agency", locationId: null, personRole: "agency_owner" });
const staff = (company: string) => signSession({ companyId: company, userId: `${company}-s`, role: "user", userName: "Xtest Staff", demo: false, kind: "agency", locationId: null, personRole: "agency_staff" });
const accountUser = (company: string) => signSession({ companyId: company, userId: `${company}-c`, role: "user", userName: "Xtest Client", demo: false, kind: "client", locationId: LOC_A, personRole: "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const res = await handle(new Request(`http://localhost/api/app/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), path.split("?")[0].split("/"));
  const text = await res.text();
  let parsed: Json = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* not json */ }
  return { status: res.status, text, body: parsed };
}
const doc = (secret: string) => ({
  title: "Weekly proof", scope: { pii: `${secret} Plumbing`, as: "account" }, period: "week of 2026-11-02", brandName: null,
  sections: [{ heading: "Found", stats: [{ label: "Found", value: "12" }], table: { columns: ["Client account", "Found"], rows: [[{ pii: `${secret} Plumbing`, as: "account" }, "12"]] } }],
});

describe.skipIf(!HAS_DB)("Share a report: cross-tenant", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from shared_reports limit 1`; ready = true; } catch { ready = false; }
    if (!ready) return;
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'Rs Agency A', 'pro') returning id`) as unknown as Array<{ id: string }>;
    [{ id: instB }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'Rs Agency B', 'pro') returning id`) as unknown as Array<{ id: string }>;
    for (const i of [instA, instB]) await sql()`insert into settings (installation_id) values (${i}) on conflict do nothing`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${LOC_A}, 'zzRs Client A1', 'UTC', true)`;
  });
  afterAll(async () => {
    if (ready) for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    await closeDb();
  });

  it("makes a link with a 192-bit id, hides names by default, and the public lookup shows only that report", async () => {
    if (!ready) return;
    const made = await call(owner(CO_A), "POST", "report-share", { kind: "weekly", doc: doc("Alpha"), days: 7 });
    expect(made.status).toBe(200);
    expect(made.body.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(made.body.url).toContain(`/r/${made.body.id}`);
    expect(made.body.namesIncluded).toBe(false);
    const row = await findSharedReport(made.body.id);
    expect(row).not.toBeNull();
    const text = JSON.stringify(row!.report);
    expect(text).not.toContain("Alpha");
    expect(text).toContain("Client account 1");
    expect(Math.round((row!.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(7);
    const shown = await call(owner(CO_A), "POST", "report-share", { kind: "weekly", doc: doc("Alpha"), includeNames: true });
    expect(JSON.stringify((await findSharedReport(shown.body.id))!.report)).toContain("Alpha Plumbing");
    const audit = await sql()`select action from audit_log where installation_id = ${instA} and action in ('report.share_created', 'report.share_opened')`;
    expect(audit.map((r) => r.action)).toContain("report.share_created");
    expect(audit.map((r) => r.action)).toContain("report.share_opened");
  });

  it("another company cannot list, see or switch off a link; an account user and agency staff cannot make, list or revoke", async () => {
    if (!ready) return;
    const made = await call(owner(CO_A), "POST", "report-share", { kind: "today", doc: doc("Bravo") });
    const id = made.body.id as string;
    const listB = await call(owner(CO_B), "GET", "report-share");
    expect(listB.status).toBe(200);
    expect(listB.text).not.toContain(id);
    expect(listB.text).not.toContain("Bravo");
    expect((await call(owner(CO_A), "GET", "report-share")).text).toContain(id);
    expect((await call(owner(CO_B), "POST", "report-share/revoke", { id })).status).toBe(404);
    expect((await findSharedReport(id))).not.toBeNull();
    for (const [who, token] of [["account user", accountUser(CO_A)], ["agency staff", staff(CO_A)]] as const) {
      expect((await call(token, "POST", "report-share", { kind: "today", doc: doc("Charlie") })).status, `${who} cannot make`).toBe(403);
      expect((await call(token, "GET", "report-share")).status, `${who} cannot list`).toBe(403);
      expect((await call(token, "POST", "report-share/revoke", { id })).status, `${who} cannot revoke`).toBe(403);
    }
    expect((await findSharedReport(id))).not.toBeNull();
  });

  it("a switched-off link, an expired link and a wrong id open nothing", async () => {
    if (!ready) return;
    const made = await call(owner(CO_A), "POST", "report-share", { kind: "clients", doc: doc("Delta") });
    const id = made.body.id as string;
    expect((await call(owner(CO_A), "POST", "report-share/revoke", { id: "short" })).status).toBe(400);
    expect((await call(owner(CO_A), "POST", "report-share/revoke", { id })).status).toBe(200);
    expect(await findSharedReport(id)).toBeNull();
    expect((await call(owner(CO_A), "POST", "report-share/revoke", { id })).status).toBe(404);
    const second = await call(owner(CO_A), "POST", "report-share", { kind: "clients", doc: doc("Echo") });
    await sql()`update shared_reports set expires_at = now() - interval '1 minute' where id = ${second.body.id}`;
    expect(await findSharedReport(second.body.id)).toBeNull();
    expect(await findSharedReport("Z".repeat(32))).toBeNull();
    expect(await findSharedReport(second.body.id.slice(0, -1) + (second.body.id.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await findSharedReport("short")).toBeNull();
    expect((await call(owner(CO_A), "POST", "report-share", { kind: "nonsense", doc: doc("Fox") })).status).toBe(400);
    expect((await call(owner(CO_A), "POST", "report-share", { kind: "today", doc: { title: "", sections: [] } })).status).toBe(400);
  });
});
