import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { listBell } from "@/lib/notifications/store";
import { announceNewClients, finishFirstSyncNotices, firstSyncDoneTitle, newAccountIds, newClientTitle } from "@/lib/sync/new-client";

// NC item 2 against the real database: a new client account makes one notice, one audit row and one onboarding seed, however often it is seen, and one
// company's accounts never reach another company. Two fixture companies with no refresh token (the production cron never touches them). Skipped without a database.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const A = "xtest-nc-a";
const B = "xtest-nc-b";
let a = "";
let b = "";

describe("which accounts are new", () => {
  it("announces nothing on a company's first read and only the unseen accounts after it", () => {
    expect(newAccountIds(["L1", "L2"], [], false)).toEqual([]);
    expect(newAccountIds(["L1", "L2", "L3"], ["L1", "L2"], true)).toEqual(["L3"]);
    expect(newAccountIds(["L1", "L1", "L2"], [], true)).toEqual(["L1", "L2"]);
    expect(newAccountIds(["L1"], ["L1"], false)).toEqual([]);
  });
  it("uses the words the owner sees", () => {
    expect(newClientTitle("Acme Dental")).toBe("New client account: Acme Dental");
    expect(newClientTitle(null)).toBe("New client account: a new account");
    expect(firstSyncDoneTitle(1200, 34)).toBe("First sync done: 1,200 contacts, 34 deals");
  });
});

describe.skipIf(!HAS_DB)("new client account flow against the real database", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${A}, ${B})`;
    [{ id: a }] = await sql()`insert into installations (company_id, company_name, plan) values (${A}, 'zzNC-A', 'pro') returning id`;
    [{ id: b }] = await sql()`insert into installations (company_id, company_name, plan) values (${B}, 'zzNC-B', 'pro') returning id`;
    await sql()`insert into onboarding_templates (installation_id, name, industry_key, steps) values (${a}, 'Everyone', null, ${sql().json([{ key: "ncaaaa1", label: "Collect the logo" }, { key: "ncaaaa2", label: "Book the kickoff" }] as never)})`;
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${A}, ${B})`; await closeDb(); });

  it("the same account seen twice makes one notice, one audit row and one seed", async () => {
    await sql()`insert into locations (installation_id, location_id, name) values (${a}, 'NC-L1', 'Acme Dental') on conflict do nothing`;
    expect(await announceNewClients(a, [{ locationId: "NC-L1", name: "Acme Dental" }])).toBe(1);
    expect(await announceNewClients(a, [{ locationId: "NC-L1", name: "Acme Dental" }])).toBe(0);
    const bell = (await listBell(a, { kind: "agency", limitTo: null }, "owner")).filter((i) => i.title.startsWith("New client account"));
    expect(bell).toHaveLength(1);
    expect(bell[0].title).toBe("New client account: Acme Dental");
    expect(bell[0].body).toBe("First sync is running.");
    expect(bell[0].link.locationId).toBe("NC-L1");
    const [audit] = await sql()`select count(*)::int n from audit_log where installation_id = ${a} and action = 'client_account_added'`;
    expect(audit.n).toBe(1);
    const steps = await sql()`select step_key, due_on is not null due from client_steps where installation_id = ${a} and location_id = 'NC-L1' order by step_key`;
    expect(steps.map((s) => s.step_key)).toEqual(["tpl:ncaaaa1", "tpl:ncaaaa2"]);
    expect(steps.every((s) => s.due)).toBe(true);
    const [hist] = await sql()`select count(*)::int n from client_step_history where installation_id = ${a} and location_id = 'NC-L1'`;
    expect(hist.n).toBe(2);
  });

  it("says when the first sync is done, with the counts, once, and only after contacts and deals were both read", async () => {
    expect(await finishFirstSyncNotices(a)).toBe(0);
    await sql()`update locations set contacts_synced_at = now() where installation_id = ${a} and location_id = 'NC-L1'`;
    expect(await finishFirstSyncNotices(a)).toBe(0);
    await sql()`update locations set opportunities_synced_at = now() where installation_id = ${a} and location_id = 'NC-L1'`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id) values (${a}, 'NC-L1', 'c1'), (${a}, 'NC-L1', 'c2')`;
    expect(await finishFirstSyncNotices(a)).toBe(1);
    expect(await finishFirstSyncNotices(a)).toBe(0);
    const done = (await listBell(a, { kind: "agency", limitTo: null }, "owner")).filter((i) => i.title.startsWith("First sync done"));
    expect(done.map((i) => i.title)).toEqual(["First sync done: 2 contacts, 0 deals"]);
  });

  it("another company sees none of it, and a client's own staff never see the company notice", async () => {
    expect((await listBell(b, { kind: "agency", limitTo: null }, "owner")).filter((i) => /client account|First sync/.test(i.title))).toHaveLength(0);
    expect((await listBell(a, { kind: "client", limitTo: "NC-L1" }, "staff")).filter((i) => /client account|First sync/.test(i.title))).toHaveLength(0);
    expect(await announceNewClients(b, [{ locationId: "NC-L1", name: "Same id, other company" }])).toBe(1);
    const [mine] = await sql()`select count(*)::int n from audit_log where installation_id = ${a} and action = 'client_account_added'`;
    expect(mine.n).toBe(1);
    const [seeded] = await sql()`select count(*)::int n from client_steps where installation_id = ${b}`;
    expect(seeded.n).toBe(0);
  });
});
