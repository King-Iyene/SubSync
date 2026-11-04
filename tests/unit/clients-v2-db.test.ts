import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { countedDealMoney, profilesOf } from "@/lib/analytics/clients-v2-queries";
import { dealFigures } from "@/lib/analytics/client-success";
import { loadDeals } from "@/lib/analytics/pipeline-queries";
import { saveProfile } from "@/lib/analytics/client-queries";

// The Clients book against the real database on two fixture companies that are removed afterwards (no refresh token, so the production cron never queues them). Skipped with
// no database. Holds: the counted deal money equals dealFigures over loadDeals (one rule, written once in TypeScript and once in SQL); the typed profile is read for the
// caller's own client accounts only; another company's id answers nothing; and 150 client accounts cost one read each.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-clients2-co-a", CO_B = "xtest-clients2-co-b";
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const NOW = Date.now();
const DAY = 86_400_000;
let instA = "", instB = "";
const ids150 = Array.from({ length: 150 }, (_, i) => `xtestC2Loc${String(i).padStart(3, "0")}`);
const LOC_B = "xtestC2LocOther";

async function deal(inst: string, loc: string, id: string, o: { value: number | null; status?: string; owner?: string | null; createdDaysAgo: number; wonDaysAgo?: number }) {
  const created = new Date(NOW - o.createdDaysAgo * DAY);
  const changed = new Date(NOW - (o.wonDaysAgo ?? o.createdDaysAgo) * DAY);
  await sql()`insert into cached_opportunities (installation_id, location_id, opportunity_id, pipeline_id, stage_id, contact_id, contact_name, name, monetary_value, status, assigned_to,
      created_remote_at, last_stage_change_at, last_action_at, last_status_change_at, updated_remote_at)
    values (${inst}, ${loc}, ${id}, null, null, ${"c-" + id}, 'Pat', ${"deal " + id}, ${o.value}, ${o.status ?? "open"}, ${o.owner === undefined ? "uOwner" : o.owner}, ${created}, ${created}, ${created}, ${changed}, ${changed})`;
}

describe.skipIf(!HAS_DB)("Clients book, query layer", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const tok = encryptSecret("not-a-real-token");
    const mk = async (co: string) => (await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, 'zzC2', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await mk(CO_A); instB = await mk(CO_B);
    await sql()`insert into locations ${sql()(ids150.map((id, i) => ({ installation_id: instA, location_id: id, name: `C2 client ${i}`, installed_at: new Date(NOW - (i + 1) * DAY) })) as never)}`;
    await sql()`insert into locations (installation_id, location_id, name) values (${instB}, ${LOC_B}, 'C2 other company')`;
    const [a, b] = ids150;
    // Client a: counted deals (a value and an owner) and the three kinds that must NOT count: no value, no owner, started long ago.
    await deal(instA, a, "a1", { value: 6000, createdDaysAgo: 3 });
    await deal(instA, a, "a2", { value: 4000, createdDaysAgo: 10 });
    await deal(instA, a, "a3", { value: 2000, createdDaysAgo: 20, status: "won", wonDaysAgo: 5 });
    await deal(instA, a, "a4", { value: 0, createdDaysAgo: 2 });
    await deal(instA, a, "a5", { value: null, createdDaysAgo: 2 });
    await deal(instA, a, "a6", { value: 9000, createdDaysAgo: 2, owner: null });
    await deal(instA, a, "a7", { value: 7000, createdDaysAgo: 90 });
    await deal(instA, a, "a8", { value: 1500, createdDaysAgo: 40, status: "won", wonDaysAgo: 35 });
    await deal(instA, b, "b1", { value: 500, createdDaysAgo: 1 });
    await deal(instB, LOC_B, "x1", { value: 99_000, createdDaysAgo: 1 });
    await saveProfile(instA, null, a, { monthlyFee: 2500, renewalDate: "2026-12-15", industry: "Real estate", markContacted: true });
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  it("counted deal money is dealFigures over loadDeals, deal for deal (one rule, two places)", async () => {
    const money = await countedDealMoney(instA, ids150, NOW);
    const figures = dealFigures(await loadDeals(instA, null), NOW - 30 * DAY, NOW);
    for (const id of [ids150[0], ids150[1], ids150[2]]) {
      const m = money.get(id), f = figures.get(id);
      expect(m?.pipeline30 ?? 0, id).toBe(f?.pipelineCreated ?? 0);
      expect(m?.won30 ?? 0, id).toBe(f?.wonValue ?? 0);
      expect(m?.wonCount30 ?? 0, id).toBe(f?.wonCount ?? 0);
    }
    // Client a by hand: a1 6000 + a2 4000 + a3 2000 started in the window (a3 won 5 days ago); a4 (zero), a5 (no value), a6 (no owner), a7 and a8 (outside the window) are not.
    expect(money.get(ids150[0])).toEqual({ pipeline30: 12_000, dealsStarted30: 3, won30: 2000, wonCount30: 1 });
    expect(money.get(ids150[1])).toEqual({ pipeline30: 500, dealsStarted30: 1, won30: 0, wonCount30: 0 });
    expect(money.has(ids150[2])).toBe(false);
  });

  it("another company's client accounts answer nothing, and the other company's deals never appear", async () => {
    expect((await countedDealMoney(instA, [LOC_B], NOW)).size).toBe(0);
    expect((await countedDealMoney(instB, ids150, NOW)).size).toBe(0);
    expect((await profilesOf(instA, [LOC_B])).size).toBe(0);
    expect((await profilesOf(instB, ids150)).size).toBe(0);
    expect((await countedDealMoney(instA, [], NOW)).size).toBe(0);
  });

  it("the typed profile comes back for the caller's own clients, with the fee, the renewal and the day it was added", async () => {
    const p = await profilesOf(instA, ids150);
    expect(p.size).toBe(150);
    expect(p.get(ids150[0])).toMatchObject({ monthlyFee: 2500, renewalDate: "2026-12-15", industry: "Real estate" });
    expect(p.get(ids150[0])?.lastContactedAt).not.toBeNull();
    expect(p.get(ids150[1])).toMatchObject({ monthlyFee: null, renewalDate: null, industry: null, lastContactedAt: null });
    expect(Math.round((NOW - (p.get(ids150[4])?.installedAt as number)) / DAY)).toBe(5);
  });

  it("150 client accounts: one read for the deals and one for the profiles, and the answer holds every client once", async () => {
    const t0 = Date.now();
    const [m, p] = await Promise.all([countedDealMoney(instA, ids150, NOW), profilesOf(instA, ids150)]);
    expect(Date.now() - t0).toBeLessThan(60_000);
    expect(p.size).toBe(150);
    expect(m.size).toBe(2);
  });

  it("an ignored client account is left out of both reads", async () => {
    await sql()`update locations set ignored = true where installation_id = ${instA} and location_id = ${ids150[1]}`;
    expect((await profilesOf(instA, ids150)).has(ids150[1])).toBe(false);
    expect((await countedDealMoney(instA, ids150, NOW)).has(ids150[1])).toBe(false);
    await sql()`update locations set ignored = false where installation_id = ${instA} and location_id = ${ids150[1]}`;
  });
});
