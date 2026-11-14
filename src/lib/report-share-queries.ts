import { sql } from "./db";
import { validReportId, type ReportKind, type StoredReport } from "./report-share";
import { newReportToken } from "./report-token";

// The database side of "Share a report", in one place so a test can hold it to the rules. A link opens only while it has not expired and has not been switched off; an id that does not match
// exactly opens nothing; only the installation that made a link can list it or switch it off. The id is the only thing a visitor holds, and the page reads nothing but that one stored row.

/** The stored report behind an id, or null when the id is malformed, unknown, expired or switched off. Counts the view and notes the first view of each hour in the audit log. */
export async function findSharedReport(id: string): Promise<{ report: StoredReport; expiresAt: Date } | null> {
  if (!validReportId(id)) return null;
  const [row] = await sql()`select installation_id, payload, expires_at, last_viewed_at from shared_reports where id = ${id} and expires_at > now() and revoked_at is null`;
  if (!row) return null;
  await sql()`update shared_reports set views = views + 1, last_viewed_at = now() where id = ${id} and expires_at > now() and revoked_at is null`.catch(() => undefined);
  const last = row.last_viewed_at instanceof Date ? row.last_viewed_at.getTime() : 0;
  if (Date.now() - last > 3_600_000) {
    await sql()`insert into audit_log (installation_id, actor, action, detail) values (${row.installation_id as string}, 'shared link', 'report.share_opened', ${sql().json({ ref: id.slice(-6) } as never)})`.catch(() => undefined);
  }
  return { report: row.payload as StoredReport, expiresAt: row.expires_at as Date };
}

export async function createSharedReport(i: { installationId: string; actor: string; kind: ReportKind; report: StoredReport; days: number }): Promise<{ id: string; expiresAt: Date }> {
  const id = newReportToken();
  const [row] = await sql()`insert into shared_reports (id, installation_id, kind, title, payload, include_names, expires_at)
    values (${id}, ${i.installationId}, ${i.kind}, ${i.report.title}, ${sql().json(i.report as never)}, ${i.report.namesIncluded}, now() + make_interval(days => ${i.days})) returning expires_at`;
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${i.installationId}, ${i.actor}, 'report.share_created', ${sql().json({ ref: id.slice(-6), kind: i.kind, days: i.days, names: i.report.namesIncluded } as never)})`;
  return { id, expiresAt: row.expires_at as Date };
}

export type SharedReportRow = { id: string; kind: string; title: string; namesIncluded: boolean; createdAt: string; expiresAt: string; revoked: boolean; expired: boolean; views: number; lastViewedAt: string | null };

/** The links this installation has made, newest first. Never another installation's. */
export async function listSharedReports(installationId: string, kind: string | null): Promise<SharedReportRow[]> {
  const rows = await sql()`select id, kind, title, include_names, created_at, expires_at, revoked_at, views, last_viewed_at from shared_reports
    where installation_id = ${installationId} and (${kind}::text is null or kind = ${kind}) order by created_at desc limit 30`;
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id as string, kind: r.kind as string, title: r.title as string, namesIncluded: r.include_names as boolean, createdAt: (r.created_at as Date).toISOString(), expiresAt: (r.expires_at as Date).toISOString(),
    revoked: r.revoked_at !== null, expired: (r.expires_at as Date).getTime() <= now, views: r.views as number, lastViewedAt: r.last_viewed_at instanceof Date ? r.last_viewed_at.toISOString() : null,
  }));
}

/** Switches a link off. Only the installation that made it can: the id alone is not enough. Returns whether a link was switched off. */
export async function revokeSharedReport(installationId: string, actor: string, id: string): Promise<boolean> {
  if (!validReportId(id)) return false;
  const done = await sql()`update shared_reports set revoked_at = now() where id = ${id} and installation_id = ${installationId} and revoked_at is null returning id`;
  if (done.length === 0) return false;
  await sql()`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, ${actor}, 'report.share_revoked', ${sql().json({ ref: id.slice(-6) } as never)})`;
  return true;
}
