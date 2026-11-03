import { maintenanceOn } from "../runtime-guards";
import { sql } from "../db";
import { freshnessOf, plainReason, type AccountFreshnessInput, type Freshness, type FreshnessInput } from "./freshness";
import { nextRefreshAt, scheduleSentences } from "./schedule";

// The database side of freshness. `loadFreshnessInput` is the ONLY place the "last successful sync" of an account is read, and `freshnessFor`
// turns it into the one sentence every screen shows (src/lib/sync/freshness.ts). `limitTo` restricts it to one account (a business or a client's
// own view); `onlyIds` applies a filter the person chose on screen.

type Opts = { limitTo?: string | null; onlyIds?: Set<string> | null; now?: number };

export type SyncFacts = {
  input: FreshnessInput;
  lastCycleStartedAt: number | null;
  checks24h: { total: number; failed: number };
  problems: Array<{ account: string | null; reason: string }>;
};

const ms = (v: unknown): number | null => (v instanceof Date ? v.getTime() : null);
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);

// If the access token has not been renewed for this long, the connection is gone (an expired token is normal: it renews on use).
const TOKEN_GONE_AFTER_MS = 3 * 86_400_000;

export async function loadSyncFacts(installationId: string, opts: Opts = {}): Promise<SyncFacts> {
  const db = sql();
  const now = opts.now ?? Date.now();
  const limit = opts.limitTo ?? null;
  const [[inst], locs, [pending], latest, [cycle], [checks]] = await Promise.all([
    db`select is_demo, token_expires_at from installations where id = ${installationId}`,
    db`select location_id, name, conversations_synced_at, last_synced_at from locations
       where installation_id = ${installationId} and not ignored and (${limit}::text is null or location_id = ${limit}) order by name`,
    db`select count(*)::int n, min(created_at) oldest from sync_jobs
       where installation_id = ${installationId} and status in ('pending', 'running') and (${limit}::text is null or location_id = ${limit} or location_id is null)`,
    // The latest finished job of each kind for each account (and the install-level ones). A failure counts only while it is the latest word.
    db`select distinct on (location_id, type) location_id, type, status, error from sync_jobs
       where installation_id = ${installationId} and status in ('done', 'failed') and created_at > now() - interval '3 days'
       order by location_id, type, created_at desc`,
    db`select max(created_at) last from sync_jobs where installation_id = ${installationId} and type = 'metrics'`,
    db`select count(*)::int total, count(*) filter (where status = 'failed')::int failed from sync_jobs
       where installation_id = ${installationId} and coalesce(finished_at, created_at) > now() - interval '24 hours'
         and (${limit}::text is null or location_id = ${limit} or location_id is null)`,
  ]);

  const failedFor = new Map<string, string>();
  let connectionProblem: string | null = null;
  const problems: SyncFacts["problems"] = [];
  const names = new Map<string, string | null>(locs.map((l) => [l.location_id as string, (l.name as string | null) ?? null]));
  for (const j of latest) {
    if (j.status !== "failed") continue;
    const loc = j.location_id as string | null;
    const reason = plainReason(j.error as string | null);
    if (loc === null) {
      // Listing the accounts failed (type "locations") or the recalculation did: about the whole connection, not one account.
      if (j.type === "locations") { connectionProblem = "SubSync could not reach your CRM to list your accounts. If this continues, reinstall SubSync from the app marketplace."; problems.push({ account: null, reason: connectionProblem }); }
      else problems.push({ account: null, reason: "Re-checking your alerts failed. It will try again on its own." });
      continue;
    }
    if (limit && loc !== limit) continue;
    if (!names.has(loc)) continue; // an ignored or removed account
    if (!failedFor.has(loc)) failedFor.set(loc, reason);
    problems.push({ account: names.get(loc) ?? "Unnamed account", reason });
  }
  const tokenAt = ms(inst?.token_expires_at);
  if (!inst?.is_demo && tokenAt !== null && now - tokenAt > TOKEN_GONE_AFTER_MS) {
    connectionProblem = "SubSync's access to your CRM has not renewed for several days. Reinstalling SubSync from the app marketplace may be needed.";
    problems.push({ account: null, reason: connectionProblem });
  }

  const accounts: AccountFreshnessInput[] = locs
    .filter((l) => !opts.onlyIds || opts.onlyIds.has(l.location_id as string))
    .map((l) => ({
      locationId: l.location_id as string,
      name: (l.name as string | null) ?? null,
      // Conversations are read in every refresh cycle; a first sync may reach `last_synced_at` through contacts first.
      lastSuccessAt: iso(l.conversations_synced_at) ?? iso(l.last_synced_at),
      problem: failedFor.get(l.location_id as string) ?? null,
    }));

  const oldestPending = ms(pending?.oldest);
  return {
    input: {
      now, demo: inst?.is_demo === true, accounts,
      pendingJobs: (pending?.n as number) ?? 0,
      oldestPendingMinutes: oldestPending === null ? null : Math.max(0, (now - oldestPending) / 60_000),
      connectionProblem,
    },
    lastCycleStartedAt: ms(cycle?.last),
    checks24h: { total: (checks?.total as number) ?? 0, failed: (checks?.failed as number) ?? 0 },
    problems,
  };
}

/** The one freshness value. Every screen, API answer and brief gets it from here. */
export async function freshnessFor(installationId: string, opts: Opts = {}): Promise<Freshness> {
  return freshnessOf((await loadSyncFacts(installationId, opts)).input);
}

export type SyncPanel = {
  freshness: Freshness;
  nextRun: { at: string | null; text: string; running: boolean } | null;
  checks24h: { total: number; failed: number };
  problems: Array<{ account: string | null; reason: string }>;
  schedule: string[];
  demo: boolean;
};

/** Everything the Sync status panel shows. */
export async function syncPanel(installationId: string, opts: Opts = {}): Promise<SyncPanel> {
  const facts = await loadSyncFacts(installationId, opts);
  const freshness = freshnessOf(facts.input);
  const now = facts.input.now;
  let nextRun: SyncPanel["nextRun"] = null;
  if (!facts.input.demo) {
    if (maintenanceOn(process.env)) nextRun = { at: null, text: "Paused for maintenance", running: false };
    else if (facts.input.pendingJobs > 0) nextRun = { at: null, text: "Refreshing now", running: true };
    else {
      const at = nextRefreshAt(facts.lastCycleStartedAt, now);
      const m = Math.max(1, Math.ceil((at - now) / 60_000));
      nextRun = { at: new Date(at).toISOString(), text: m <= 1 ? "Next refresh in about a minute" : `Next refresh in about ${m} minutes`, running: false };
    }
  }
  return { freshness, nextRun, checks24h: facts.checks24h, problems: facts.problems, schedule: scheduleSentences(), demo: facts.input.demo };
}
