import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// The Lead workbench routes (stage MOAT) against the real database with fixture companies only (removed afterwards; deleting the installation cascades). Skipped with no database.
// WRITE_GHL_LIVE is never set here, so every write is a dry run and nothing can reach a CRM: what is checked is WHO may ask for WHAT.
//   1. Forged ids are "not found": another company's account, another account's contact, a deal or appointment that is not this person's.
//   2. A client's staff may preview and do a note or a message on their own account (dry run), but never a delete (403), and never another account of the same company.
//   3. A dry run records one WOULD line in the audit with ids and field names, never the message text.
//   4. Do Not Disturb refuses a message even in a dry run (422), and a delete without the typed name is refused.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CO_A = "xtest-wb-a", CO_B = "xtest-wb-b";
const A1 = "xtestWbA1", A2 = "xtestWbA2", B1 = "xtestWbB1";
let instA = "", instB = "";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "client", locationId: string | null, userId = `u-${kind}`) =>
  signSession({ companyId: company, userId, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : "account_user" } as never);
async function call(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const [p, q] = path.split("?");
  const res = await handle(new Request(`http://localhost/api/app/${p}${q ? "?" + q : ""}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), p.split("/"));
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const contact = (inst: string, loc: string, id: string, first: string, o: Record<string, unknown> = {}) => ({
  installation_id: inst, location_id: loc, contact_id: id, first_name: first, last_name: "Test", email: `${id}@x.test`, phone: "+15550100000", tags: ["hot"] as string[], date_added: ago(30 * DAY),
  last_activity_at: ago(2 * DAY), dnd: false, assigned_to: null as string | null, source: null as string | null, ...o,
});

describe.skipIf(!HAS_DB)("Lead workbench: routes, tenancy and dry runs", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    const mk = async (co: string, name: string) => (await sql()`insert into installations (company_id, company_name, plan) values (${co}, ${name}, 'pro') returning id`)[0].id as string;
    instA = await mk(CO_A, "zzWb A"); instB = await mk(CO_B, "zzWb B");
    for (const inst of [instA, instB]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzWb Client A1"], [instA, A2, "zzWb Client A2"], [instB, B1, "zzWb Client B1"]]) {
      await sql()`insert into locations (installation_id, location_id, name, timezone, client_view, speed_access, appointments_access, users_access) values (${inst}, ${loc}, ${name}, 'America/New_York', true, 'ok', 'ok', 'ok')`;
    }
    await sql()`insert into cached_contacts ${sql()([
      contact(instA, A1, "a1-ada", "Ada"), contact(instA, A1, "a1-dnd", "Grace", { dnd: true }), contact(instA, A2, "a2-bob", "Bob"), contact(instB, B1, "b1-zed", "Zed"),
    ] as never)}`;
    await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, assigned_to, created_remote_at)
      values (${instA}, ${A1}, 'o-ada', 'pipe1', 'stage1', 'a1-ada', 'Ada', 'Ada deal', 900, 'open', 'u-owner', ${ago(10 * DAY)}), (${instA}, ${A2}, 'o-bob', 'pipe1', 'stage1', 'a2-bob', 'Bob', 'Bob deal', 500, 'open', 'u-owner', ${ago(10 * DAY)})`;
    await sql()`insert into cached_appointments (installation_id, location_id, appointment_id, contact_id, title, status, start_at) values (${instA}, ${A2}, 'ap-bob', 'a2-bob', 'Consult', 'new', ${ago(DAY)})`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  const agency = () => session(CO_A, "agency", null);
  const client = () => session(CO_A, "client", A1, "u-client");
  const note = { kind: "note", text: "SECRET-NOTE-TEXT-777" };

  it("the context of a person in an account the caller can see loads, with the switch off and nothing allowed", async () => {
    const r = await call(agency(), "GET", `workbench/context?locationId=${A1}&contactId=a1-ada`);
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("Ada Test");
    expect(r.body.mode.live).toBe(false);
    expect(r.body.canDelete).toBe(true);
    expect(r.body.deals.map((d: { id: string }) => d.id)).toEqual(["o-ada"]);
  });

  it("forged ids are not found: another company's account, another account's contact, a person from the wrong account", async () => {
    expect((await call(agency(), "GET", `workbench/context?locationId=${B1}&contactId=b1-zed`)).status).toBe(404);
    expect((await call(agency(), "GET", `workbench/context?locationId=${A1}&contactId=b1-zed`)).status).toBe(404);
    expect((await call(agency(), "GET", `workbench/context?locationId=${A1}&contactId=a2-bob`)).status).toBe(404);
    expect((await call(agency(), "GET", `workbench/thread?locationId=${B1}&contactId=b1-zed`)).status).toBe(404);
    expect((await call(agency(), "POST", "workbench/do", { locationId: B1, contactId: "b1-zed", action: note, confirm: true })).status).toBe(404);
    expect((await call(agency(), "POST", "workbench/preview", { locationId: A1, contactId: "b1-zed", action: note })).status).toBe(404);
  });

  it("a deal or an appointment that is not this person's is not found", async () => {
    expect((await call(agency(), "POST", "workbench/preview", { locationId: A1, contactId: "a1-ada", action: { kind: "deal", opportunityId: "o-bob", value: 1 } })).status).toBe(404);
    expect((await call(agency(), "POST", "workbench/preview", { locationId: A1, contactId: "a1-ada", action: { kind: "deal", opportunityId: "o-nope", value: 1 } })).status).toBe(404);
    expect((await call(agency(), "POST", "workbench/preview", { locationId: A2, contactId: "a2-bob", action: { kind: "appointment", appointmentId: "ap-missing", status: "showed" } })).status).toBe(404);
    expect((await call(agency(), "POST", "workbench/preview", { locationId: A2, contactId: "a2-bob", action: { kind: "appointment", appointmentId: "ap-bob", status: "showed" } })).status).toBe(200);
  });

  it("a client's staff work on their own account only, and never delete", async () => {
    expect((await call(client(), "GET", `workbench/context?locationId=${A1}&contactId=a1-ada`)).status).toBe(200);
    expect((await call(client(), "GET", `workbench/context?locationId=${A2}&contactId=a2-bob`)).status).toBe(404);
    expect((await call(client(), "POST", "workbench/preview", { locationId: A2, contactId: "a2-bob", action: note })).status).toBe(404);
    const noteTry = await call(client(), "POST", "workbench/do", { locationId: A1, contactId: "a1-ada", action: note, confirm: true });
    expect(noteTry.status).toBe(200);
    expect(noteTry.body.dryRun).toBe(true);
    const del = await call(client(), "POST", "workbench/do", { locationId: A1, contactId: "a1-ada", action: { kind: "delete", confirmText: "Ada Test" }, confirm: true });
    expect(del.status).toBe(403);
    expect((await call(agency(), "GET", `workbench/context?locationId=${A1}&contactId=a1-ada`)).body.canDelete).toBe(true);
    expect((await call(client(), "GET", `workbench/context?locationId=${A1}&contactId=a1-ada`)).body.canDelete).toBe(false);
  });

  it("a dry run records one WOULD line with ids and field names, never the text", async () => {
    await sql()`delete from audit_log where installation_id = ${instA}`;
    const r = await call(agency(), "POST", "workbench/do", { locationId: A1, contactId: "a1-ada", action: note, confirm: true });
    expect(r.body.dryRun).toBe(true);
    const rows = await sql()`select action, detail from audit_log where installation_id = ${instA} and action like 'dry_run.%'`;
    expect(rows.length).toBe(1);
    expect(JSON.stringify(rows[0].detail)).toContain("crm.workbench.note.create");
    expect(JSON.stringify(rows[0].detail)).not.toContain("SECRET-NOTE-TEXT");
  });

  it("Do Not Disturb refuses a message even as a dry run; a delete needs the typed name", async () => {
    const dnd = await call(agency(), "POST", "workbench/do", { locationId: A1, contactId: "a1-dnd", action: { kind: "message", channel: "SMS", text: "hello" }, confirm: true });
    expect(dnd.status).toBe(422);
    expect(dnd.body.blockers[0].id).toBe("dnd");
    const del = await call(agency(), "POST", "workbench/do", { locationId: A1, contactId: "a1-ada", action: { kind: "delete", confirmText: "wrong" }, confirm: true });
    expect(del.status).toBe(422);
    const delOk = await call(agency(), "POST", "workbench/do", { locationId: A1, contactId: "a1-ada", action: { kind: "delete", confirmText: "Ada Test" }, confirm: true });
    expect(delOk.body.dryRun).toBe(true); // switched off: nothing was deleted
    expect((await sql()`select 1 from cached_contacts where installation_id = ${instA} and contact_id = 'a1-ada'`).length).toBe(1);
  });

});
