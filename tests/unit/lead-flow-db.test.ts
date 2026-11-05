import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// Lead flow against the real database: leads created in the dates chosen, followed to a reply, an appointment and its outcome; and the walls between companies.
//   1. The counts follow the data: replied (a person answered), never answered, booked, showed, no-show, won; the steps add up.
//   2. The dates choose the leads: a lead outside them is not counted.
//   3. Another company's client, a sibling client a client's staff may not read, or a forged accounts= / ta= / location= returns nothing from outside the caller's own clients.
//   4. Bad dates are refused in plain words.
// Fixture companies only, removed afterwards. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const CO_A = "xtest-flow-a", CO_B = "xtest-flow-b";
const A1 = "xtestFlowA1", A2 = "xtestFlowA2", B1 = "xtestFlowB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "user" : "business_owner", exp: Math.floor(Date.now() / 1000) + 3600 } as never);
const iso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
const get = async (token: string, query: string) => { const res = await handle(new Request(`http://localhost/api/app/today/lead-flow${query}`, { headers: { Authorization: `Bearer ${token}` } }), ["today", "lead-flow"]); return { status: res.status, body: (await res.json()) as Json }; };
const range = `?from=${iso(6)}&to=${iso(0)}`;

describe.skipIf(!HAS_DB)("Lead flow", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzFlow A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzFlow B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzFlow Client A1"], [instA, A2, "zzFlow Client A2"], [instB, B1, "zzFlow Client B1"]]) await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    const contact = (inst: string, loc: string, id: string, daysAgo: number) =>
      sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, date_added) values (${inst}, ${loc}, ${id}, ${id}, 'Flow', ${`${id}@gmail.com`}, now() - make_interval(days => ${daysAgo}) - interval '1 hour')`;
    const touch = (inst: string, loc: string, id: string, replied: boolean) =>
      sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, human_touch_at, read_version) values (${inst}, ${loc}, ${id}, ${`conv-${id}`}, now() - interval '2 days', ${replied ? new Date() : null}, 1)`;
    const appt = (inst: string, loc: string, id: string, status: string) =>
      sql()`insert into cached_appointments (installation_id, location_id, appointment_id, contact_id, status, start_at) values (${inst}, ${loc}, ${`ap-${id}`}, ${id}, ${status}, now())`;
    // A1: f1 replied+booked+showed+won, f2 replied+booked+noshow, f3 replied only, f4 never (a conversation, no person answered), f5 never (no conversation, recent), f6 outside the dates.
    for (const [id, d] of [["f1", 1], ["f2", 2], ["f3", 3], ["f4", 3], ["f5", 4], ["f6", 20]] as const) await contact(instA, A1, id, d);
    await touch(instA, A1, "f1", true); await touch(instA, A1, "f2", true); await touch(instA, A1, "f3", true); await touch(instA, A1, "f4", false);
    await appt(instA, A1, "f1", "showed"); await appt(instA, A1, "f2", "noshow"); await appt(instA, A1, "f6", "showed");
    await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, contact_id, status, monetary_value) values (${instA}, ${A1}, 'o1', 'f1', 'won', 100)`;
    await contact(instA, A2, "g1", 1);
    await contact(instB, B1, "x1", 1); await contact(instB, B1, "x2", 1);
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("counts each step from the data and the steps add up", async () => {
    const r = await get(session(CO_A, "client", A1), range);
    expect(r.status).toBe(200);
    const c = (id: string) => r.body.flow.nodes.find((n: Json) => n.id === id).count;
    expect(r.body.flow.total).toBe(5); // f6 was added outside the dates
    expect([c("replied"), c("never"), c("unknown")]).toEqual([3, 2, 0]);
    expect([c("booked"), c("nobook"), c("showed"), c("noshow"), c("waiting")]).toEqual([2, 3, 1, 1, 0]);
    expect(r.body.flow.won).toBe(1);
    expect(r.body.leads.map((l: Json) => l.name).sort()).toEqual(["f1 Flow", "f2 Flow", "f3 Flow", "f4 Flow", "f5 Flow"]);
  });

  it("the dates choose the leads", async () => {
    const wide = await get(session(CO_A, "client", A1), `?from=${iso(30)}&to=${iso(0)}`);
    expect(wide.body.flow.total).toBe(6);
    const none = await get(session(CO_A, "client", A1), `?from=${iso(60)}&to=${iso(40)}`);
    expect(none.body.flow.total).toBe(0);
  });

  it("an agency sees all its clients, a client's staff only their own, and never another company's", async () => {
    const agency = await get(session(CO_A, "agency", null), range);
    expect(agency.body.flow.total).toBe(6); // five at A1 and one at A2
    expect(agency.body.leads.every((l: Json) => l.locationId === A1 || l.locationId === A2)).toBe(true);
    const staff = await get(session(CO_A, "client", A1), range);
    expect(staff.body.leads.every((l: Json) => l.locationId === A1)).toBe(true);
    for (const q of [`&accounts=${B1}`, `&accounts=${B1},${A2}`, `&ta=${A2}`, `&location=${A2}&locationId=${A2}`]) {
      const r = await get(session(CO_A, "client", A1), range + q);
      expect(r.status).toBe(200);
      expect(r.body.leads.every((l: Json) => l.locationId === A1), q).toBe(true);
      expect(JSON.stringify(r.body)).not.toContain(B1);
    }
    const own = await get(session(CO_B, "agency", null), range);
    expect(own.body.flow.total).toBe(2);
    const other = await get(session(CO_B, "agency", null), range + `&accounts=${A1}`);
    expect(other.body.flow.total).toBe(0);
    expect(JSON.stringify(other.body)).not.toContain("xtestFlowA");
  });

  it("refuses bad dates in plain words", async () => {
    for (const q of ["", "?from=2026-11-05", `?from=${iso(0)}&to=${iso(5)}`, "?from=2024-01-01&to=2026-11-01", "?from=abc&to=def"]) {
      const r = await get(session(CO_A, "agency", null), q);
      expect(r.status, q).toBe(400);
      expect(typeof r.body.error).toBe("string");
    }
  });
});
