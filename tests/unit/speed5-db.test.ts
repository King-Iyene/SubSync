import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { duplicateGuard, loadLadder, newLeadDuplicateDrafts, perAccountBreaches, saveLadder, speedBooking } from "@/lib/analytics/speed5-queries";

// Stage SPEED5 against the real database on two fixture companies that are removed afterwards (no refresh token, so the production cron never queues them). Skipped with no database.
// The per-account target test needs locations.speed_target_minutes; the ladder test needs settings.speed_escalation (this stage's own additive migration, NOT applied by the stage).
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-speed5-co-a", CO_B = "xtest-speed5-co-b";
const LOC_1 = "xtestS5LocOne", LOC_2 = "xtestS5LocTwo", LOC_X = "xtestS5LocOther";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const MIN = 60_000, DAY = 86_400_000;
const NOW = Date.now();
let instA = "", instB = "", hasTarget = false, hasLadder = false;

async function lead(inst: string, loc: string, id: string, o: { ageMin: number; replyMin?: number; email?: string | null; phone?: string | null; name?: string }) {
  const at = new Date(NOW - o.ageMin * MIN);
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, email, phone, tags, date_added)
    values (${inst}, ${loc}, ${id}, ${o.name ?? "Pat"}, ${"L" + id}, ${o.email ?? null}, ${o.phone ?? null}, ${[]}, ${at})`;
  const touch = o.replyMin === undefined ? null : new Date(at.getTime() + o.replyMin * MIN);
  await sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, touch_at, human_touch_at, read_version)
    values (${inst}, ${loc}, ${id}, ${"conv-" + id}, ${at}, ${touch}, ${touch}, 1)`;
}
const appt = (inst: string, loc: string, contact: string, id: string, status: string, created: Date) => sql()`insert into cached_appointments (installation_id, location_id, appointment_id, contact_id, title, status, start_at, end_at, created_remote_at)
  values (${inst}, ${loc}, ${id}, ${contact}, 'x', ${status}, ${new Date(created.getTime() + DAY)}, ${new Date(created.getTime() + DAY + 1_800_000)}, ${created})`;
const input = (inst: string, allowed: string[] | null) => ({ installationId: inst, allowed, targetMinutes: 15, now: NOW, seePeople: true });

