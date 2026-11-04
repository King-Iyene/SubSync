import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { setAccountTarget, speedCompare, speedHome, speedList } from "@/lib/analytics/speed-v2-queries";
import { parseWindow } from "@/lib/analytics/speed-window";

// Speed to lead, rebuilt (stage SPEED), against the real database on two fixture companies that are removed afterwards (no refresh token, so the production cron never
// queues them). Skipped with no database. The reply-target test is skipped until the database update that adds locations.speed_target_minutes has run.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-speed2-co-a", CO_B = "xtest-speed2-co-b";
const LOC_1 = "xtestS2LocOne", LOC_2 = "xtestS2LocTwo", LOC_X = "xtestS2LocOther";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const MIN = 60_000;
const NOW = Date.now();
const DAY = 86_400_000;
let instA = "", instB = "", hasTargetColumn = false;

async function lead(inst: string, loc: string, id: string, o: { ageMin: number; replyMin?: number; user?: string; source?: string | null; full?: string; assigned?: string | null; phone?: string; dnd?: boolean }) {
  const at = new Date(NOW - o.ageMin * MIN);
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, source, tags, assigned_to, date_added, phone, dnd)
    values (${inst}, ${loc}, ${id}, ${o.full ?? "pat"}, ${o.full ? null : "x" + id}, ${o.source ?? null}, ${[]}, ${o.assigned ?? null}, ${at}, ${o.phone ?? null}, ${o.dnd === true})`;
  const touch = o.replyMin === undefined ? null : new Date(at.getTime() + o.replyMin * MIN);
  await sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, touch_at, touch_user_id, human_touch_at, read_version)
    values (${inst}, ${loc}, ${id}, ${"conv-" + id}, ${at}, ${touch}, ${o.user ?? null}, ${touch}, 1)`;
}
const win30 = () => { const w = parseWindow(new Date(NOW - 29 * DAY).toISOString().slice(0, 10), new Date(NOW).toISOString().slice(0, 10), NOW); if (!w.ok) throw new Error(w.error); return w.win; };

