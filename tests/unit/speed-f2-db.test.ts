import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { speedPart, speedView } from "@/lib/analytics/speed-queries";
import { parseWindow } from "@/lib/analytics/speed-window";

// Stage F2 against the real database, on two fixture companies that are removed afterwards (no refresh token, so the production cron never queues them).
// Skipped with no database. Written for the lead engineer to run after the merge; not run in the parallel stage.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO_A = "xtest-f2-co-a", CO_B = "xtest-f2-co-b";
const LOC_1 = "xtestF2LocOne", LOC_2 = "xtestF2LocTwo", LOC_X = "xtestF2LocOther";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });
const MIN = 60_000;
const NOW = Date.now();
let instA = "", instB = "";

async function lead(inst: string, loc: string, id: string, o: { ageMin: number; replyMin?: number; user?: string; source?: string | null; full?: string; assigned?: string | null; autoSec?: number; tags?: string[] }) {
  const at = new Date(NOW - o.ageMin * MIN);
  await sql()`insert into cached_contacts (installation_id, location_id, contact_id, first_name, last_name, source, tags, assigned_to, date_added)
    values (${inst}, ${loc}, ${id}, ${o.full ?? "pat"}, ${o.full ? null : "x" + id}, ${o.source ?? null}, ${o.tags ?? []}, ${o.assigned ?? null}, ${at})`;
  const touch = o.replyMin === undefined ? null : new Date(at.getTime() + o.replyMin * MIN);
  await sql()`insert into lead_touches (installation_id, location_id, contact_id, conversation_id, lead_at, touch_at, touch_user_id, auto_touch_at, human_touch_at, read_version)
    values (${inst}, ${loc}, ${id}, ${"conv-" + id}, ${at}, ${touch}, ${o.user ?? null}, ${o.autoSec === undefined ? null : new Date(at.getTime() + o.autoSec * 1000)}, ${touch}, 1)`;
}

