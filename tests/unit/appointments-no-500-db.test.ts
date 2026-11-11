import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";
import { APPT3_PARTS } from "@/lib/analytics/appointments3-types";

// Regression: no Appointments or action/meeting route may answer 500 (the overview once did: an unquoted `day` alias was a SQL syntax error).
// Checked on the demo company (when seeded) and on a fixture company with no appointments at all. Skipped without a database.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
process.env.FLAGS_ALL_ON = "true";
process.env.DEMO_MODE = "true"; // the demo company answers only while demo mode is on (never in production)
const CO = "xtest-ap-no500";
let inst = "", demoSeeded = false;
const session = (company: string, kind: "agency" | "client", demo: boolean, loc: string | null = null) =>
  signSession({ companyId: company, userId: "u-t", role: "admin", userName: "T", demo, kind, locationId: loc, personRole: kind === "agency" ? "agency_owner" : "account_user" });
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown) {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }), p.split("/"));
  return res.status;
}
const GETS = [
  ...APPT3_PARTS.map((p) => `appointments?part=${p}${p === "detail" ? "&location=nope&id=nope" : ""}`),
  "appointments?part=list&bucket=unmarked", "appointments?part=list&bucket=noshow&size=100", "appointments?part=flow-tree&compare=a,b", "appointments?part=overview&from=bad&to=worse",
  "appointments/work", "appointments/list", "appointments/compare",
  "appointments/act/caps", "appointments/act/panel?locationId=nope&id=nope", "appointments/act/slots?locationId=nope&id=nope",
  "appointments/meetings/home", "appointments/meetings/matching", "appointments/meetings/followup",
];
const POSTS = ["act/apply", "act/create", "act/rebook", "act/bulk", "act/undo", "meetings/sync", "meetings/match", "meetings/followup-note"].map((p) => `appointments/${p}`);

describe.skipIf(!HAS_DB)("appointments never answer 500", () => {
  beforeAll(async () => {
    try { await sql()`select 1 from appointment_history limit 1`; } catch { return; }
    await sql()`delete from installations where company_id = ${CO}`;
    [{ id: inst }] = (await sql()`insert into installations (company_id, company_name, plan) values (${CO}, 'zzNo500', 'pro') returning id`) as unknown as Array<{ id: string }>;
    await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    demoSeeded = ((await sql()`select 1 from installations where company_id = 'demo-agency' and is_demo`) as unknown as unknown[]).length > 0;
  });
  afterAll(async () => { if (inst) await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("empty account: every GET is below 500, agency and client", async () => {
    if (!inst) return;
    for (const tok of [session(CO, "agency", false), session(CO, "client", false, "xtestNoLoc")]) {
      for (const g of GETS) expect(await call(tok, "GET", g), g).toBeLessThan(500);
    }
    expect(await call(session(CO, "agency", false), "GET", "appointments?part=overview")).toBe(200);
  });

  it("empty account: bad-input POSTs are 4xx, never 500", async () => {
    if (!inst) return;
    const t = session(CO, "agency", false);
    for (const p of POSTS) expect(await call(t, "POST", p, {}), p).toBeLessThan(500);
  });

  it("demo account: every GET is below 500 and the parts answer 200", async () => {
    if (!inst || !demoSeeded) return;
    const t = session("demo-agency", "agency", true);
    for (const g of GETS) { const t0 = Date.now(); const s = await call(t, "GET", g); console.log("T", g, s, Date.now() - t0); expect(s, g).toBeLessThan(500); }
    for (const p of APPT3_PARTS.filter((x) => x !== "detail")) expect(await call(t, "GET", `appointments?part=${p}`), p).toBe(200);
  });
});
