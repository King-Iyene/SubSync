import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { applyLeadRules } from "@/lib/sync/lead-rules-apply";

// The real lead rules against the real database, on a fixture account that is removed afterwards. Skipped with no database.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-leadrules-co";
const LOC = "xtestLeadRulesLoc";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const MIN = 60_000;
const lastSaturdayAt13Utc = () => {
  const d = new Date();
  d.setUTCHours(13, 0, 0, 0);
  while (d.getUTCDay() !== 6 || d.getTime() > Date.now() - 2 * 86_400_000) d.setUTCDate(d.getUTCDate() - 1);
  return d;
};

type C = { id: string; first?: string; email?: string | null; tags?: string[]; source?: string | null; dnd?: boolean; at: Date };
let inst = "";

async function addContact(c: C) {
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, tags, source, dnd, date_added)
    values (${inst}, ${LOC}, ${c.id}, ${c.first ?? "Pat"}, ${"L-" + c.id}, ${c.email ?? null}, ${c.tags ?? []}, ${c.source ?? null}, ${c.dnd ?? false}, ${c.at})`;
  await sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at) values (${inst}, ${LOC}, ${c.id}, ${"conv-" + c.id}, ${c.at})`;
}
const row = async (id: string) => (await sql()`select excluded, clock_start from lead_touches where installation_id = ${inst} and contact_id = ${id}`)[0];

describe.skipIf(!HAS_DB)("lead rules applied to real rows", () => {
  const sat = lastSaturdayAt13Utc();
  const recent = new Date(Date.now() - 3 * 86_400_000 - 5 * MIN);

  beforeAll(async () => {
    await sql()`delete from installations where company_id = ${CO}`;
    const tok = encryptSecret("not-a-real-token");
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${CO}, 'zzLeadRules', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`;
    inst = i.id as string;
    await sql()`insert into locations (installation_id, location_id, name, timezone) values (${inst}, ${LOC}, 'Lead rules fixture', 'Africa/Lagos')`;
    await sql()`insert into settings (installation_id, speed_business_hours, speed_open_hour, speed_close_hour) values (${inst}, true, 9, 17)
      on conflict (installation_id) do update set speed_business_hours = true, speed_open_hour = 9, speed_close_hour = 17`;
    await addContact({ id: "c-good", email: "pat.one@homes.test.ng", source: "Facebook Lead Form", at: recent });
    await addContact({ id: "c-spam", tags: ["spam"], at: new Date(recent.getTime() + MIN * 1) });
    await addContact({ id: "c-test", first: "Test", at: new Date(recent.getTime() + MIN * 120) });
    await addContact({ id: "c-dnd", dnd: true, at: new Date(recent.getTime() + MIN * 240) });
    await addContact({ id: "c-csv", source: "CSV import", at: new Date(recent.getTime() + MIN * 360) });
    await addContact({ id: "c-dup", email: "pat.one@homes.test.ng", at: new Date(recent.getTime() + MIN * 480) });
    await addContact({ id: "c-sat", at: sat });
    // Twenty contacts created in the same minute are a bulk import.
    const bulkAt = new Date(Math.floor((recent.getTime() + MIN * 600) / MIN) * MIN); // start of a minute
    for (let k = 0; k < 20; k++) await addContact({ id: `c-bulk-${k}`, first: "Bulk", at: new Date(bulkAt.getTime() + k * 1000) });
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  it("excludes each kind of contact that is not a lead, with the right reason, and keeps the real one", async () => {
    const out = await applyLeadRules(inst, LOC);
    expect(out.checked).toBe(27);
    expect((await row("c-good")).excluded).toBeNull();
    expect((await row("c-spam")).excluded).toBe("spam");
    expect((await row("c-test")).excluded).toBe("test");
    expect((await row("c-dnd")).excluded).toBe("dnd");
    expect((await row("c-csv")).excluded).toBe("import");
    expect((await row("c-dup")).excluded).toBe("duplicate");
    expect((await row("c-bulk-3")).excluded).toBe("import");
    expect((await row("c-sat")).excluded).toBeNull();
  });

  it("starts the clock of a weekend lead on Monday morning in the account's time zone, and leaves a weekday lead alone", async () => {
    const r = await row("c-sat");
    const monday = new Date(sat.getTime());
    monday.setUTCDate(monday.getUTCDate() + 2);
    monday.setUTCHours(8, 0, 0, 0); // 09:00 in Lagos (UTC+1, no daylight saving)
    expect((r.clock_start as Date).getTime()).toBe(monday.getTime());
    // 3 days ago at a weekday daytime may or may not fall in opening hours; what matters is it is never before the lead.
    const g = await row("c-good");
    if (g.clock_start) expect((g.clock_start as Date).getTime()).toBeGreaterThan(recent.getTime());
  });

  it("is repeatable: a second run changes nothing", async () => {
    const before = await sql()`select contact_id, excluded, clock_start from lead_touches where installation_id = ${inst} order by contact_id`;
    const again = await applyLeadRules(inst, LOC);
    expect(again.checked).toBe(27);
    const after = await sql()`select contact_id, excluded, clock_start from lead_touches where installation_id = ${inst} order by contact_id`;
    expect(after).toEqual(before);
  });

  it("a contact that is tagged spam later drops out on the next run", async () => {
    await sql()`update cached_contacts set tags = array['spam'] where installation_id = ${inst} and contact_id = 'c-good'`;
    await applyLeadRules(inst, LOC);
    expect((await row("c-good")).excluded).toBe("spam");
  });

  it("with business hours off, no clock start is stored", async () => {
    await sql()`update settings set speed_business_hours = false where installation_id = ${inst}`;
    await applyLeadRules(inst, LOC);
    expect((await row("c-sat")).clock_start).toBeNull();
  });
});
