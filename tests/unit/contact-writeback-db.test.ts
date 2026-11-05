import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { saveContactNote, undoWrite, writeCallOutcome } from "@/lib/analytics/contact-writeback";
import { changeTag } from "@/lib/analytics/contact-tags";

// Writing to the lead in the CRM against the real database, with the master switch OFF (so every write is a dry run and nothing can leave): idempotency per contact + outcome + minute,
// the hourly cap, tenancy (another company's or another account's contact is "not found", nothing is recorded), and a tag removal needs a confirm.
// Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const A = "xtest-wb-a", B = "xtest-wb-b";
let ia = "", ib = "";
const who = (inst: string, allowed: string[] | null) => ({ installationId: inst, allowed, actor: "u1", actorName: "Test User", granted: true });

describe.skipIf(!HAS_DB)("contact write-back", () => {
  beforeAll(async () => {
    delete process.env.WRITE_GHL_LIVE;
    for (const co of [A, B]) await sql()`delete from installations where company_id = ${co}`;
    [{ id: ia }] = await sql()`insert into installations (company_id, company_name, plan) values (${A}, 'zz A', 'pro') returning id` as unknown as Array<{ id: string }>;
    [{ id: ib }] = await sql()`insert into installations (company_id, company_name, plan) values (${B}, 'zz B', 'pro') returning id` as unknown as Array<{ id: string }>;
    for (const [i, l] of [[ia, "xwbA1"], [ia, "xwbA2"], [ib, "xwbB1"]]) await sql()`insert into locations (installation_id, location_id, name, timezone) values (${i}, ${l}, ${"zz " + l}, 'UTC')`;
    for (const [i, l, c] of [[ia, "xwbA1", "cA1"], [ia, "xwbA2", "cA2"], [ib, "xwbB1", "cB1"]]) await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, tags, dnd) values (${i}, ${l}, ${c}, 'Pat', 'Test', ${["hot"]}::text[], false)`;
  });
  afterAll(async () => { for (const co of [A, B]) await sql()`delete from installations where company_id = ${co}`; await closeDb(); });

  it("a double click is one write; the SubSync record is kept once; Undo removes it", async () => {
    const v = { locationId: "xwbA1", contactId: "cA1", outcome: "voicemail" as const, note: null, followUpInDays: null };
    const t = Date.now();
    const one = await writeCallOutcome(who(ia, null), v, t);
    const two = await writeCallOutcome(who(ia, null), v, t + 5_000);
    expect(one.status).toBe("dry_run");
    expect(two.duplicate).toBe(true);
    expect((await sql()`select count(*)::int n from contact_writes where installation_id = ${ia} and kind = 'outcome'`)[0].n).toBe(1);
    expect((await sql()`select count(*)::int n from call_outcomes where installation_id = ${ia} and contact_id = 'cA1'`)[0].n).toBe(1);
    expect((await undoWrite(who(ia, null), one.id!)).ok).toBe(true);
    expect((await sql()`select count(*)::int n from call_outcomes where installation_id = ${ia} and contact_id = 'cA1'`)[0].n).toBe(0);
  });

  it("the cap stops the 201st write in an hour with a plain message", async () => {
    await sql()`insert into contact_writes (installation_id, location_id, contact_id, kind, idem_key, status) select ${ib}, 'xwbB1', 'cB1', 'note', 'cap-' || g, 'dry_run' from generate_series(1, 200) g`;
    const r = await saveContactNote(who(ib, null), { locationId: "xwbB1", contactId: "cB1", text: "over the cap" });
    expect(r.status).toBe("limit");
    expect(r.message).toMatch(/limit of 200/);
  });

  it("tenancy: another company's contact, or an account outside the allowed list, is not found and records nothing", async () => {
    expect((await saveContactNote(who(ia, null), { locationId: "xwbB1", contactId: "cB1", text: "x" })).status).toBe("unknown");
    expect((await saveContactNote(who(ia, ["xwbA1"]), { locationId: "xwbA2", contactId: "cA2", text: "x" })).status).toBe("unknown");
    expect((await changeTag(who(ia, ["xwbA1"]), { locationId: "xwbA2", contactId: "cA2", tag: "x", remove: false })).status).toBe("unknown");
    expect((await sql()`select count(*)::int n from contact_writes where installation_id = ${ia} and contact_id in ('cB1', 'cA2')`)[0].n).toBe(0);
  });

  it("a tag removal without a confirm is refused; a confirmed one in dry-run leaves our copy of the tags alone", async () => {
    expect((await changeTag(who(ia, null), { locationId: "xwbA1", contactId: "cA1", tag: "hot", remove: true })).ok).toBe(false);
    expect((await changeTag(who(ia, null), { locationId: "xwbA1", contactId: "cA1", tag: "hot", remove: true, confirm: true })).status).toBe("dry_run");
    expect((await sql()`select tags from cached_contacts where installation_id = ${ia} and contact_id = 'cA1'`)[0].tags).toEqual(["hot"]);
  });
});
