// Pure health rules (no database), so they can be unit tested.

export type HealthLevel = "healthy" | "degraded" | "down" | "idle";

export const STALE_AFTER_HOURS = 6;

type HealthInput = {
  now: number;
  lastSyncAt: number | null;
  failedJobs24h: number;
  totalJobs24h: number;
  tokenExpiresAt: number | null;
};

// An expired access token is normal (it is refreshed on use), so it only matters when the refresh
// has not happened for a long time. A high share of failed jobs is the real signal.
export function healthLevel(i: HealthInput): { level: HealthLevel; reasons: string[]; stale: boolean } {
  const reasons: string[] = [];
  const stale = i.lastSyncAt !== null && i.now - i.lastSyncAt > STALE_AFTER_HOURS * 3_600_000;
  if (i.lastSyncAt === null) return { level: "idle", reasons: ["No sync has finished yet."], stale: false };
  const errorRate = i.totalJobs24h > 0 ? i.failedJobs24h / i.totalJobs24h : 0;
  if (i.failedJobs24h >= 5 && errorRate >= 0.5) reasons.push(`${i.failedJobs24h} of ${i.totalJobs24h} sync jobs failed in the last 24 hours.`);
  else if (i.failedJobs24h > 0 && errorRate >= 0.1) reasons.push(`${i.failedJobs24h} sync job${i.failedJobs24h === 1 ? "" : "s"} failed in the last 24 hours.`);
  if (stale) reasons.push(`The last successful sync was more than ${STALE_AFTER_HOURS} hours ago.`);
  if (i.tokenExpiresAt !== null && i.now - i.tokenExpiresAt > 3 * 86_400_000) reasons.push("The connection has not been refreshed for several days. Reinstalling the app may be needed.");
  const down = (i.failedJobs24h >= 5 && errorRate >= 0.5) || (i.tokenExpiresAt !== null && i.now - i.tokenExpiresAt > 3 * 86_400_000);
  return { level: down ? "down" : reasons.length ? "degraded" : "healthy", reasons, stale };
}
