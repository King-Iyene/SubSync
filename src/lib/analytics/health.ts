import { sql } from "../db";
import { healthLevel, type HealthLevel } from "./health-level";

// Connection health (spec 11.4) and per-account sync status (spec 11.5).

export type AccountSyncRow = {
  locationId: string;
  name: string | null;
  lastSyncedAt: string | null;
  contactsSyncedAt: string | null;
  opportunitiesSyncedAt: string | null;
  conversationsSyncedAt: string | null;
  syncError: string | null;
  contacts: number;
};

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export async function integrationHealth(installationId: string, demo: boolean) {
  const db = sql();
  const [[inst], [jobs], [last], failures, accounts] = await Promise.all([
    db`select token_expires_at from installations where id = ${installationId}`,
    db`select count(*)::int total, count(*) filter (where status = 'failed')::int failed
       from sync_jobs where installation_id = ${installationId} and coalesce(finished_at, created_at) > now() - interval '24 hours'`,
    db`select max(finished_at) f from sync_jobs where installation_id = ${installationId} and status = 'done'`,
    db`select type, location_id, error, finished_at from sync_jobs
       where installation_id = ${installationId} and status = 'failed' and finished_at > now() - interval '24 hours'
       order by finished_at desc limit 5`,
    db`select l.location_id, l.name, l.last_synced_at, l.contacts_synced_at, l.opportunities_synced_at, l.conversations_synced_at, l.sync_error,
         (select count(*)::int from cached_contacts c where c.installation_id = l.installation_id and c.location_id = l.location_id) contacts
       from locations l where l.installation_id = ${installationId} and not l.ignored order by l.name`,
  ]);
  const tokenExpiresAt = inst?.token_expires_at instanceof Date ? inst.token_expires_at.getTime() : null;
  const lastSyncAt = last?.f instanceof Date ? last.f.getTime() : null;
  const h = healthLevel({
    now: Date.now(), lastSyncAt, failedJobs24h: jobs?.failed ?? 0, totalJobs24h: jobs?.total ?? 0,
    // Demo data has no real connection to check.
    tokenExpiresAt: demo ? null : tokenExpiresAt,
  });
  return {
    level: demo ? ("healthy" as HealthLevel) : h.level,
    reasons: demo ? [] : h.reasons,
    stale: demo ? false : h.stale,
    lastSyncAt: lastSyncAt === null ? null : new Date(lastSyncAt).toISOString(),
    failedJobs24h: jobs?.failed ?? 0,
    totalJobs24h: jobs?.total ?? 0,
    recentErrors: failures.map((f) => ({
      type: f.type as string, locationId: f.location_id as string | null, error: (f.error as string | null) ?? "Unknown error", at: iso(f.finished_at),
    })),
    accounts: accounts.map((a): AccountSyncRow => ({
      locationId: a.location_id as string, name: a.name as string | null, lastSyncedAt: iso(a.last_synced_at), contactsSyncedAt: iso(a.contacts_synced_at),
      opportunitiesSyncedAt: iso(a.opportunities_synced_at), conversationsSyncedAt: iso(a.conversations_synced_at),
      syncError: a.sync_error as string | null, contacts: a.contacts as number,
    })),
  };
}
