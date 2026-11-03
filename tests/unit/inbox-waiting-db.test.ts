import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDb, sql } from "@/lib/db";
import { ensureDemo } from "@/lib/demo/seed";
import { inbox } from "@/lib/analytics/queries";
import { waitingState } from "@/lib/analytics/waiting";

// The SQL that counts waiting conversations and the pure rule that defines them must say the same thing, on the messy demo
// tenant (five channels, a dead thread, an automatic reply, an internal note). Skipped when no database is configured.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const SLA = 4;

describe.skipIf(!HAS_DB)("waiting conversations: the database and the rule agree", () => {
  afterAll(async () => { await closeDb(); });

  it("every account has the same waiting count from the SQL list and from the rule over the raw rows", async () => {
    const inst = await ensureDemo();
    const now = Date.now();
    const raw = await sql()`select c.location_id, c.last_message_direction d, c.last_message_at at, c.last_message_type t
      from cached_conversations c join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
      where c.installation_id = ${inst}`;
    const byRule = new Map<string, number>();
    for (const r of raw) {
      if (waitingState({ direction: r.d as string | null, at: r.at instanceof Date ? r.at.getTime() : null, type: r.t as string | null }, now, SLA) === "waiting") {
        byRule.set(r.location_id as string, (byRule.get(r.location_id as string) ?? 0) + 1);
      }
    }
    const list = await inbox(inst, SLA, 100_000);
    const bySql = new Map<string, number>();
    for (const r of list) if (r.overSla) bySql.set(r.locationId, (bySql.get(r.locationId) ?? 0) + 1);
    expect([...bySql.entries()].sort()).toEqual([...byRule.entries()].sort());
    expect([...bySql.values()].reduce((s, n) => s + n, 0)).toBeGreaterThan(0);
  });

  it("the messy cases are classified as intended: four waiting, one pending, and the dead thread, auto-reply and note are not waiting", async () => {
    const inst = await ensureDemo();
    const rows = await sql()`select conversation_id id, last_message_direction d, last_message_at at, last_message_type t from cached_conversations where installation_id = ${inst} and conversation_id like 'inbox-sample-%' order by conversation_id`;
    expect(rows).toHaveLength(8);
    const now = Date.now();
    const state = Object.fromEntries(rows.map((r) => [r.id as string, waitingState({ direction: r.d as string | null, at: r.at instanceof Date ? r.at.getTime() : null, type: r.t as string | null }, now, SLA)]));
    expect(state).toEqual({
      "inbox-sample-1": "waiting", "inbox-sample-2": "waiting", "inbox-sample-3": "pending", "inbox-sample-4": "waiting",
      "inbox-sample-5": "waiting", "inbox-sample-6": "stale", "inbox-sample-7": "answered",
      // An internal note is not a reply and says nothing about whether the customer was answered, so the rule does not judge it (stage E0, principle 14).
      "inbox-sample-8": "none",
    });
    const list = await inbox(inst, SLA, 100_000);
    const flagged = new Set(list.filter((r) => r.overSla).map((r) => r.conversationId));
    for (const id of ["inbox-sample-1", "inbox-sample-2", "inbox-sample-4", "inbox-sample-5"]) expect(flagged.has(id), id).toBe(true);
    for (const id of ["inbox-sample-3", "inbox-sample-6", "inbox-sample-7", "inbox-sample-8"]) expect(flagged.has(id), id).toBe(false);
  });
});
