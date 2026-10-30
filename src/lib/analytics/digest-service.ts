import { sql } from "../db";
import { syncStatus } from "../sync/engine";
import { freshness, portfolioHeadlines, rank, type AccountInput, type SeriesPoint } from "./digest-intel";
import { inbox, listDomainChecks, visibleLocationIds } from "./queries";
import { appointmentSignals } from "./appointment-queries";
import { replyHoursFor } from "./playbooks";
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
export async function buildDailyDigest(installationId: string, opts: { limitTo?: string | null; planLimit?: number | null; onlyIds?: Set<string> | null } = {}) {
  const [{ settings, accounts }, status] = await Promise.all([loadAccounts(installationId), syncStatus(installationId, opts.limitTo)]);
  let live = accounts.filter((a) => !a.ignored);
  if (opts.limitTo) live = live.filter((a) => a.locationId === opts.limitTo);
  else if (opts.planLimit) {
    const allowed = new Set(await visibleLocationIds(installationId, opts.planLimit));
    live = live.filter((a) => allowed.has(a.locationId));
  }
  if (opts.onlyIds) live = live.filter((a) => opts.onlyIds!.has(a.locationId));
  const [lastLocations] = await sql()`select status, error from sync_jobs where installation_id = ${installationId} and type = 'locations' order by coalesce(finished_at, created_at) desc limit 1`;
  const connection = lastLocations?.status === "failed"
    ? { ok: false, message: "SubSync could not connect to the platform to refresh your accounts. Access may have been removed. If this continues, reinstall SubSync from the app marketplace." }
    : { ok: true, message: null as string | null };
  const ids = live.map((a) => a.locationId);
  const [series, waiting, domains, signals] = await Promise.all([
    seriesByLocation(installationId, ids),
    inbox(installationId, settings.slaHours, 2000, opts.limitTo ?? undefined),
    listDomainChecks(installationId),
    appointmentSignals(installationId, ids),
  ]);
  // Each account's reply target: its industry's when the agency switched that on, otherwise one number for everyone.
  const industries = new Map<string, string | null>();
  if (settings.industryTargets && ids.length > 0) {
    for (const r of await sql()`select location_id, industry from account_profiles where installation_id = ${installationId} and location_id = any(${ids}::text[])`) {
      industries.set(r.location_id as string, r.industry as string | null);
    }
  }
  const targetFor = (id: string) => replyHoursFor(industries.get(id), settings.slaHours, settings.industryTargets);
  const oldest = new Map<string, number>();
  const unansweredAt = new Map<string, number>();
  for (const r of waiting) {
    if (r.lastMessageDirection !== "inbound" || r.waitingHours === null || r.waitingHours > 30 * 24) continue;
    if (r.waitingHours < targetFor(r.locationId)) continue;
    unansweredAt.set(r.locationId, (unansweredAt.get(r.locationId) ?? 0) + 1);
    oldest.set(r.locationId, Math.max(oldest.get(r.locationId) ?? 0, r.waitingHours));
  }
  const worstDomain = (id: string): AccountInput["emailStatus"] => {
    const mine = domains.filter((d) => d.locationId === id);
    if (mine.length === 0) return "unchecked";
    return mine.some((d) => d.status === "critical") ? "critical" : mine.some((d) => d.status === "warning") ? "warning" : "ok";
  };
  const inputs: AccountInput[] = live.map((a) => ({
    locationId: a.locationId, name: a.name ?? "Unnamed account", series: series.get(a.locationId) ?? [],
    unanswered: settings.industryTargets ? unansweredAt.get(a.locationId) ?? 0 : a.unanswered, oldestWaitingHours: oldest.get(a.locationId) ?? null, slaHours: targetFor(a.locationId),
    staleCount: a.staleOpps, staleValue: a.revenueAtRisk, dormant: a.dormant, daysInactive: a.daysInactive,
    emailStatus: worstDomain(a.locationId), syncError: a.syncError, lastSyncedAt: a.contactsSyncedAt, pipelines: a.pipelines,
    noShows3d: signals.get(a.locationId)?.noShows3d ?? 0, unconfirmed48: signals.get(a.locationId)?.unconfirmed48 ?? 0,
  }));
  const { attention, fine } = rank(inputs);
  return {
    generatedAt: new Date().toISOString(),
    freshness: { ...freshness(status.lastFinishedAt), lastSyncAt: status.lastFinishedAt, pending: status.pending },
    headlines: portfolioHeadlines([...series.values()]),
    attention, fine, accounts: live.length, settings, connection,
  };
}
