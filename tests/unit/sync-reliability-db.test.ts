import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { clearResolvedError, enqueueAreaSync, JOBS_FOR_AREA, scheduleFastRefresh } from "@/lib/sync/engine";
import { freshnessFor, syncPanel } from "@/lib/sync/freshness-queries";
import { collectDiagnostics, recordVerdicts } from "@/lib/sync/watchdog";
import { REFRESH_EVERY_MINUTES } from "@/lib/sync/schedule";

// Sync reliability against the real database, on a fixture company removed afterwards. The fixture has NO refresh token on purpose: the real
// scheduler (same database, every 5 minutes) only queues work for installs that have one, so it leaves the fixture alone.
// Jobs that must look "in progress" are inserted as `running` and just updated, because the real worker only takes over a running job that
// has not been touched for 10 minutes. Skipped with no database.
const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
const CO = "xtest-syncrel-co";
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let inst = "";
const L1 = "xtestSyncLoc0001";
const L2 = "xtestSyncLoc0002";
const MIN = 60_000;

const wipeJobs = () => sql()`delete from sync_jobs where installation_id = ${inst}`;
const metrics = (minutesAgo: number, status = "done") => sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at, started_at, finished_at)
  values (${inst}, null, 'metrics', ${status}, now() - make_interval(secs => ${minutesAgo * 60}), now() - make_interval(secs => ${minutesAgo * 60}), now() - make_interval(secs => ${minutesAgo * 60 - 20}))`;
const setSynced = (loc: string, d: Date | null) => sql()`update locations set conversations_synced_at = ${d}, last_synced_at = ${d} where installation_id = ${inst} and location_id = ${loc}`;

describe.skipIf(!HAS_DB)("sync scheduling, freshness and the alarm on real rows", () => {
  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
    await sql()`delete from installations where company_id = ${CO}`;
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${CO}, 'zzSyncRel', 'pro', ${encryptSecret("not-a-real-token")}, now() + interval '1 hour') returning id`;
    inst = i.id as string;
    await sql()`insert into locations (installation_id, location_id, name) values (${inst}, ${L1}, 'zz Alpha'), (${inst}, ${L2}, 'zz Beta')`;
  });
  afterAll(async () => { await sql()`delete from installations where company_id = ${CO}`; await closeDb(); });

  describe("the 15 minute refresh is queued when due, once, and never on top of itself", () => {
    it("queues a cycle for every account plus the recalculation when the last one was queued 15 minutes ago", async () => {
      await wipeJobs();
      await metrics(15);
      const n = await scheduleFastRefresh({ only: inst, requireToken: false });
      expect(n).toBe(2 * 3 + 1); // conversations, appointments and speed for two accounts, plus one metrics job
      await wipeJobs();
    });
    it("measures from the START of the last cycle with a one minute allowance, not from its finish", async () => {
      await wipeJobs();
      await metrics(14.5); // queued 14.5 minutes ago and finished 14 minutes ago
      expect(await scheduleFastRefresh({ only: inst, requireToken: false })).toBeGreaterThan(0);
      await wipeJobs();
      await metrics(13);
      expect(await scheduleFastRefresh({ only: inst, requireToken: false }), "13 minutes is too soon").toBe(0);
      await wipeJobs();
    });
    it("a failed last cycle is retried on the same rhythm", async () => {
      await wipeJobs();
      await metrics(16, "failed");
      expect(await scheduleFastRefresh({ only: inst, requireToken: false })).toBeGreaterThan(0);
      await wipeJobs();
    });
    it("nothing is queued while jobs are still queued or running", async () => {
      await wipeJobs();
      await metrics(40);
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at) values (${inst}, ${L1}, 'conversations', 'running', now() - interval '2 minutes')`;
      expect(await scheduleFastRefresh({ only: inst, requireToken: false })).toBe(0);
      await wipeJobs();
    });
    it("an install that has never had a cycle gets one; an install with no refresh token is left alone by default", async () => {
      await wipeJobs();
      expect(await scheduleFastRefresh({ only: inst })).toBe(0);
      expect(await scheduleFastRefresh({ only: inst, requireToken: false })).toBeGreaterThan(0);
      await wipeJobs();
    });
    it("the cadence constant is what the screen promises", () => { expect(REFRESH_EVERY_MINUTES).toBe(15); });
  });

  describe("a change in the CRM queues the right refresh", () => {
    it("messages also queue the reply-time read; appointments queue the appointment read; repeats are no-ops", async () => {
      await wipeJobs();
      expect(JOBS_FOR_AREA.conversations).toEqual(["conversations", "speed"]);
      expect(await enqueueAreaSync(inst, L1, "conversations")).toBe(2);
      expect(await enqueueAreaSync(inst, L1, "conversations"), "the same change twice queues nothing more").toBe(0);
      expect(await enqueueAreaSync(inst, L1, "appointments")).toBe(1);
      expect(await enqueueAreaSync(inst, L2, "contacts")).toBe(1);
      await wipeJobs();
    });
  });

  describe("an old failure stops showing once a later read succeeded", () => {
    it("clears the account's error only when the latest finished job of every kind is no longer a failure", async () => {
      await wipeJobs();
      await sql()`update locations set sync_error = 'old error' where installation_id = ${inst} and location_id = ${L1}`;
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, error, created_at, finished_at) values
        (${inst}, ${L1}, 'conversations', 'failed', '/x returned 503', now() - interval '30 minutes', now() - interval '30 minutes'),
        (${inst}, ${L1}, 'contacts', 'failed', '/x returned 503', now() - interval '20 minutes', now() - interval '20 minutes')`;
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at, finished_at) values (${inst}, ${L1}, 'conversations', 'done', now() - interval '10 minutes', now() - interval '10 minutes')`;
      await clearResolvedError(inst, L1);
      expect((await sql()`select sync_error e from locations where installation_id = ${inst} and location_id = ${L1}`)[0].e, "contacts is still failing").toBe("old error");
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at, finished_at) values (${inst}, ${L1}, 'contacts', 'done', now() - interval '5 minutes', now() - interval '5 minutes')`;
      await clearResolvedError(inst, L1);
      expect((await sql()`select sync_error e from locations where installation_id = ${inst} and location_id = ${L1}`)[0].e).toBeNull();
      await wipeJobs();
    });
  });

  describe("the one freshness value, read from the database", () => {
    it("is the oldest account's last successful refresh, worded exactly", async () => {
      await wipeJobs();
      const now = Date.now();
      await setSynced(L1, new Date(now - 7 * MIN));
      await setSynced(L2, new Date(now - 12 * MIN));
      const f = await freshnessFor(inst, { now });
      expect(f.text).toBe("Updated 12 min ago");
      expect(f.state).toBe("fresh");
      expect(f.accounts.map((a) => [a.name, a.text])).toEqual([["zz Alpha", "Updated 7 min ago"], ["zz Beta", "Updated 12 min ago"]]);
      // One account's own view says its own time (a business or a client sees only their account).
      expect((await freshnessFor(inst, { limitTo: L1, now })).text).toBe("Updated 7 min ago");
      expect((await freshnessFor(inst, { limitTo: L1, now })).accounts).toHaveLength(1);
    });
    it("changes its wording after 30 minutes", async () => {
      const now = Date.now();
      await setSynced(L1, new Date(now - 7 * MIN));
      await setSynced(L2, new Date(now - 45 * MIN));
      const f = await freshnessFor(inst, { now });
      expect(f.text).toBe("Updated 45 min ago, refresh is delayed");
      expect(f.state).toBe("delayed");
    });
    it("says so when the latest read of an account failed, with a plain reason and not the raw message", async () => {
      await wipeJobs();
      const now = Date.now();
      await setSynced(L1, new Date(now - 7 * MIN));
      await setSynced(L2, new Date(now - 9 * MIN));
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, error, created_at, finished_at) values (${inst}, ${L2}, 'conversations', 'failed', '/conversations/search returned 429', now() - interval '2 minutes', now() - interval '2 minutes')`;
      const f = await freshnessFor(inst, { now });
      expect(f.state).toBe("failing");
      expect(f.text).toBe("Updated 9 min ago, but the latest refresh failed for 1 account");
      expect(f.detail).toMatch(/slow down/);
      expect(JSON.stringify(f)).not.toContain("returned 429");
      expect((await freshnessFor(inst, { limitTo: L1, now })).state, "the other account's failure is not shown to its neighbour").toBe("fresh");
      const panel = await syncPanel(inst, { now });
      expect(panel.problems).toEqual([{ account: "zz Beta", reason: expect.stringMatching(/slow down/) }]);
      expect(panel.checks24h.failed).toBe(1);
      // A later success clears it.
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at, finished_at) values (${inst}, ${L2}, 'conversations', 'done', now() - interval '1 minute', now() - interval '1 minute')`;
      expect((await freshnessFor(inst, { now })).state).toBe("fresh");
      await wipeJobs();
    });
    it("shows the running note only for a first sync or a job that has waited a long time, not for a normal refresh", async () => {
      await wipeJobs();
      const now = Date.now();
      await setSynced(L1, new Date(now - 14 * MIN));
      await setSynced(L2, new Date(now - 14 * MIN));
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at) values (${inst}, ${L1}, 'conversations', 'running', now() - interval '1 minute')`;
      expect((await freshnessFor(inst, { now: Date.now() })).syncingNote, "a normal refresh in progress").toBeNull();
      await wipeJobs();
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at) values (${inst}, ${L1}, 'contacts', 'running', now() - interval '15 minutes')`;
      expect((await freshnessFor(inst, { now: Date.now() })).syncingNote).toMatch(/has been running for 15 minutes/);
      await wipeJobs();
      await setSynced(L1, null);
      await setSynced(L2, null);
      await sql()`insert into sync_jobs (installation_id, location_id, type, status, created_at) values (${inst}, ${L1}, 'contacts', 'running', now() - interval '1 minute')`;
      const first = await freshnessFor(inst, { now: Date.now() });
      expect(first.state).toBe("first_sync");
      expect(first.syncingNote).toMatch(/first sync is running/i);
      await wipeJobs();
    });
    it("the panel says when the next refresh is, from the last cycle", async () => {
      await wipeJobs();
      const now = Date.now();
      await setSynced(L1, new Date(now - 5 * MIN));
      await setSynced(L2, new Date(now - 5 * MIN));
      await metrics(5);
      const p = await syncPanel(inst, { now: Date.now() });
      expect(p.nextRun?.running).toBe(false);
      expect(p.nextRun?.text).toMatch(/^Next refresh in about \d+ minutes?$|^Next refresh in about a minute$/);
      const minutes = (Date.parse(p.nextRun!.at!) - Date.now()) / MIN;
      // The last cycle was queued 5 minutes ago and the next is due 14 minutes after it (9 from now); the scheduler wakes on a 5 minute grid.
      expect(minutes).toBeGreaterThanOrEqual(8.9);
      expect(minutes).toBeLessThanOrEqual(14.1);
      expect(p.schedule.join(" ")).toMatch(/Every 15 minutes/);
      await wipeJobs();
    });
  });

  describe("the internal alarm on real rows", () => {
    it("is written once when it starts, not again, and once when it clears, and sends nothing", async () => {
      const id = inst;
      const t0 = Date.now();
      const alarm = [{ id, verdict: { installationId: id, state: "alarm" as const, ageMinutes: 41, why: "test" }, detail: { ageMinutes: 41, why: "test", pendingJobs: 0, failedJobs24h: 0, accounts: 2 } }];
      const ok = [{ id, verdict: { installationId: id, state: "ok" as const, ageMinutes: 3, why: "Fresh." }, detail: { ageMinutes: 3, why: "Fresh." } }];
      const entries = async () => (await sql()`select action, detail from audit_log where installation_id = ${id} and action in ('sync.alarm', 'sync.recovered') order by at, id`).map((r) => r.action as string);
      expect((await recordVerdicts(alarm, t0)).raised).toBe(1);
      expect((await recordVerdicts(alarm, t0 + 10 * MIN)).raised, "still standing, ten minutes later: nothing new").toBe(0);
      expect((await recordVerdicts(alarm, t0 + 61 * MIN)).reminded, "an hour later: one reminder").toBe(1);
      expect((await recordVerdicts(ok, t0 + 70 * MIN)).recovered).toBe(1);
      expect((await recordVerdicts(ok, t0 + 80 * MIN)).recovered, "nothing more once clear").toBe(0);
      expect(await entries()).toEqual(["sync.alarm", "sync.alarm", "sync.recovered"]);
      const [row] = await sql()`select detail from audit_log where installation_id = ${id} and action = 'sync.alarm' order by at, id limit 1`;
      expect(JSON.stringify(row.detail)).toContain("WOULD NOTIFY");
      expect(Object.keys(row.detail as object).sort()).toEqual(["accounts", "ageMinutes", "failedJobs24h", "kind", "outward", "pendingJobs", "why"]);
    });
    it("the diagnostics list real installs only: short ids, no names, no fixture", async () => {
      const { diagnostics } = await collectDiagnostics();
      expect(diagnostics.installations.length).toBeGreaterThan(0);
      for (const i of diagnostics.installations) {
        expect(i.installation).toHaveLength(8);
        expect(Object.keys(i).sort()).toEqual(["accounts", "cadence24h", "freshness", "installation", "mode", "queue", "verdict"]);
      }
      expect(diagnostics.installations.some((i) => i.installation === inst.slice(0, 8)), "a fixture without a refresh token is not a real install").toBe(false);
      expect(typeof diagnostics.generatedAt).toBe("string");
      expect(JSON.stringify(diagnostics)).not.toMatch(/zzSyncRel|xtest/);
    });
  });
});
