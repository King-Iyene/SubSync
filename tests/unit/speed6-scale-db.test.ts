import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { pulseDayCounts } from "@/lib/analytics/speed6-queries";

// A client account with 100,000 leads: the day counts come from one aggregate query, are exact, and the answer stays tiny (one entry per day, never a row per lead). One fixture company, removed afterwards.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });
const CO = "xtest-speed6-scale";
let inst = "";
const DAY = 86_400_000;
const start = Date.UTC(2026, 9, 1);

describe.skipIf(!HAS_DB)("speed6 scale: 100k leads", () => {
  beforeAll(async () => {
    const tok = encryptSecret("not-a-real-token");
    await sql()`delete from installations where company_id = ${CO}`;
    const [r] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${CO}, 'zzScale', 'pro', ${tok}, ${tok}, now() + interval '1 day') returning id`;
    inst = r.id as string;
    await sql()`insert into locations (installation_id, location_id, name) values (${inst}, 'SA', 'Scale')`;
    // 100,000 leads spread over 30 days, every second one answered.
    await sql()`
      insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, touch_at, touch_user_id)
      select ${inst}::uuid, 'SA', 'c' || g, 'v' || g, ${new Date(start)}::timestamptz + (g % 30) * interval '1 day' + (g % 86400) * interval '1 second',
        case when g % 2 = 0 then ${new Date(start)}::timestamptz + (g % 30) * interval '1 day' + ((g % 86400) + 60) * interval '1 second' end, case when g % 2 = 0 then 'u1' end
      from generate_series(1, 100000) g`;
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`.catch(() => undefined); await closeDb(); });

  it("counts every lead exactly, by day, in a small answer", async () => {
    const t0 = Date.now();
    const r = await pulseDayCounts(inst, null, start, start + 30 * DAY);
    expect(r.total).toBe(100_000);
    expect(r.leadsByDay).toHaveLength(30);
    expect(r.leadsByDay.reduce((s, d) => s + d.n, 0)).toBe(100_000);
    expect(r.repliesByDay.reduce((s, d) => s + d.n, 0)).toBe(50_000);
    expect(JSON.stringify(r).length).toBeLessThan(6_000);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
  it("a caller's own accounts bound the count", async () => {
    const r = await pulseDayCounts(inst, ["OTHER"], start, start + 30 * DAY);
    expect(r.total).toBe(0);
  });
});