describe.skipIf(!HAS_DB)("Speed to lead, query layer", () => {
  beforeAll(async () => {
    await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`;
    const tok = encryptSecret("not-a-real-token");
    const mk = async (co: string) => (await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, 'zzF2', 'pro', ${tok}, ${tok}, now() + interval '1 hour') returning id`)[0].id as string;
    instA = await mk(CO_A); instB = await mk(CO_B);
    for (const [inst, loc, nm, ua] of [[instA, LOC_1, "F2 one", "ok"], [instA, LOC_2, "F2 two", "needs_permission"], [instB, LOC_X, "F2 other company", "ok"]] as const) {
      await sql()`insert into locations (installation_id, location_id, name, speed_access, users_access) values (${inst}, ${loc}, ${nm}, 'ok', ${ua})`;
    }
    await sql()`insert into team_names (installation_id, user_id, name, source, photo_url) values (${instA}, 'uDana', 'dana brooks', 'platform', 'https://cdn.example.org/dana.png')`;
    // Account one: 4 answered in time by Dana, 2 late, 3 waiting (one with an automatic message), 2 missed, one with no source, names in lower case.
    for (let i = 0; i < 4; i++) await lead(instA, LOC_1, `a-in-${i}`, { ageMin: 300 + i * 10, replyMin: 3 + i, user: "uDana", source: "Facebook Lead Form", assigned: "uDana" });
    for (let i = 0; i < 2; i++) await lead(instA, LOC_1, `a-late-${i}`, { ageMin: 400 + i, replyMin: 120, user: "uGone", source: "Zillow" });
    for (let i = 0; i < 3; i++) await lead(instA, LOC_1, `a-wait-${i}`, { ageMin: 100 + i * 20, source: i === 0 ? null : "referral", full: "the real estate blueprint", autoSec: i === 0 ? 8 : undefined });
    for (let i = 0; i < 2; i++) await lead(instA, LOC_1, `a-miss-${i}`, { ageMin: 5 * 24 * 60 + i, source: "" });
    await lead(instA, LOC_2, "b-wait-0", { ageMin: 200, source: "referral" });
    // The other company has leads too; the first company must never see them.
    for (let i = 0; i < 5; i++) await lead(instB, LOC_X, `x-wait-${i}`, { ageMin: 500 + i });
  });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  it("the main answer lists waiting and missed leads with proper-case names, owners and automatic messages, longest wait first", async () => {
    const v = await speedView(instA, null, 15, NOW);
    expect(v.overall.stillWaiting).toBe(3 + 2 + 1);
    expect(v.waitingTotal).toBe(v.overall.stillWaiting);
    expect(v.waiting).toHaveLength(v.waitingTotal);
    const waits = v.waiting.map((w) => w.waitingMinutes);
    expect([...waits].sort((a, b) => b - a)).toEqual(waits);
    const blueprint = v.waiting.filter((w) => w.name === "The Real Estate Blueprint");
    expect(blueprint.length).toBeGreaterThan(0);
    expect(v.waiting.find((w) => w.contactId === "a-wait-0")).toMatchObject({ source: "No source recorded", detailed: true, autoSeconds: 8 });
    expect(v.waiting.filter((w) => w.neverAnswered)).toHaveLength(2);
  });

  it("people are named from the team list, with a picture; an unknown person is a former team member; an account without permission says so", async () => {
    const v = await speedView(instA, [LOC_1], 15, NOW);
    const dana = v.people.find((p) => p.userId === "uDana");
    expect(dana).toMatchObject({ label: "Dana Brooks", state: "named", photoUrl: "https://cdn.example.org/dana.png", replies: 4, ranked: true });
    const gone = v.people.find((p) => p.userId === "uGone");
    expect(gone).toMatchObject({ label: "Former team member", state: "former", ranked: false });
    expect(JSON.stringify(v)).not.toMatch(/Team member [A-Za-z0-9]{4}\b/);
  });

  it("a card's list has exactly as many leads as its figure, for the window the card chose", async () => {
    const w = parseWindow(new Date(NOW - 10 * 86_400_000).toISOString().slice(0, 10), new Date(NOW).toISOString().slice(0, 10), NOW);
    if (!w.ok) throw new Error(w.error);
    const s = await speedPart(instA, null, 15, "summary", w.win, null, NOW);
    if (s.part !== "summary" || !("lists" in s)) throw new Error("summary expected");
    expect(s.lists.within.count).toBe(s.summary.withinTarget);
    expect(s.lists.late.count).toBe(s.summary.answeredLate);
    expect(s.lists.waiting.count).toBe(s.summary.stillWaiting);
    expect(s.summary.withinTarget).toBe(4);
    expect(s.summary.answeredLate).toBe(2);
    const src = await speedPart(instA, null, 15, "source", w.win, null, NOW);
    if (!("unknown" in src)) throw new Error("source expected");
    for (const r of src.rows) expect(r.members.count, r.label).toBe(r.leads);
    expect(src.unknown.members.count).toBe(src.unknown.n);
    const who = await speedPart(instA, null, 15, "people", w.win, null, NOW);
    if (!("rows" in who)) throw new Error("people expected");
    for (const p of who.rows as Array<{ replies: number; members: { count: number } }>) expect(p.members.count).toBe(p.replies);
  });

  it("a window with a comparison returns both periods", async () => {
    const cur = parseWindow(new Date(NOW - 10 * 86_400_000).toISOString().slice(0, 10), new Date(NOW).toISOString().slice(0, 10), NOW);
    const cmp = parseWindow(new Date(NOW - 20 * 86_400_000).toISOString().slice(0, 10), new Date(NOW - 11 * 86_400_000).toISOString().slice(0, 10), NOW);
    if (!cur.ok || !cmp.ok) throw new Error("windows");
    const s = await speedPart(instA, null, 15, "summary", cur.win, cmp.win, NOW);
    expect("compare" in s && s.compare?.summary.leads).toBe(0);
  });

  it("never reads across tenants or beyond the allowed accounts", async () => {
    const mine = await speedView(instA, null, 15, NOW);
    expect(mine.waiting.every((w) => [LOC_1, LOC_2].includes(w.locationId))).toBe(true);
    expect(JSON.stringify(mine)).not.toContain("F2 other company");
    const one = await speedView(instA, [LOC_1], 15, NOW);
    expect(one.waiting.every((w) => w.locationId === LOC_1)).toBe(true);
    expect(one.perAccount.map((a) => a.locationId)).toEqual([LOC_1]);
    // Asking for the other company's account while signed in as the first changes nothing.
    const foreign = await speedView(instA, [LOC_X], 15, NOW);
    expect(foreign.waiting).toHaveLength(0);
    expect(foreign.overall.leads).toBe(0);
    const w = parseWindow(new Date(NOW - 10 * 86_400_000).toISOString().slice(0, 10), new Date(NOW).toISOString().slice(0, 10), NOW);
    if (!w.ok) throw new Error(w.error);
    const part = await speedPart(instA, [LOC_1], 15, "accounts", w.win, null, NOW);
    expect(JSON.stringify(part)).not.toContain(LOC_2);
    expect(JSON.stringify(part)).not.toContain(LOC_X);
  });
});
