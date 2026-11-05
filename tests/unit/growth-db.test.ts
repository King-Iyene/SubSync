import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { handle } from "@/lib/api/router";
import { growthAlertDrafts } from "@/lib/api/growth-api";
import { signSession } from "@/lib/session";

// The Growth tab against the real database: new email leads per client, the goal and the two settings, and the walls between companies.
//   1. A person counts once per client: copies, test records, staff and shared mailboxes are left out and the breakdown adds up.
//   2. Another company's client, a sibling client a client's staff may not read, or a forged `accounts=` returns nothing from outside the caller's own accounts.
//   3. Goals and settings are written only by someone who may; a goal for a client that is not yours is refused like one that does not exist.
//   4. A sudden drop raises an alert with a dedupe key.
// Fixture companies only, removed afterwards. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const CO_A = "xtest-grow-a", CO_B = "xtest-grow-b";
const A1 = "xtestGrowA1", A2 = "xtestGrowA2", B1 = "xtestGrowB1";
let instA = "", instB = "";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const session = (company: string, kind: "agency" | "business" | "client", locationId: string | null) =>
  signSession({ companyId: company, userId: `u-${kind}`, role: kind === "client" ? "user" : "admin", userName: `Test ${kind}`, demo: false, kind, locationId, personRole: kind === "agency" ? "agency_owner" : kind === "client" ? "user" : "business_owner", exp: Math.floor(Date.now() / 1000) + 3600 } as never);
