import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { dialInsights } from "@/lib/analytics/dial6-queries";
import { recordTouchEvents } from "@/lib/analytics/touch-events-db";

// Call mode v2 reads on the real database with TWO fixture companies, removed afterwards: attempt counts, the board and the agency view only ever contain the caller's own accounts, and a client's staff
// see only their own line. Skipped when no database is configured or the touch_events migration has not run.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const COS = ["xtest-dial6-a", "xtest-dial6-b"] as const;
const inst: string[] = [];
let ready = false;
const ago = (h: number) => Date.now() - h * 3_600_000;
const call = (key: string, contactId: string, userId: string, outcome: string, at: number, locationId: string) => ({ key, locationId, contactId, conversationId: null, direction: "outbound" as const, channel: "call" as const, kind: "call" as const, at, userId, automated: false, source: "subsync_call", outcome });

describe.skipIf(!HAS_DB)("call mode v2 reads: isolation, attempts, board", () => {
  beforeAll(async () => {
    const t = await sql()`select to_regclass('public.touch_events') r`;
    ready = t[0]?.r !== null;
    if (!ready) return;
    const tok = encryptSecret("not-a-real-token");
    for (const [i, co] of COS.entries()) {
      await sql()`delete from installations where company_id = ${co}`;
      const [r] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, refresh_token_enc, token_expires_at) values (${co}, ${"zzDial6" + i}, 'pro', ${tok}, ${tok}, now() + interval '1 day') returning id`;
      inst.push(r.id as string);
      await sql()`insert into locations (installation_id, location_id, name) values (${r.id}, ${i === 0 ? "DA" : "DB"}, ${"Fixture " + i})`;
    }
    await recordTouchEvents(inst[0], [call("a1", "c1", "u1", "no_answer", ago(5), "DA"), call("a2", "c1", "u1", "booked", ago(4), "DA"), call("a3", "c2", "u2", "spoke", ago(3), "DA")]);
    await recordTouchEvents(inst[1], [call("b1", "cX", "uX", "booked", ago(2), "DB")]);
  });
  afterAll(async () => { for (const co of COS) await sql()`delete from installations where company_id = ${co}`.catch(() => undefined); await closeDb(); });

  it("a company sees only its own calls: attempts, which attempt books, the board, the activity", async () => {
    if (!ready) return;
    const r = await dialInsights({ installationId: inst[0], allowed: null, userId: "u1", ownOnly: false, names: new Map([["u2", "Una"]]), now: Date.now() });
    expect(r.states.map(([k]) => k).sort()).toEqual(["DA:c1", "DA:c2"]);
    expect(r.states.find(([k]) => k === "DA:c1")?.[1]).toMatchObject({ attempts: 2, reached: true });
    expect(r.byAttempt[1]).toMatchObject({ attempt: 2, leads: 1, booked: 1 });
    expect(r.board.map((b) => b.id).sort()).toEqual(["u1", "u2"]);
    expect(r.activity).toHaveLength(1);
    expect(r.activity[0].name).toBe("Fixture 0");
  });
  it("narrowing to a list of accounts and a client's staff view hide the rest", async () => {
    if (!ready) return;
    const other = await dialInsights({ installationId: inst[0], allowed: ["DB"], userId: "u1", ownOnly: false, names: new Map(), now: Date.now() });
    expect(other.states).toHaveLength(0);
    const own = await dialInsights({ installationId: inst[0], allowed: null, userId: "u2", ownOnly: true, names: new Map(), now: Date.now() });
    expect(own.board.map((b) => b.id)).toEqual(["u2"]);
    expect(own.activity).toHaveLength(0);
    expect(own.teamVisible).toBe(false);
  });
});
