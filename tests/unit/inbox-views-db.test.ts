import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { contactOwners, listViews, removeView, saveView, teamNames } from "@/lib/analytics/inbox-queries";
import { DEFAULT_QUEUE, MAX_SAVED_VIEWS } from "@/lib/analytics/waiting-view";

// Stage F4, on the real database (WRITTEN, NOT RUN in the stage: the lead runs it after the merge). Two fixture companies, no tokens (the scheduler ignores
// an install with none), both removed afterwards. Proves: saved views are per person and per company, a person cannot read or remove another person's or
// another company's view, the limit holds, a damaged saved filter reads back as the default, and the conversation owner lookup stays inside its company.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-f4-a";
const CO_B = "xtest-f4-b";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let a = "";
let b = "";
const ME = "agency:agency:user-1";
const OTHER_PERSON = "agency:agency:user-2";

describe.skipIf(!HAS_DB)("saved views and conversation owners", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const [x] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_A}, 'zzF4A', 'pro') returning id`;
    const [y] = await sql()`insert into installations (company_id, company_name, plan) values (${CO_B}, 'zzF4B', 'pro') returning id`;
    a = x.id as string;
    b = y.id as string;
    await sql()`insert into locations (installation_id, location_id, name) values (${a}, 'xtF4LocA', 'F4 A'), (${b}, 'xtF4LocB', 'F4 B')`;
    await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, assigned_to) values
      (${a}, 'xtF4LocA', 'ctA1', 'Ada', 'Owned', 'userSam'), (${a}, 'xtF4LocA', 'ctA2', 'Bo', 'Nobody', null), (${a}, 'xtF4LocA', 'ctA3', 'Cy', 'Blank', ''),
      (${b}, 'xtF4LocB', 'ctB1', 'Dee', 'Other', 'userSecret')`;
    await sql()`insert into team_names (installation_id, user_id, name) values (${a}, 'userSam', 'Sam'), (${b}, 'userSecret', 'Secret Person')`;
  });
  afterAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    await closeDb();
  });

  it("a saved view is kept per person, and the same name again replaces it", async () => {
    expect(await saveView(a, ME, "Over a day", { ...DEFAULT_QUEUE, wait: "24h" })).toBe("saved");
    expect(await saveView(a, ME, "Over a day", { ...DEFAULT_QUEUE, wait: "48h", channel: "WhatsApp" })).toBe("saved");
    const mine = await listViews(a, ME);
    expect(mine).toHaveLength(1);
    expect(mine[0].filters).toMatchObject({ wait: "48h", channel: "WhatsApp" });
    expect(await listViews(a, OTHER_PERSON), "another person does not see it").toEqual([]);
    expect(await listViews(b, ME), "another company does not see it even with the same owner key").toEqual([]);
  });

  it("a person cannot remove another person's or another company's view", async () => {
    const [mine] = await listViews(a, ME);
    expect(await removeView(a, OTHER_PERSON, mine.id)).toBe(false);
    expect(await removeView(b, ME, mine.id)).toBe(false);
    expect((await listViews(a, ME)).length).toBe(1);
    expect(await removeView(a, ME, mine.id)).toBe(true);
    expect(await listViews(a, ME)).toEqual([]);
  });

  it("the limit holds: the eleventh view is refused, but replacing an existing one still works", async () => {
    for (let i = 0; i < MAX_SAVED_VIEWS; i++) expect(await saveView(a, OTHER_PERSON, `View ${i}`, DEFAULT_QUEUE)).toBe("saved");
    expect(await saveView(a, OTHER_PERSON, "One too many", DEFAULT_QUEUE)).toBe("full");
    expect(await saveView(a, OTHER_PERSON, "View 3", { ...DEFAULT_QUEUE, sort: "newest" })).toBe("saved");
    expect(await listViews(a, OTHER_PERSON)).toHaveLength(MAX_SAVED_VIEWS);
    expect(await listViews(a, ME), "the limit is per person").toEqual([]);
  });

  it("a damaged saved filter reads back as the default instead of breaking the page", async () => {
    await sql()`insert into saved_views (installation_id, owner, page, name, filters) values (${a}, ${ME}, 'inbox', 'Broken', ${sql().json({ tab: "bogus", wait: 99, account: "<x>" } as never)})`;
    const [v] = await listViews(a, ME);
    expect(v.name).toBe("Broken");
    expect(v.filters).toEqual(DEFAULT_QUEUE);
  });

  it("conversation owners come from the contact's assigned team member, inside the company, as names", async () => {
    const owners = await contactOwners(a, [{ locationId: "xtF4LocA", contactId: "ctA1" }, { locationId: "xtF4LocA", contactId: "ctA2" }, { locationId: "xtF4LocA", contactId: "ctA3" }, { locationId: "xtF4LocA", contactId: null }]);
    expect(owners.get("xtF4LocA:ctA1")).toBe("userSam");
    expect(owners.get("xtF4LocA:ctA2")).toBeNull();
    expect(owners.get("xtF4LocA:ctA3")).toBeNull();
    expect((await teamNames(a)).get("userSam")).toBe("Sam");
    // Company A asking about company B's contact learns nothing, and A's names never include B's.
    const cross = await contactOwners(a, [{ locationId: "xtF4LocB", contactId: "ctB1" }]);
    expect(cross.size).toBe(0);
    expect((await teamNames(a)).has("userSecret")).toBe(false);
  });
});
