import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { signSession } from "@/lib/session";

// The date and client filter each Today report tab carries, against the real database: the dates choose which leads are counted (and the same count opens the same people), and a
// client in the address is checked against the caller's own list on the server. A client of another company, a sibling a client's staff may not read, or a made-up id is refused,
// never silently widened. Fixture companies only, removed afterwards. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const CO_A = "xtest-flt-a", CO_B = "xtest-flt-b";
const A1 = "xtestFltA1", A2 = "xtestFltA2", B1 = "xtestFltB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "user" : "business_owner", exp: Math.floor(Date.now() / 1000) + 3600 } as never);
const get = async (token: string, path: string) => {
  const res = await handle(new Request(`http://localhost/api/app/${path}`, { headers: { Authorization: `Bearer ${token}` } }), path.split("?")[0].split("/"));
  return { status: res.status, body: (await res.json()) as Json };
};
const day = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(!HAS_DB)("Today report tabs: dates and client filter", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzFlt A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzFlt B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzFlt Client A1"], [instA, A2, "zzFlt Client A2"], [instB, B1, "zzFlt Client B1"]]) await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    const add = (inst: string, loc: string, id: string, email: string, daysAgo: number) =>
      sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, source, dnd, date_added) values (${inst}, ${loc}, ${id}, ${id}, 'Flt', ${email}, 'Facebook Ads', false, now() - make_interval(days => ${daysAgo}))`;
    await add(instA, A1, "g1", "a1.recent@gmail.com", 2); await add(instA, A1, "g2", "a1.recent2@gmail.com", 3); await add(instA, A1, "g3", "a1.old@gmail.com", 40);
    await add(instA, A2, "g4", "a2.recent@gmail.com", 1);
    await add(instB, B1, "x1", "b1.secret@gmail.com", 1);
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("Growth: the dates choose which leads are counted, and the chart has one point per day", async () => {
    const agency = session(CO_A, "agency", null);
    const week = await get(agency, `today/growth?from=${day(6)}&to=${day(0)}`);
    expect(week.status).toBe(200);
    expect(week.body.range.days).toBe(7);
    expect(week.body.range.count).toBe(3);
    expect(week.body.series).toHaveLength(7);
    expect(week.body.series.reduce((s: number, p: Json) => s + p.count, 0)).toBe(3);
    const long = await get(agency, `today/growth?from=${day(89)}&to=${day(0)}`);
    expect(long.body.range.count).toBe(4);
    expect(long.body.series).toHaveLength(90);
    // The records a mark opens are the same people the mark counted.
    expect(long.body.records.filter((r: Json) => r.verdict === "counted" && r.at >= long.body.range.start && r.at < long.body.range.end)).toHaveLength(4);
    expect(long.body.mix.total).toBe(4);
  });

  it("Growth: a client filter narrows every part, and a tampered client is refused", async () => {
    const agency = session(CO_A, "agency", null);
    const one = await get(agency, `today/growth?client=${A2}`);
    expect(one.status).toBe(200);
    expect(one.body.accounts).toBe(1);
    expect(one.body.range.count).toBe(1);
    expect(one.body.league.map((l: Json) => l.locationId)).toEqual([A2]);
    for (const bad of [B1, "nope-not-mine", "../etc/passwd", "a"]) {
      const r = await get(agency, `today/growth?client=${encodeURIComponent(bad)}`);
      expect([400, 404], bad).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toContain("b1.secret");
    }
    expect((await get(agency, "today/growth?from=2026-13-40&to=2026-01-01")).status).toBe(400);
    expect((await get(agency, `today/growth?from=${day(0)}&to=${day(5)}`)).status).toBe(400);
  });

  it("a client's staff can only ever read their own client, whatever the address says", async () => {
    const staff = session(CO_A, "client", A1);
    expect((await get(staff, `today/growth?client=${A2}`)).status).toBe(404);
    expect((await get(staff, `today/lead-flow?from=${day(6)}&to=${day(0)}&client=${A2}`)).status).toBe(404);
    const own = await get(staff, `today/growth?client=${A1}&from=${day(6)}&to=${day(0)}`);
    expect(own.status).toBe(200);
    expect(own.body.accounts).toBe(1);
    expect(own.body.range.count).toBe(2);
  });

  it("another company never sees these clients, and its own list is unaffected", async () => {
    const other = session(CO_B, "agency", null);
    expect((await get(other, `today/growth?client=${A1}`)).status).toBe(404);
    expect((await get(other, `today/lead-flow?from=${day(6)}&to=${day(0)}&client=${A1}`)).status).toBe(404);
    const mine = await get(other, `today/growth?from=${day(6)}&to=${day(0)}`);
    expect(JSON.stringify(mine.body)).not.toContain("xtestFltA");
    expect(mine.body.range.count).toBe(1);
  });

  it("Lead flow: the client filter narrows the leads it follows", async () => {
    const agency = session(CO_A, "agency", null);
    const all = await get(agency, `today/lead-flow?from=${day(6)}&to=${day(0)}`);
    expect(all.body.flow.total).toBe(3);
    const one = await get(agency, `today/lead-flow?from=${day(6)}&to=${day(0)}&client=${A1}`);
    expect(one.body.flow.total).toBe(2);
    expect(one.body.leads.every((l: Json) => l.locationId === A1)).toBe(true);
  });

  it("the email list follows the same dates", async () => {
    const agency = session(CO_A, "agency", null);
    const r = await get(agency, `today/growth/emails?from=${day(6)}&to=${day(0)}`);
    expect(r.body.total).toBe(3);
  });
});
