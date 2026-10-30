import { sql } from "../db";
import { syncStatus } from "../sync/engine";
import { freshness, portfolioHeadlines, rank, type AccountInput, type SeriesPoint } from "./digest-intel";
import { inbox, listDomainChecks, visibleLocationIds } from "./queries";
import { loadAccounts } from "./service";

// Things a daily brief could say but cannot yet, with the honest reason. Shown in the app so
// nobody assumes they are being watched.
export const NOT_WATCHED = [
  { what: "Missed calls", why: "the platform does not give this app call logs yet" },
  { what: "Failing workflows", why: "the workflows API is in closed beta" },
  { what: "Low wallet balance and failed payments", why: "needs billing access the app does not request" },
  { what: "Phone registration (A2P) status", why: "not available through the API this app uses" },
];

async function seriesByLocation(installationId: string, locationIds: string[]): Promise<Map<string, SeriesPoint[]>> {
  if (locationIds.length === 0) return new Map();
  const rows = await sql()`
    select location_id, day::text as day, contacts, new_contacts_30d, open_opportunities, open_value::float8 open_value,
      stale_opportunities, unread_conversations, completeness_pct, engagement_score
    from account_metrics_daily
    where installation_id = ${installationId} and location_id = any(${locationIds}::text[]) and day >= current_date - 10
    order by day`;
  const by = new Map<string, SeriesPoint[]>();
  for (const r of rows) {
    const list = by.get(r.location_id as string) ?? [];
    list.push({
      day: r.day, contacts: r.contacts, new30: r.new_contacts_30d, openOpps: r.open_opportunities, openValue: r.open_value, stale: r.stale_opportunities,
      unread: r.unread_conversations, completeness: r.completeness_pct, score: r.engagement_score,
    });
    by.set(r.location_id as string, list);
  }
  return by;
}

// Everything the daily brief needs for one install. `limitTo` restricts it to a single account
// (a business or client view); `planLimit` applies the free plan's account limit.
export async function buildDailyDigest(installationId: string, opts: { limitTo?: string | null; planLimit?: number | null } = {}) {
  const [{ settings, accounts }, status] = await Promise.all([loadAccounts(installationId), syncStatus(installationId, opts.limitTo)]);
  let live = accounts.filter((a) => !a.ignored);
  if (opts.limitTo) live = live.filter((a) => a.locationId === opts.limitTo);
  else if (opts.planLimit) {
    const allowed = new Set(await visibleLocationIds(installationId, opts.planLimit));
    live = live.filter((a) => allowed.has(a.locationId));
  }
  const ids = live.map((a) => a.locationId);
  const [series, waiting, domains] = await Promise.all([
    seriesByLocation(installationId, ids),
    inbox(installationId, settings.slaHours, 2000, opts.limitTo ?? undefined),
    listDomainChecks(installationId),
  ]);
  const oldest = new Map<string, number>();
  for (const r of waiting) if (r.overSla && r.waitingHours !== null) oldest.set(r.locationId, Math.max(oldest.get(r.locationId) ?? 0, r.waitingHours));
  const worstDomain = (id: string): AccountInput["emailStatus"] => {
    const mine = domains.filter((d) => d.locationId === id);
    if (mine.length === 0) return "unchecked";
    return mine.some((d) => d.status === "critical") ? "critical" : mine.some((d) => d.status === "warning") ? "warning" : "ok";
  };
  const inputs: AccountInput[] = live.map((a) => ({
    locationId: a.locationId, name: a.name ?? "Unnamed account", series: series.get(a.locationId) ?? [],
    unanswered: a.unanswered, oldestWaitingHours: oldest.get(a.locationId) ?? null, slaHours: settings.slaHours,
    staleCount: a.staleOpps, staleValue: a.revenueAtRisk, dormant: a.dormant, daysInactive: a.daysInactive,
    emailStatus: worstDomain(a.locationId), syncError: a.syncError, lastSyncedAt: a.contactsSyncedAt, pipelines: a.pipelines,
  }));
  const { attention, fine } = rank(inputs);
  return {
    generatedAt: new Date().toISOString(),
    freshness: { ...freshness(status.lastFinishedAt), lastSyncAt: status.lastFinishedAt, pending: status.pending },
    headlines: portfolioHeadlines([...series.values()]),
    attention, fine, accounts: live.length, settings,
  };
}
