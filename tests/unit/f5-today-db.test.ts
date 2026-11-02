import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { seriesByLocation } from "@/lib/analytics/digest-service";
import { currentSnapshotVersion } from "@/lib/analytics/definitions-sql";
import { portfolioRangeChanges } from "@/lib/analytics/today-intel";

// Stage F5: the figures behind Today's "What changed" card, read from the stored daily snapshots, and kept inside one company. Built on two fixture
// companies in the real database, removed afterwards; neither has a refresh token, so the production scheduler ignores them. WRITTEN, NOT RUN in the
// parallel stage: the lead runs it after the merge. Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-f5-a", CO_B = "xtest-f5-b";
const L1 = "xtestF5LocA1", L2 = "xtestF5LocA2", LB = "xtestF5LocB";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let instA = "", instB = "";
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function mkInstall(company: string) {
  await sql()`delete from installations where company_id = ${company}`;
  const tok = encryptSecret("not-a-real-token");
  const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${company}, ${"zz" + company}, 'pro', ${tok}, now() + interval '1 hour') returning id`;
  await sql()`insert into settings (installation_id) values (${i.id}) on conflict do nothing`;
  return i.id as string;
}
async function snap(inst: string, loc: string, ago: number, o: { stale: number; unread: number; value: number; version: number }) {
  await sql()`insert into account_metrics_daily (installation_id, location_id, day, contacts, new_contacts_30d, open_opportunities, open_value, stale_opportunities, unread_conversations, completeness_pct, engagement_score, definition_version)
    values (${inst}, ${loc}, ${isoDaysAgo(ago)}::date, 100, 40, 10, ${o.value}, ${o.stale}, ${o.unread}, 80, 70, ${o.version})`;
}

describe.skipIf(!HAS_DB)("Today's what-changed figures", () => {
  let version = 0;
  beforeAll(async () => {
    instA = await mkInstall(CO_A); instB = await mkInstall(CO_B);
    version = await currentSnapshotVersion(instA);
    for (const [inst, loc, name] of [[instA, L1, "F5 A1"], [instA, L2, "F5 A2"], [instB, LB, "F5 B"]] as const) {
      await sql()`insert into locations (installation_id, location_id, name, timezone) values (${inst}, ${loc}, ${name}, 'UTC')`;
    }
    // Account 1 (company A): stale 10 eight days ago, 16 now. Account 2: 5 then, 9 now. Company B has its own, much larger numbers.
    for (const [loc, then, now] of [[L1, 10, 16], [L2, 5, 9]] as const) {
      await snap(instA, loc, 8, { stale: then, unread: 20, value: 60_000, version });
      await snap(instA, loc, 3, { stale: then + 1, unread: 22, value: 61_000, version });
      await snap(instA, loc, 0, { stale: now, unread: 25, value: 70_000, version });
    }
    await snap(instB, LB, 8, { stale: 900, unread: 900, value: 9_000_000, version });
    await snap(instB, LB, 0, { stale: 950, unread: 950, value: 9_500_000, version });
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  it("the change since a start day is the sum over the company's accounts, from the day before the window", async () => {
    const series = await seriesByLocation(instA, [L1, L2], 12);
    const from = isoDaysAgo(7);
    const stale = portfolioRangeChanges([...series.values()], from).find((c) => c.key === "stale")!;
    expect(stale.now).toBe(25);
    expect(stale.then).toBe(15);
    expect(stale.thenDay).toBe(isoDaysAgo(8));
    expect(stale.diff).toBe(10);
    expect(stale.percent).toBe(67);
    expect(stale.coversWindow).toBe(true);
  });

  it("a longer window than the history says so and starts from the earliest stored day", async () => {
    const series = await seriesByLocation(instA, [L1, L2], 100);
    const c = portfolioRangeChanges([...series.values()], isoDaysAgo(90)).find((x) => x.key === "unread")!;
    expect(c.coversWindow).toBe(false);
    expect(c.thenDay).toBe(isoDaysAgo(8));
    expect(c.then).toBe(40);
  });

  it("another company's snapshots are never read, even when its account id is asked for", async () => {
    const series = await seriesByLocation(instA, [L1, L2, LB], 12);
    expect([...series.keys()].sort()).toEqual([L1, L2].sort());
    const all = portfolioRangeChanges([...series.values()], isoDaysAgo(7));
    for (const c of all) expect(c.now, c.key).toBeLessThan(1_000_000);
    expect((await seriesByLocation(instB, [L1, L2], 12)).size).toBe(0);
  });
});
