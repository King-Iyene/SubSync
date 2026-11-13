import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { filterOptions, OPTION_CAP } from "@/lib/analytics/filter-options";
import { closeDb, sql } from "@/lib/db";

// The suggestions for the Source and Tag filter boxes, on the real database with fixture companies removed afterwards. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const COS = ["xtest-fopt-a", "xtest-fopt-b"];
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const day = (d: string) => new Date(`${d}T12:00:00Z`);

let a = "", b = "";
async function install(co: string): Promise<string> {
  const tok = encryptSecret("not-a-real-token");
  const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, ${co}, 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`;
  return i!.id as string;
}
const contact = (inst: string, loc: string, id: string, source: string | null, tags: string[], added: string) => sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, source, tags, date_added)
  values (${inst}, ${loc}, ${id}, 'Fixture', ${id}, ${source}, ${tags}, ${day(added)})`;

describe.skipIf(!HAS_DB)("filter suggestions", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id = any(${COS}::text[])`;
    a = await install(COS[0]!); b = await install(COS[1]!);
    for (const [inst, loc] of [[a, "foLocA1"], [a, "foLocA2"], [b, "foLocB1"]] as const) await sql()`insert into locations (installation_id, location_id, name) values (${inst}, ${loc}, ${loc})`;
    for (let i = 0; i < 5; i++) await contact(a, "foLocA1", `a1-fb-${i}`, "Facebook Ads", ["hot", "Webinar"], "2026-11-01");
    for (let i = 0; i < 3; i++) await contact(a, "foLocA1", `a1-web-${i}`, "website form", ["hot"], "2026-11-02");
    await contact(a, "foLocA1", "a1-none", null, [], "2026-11-02");
    for (let i = 0; i < 2; i++) await contact(a, "foLocA2", `a2-fb-${i}`, "Facebook Ads", ["other-account-tag"], "2026-09-01");
    await contact(b, "foLocB1", "b1-secret", "Competitor Secret Source", ["competitor-secret-tag"], "2026-11-01");
    for (let i = 0; i < OPTION_CAP + 10; i++) await contact(a, "foLocA1", `a1-many-${i}`, `bulk source ${String(i).padStart(3, "0")}`, [`bulk-tag-${String(i).padStart(3, "0")}`], "2026-10-15");
  });
  afterAll(async () => { await sql()`delete from installations where company_id = any(${COS}::text[])`; await closeDb(); });

  it("orders by how many leads carry the value, merges all-lower-case spellings and leaves out blanks", async () => {
    const r = await filterOptions({ installationId: a, allowed: ["foLocA1"], kind: "source", q: "" });
    expect(r.values.slice(0, 2)).toEqual([{ value: "Facebook Ads", count: 5 }, { value: "Website Form", count: 3 }]);
    expect(r.values.some((v) => v.value === "No source recorded")).toBe(false);
  });
  it("finds by what the value starts with, and tags come back in lower case", async () => {
    expect((await filterOptions({ installationId: a, allowed: ["foLocA1"], kind: "source", q: "WEB" })).values).toEqual([{ value: "Website Form", count: 3 }]);
    expect((await filterOptions({ installationId: a, allowed: ["foLocA1"], kind: "tag", q: "web" })).values).toEqual([{ value: "webinar", count: 5 }]);
    expect((await filterOptions({ installationId: a, allowed: ["foLocA1"], kind: "tag", q: "" })).values[0]).toEqual({ value: "hot", count: 8 });
  });
  it("caps the answer and says there is more; typing narrows it again", async () => {
    const r = await filterOptions({ installationId: a, allowed: ["foLocA1"], kind: "tag", q: "" });
    expect(r.values).toHaveLength(OPTION_CAP);
    expect(r.more).toBe(true);
    const n = await filterOptions({ installationId: a, allowed: ["foLocA1"], kind: "tag", q: "bulk-tag-00" });
    expect(n.values).toHaveLength(10);
    expect(n.more).toBe(false);
  });
  it("follows the dates of the bar", async () => {
    const r = await filterOptions({ installationId: a, allowed: null, kind: "source", q: "fac", fromMs: day("2026-10-30").getTime(), toMs: day("2026-11-05").getTime() });
    expect(r.values).toEqual([{ value: "Facebook Ads", count: 5 }]);
    const all = await filterOptions({ installationId: a, allowed: null, kind: "source", q: "fac" });
    expect(all.values).toEqual([{ value: "Facebook Ads", count: 7 }]);
  });
  it("only ever reads the accounts the session allows, and never another company", async () => {
    const own = await filterOptions({ installationId: a, allowed: ["foLocA2"], kind: "tag", q: "" });
    expect(own.values).toEqual([{ value: "other-account-tag", count: 2 }]);
    // an account id of another company, asked for under this company, finds nothing
    expect(await filterOptions({ installationId: a, allowed: ["foLocB1"], kind: "source", q: "" })).toEqual({ values: [], more: false });
    // the whole company never includes the other company's values
    const every = await filterOptions({ installationId: a, allowed: null, kind: "source", q: "comp" });
    expect(every.values).toEqual([]);
    expect((await filterOptions({ installationId: b, allowed: null, kind: "tag", q: "" })).values).toEqual([{ value: "competitor-secret-tag", count: 1 }]);
  });
});