const get = async (token: string, path = "today/growth", query = "") => { const res = await handle(new Request(`http://localhost/api/app/${path}${query}`, { headers: { Authorization: `Bearer ${token}` } }), path.split("/")); return { status: res.status, body: (await res.json()) as Json }; };
const post = async (token: string, path: string, body: Json) => { const res = await handle(new Request(`http://localhost/api/app/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), path.split("/")); return { status: res.status, body: (await res.json()) as Json }; };

describe.skipIf(!HAS_DB)("Growth: email leads", () => {
  beforeAll(async () => {
    for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: instA }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzGrow A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: instB }] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzGrow B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const inst of [instA, instB]) await sql()`insert into settings (installation_id) values (${inst}) on conflict do nothing`;
    for (const [inst, loc, name] of [[instA, A1, "zzGrow Client A1"], [instA, A2, "zzGrow Client A2"], [instB, B1, "zzGrow Client B1"]]) await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${inst}, ${loc}, ${name}, 'UTC', true)`;
    const add = async (inst: string, loc: string, id: string, first: string, email: string | null, hoursAgo: number, source = "Facebook Ads") =>
      sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, source, date_added) values (${inst}, ${loc}, ${id}, ${first}, 'Grow', ${email}, ${source}, now() - make_interval(hours => ${hoursAgo}))`;
    // A1: two real people, a copy of one of them, a test record, a staff address, a shared mailbox and a contact with no email, all in the last two days.
    await add(instA, A1, "a1", "Ann", "ann.lee@gmail.com", 5); await add(instA, A1, "a2", "Ann", "annlee+ad@gmail.com", 3); await add(instA, A1, "a3", "Bob", "bob@outlook.com", 4);
    await add(instA, A1, "a4", "Test", "test@acme.com", 2); await add(instA, A1, "a5", "Zed", "zed@myagency.com", 2); await add(instA, A1, "a6", "Shop", "info@bakery.com", 2); await add(instA, A1, "a7", "Nomail", null, 2);
    await add(instA, A2, "b1", "Cy", "cy@yahoo.com", 6, "Google Search");
    await add(instB, B1, "x1", "Secret", "secret@other.com", 3); await add(instB, B1, "x2", "Secret2", "secret2@other.com", 3);
    await sql()`insert into growth_settings (installation_id, exclude_role_addresses, internal_domains) values (${instA}, true, ${["myagency.com"]})`;
  });
  afterAll(async () => { for (const co of [CO_A, CO_B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("counts one person once per client and the breakdown adds up", async () => {
    const r = await get(session(CO_A, "agency", null));
    expect(r.status).toBe(200);
    const g = r.body;
    expect(g.changes.all.count).toBe(3); // Ann, Bob, Cy
    expect(g.gross.signUps).toBe(7); // six with an email at A1 and one at A2; the contact with no email is not a sign up
    expect(g.gross.removed).toEqual({ duplicate: 1, junk: 1, staff: 1, role: 1 });
    expect(g.gross.unique + 4).toBe(g.gross.signUps);
    const names = g.records.filter((x: Json) => x.verdict === "counted").map((x: Json) => x.name).sort();
    expect(names).toEqual(["Ann Grow", "Bob Grow", "Cy Grow"]);
    expect(g.records.every((x: Json) => x.locationId === A1 || x.locationId === A2)).toBe(true);
  });

  it("never returns another company's client, whatever ids or accounts= say", async () => {
    const agency = session(CO_A, "agency", null);
    for (const q of [`?accounts=${B1}`, `?accounts=${B1},${A1}`, `?ta=${B1}`, `?location=${B1}&locationId=${B1}`]) {
      const r = await get(agency, "today/growth", q);
      expect(r.status).toBe(200);
      const seen = new Set<string>([...r.body.records.map((x: Json) => x.locationId), ...r.body.league.map((x: Json) => x.locationId)]);
      expect(seen.has(B1), `${q}`).toBe(false);
      expect(JSON.stringify(r.body)).not.toContain("Secret");
    }
    // the other company sees only its own
    const b = await get(session(CO_B, "agency", null));
    expect(b.body.changes.all.count).toBe(2);
    expect(JSON.stringify(b.body)).not.toContain("Ann");
  });

  it("a client's staff see only their own client, and a business owner only theirs", async () => {
    const staff = await get(session(CO_A, "client", A1), "today/growth", `?accounts=${A2}`);
    expect(staff.body.accounts).toBe(1);
    expect(staff.body.league.map((x: Json) => x.locationId)).toEqual([A1]);
    expect(staff.body.records.every((x: Json) => x.locationId === A1)).toBe(true);
    expect(staff.body.rules.internalDomains, "a client's staff never see which internal domains the company leaves out").toEqual([]);
    const biz = await get(session(CO_A, "business", A2));
    expect(biz.body.league.map((x: Json) => x.locationId)).toEqual([A2]);
    expect(biz.body.changes.all.count).toBe(1);
  });

  it("goals: set by someone who may, refused for a client that is not theirs, refused for a client's staff, removed when emptied", async () => {
    const agency = session(CO_A, "agency", null);
    expect((await post(agency, "today/growth/goal", { locationId: A1, goal: 40 })).status).toBe(200);
    expect((await get(agency)).body.league.find((x: Json) => x.locationId === A1).goal).toBe(40);
    expect((await post(agency, "today/growth/goal", { locationId: B1, goal: 40 })).status, "another company's client").toBe(404);
    expect((await post(session(CO_A, "client", A1), "today/growth/goal", { locationId: A1, goal: 5 })).status).toBe(403);
    expect([403, 404], "a sibling client").toContain((await post(session(CO_A, "business", A2), "today/growth/goal", { locationId: A1, goal: 5 })).status);
    for (const bad of [0, -3, 1.5, "7", 2_000_000]) expect((await post(agency, "today/growth/goal", { locationId: A1, goal: bad })).status).toBe(400);
    expect((await post(agency, "today/growth/goal", { locationId: A1, goal: null })).status).toBe(200);
    expect((await get(agency)).body.league.find((x: Json) => x.locationId === A1).goal).toBeNull();
    const rows = await sql()`select count(*)::int n from growth_goals where installation_id = ${instB}`;
    expect(rows[0].n).toBe(0);
  });

  it("settings: saved for the company, refused for a client's staff, domains cleaned", async () => {
    const agency = session(CO_A, "agency", null);
    const ok = await post(agency, "today/growth/settings", { excludeRoleAddresses: false, internalDomains: ["@MyAgency.com ", "not a domain", "myagency.com"] });
    expect(ok.status).toBe(200);
    expect(ok.body.internalDomains).toEqual(["myagency.com"]);
    expect((await get(agency)).body.gross.removed.role).toBe(0);
    expect((await post(session(CO_A, "client", A1), "today/growth/settings", { excludeRoleAddresses: true, internalDomains: [] })).status).toBe(403);
    expect((await post(agency, "today/growth/settings", { excludeRoleAddresses: "yes" })).status).toBe(400);
    expect((await get(session(CO_B, "agency", null))).body.rules.internalDomains).toEqual([]);
    await post(agency, "today/growth/settings", { excludeRoleAddresses: true, internalDomains: ["myagency.com"] });
  });

  it("a sudden drop raises one alert with a dedupe key, for the client that dropped only", async () => {
    // A3 has a steady 35 leads a week for 6 weeks and nothing this week.
    const A3 = "xtestGrowA3";
    await sql()`insert into locations (installation_id, location_id, name, timezone, client_view) values (${instA}, ${A3}, 'zzGrow Client A3', 'UTC', true)`;
    for (let d = 8; d <= 50; d++) for (let n = 0; n < 5; n++) await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, date_added) values (${instA}, ${A3}, ${`s${d}-${n}`}, ${`P${d}x${n}`}, 'Steady', ${`p${d}x${n}@gmail.com`}, now() - make_interval(days => ${d}, hours => ${n}))`;
    const drafts = await growthAlertDrafts(instA);
    const mine = drafts.filter((x) => x.locationId === A3);
    expect(mine.some((x) => x.kind === "growth" && x.dedupeKey === `growth:${A3}:week:drop` && x.severity === "warning")).toBe(true);
    expect(drafts.filter((x) => x.locationId === A1 || x.locationId === B1), "thin data stays quiet").toEqual([]);
    expect((await growthAlertDrafts(instB)).every((x) => x.locationId === B1)).toBe(true);
  });

  it("without the tables Growth still opens and says what is missing", async () => {
    await sql()`alter table growth_goals rename to growth_goals_x`;
    try {
      const r = await get(session(CO_A, "agency", null));
      expect(r.status).toBe(200);
      expect(r.body.setup.goalsReady).toBe(false);
      expect((await post(session(CO_A, "agency", null), "today/growth/goal", { locationId: A1, goal: 5 })).status).toBe(409);
    } finally { await sql()`alter table growth_goals_x rename to growth_goals`; }
  });
});