describe.skipIf(!HAS_DB)("Speed to lead v2, query layer", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const tok = encryptSecret("not-a-real-token");
    const mk = async (co: string) => (await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, 'zzS2', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await mk(CO_A); instB = await mk(CO_B);
    for (const [inst, loc, nm] of [[instA, LOC_1, "S2 one"], [instA, LOC_2, "S2 two"], [instB, LOC_X, "S2 other company"]] as const) {
      await sql()`insert into locations (installation_id, location_id, name, speed_access, users_access) values (${inst}, ${loc}, ${nm}, 'ok', 'ok')`;
    }
    await sql()`insert into team_names (installation_id, user_id, name, source) values (${instA}, 'uDana', 'Dana Brooks', 'platform'), (${instA}, 'uSam', 'Sam Lee', 'platform')`;
    // Account one: 6 answered by Dana in time (3 replies is enough to rank her), 3 answered late by Sam, 4 waiting (two nobody owns, one asked not to be contacted), one missed for days.
    for (let i = 0; i < 6; i++) await lead(instA, LOC_1, `a-in-${i}`, { ageMin: 300 + i * 10, replyMin: 3 + i, user: "uDana", source: "Website", assigned: "uDana" });
    for (let i = 0; i < 3; i++) await lead(instA, LOC_1, `a-late-${i}`, { ageMin: 400 + i, replyMin: 90, user: "uSam", source: "Zillow" });
    await lead(instA, LOC_1, "a-wait-0", { ageMin: 100, source: "referral", full: "ava stone", assigned: "uSam", phone: "+15555550101" });
    await lead(instA, LOC_1, "a-wait-1", { ageMin: 120, source: "referral", full: "ben stone", assigned: null, dnd: true, phone: "+15555550102" });
    await lead(instA, LOC_1, "a-wait-2", { ageMin: 140, source: null, full: "cy stone", assigned: null });
    await lead(instA, LOC_1, "a-miss-0", { ageMin: 5 * 24 * 60, source: "", full: "di stone", assigned: "uSam" });
    await lead(instA, LOC_2, "b-wait-0", { ageMin: 200, source: "referral", full: "ed stone", assigned: "uSam" });
    for (let i = 0; i < 5; i++) await lead(instB, LOC_X, `x-wait-${i}`, { ageMin: 500 + i });
    hasTargetColumn = (await sql()`select 1 from information_schema.columns where table_name = 'locations' and column_name = 'speed_target_minutes'`).length > 0;
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  const base = { targetMinutes: 15, now: NOW, seePeople: true, canChangeTarget: true };

  it("home: the leads waiting are counted once, the five rows are the longest waits, and nothing of the other company is read", async () => {
    const h = await speedHome({ ...base, installationId: instA, allowed: null, win: win30(), cmp: null });
    expect(h.waiting.waiting).toBe(5);
    expect(h.waiting.never).toBe(1);
    expect(h.waiting.noOwner).toBe(2);
    expect(h.waiting.accountsWithWaiting).toBe(2);
    expect(h.waiting.rows).toHaveLength(5);
    const waits = h.waiting.rows.map((r) => r.minutes);
    expect([...waits].sort((a, b) => b - a)).toEqual(waits);
    expect(h.waiting.rows[0]).toMatchObject({ contactId: "a-miss-0", neverAnswered: true });
    expect(h.waiting.rows.every((r) => [LOC_1, LOC_2].includes(r.locationId))).toBe(true);
    expect(h.waiting.headline.text).toBe("5 leads are waiting for a reply across 2 clients. One of them was never answered.");
    expect(h.compareAccounts.rows.every((a) => a.id !== LOC_X)).toBe(true);
  });

  it("home: a lead nobody owns gets a suggested replier (a display), the phone and the do-not-disturb mark come with the row", async () => {
    const h = await speedHome({ ...base, installationId: instA, allowed: null, win: win30(), cmp: null });
    const ben = h.waiting.rows.find((r) => r.contactId === "a-wait-1")!;
    expect(ben).toMatchObject({ phone: "+15555550102", dnd: true, unassigned: true });
    expect(ben.suggestion?.label).toBe("Dana Brooks");
    expect(h.waiting.rows.find((r) => r.contactId === "a-wait-0")!.suggestion).toBeNull();
  });

  it("the list behind a number has exactly the number's rows; the other company's never appear; an account the caller may not read answers nothing", async () => {
    const w = win30();
    const h = await speedHome({ ...base, installationId: instA, allowed: null, win: w, cmp: null });
    const L = (o: Partial<Parameters<typeof speedList>[0]> = {}) => speedList({ ...base, installationId: instA, allowed: null, meId: "uSam", status: "all", win: w, person: null, account: null, owner: null, noSource: false, week: null, q: "", sort: "wait", page: 0, size: 25, ...o });
    expect((await L({ status: "within" })).total).toBe(h.summary.withinTarget);
    expect((await L({ status: "late" })).total).toBe(h.summary.answeredLate);
    expect((await L({ status: "waiting" })).total).toBe(h.summary.stillWaiting);
    expect((await L({ status: "all" })).total).toBe(h.summary.judged);
    expect((await L({ status: "waiting", win: null })).total).toBe(h.waiting.waiting);
    for (const a of h.compareAccounts.rows) expect((await L({ allowed: [a.id] })).total, a.name).toBe(a.judged);
    for (const p of h.comparePeople.rows) expect((await L({ status: "answered", person: p.userId })).total, p.label).toBe(p.replies);
    // Narrowed to an account the caller may not read: nothing.
    expect((await L({ allowed: [LOC_2], q: "ava" })).total).toBe(0);
    // Owners: nobody, and the person asking.
    expect((await L({ status: "waiting", win: null, owner: "none" })).total).toBe(2);
    expect((await L({ status: "waiting", win: null, owner: "me" })).total).toBe(3);
    // Search, paging.
    expect((await L({ q: "stone" })).total).toBe(5);
    const paged = await L({ status: "waiting", win: null, size: 2, page: 1 });
    expect(paged).toMatchObject({ page: 1, pages: 3, total: 5, from: 3, to: 4 });
    expect(paged.rows).toHaveLength(2);
    const other = await speedList({ ...base, installationId: instB, allowed: null, meId: null, status: "waiting", win: null, person: null, account: null, owner: null, noSource: false, week: null, q: "", sort: "wait", page: 0, size: 50 });
    expect(other.total).toBe(5);
    expect(other.rows.every((r) => r.locationId === LOC_X)).toBe(true);
  });

  it("compare: clients are paged and searchable, people are ranked slowest first, a person with fewer than 3 replies is not ranked", async () => {
    const w = win30();
    const accounts = await speedCompare({ ...base, installationId: instA, allowed: null, win: w, by: "account", q: "", page: 0, size: 1 });
    expect(accounts.total).toBe(2);
    expect(accounts.rows).toHaveLength(1);
    const people = await speedCompare({ ...base, installationId: instA, allowed: null, win: w, by: "person", q: "", page: 0, size: 25 });
    expect(people.rows.map((p) => (p as { label: string }).label)).toEqual(["Sam Lee", "Dana Brooks"]);
    expect((await speedCompare({ ...base, installationId: instA, allowed: null, win: w, by: "person", q: "dana", page: 0, size: 25 })).total).toBe(1);
    expect((await speedCompare({ ...base, installationId: instA, allowed: null, win: w, by: "person", q: "", page: 0, size: 25, seePeople: false })).total).toBe(0);
  });

  it.skipIf(!HAS_DB)("an account's own reply target changes how its leads are judged, only that account's, and goes back (needs the database update)", async (ctx) => {
    if (!hasTargetColumn) ctx.skip();
    const w = win30();
    const before = await speedHome({ ...base, installationId: instA, allowed: null, win: w, cmp: null });
    expect((await setAccountTarget(instA, null, LOC_1, 200)).ok).toBe(true);
    try {
      const after = await speedHome({ ...base, installationId: instA, allowed: null, win: w, cmp: null });
      const one = after.compareAccounts.rows.find((a) => a.id === LOC_1)!;
      expect(one).toMatchObject({ targetMinutes: 200, ownTarget: true });
      expect(after.waiting.waiting, "the 100 to 140 minute waits are inside a 200 minute target").toBeLessThan(before.waiting.waiting);
      expect(after.compareAccounts.rows.find((a) => a.id === LOC_2)).toMatchObject({ ownTarget: false, targetMinutes: 15 });
    } finally {
      expect((await setAccountTarget(instA, null, LOC_1, null)).ok).toBe(true);
    }
    // Refused: out of range, another company's account, an account the caller may not read.
    expect((await setAccountTarget(instA, null, LOC_1, 0)).ok).toBe(false);
    expect(await setAccountTarget(instA, null, LOC_X, 20)).toMatchObject({ ok: false, status: 404 });
    expect(await setAccountTarget(instA, [LOC_2], LOC_1, 20)).toMatchObject({ ok: false, status: 404 });
  });

  it("without the database update, saving a target says so in words and the screen still works", async (ctx) => {
    if (hasTargetColumn) ctx.skip();
    const r = await setAccountTarget(instA, null, LOC_1, 20);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect((r as { error: string }).error).toMatch(/latest database update/);
    const h = await speedHome({ ...base, installationId: instA, allowed: null, win: win30(), cmp: null });
    expect(h.targetsReady).toBe(false);
  });
});
