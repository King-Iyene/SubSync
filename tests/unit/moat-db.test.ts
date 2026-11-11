import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { recordMoatEvent, sweepMoatEvents } from "@/lib/analytics/moat-record";
import { rescuedReceipt, speedCurve, scorecards } from "@/lib/analytics/moat-queries";
import { peerBenchmark } from "@/lib/analytics/benchmarks-audited";
import { createProofPage, findProofPage, revokeProofPage } from "@/lib/analytics/reply-proof";

// Tiny fixtures only (ids start with xtest-), cleaned up after. Skipped when there is no database or the slice's migration is not applied yet.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-moat-a";
const CO_B = "xtest-moat-b";
const LOC_A = "xtestMoatLocA";
const LOC_B = "xtestMoatLocB";
let instA = "";
let instB = "";
let migrated = false;

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

describe.skipIf(!HAS_DB)("Moat record, receipts, benchmark and proof page", () => {
  beforeAll(async () => {
    const [t] = await sql()`select to_regclass('public.moat_events') is not null ok`;
    migrated = t?.ok === true;
    if (!migrated) return;
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const token = encryptSecret("not-a-real-token");
    const create = async (company: string) => (await sql()`
      insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at)
      values (${company}, ${company}, 'pro', ${token}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await create(CO_A);
    instB = await create(CO_B);
    await sql()`insert into locations (installation_id, location_id, name) values (${instA}, ${LOC_A}, 'Moat A'), (${instB}, ${LOC_B}, 'Moat B')`;
    await sql()`insert into settings (installation_id) values (${instA}), (${instB}) on conflict (installation_id) do nothing`;
    await sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, human_touch_at, touch_at, touch_user_id)
      values (${instA}, ${LOC_A}, 'c1', 'v1', now() - interval '3 days', now() - interval '3 days' + interval '3 minutes', now() - interval '3 days' + interval '3 minutes', 'u1'),
             (${instA}, ${LOC_A}, 'c2', 'v2', now() - interval '3 days', null, null, null)`;
  });

  afterAll(async () => {
    if (migrated) await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    await closeDb();
  });

  it("writes each fact once and never changes it", async (ctx) => {
    if (!migrated) return ctx.skip();
    const at = new Date();
    const e = { installationId: instA, locationId: LOC_A, kind: "lead_created" as const, key: "lead_created|xtest|1", at };
    expect(await recordMoatEvent(e)).toBe(true);
    expect(await recordMoatEvent(e)).toBe(false);
    await expect(sql()`update moat_events set value = 1 where installation_id = ${instA}`).rejects.toThrow(/append-only/);
    const first = await sweepMoatEvents(instA, 24 * 7);
    const again = await sweepMoatEvents(instA, 24 * 7);
    expect(first.lead_created).toBe(2);
    expect(first.first_human_touch).toBe(1);
    expect(Object.values(again).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("keeps one installation's record out of another's receipt, curve and scorecards", async (ctx) => {
    if (!migrated) return ctx.skip();
    const month = { from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const own = await rescuedReceipt({ installationId: instA, allowed: null, ...month });
    expect(own.rows.map((r) => r.locationId)).toEqual([LOC_A]);
    const foreign = await rescuedReceipt({ installationId: instB, allowed: [LOC_A], ...month });
    expect(foreign.rows).toEqual([]);
    const curve = await speedCurve({ installationId: instB, allowed: null, days: 30, countAutomated: false });
    expect(curve.total).toBe(0);
    const cards = await scorecards({ installationId: instB, allowed: null, onlyUserId: null, countAutomated: false, openHour: 9, closeHour: 17, days: 30, page: 0, size: 20 });
    expect(cards.total).toBe(0);
  });

  it("shows no benchmark without opt-in or enough accounts, and audits the read", async (ctx) => {
    if (!migrated) return ctx.skip();
    const off = await peerBenchmark({ installationId: instA, actor: "u1", allowedLocations: null }, "med_spa");
    expect(off.available).toBe(false);
    await sql()`update settings set benchmark_opt_in = true where installation_id = ${instA}`;
    const small = await peerBenchmark({ installationId: instA, actor: "u1", allowedLocations: null }, "med_spa");
    expect(small).toMatchObject({ available: false, reason: "suppressed", message: "Not enough accounts yet" });
    const [n] = await sql()`select count(*)::int n from audit_log where installation_id = ${instA} and action = 'benchmark.read'`;
    expect(n.n).toBe(1);
  });

  it("makes a chained page that verifies, refuses a thin account, and can be switched off", async (ctx) => {
    if (!migrated) return ctx.skip();
    const thin = await createProofPage({ installationId: instA, locationId: LOC_A, by: "u1", brand: { name: "Agency", color: null, logoUrl: null }, countAutomated: false, defaultTarget: 15, businessHours: false });
    expect(thin.ok).toBe(false); // 2 leads is under the minimum
    // Insert a page directly through the same writer rules by faking enough leads.
    await sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, human_touch_at, touch_at)
      select ${instA}, ${LOC_A}, 'p' || g, 'pv' || g, now() - interval '2 days', now() - interval '2 days' + interval '2 minutes', now() - interval '2 days' + interval '2 minutes' from generate_series(1, 25) g`;
    const made = await createProofPage({ installationId: instA, locationId: LOC_A, by: "u1", brand: { name: "Agency", color: null, logoUrl: null }, countAutomated: false, defaultTarget: 15, businessHours: false });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const page = await findProofPage(made.id);
    expect(page?.verification.ok).toBe(true);
    await sql()`update reply_proof_pages set payload = jsonb_set(payload, '{leads}', '999') where id = ${made.id}`;
    expect((await findProofPage(made.id))?.verification.ok).toBe(false);
    expect(await revokeProofPage(instB, null, made.id, "x")).toBe(false); // another installation cannot switch it off
    expect(await revokeProofPage(instA, null, made.id, "u1")).toBe(true);
    expect(await findProofPage(made.id)).toBeNull();
  });
});
