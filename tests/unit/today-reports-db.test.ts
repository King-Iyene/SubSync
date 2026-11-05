import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { purgeLocationData } from "@/lib/ghl/installations";
import { signSession } from "@/lib/session";

// The two report tabs added to Today, against the real database:
//   Email leads (under Growth): one person once per client, search, client filter, a CSV of what is shown without do-not-contact people, an audit line, and the walls between companies.
//   Clients coming and going: agency only, arrivals from when a client was first seen, departures recorded when a client is removed, a plain refusal for everyone else.
// Fixture companies only, removed afterwards. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const CO_A = "xtest-rep-a", CO_B = "xtest-rep-b";
const A1 = "xtestRepA1", A2 = "xtestRepA2", A3 = "xtestRepA3", B1 = "xtestRepB1";
let instA = "", instB = "", tablesThere = true;
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "user" : "business_owner", exp: Math.floor(Date.now() / 1000) + 3600 } as never);
const req = (token: string, path: string) => handle(new Request(`http://localhost/api/app/${path}`, { headers: { Authorization: `Bearer ${token}` } }), path.split("?")[0].split("/"));
const get = async (token: string, path: string) => { const res = await req(token, path); return { status: res.status, body: (await res.json()) as Json }; };

describe.skipIf(!HAS_DB)("Email leads and Clients coming and going", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzRep A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzRep B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzRep Client A1"], [instA, A2, "zzRep Client A2"], [instA, A3, "zzRep Client A3"], [instB, B1, "zzRep Client B1"]]) await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    const add = (inst: string, loc: string, id: string, email: string, hoursAgo: number, dnd = false) =>
      sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, source, dnd, date_added) values (${inst}, ${loc}, ${id}, ${id}, 'Rep', ${email}, 'Facebook Ads', ${dnd}, now() - make_interval(hours => ${hoursAgo}))`;
    await add(instA, A1, "e1", "ann.lee@gmail.com", 5); await add(instA, A1, "e2", "bob@outlook.com", 4); await add(instA, A1, "e3", "optout@yahoo.com", 3, true); await add(instA, A1, "e4", "=cmd@gmail.com", 2);
    await add(instA, A2, "e5", "cy@yahoo.com", 6);
    await add(instB, B1, "x1", "secret@other.com", 3);
    const [t] = await sql()`select to_regclass('client_departures') as d`;
    tablesThere = Boolean(t.d);
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("lists each person once per client, newest first, with search and a client filter", async () => {
    const r = await get(session(CO_A, "agency", null), "today/growth/emails");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(5);
    expect(r.body.doNotContact).toBe(1);
    const s = await get(session(CO_A, "agency", null), "today/growth/emails?q=outlook");
    expect(s.body.rows.map((x: Json) => x.email)).toEqual(["bob@outlook.com"]);
    const c = await get(session(CO_A, "agency", null), `today/growth/emails?client=${A2}`);
    expect(c.body.rows.map((x: Json) => x.email)).toEqual(["cy@yahoo.com"]);
  });

  it("never returns another company's client or a sibling a client's staff may not read", async () => {
    const staff = session(CO_A, "client", A1);
    const r = await get(staff, "today/growth/emails");
    expect(r.body.rows.every((x: Json) => x.locationId === A1)).toBe(true);
    for (const q of [`?client=${A2}`, `?client=${B1}`, `?accounts=${B1}`, `?ta=${A2}`]) {
      const x = await get(staff, `today/growth/emails${q}`);
      expect(x.status).toBe(200);
      expect(x.body.rows.every((y: Json) => y.locationId === A1), q).toBe(true);
    }
    const other = await get(session(CO_B, "agency", null), `today/growth/emails?client=${A1}`);
    expect(other.body.total).toBe(0);
    expect(JSON.stringify(await get(session(CO_B, "agency", null), "today/growth/emails"))).not.toContain("xtestRepA");
  });

  it("the download follows the filters, leaves out do-not-contact people, is safe in a spreadsheet and is audit-logged", async () => {
    const res = await req(session(CO_A, "agency", null), "today/growth/emails?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("ann.lee@gmail.com");
    expect(text).not.toContain("optout@yahoo.com");
    expect(text).toContain("'=cmd@gmail.com");
    expect(text.split("\r\n")[0]).toBe("Email,Name,Client,Source,Date added");
    const one = await (await req(session(CO_A, "agency", null), `today/growth/emails?format=csv&client=${A2}`)).text();
    expect(one.trim().split("\r\n")).toHaveLength(2);
    const [log] = await sql()`select count(*)::int as n, bool_or(detail::text like '%@%') as has_address from audit_log where installation_id = ${instA} and action = 'growth.emails_downloaded'`;
    expect(log.n).toBe(2);
    expect(log.has_address).toBe(false);
  });

  it("Clients coming and going is for the company that looks after clients only", async () => {
    expect((await get(session(CO_A, "client", A1), "today/clients-flow")).status).toBe(403);
    expect((await get(session(CO_A, "business", A1), "today/clients-flow")).status).toBe(403);
    const r = await get(session(CO_A, "agency", null), "today/clients-flow");
    expect(r.status).toBe(200);
    expect(r.body.current).toBe(3);
    expect(r.body.events.filter((e: Json) => e.kind === "added")).toHaveLength(3);
    expect(JSON.stringify(r.body)).not.toContain("xtestRepB");
  });

  it("removing a client records when it left, and the tab shows it", async () => {
    if (!tablesThere) {
      const r = await get(session(CO_A, "agency", null), "today/clients-flow");
      expect(r.body.departuresReady).toBe(false);
      await expect(purgeLocationData(instA, A3)).resolves.toBeUndefined(); // the removal itself still works
      return;
    }
    await purgeLocationData(instA, A3);
    const r = await get(session(CO_A, "agency", null), "today/clients-flow");
    expect(r.body.departuresReady).toBe(true);
    expect(r.body.current).toBe(2);
    const gone = r.body.events.filter((e: Json) => e.kind === "removed");
    expect(gone.map((e: Json) => e.locationId)).toEqual([A3]);
    expect(r.body.events.filter((e: Json) => e.kind === "added")).toHaveLength(3); // the departed client's arrival is kept
  });
});
