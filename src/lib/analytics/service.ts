import { sql } from "../db";
import { postToSlack } from "../notify";
import { emailConfigured, unsubscribeHeaders, type Mail } from "../email";
import { unsubscribeUrl } from "../unsubscribe";

import { localParts } from "./digest-intel";
import { alertEmail, alertsToSendNow } from "./weekly-email";
import { currentVersion } from "./definitions";
import { buildDigest, computeAlerts, deriveAccount, type DerivedAccount, type DomainStatus } from "./derive";
import {
  accountRows, getSettings, listAlerts, listDomainChecks, scoreHistory, syncAlerts, type Settings,
} from "./queries";

export async function loadAccounts(installationId: string): Promise<{ settings: Settings; accounts: DerivedAccount[] }> {
  const settings = await getSettings(installationId);
  const [rows, history] = await Promise.all([accountRows(installationId, settings), scoreHistory(installationId, 30)]);
  const now = Date.now();
  return {
    settings,
    accounts: rows.map((r) => {
      const h = history.get(r.locationId);
      return deriveAccount(r, settings, h?.scores ?? [], now, h?.newContacts ?? []);
    }),
  };
}

// Write today's snapshot for every account (feeds trends and churn detection).
export async function snapshotMetrics(installationId: string, accounts: DerivedAccount[], rulesRevision = 0): Promise<void> {
  const db = sql();
  // Written with the version of the counting rules, so history is only ever compared inside one version (definitions.ts, N39).
  const version = currentVersion(rulesRevision);
  if (accounts.length === 0) return;
  // One statement for all accounts (a settings change refreshes insights, and one round trip per account made that take many seconds).
  const rows = accounts.map((a) => ({
    installation_id: installationId, location_id: a.locationId, contacts: a.contacts, new_contacts_30d: a.new30d,
    open_opportunities: a.openOpps, open_value: a.openValue, stale_opportunities: a.staleOpps, unread_conversations: a.unread,
    completeness_pct: a.completenessPct, engagement_score: a.score, days_inactive: a.daysInactive, definition_version: version,
  }));
  await db`
    insert into account_metrics_daily (installation_id, location_id, day, contacts, new_contacts_30d, open_opportunities, open_value,
      stale_opportunities, unread_conversations, completeness_pct, engagement_score, days_inactive, definition_version)
    select r.installation_id::uuid, r.location_id, current_date, r.contacts, r.new_contacts_30d, r.open_opportunities, r.open_value,
      r.stale_opportunities, r.unread_conversations, r.completeness_pct, r.engagement_score, r.days_inactive, r.definition_version
    from jsonb_to_recordset(${db.json(rows as never)}::jsonb) as r(installation_id text, location_id text, contacts int, new_contacts_30d int, open_opportunities int,
      open_value float8, stale_opportunities int, unread_conversations int, completeness_pct int, engagement_score int, days_inactive int, definition_version int)
    on conflict (installation_id, location_id, day) do update set
      contacts = excluded.contacts, new_contacts_30d = excluded.new_contacts_30d,
      open_opportunities = excluded.open_opportunities, open_value = excluded.open_value,
      stale_opportunities = excluded.stale_opportunities, unread_conversations = excluded.unread_conversations,
      completeness_pct = excluded.completeness_pct, engagement_score = excluded.engagement_score,
      days_inactive = excluded.days_inactive, definition_version = excluded.definition_version`;
}

export async function domainStatuses(installationId: string): Promise<DomainStatus[]> {
  const checks = await listDomainChecks(installationId);
  return checks.map((c) => ({ locationId: c.locationId, domain: c.domain, status: c.status }));
}

// Email every open critical or warning alert that has not been emailed yet (and is under a week old). Because this reads what is still
// waiting, not just what was raised in this run, a send that failed is retried on the next run, a warning that arrived in quiet hours goes
// out in the morning, and each alert is emailed exactly once (email_notified_at, kept apart from Slack's notified_at).
//
// LEGACY (stage F9): nothing calls this any more. Alerts are now sent by the dispatcher (src/lib/notifications), which has the same rules (quiet hours, critical
// always at once, once per alert, retried) plus preferences, Slack routing and the SEND_EMAIL_LIVE switch. It stays, with its tests, as the written definition
// of the older behaviour; it has no default sender, so it can never send anything by itself.
export async function emailPendingAlerts(installationId: string, settings: Settings, now = new Date(), send: (to: string, m: Mail) => Promise<boolean>): Promise<number> {
  if (!settings.digestEmail || !emailConfigured()) return 0;
  const rows = await sql()`
    select id, severity, title from alerts
    where installation_id = ${installationId} and resolved_at is null and severity <> 'info' and email_notified_at is null and created_at > now() - interval '7 days'
    order by case severity when 'critical' then 0 else 1 end, created_at limit 50`;
  if (rows.length === 0) return 0;
  const [first] = await sql()`select timezone from locations where installation_id = ${installationId} and timezone is not null order by name limit 1`;
  const hour = localParts(now, settings.digestTimezone ?? (first?.timezone as string | null) ?? "UTC")?.hour ?? null;
  const due = alertsToSendNow(rows.map((r) => ({ id: r.id as string, severity: r.severity as string, title: r.title as string })), hour, settings.alertQuietHours);
  if (due.length === 0) return 0;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const stop = unsubscribeUrl(appUrl, installationId, settings.digestEmail);
  const mail = alertEmail(settings.brandName ?? "Your company", due.map((a) => ({ severity: a.severity, title: a.title })), appUrl, stop, settings.brandLogoUrl);
  if (!(await send(settings.digestEmail, { ...mail, headers: unsubscribeHeaders(stop) }))) return 0;
  await sql()`update alerts set email_notified_at = now() where id = any(${due.map((a) => a.id)}::uuid[])`;
  return due.length;
}

// Recompute alerts and today's snapshot, and push newly raised critical/warning alerts to
// Slack if the agency configured a webhook. Returns a small summary.
export async function refreshInsights(installationId: string): Promise<{ accounts: number; openAlerts: number; created: number }> {
  const { settings, accounts } = await loadAccounts(installationId);
  await snapshotMetrics(installationId, accounts, settings.dealRulesRevision);
  // Clean-up: today's data-quality snapshot per account, and an alert for accounts where new likely duplicates appeared. Never stops the refresh.
  const { dailyQualityScan, duplicateAlertDrafts } = await import("./cleanup-scan");
  await dailyQualityScan(installationId).catch(() => undefined);
  const drafts = [...computeAlerts(accounts, await domainStatuses(installationId), settings), ...(await duplicateAlertDrafts(installationId).catch(() => []))];
  const created = await syncAlerts(installationId, drafts);

  // Telling people (the bell, email, Slack) is the dispatcher's job (stage F9): it reads each kind of message's preferences, quiet hours and routing, never
  // sends the same alert twice, retries a failed send, and sends nothing real while the live switches are off. It also works off what is waiting.
  // Loaded when needed: the dispatcher reads the daily digest, which reads this file.
  const { afterRefresh } = await import("../notifications/service");
  await afterRefresh(installationId, created);
  return { accounts: accounts.length, openAlerts: drafts.length, created: created.length };
}

export async function sendDigest(installationId: string, agencyLabel: string): Promise<boolean> {
  const { settings, accounts } = await loadAccounts(installationId);
  if (!settings.slackWebhookUrl) return false;
  const open = await listAlerts(installationId, false, 500);
  return postToSlack(settings.slackWebhookUrl, buildDigest(agencyLabel, accounts, open.length), { installationId, what: "slack.weekly_digest" });
}
