import { sql } from "../db";
import { schemaReady } from "./cleanup-config";
import type { AlertDraft } from "./derive";
import { scanAccount } from "./quality-queries";

// The scheduled scan of the Clean-up module (stage CLEANUP). It runs inside the existing refresh (refreshInsights): once a day it scans each client account that has no snapshot from
// today (within a time budget, so a big agency finishes over a few runs), which stores the data-quality score and counts the likely duplicate groups that appeared since the
// previous snapshot. Whenever a snapshot says several new groups appeared, an alert is raised through the existing alert engine (in-app bell; email and Slack only through
// the existing switches, which are off). Nothing here reads the CRM or changes a contact.

/** Fewer new groups than this is noise, not an alert. */
export const NEW_GROUPS_ALERT_AT = 3;
const BUDGET_MS = 25_000;

export async function dailyQualityScan(installationId: string, budgetMs = BUDGET_MS): Promise<{ scanned: number; pending: number }> {
  if (!(await schemaReady()).snapshots) return { scanned: 0, pending: 0 };
  const db = sql();
  const rows = await db`
    select l.location_id from locations l
    where l.installation_id = ${installationId} and not l.ignored
      and not exists (select 1 from cleanup_quality_snapshots s where s.installation_id = l.installation_id and s.location_id = l.location_id and s.day = current_date)
    order by l.name`;
  const deadline = Date.now() + budgetMs;
  let scanned = 0;
  for (const r of rows) {
    if (Date.now() >= deadline) break;
    try { await scanAccount(installationId, r.location_id as string, null, null); scanned++; } catch { /* the next run tries again */ }
  }
  return { scanned, pending: rows.length - scanned };
}

/** One alert per account whose latest snapshot (from the last 2 days) found enough new likely duplicates. Rebuilt on every refresh, so it clears itself when the groups are dealt with. */
export async function duplicateAlertDrafts(installationId: string): Promise<AlertDraft[]> {
  if (!(await schemaReady()).snapshots) return [];
  const rows = await sql()`
    select distinct on (s.location_id) s.location_id, s.new_groups, s.duplicate_groups, l.name
    from cleanup_quality_snapshots s join locations l on l.installation_id = s.installation_id and l.location_id = s.location_id and not l.ignored
    where s.installation_id = ${installationId} and s.day >= current_date - 2 order by s.location_id, s.day desc`;
  const arrivals = await sql()`
    select d.location_id, count(*)::int n, l.name from possible_duplicates d join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id and not l.ignored
    where d.installation_id = ${installationId} and d.status = 'new' and d.tier <> 'maybe' and d.created_at > now() - interval '3 days' group by d.location_id, l.name`.catch(() => []);
  const fromArrivals = arrivals.map((r) => ({
    dedupeKey: `arrivals:${r.location_id}`, kind: "duplicates", severity: "info" as const, locationId: r.location_id as string,
    title: `${(r.name as string | null) ?? "A client account"}: ${r.n} new contact${r.n === 1 ? "" : "s"} may already exist`, detail: { arrivals: r.n },
  }));
  return [...fromArrivals, ...rows.filter((r) => (r.new_groups as number) >= NEW_GROUPS_ALERT_AT).map((r) => ({
    dedupeKey: `duplicates:${r.location_id}`, kind: "duplicates", severity: "info" as const, locationId: r.location_id as string,
    title: `${(r.name as string | null) ?? "A client account"} has ${r.new_groups} new likely duplicate groups`,
    detail: { newGroups: r.new_groups, openGroups: r.duplicate_groups },
  }))];
}
