import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { loadTouchEvents, rebuildSpeedDaily, recordLeadEvents, recordTouchEvents, leadStory } from "@/lib/analytics/touch-events-db";
import { speedCoverage } from "@/lib/analytics/speed-v4-queries";
import type { TouchEvent } from "@/lib/analytics/touch-events";

// The speed history on the real database with TWO fixture companies, removed afterwards: events are idempotent, one company never reads the other's history, a rollup is rebuilt, a story is
// read only inside the caller's accounts. Skipped when no database is configured, or when the SPEED4 migration (20261109090000_touch_events) has not been applied yet.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const COS = ["xtest-speedhist-a", "xtest-speedhist-b"] as const;
const inst: string[] = [];
let ready = false;
const hoursAgo = (h: number) => Date.now() - h * 3_600_000;
const ev = (over: Partial<TouchEvent>): TouchEvent => ({ key: "k", locationId: "LA", contactId: "c1", conversationId: "v1", direction: "outbound", channel: "sms", kind: "message", at: hoursAgo(2), userId: "u1", automated: false, source: "app", outcome: null, ...over });

describe.skipIf(!HAS_DB)("speed history: events, lifecycle, rollup, isolation", () => {
  beforeAll(async () => {
    const t = await sql()`select to_regclass('public.touch_events') r`;
    ready = t[0]?.r !== null;
    if (!ready) return;
    const tok = encryptSecret("not-a-real-token");
    for (const [i, co] of COS.entries()) {
      await sql()`delete from installations where company_id = ${co}`;
      const [r] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, ${"zzSpeedHist" + i}, 'pro', ${tok}, ${tok}, now() + interval '1 day') returning id`;
      inst.push(r.id as string);
      await sql()`insert into locations (installation_id, location_id, name) values (${r.id}, ${i === 0 ? "LA" : "LB"}, ${"Fixture " + i})`;
    }
  });
  afterAll(async () => { for (const co of COS) await sql()`delete from installations where company_id = ${co}`.catch(() => undefined); await closeDb(); });

  it("the same event twice is one row, and a retry changes nothing", async () => {
    if (!ready) return;
    const e = [ev({ key: "m:1" }), ev({ key: "m:2", direction: "inbound", userId: null, at: hoursAgo(1) })];
    await recordTouchEvents(inst[0], e); await recordTouchEvents(inst[0], e);
    const rows = await loadTouchEvents(inst[0], null, hoursAgo(24));
    expect(rows).toHaveLength(2);
  });

  it("a company reads only its own history, and an account list narrows further", async () => {
    if (!ready) return;
    await recordTouchEvents(inst[1], [ev({ key: "m:1", locationId: "LB", contactId: "other" })]);
    const a = await loadTouchEvents(inst[0], null, hoursAgo(24)), b = await loadTouchEvents(inst[1], null, hoursAgo(24));
    expect(a.every((x) => x.locationId === "LA")).toBe(true); expect(b.map((x) => x.contactId)).toEqual(["other"]);
    expect(await loadTouchEvents(inst[0], ["LB"], hoursAgo(24))).toHaveLength(0);
    const cov = await speedCoverage({ installationId: inst[0], allowed: ["LA"], targetMinutes: 15, now: Date.now(), seePeople: true });
    expect(cov.eventsStored).toBe(2);
  });

  it("a missed call with no callback shows as unrecovered, with no text of any message stored", async () => {
    if (!ready) return;
    await recordTouchEvents(inst[0], [ev({ key: "m:miss", contactId: "caller", direction: "inbound", channel: "call", kind: "missed_call", userId: null, at: hoursAgo(3) })]);
    const cov = await speedCoverage({ installationId: inst[0], allowed: null, targetMinutes: 15, now: Date.now(), seePeople: true });
    expect(cov.missed.unrecovered).toBe(1);
    const cols = await sql()`select column_name from information_schema.columns where table_name = 'touch_events'`;
    expect(cols.map((c) => c.column_name as string).some((c) => /(^|_)(body|text|content|html|snippet)(_|$)/.test(c))).toBe(false);
  });

  it("lifecycle events are idempotent, and a story is only read inside the caller's accounts", async () => {
    if (!ready) return;
    const le = { key: "created:c1", locationId: "LA", contactId: "c1", kind: "created" as const, fromValue: null, toValue: null, userId: null, at: hoursAgo(5) };
    await recordLeadEvents(inst[0], [le, le]);
    const n = await sql()`select count(*)::int n from lead_events where installation_id = ${inst[0]}`;
    expect(n[0].n).toBe(1);
    expect((await leadStory(inst[0], "LA", "c1")).length).toBeGreaterThan(0);
    expect(await leadStory(inst[1], "LA", "c1")).toHaveLength(0);
  });

  it("the nightly rollup can be rebuilt twice with the same result", async () => {
    if (!ready) return;
    await rebuildSpeedDaily(inst[0], 15); const one = await sql()`select count(*)::int n from speed_daily where installation_id = ${inst[0]}`;
    await rebuildSpeedDaily(inst[0], 15); const two = await sql()`select count(*)::int n from speed_daily where installation_id = ${inst[0]}`;
    expect(two[0].n).toBe(one[0].n);
  });

  it("removing the installation removes its history (delete on uninstall)", async () => {
    if (!ready) return;
    await sql()`delete from installations where company_id = ${COS[1]}`;
    const left = await sql()`select count(*)::int n from touch_events where installation_id = ${inst[1]}`;
    expect(left[0].n).toBe(0);
  });
});