describe.skipIf(!HAS_DB)("Speed to lead, fifth pass, query layer", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const tok = encryptSecret("not-a-real-token");
    const mk = async (co: string) => (await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, 'zzS5', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await mk(CO_A); instB = await mk(CO_B);
    for (const [inst, loc, nm] of [[instA, LOC_1, "S5 one"], [instA, LOC_2, "S5 two"], [instB, LOC_X, "S5 other company"]] as const) {
      await sql()`insert into locations (installation_id, location_id, name, speed_access, users_access) values (${inst}, ${loc}, ${nm}, 'ok', 'ok')`;
    }
    hasTarget = (await sql()`select 1 from information_schema.columns where table_name = 'locations' and column_name = 'speed_target_minutes'`).length > 0;
    hasLadder = (await sql()`select 1 from information_schema.columns where table_name = 'settings' and column_name = 'speed_escalation'`).length > 0;
    if (hasTarget) await sql()`update locations set speed_target_minutes = 5 where installation_id = ${instA} and location_id = ${LOC_1}`;
    await sql()`insert into settings (installation_id) values (${instA}) on conflict do nothing`;

    // Breach: the same 8-minute wait is past account one's own 5-minute target and inside the 15-minute default of account two.
    await lead(instA, LOC_1, "br-1", { ageMin: 8 }); await lead(instA, LOC_2, "br-2", { ageMin: 8 }); await lead(instB, LOC_X, "br-x", { ageMin: 600 });

    // Booking: account one, 12 fast replies (6 booked, one booking cancelled, one made BEFORE the lead), 18 slow replies (1 booked). Company B holds its own fast leads that must never count here.
    const old = (d: number) => NOW - d * DAY;
    for (let i = 0; i < 12; i++) await lead(instA, LOC_1, `f-${i}`, { ageMin: (10 + i) * 1440, replyMin: 2 });
    for (let i = 0; i < 6; i++) await appt(instA, LOC_1, `f-${i}`, `fa-${i}`, "confirmed", new Date(old(10 + i) + 3_600_000));
    await appt(instA, LOC_1, "f-6", "fa-cancel", "cancelled", new Date(old(16) + 3_600_000));
    await appt(instA, LOC_1, "f-7", "fa-before", "confirmed", new Date(old(17) - 5 * DAY));
    for (let i = 0; i < 18; i++) await lead(instA, LOC_1, `s-${i}`, { ageMin: (30 + i) * 1440, replyMin: 120 });
    await appt(instA, LOC_1, "s-0", "sa-0", "confirmed", new Date(old(30) + 7_200_000));
    for (let i = 0; i < 12; i++) await lead(instB, LOC_X, `bf-${i}`, { ageMin: (10 + i) * 1440, replyMin: 2 });
    for (let i = 0; i < 12; i++) await appt(instB, LOC_X, `bf-${i}`, `ba-${i}`, "confirmed", new Date(old(10 + i) + 3_600_000));

    // Duplicates: an older record of Ann in account one, the same email in account two (another account) and in company B (another company), then a new lead from Ann.
    await lead(instA, LOC_1, "ann-old", { ageMin: 60 * 1440, email: "ann.lee@example.test", phone: "+14158675309", name: "Ann" });
    await lead(instA, LOC_2, "ann-other-acct", { ageMin: 60 * 1440, email: "dana.fox@example.test", phone: "+14155550100", name: "Dana" });
    await lead(instB, LOC_X, "ann-other-co", { ageMin: 60 * 1440, email: "ann.lee@example.test", phone: "+14158675309", name: "Ann" });
    await lead(instA, LOC_1, "ann-new", { ageMin: 30, email: "ann.lee@example.test", phone: "+14158675309", name: "Ann" });
    await lead(instA, LOC_2, "dana-new", { ageMin: 30, email: "dana.fox@example.test", phone: "+14155550100", name: "Dana" });
    await lead(instA, LOC_1, "ann-new2", { ageMin: 20, email: "ann.lee@example.test", phone: "+14158675309", name: "Ann" });
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  it("breach counts use each account's OWN target, and never read another company", async () => {
    const m = await perAccountBreaches(instA, 15);
    if (!hasTarget) { expect(m).toBeNull(); return; }
    expect(m).not.toBeNull();
    expect(m!.get(LOC_1)).toMatchObject({ targetMinutes: 5 });
    expect(m!.get(LOC_1)!.waiting, "the 8-minute lead, and the two later ones").toBe(3);
    expect(m!.get(LOC_2)).toMatchObject({ targetMinutes: 15 });
    expect(m!.get(LOC_2)!.waiting, "the 8-minute lead is inside the default 15; only the 30-minute one is past it").toBe(1);
    expect(m!.has(LOC_X)).toBe(false);
    const b = await perAccountBreaches(instB, 15);
    expect(b!.has(LOC_1)).toBe(false);
    expect(b!.get(LOC_X)!.waiting).toBe(1);
  });

  it("booking by reply time: cancelled and earlier appointments do not count, the slow group is separate, and company B never leaks in", async () => {
    const r = await speedBooking(input(instA, [LOC_1]));
    const m5 = r.buckets.find((b) => b.key === "m5")!, h4 = r.buckets.find((b) => b.key === "h4")!;
    expect(m5.leads).toBe(12); expect(m5.booked).toBe(6); expect(m5.rate).toBe(50);
    expect(h4.leads).toBe(18); expect(h4.booked).toBe(1);
    expect(r.fastRate).toBe(0.5); expect(r.multiple).toBe(9);
    const all = await speedBooking(input(instA, null));
    expect(all.buckets.find((b) => b.key === "m5")!.leads, "B's 12 fast leads are another company").toBe(12);
    const other = await speedBooking(input(instA, [LOC_2]));
    expect(other.total).toBeLessThan(5);
  });

  it("the duplicate guard finds the older record in the same account only", async () => {
    const leads = [
      { locationId: LOC_1, contactId: "ann-new", name: "Ann LAnn-new", email: "ann.lee@example.test", phone: "+14158675309", leadAt: NOW - 30 * MIN },
      { locationId: LOC_2, contactId: "dana-new", name: "Dana Ldana-new", email: "dana.fox@example.test", phone: "+14155550100", leadAt: NOW - 30 * MIN },
    ];
    const hits = await duplicateGuard(instA, null, leads);
    expect(hits.get(`${LOC_1}:ann-new`)?.contactId).toBe("ann-old");
    expect(hits.get(`${LOC_2}:dana-new`)?.contactId).toBe("ann-other-acct");
    const only2 = await duplicateGuard(instA, [LOC_2], leads);
    expect(only2.has(`${LOC_1}:ann-new`), "an account the caller may not read is never searched").toBe(false);
    const fromB = await duplicateGuard(instB, null, [{ ...leads[0], locationId: LOC_X }]);
    expect(fromB.get(`${LOC_X}:ann-new`)?.contactId, "company B finds only its own record").toBe("ann-other-co");
  });

  it("the new-lead duplicate alert needs two such leads in one account and names that account only", async () => {
    const d = await newLeadDuplicateDrafts(instA, NOW);
    const one = d.find((x) => x.locationId === LOC_1);
    expect(one?.dedupeKey).toBe(`leaddup:${LOC_1}`); expect(one?.kind).toBe("duplicates");
    expect(d.find((x) => x.locationId === LOC_2), "one duplicate lead is not an alert").toBeUndefined();
    expect(d.find((x) => x.locationId === LOC_X)).toBeUndefined();
  });

  it("the ladder is saved per company when the update has run, and the default is used (with a plain answer) when it has not", async () => {
    const before = await loadLadder(instA);
    expect(before.ladder).toEqual({ enabled: true, nextAfterMin: 15, managerAfterMin: 45 });
    const saved = await saveLadder(instA, { enabled: true, nextAfterMin: 10, managerAfterMin: 30 });
    if (!hasLadder) { expect(saved.ok).toBe(false); expect(before.ready).toBe(false); return; }
    expect(saved.ok).toBe(true);
    expect((await loadLadder(instA)).ladder).toEqual({ enabled: true, nextAfterMin: 10, managerAfterMin: 30 });
    expect((await loadLadder(instB)).ladder.nextAfterMin, "another company keeps its own setting").toBe(15);
  });
});
