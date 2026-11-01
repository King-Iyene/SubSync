import { sql } from "../db";
import { postToSlack } from "../notify";
import { emailConfigured, sendEmail, unsubscribeHeaders } from "../email";
import { unsubscribeUrl } from "../unsubscribe";
import { localParts } from "./digest-intel";
import { alertEmail, alertsToSendNow } from "./weekly-email";
import { buildDigest, computeAlerts, deriveAccount, type DerivedAccount, type DomainStatus } from "./derive";
import {
  accountRows, getSettings, listAlerts, listDomainChecks, markNotified, scoreHistory, syncAlerts, type Settings,
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
export async function snapshotMetrics(installationId: string, accounts: DerivedAccount[]): Promise<void> {
  const db = sql();
  for (const a of accounts) {
    await db`
      insert into account_metrics_daily
        (installation_id, location_id, day, contacts, new_contacts_30d, open_opportunities, open_value,
         stale_opportunities, unread_conversations, completeness_pct, engagement_score, days_inactive)
      values
        (${installationId}, ${a.locationId}, current_date, ${a.contacts}, ${a.new30d}, ${a.openOpps}, ${a.openValue},
         ${a.staleOpps}, ${a.unread}, ${a.completenessPct}, ${a.score}, ${a.daysInactive})
      on conflict (installation_id, location_id, day) do update set
        contacts = excluded.contacts, new_contacts_30d = excluded.new_contacts_30d,
        open_opportunities = excluded.open_opportunities, open_value = excluded.open_value,
        stale_opportunities = excluded.stale_opportunities, unread_conversations = excluded.unread_conversations,
        completeness_pct = excluded.completeness_pct, engagement_score = excluded.engagement_score,
        days_inactive = excluded.days_inactive`;
  }
}

export async function domainStatuses(installationId: string): Promise<DomainStatus[]> {
  const checks = await listDomainChecks(installationId);
  return checks.map((c) => ({ locationId: c.locationId, domain: c.domain, status: c.status }));
}

// Email every open critical or warning alert that has not been emailed yet (and is under a week old). Because this reads what is still
// waiting, not just what was raised in this run, a send that failed is retried on the next run, a warning that arrived in quiet hours goes
// out in the morning, and each alert is emailed exactly once (email_notified_at, kept apart from Slack's notified_at).
export async function emailPendingAlerts(installationId: string, settings: Settings, now = new Date(), send: typeof sendEmail = sendEmail): Promise<number> {
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
  const mail = alertEmail(settings.brandName ?? "Your company", due.map((a) => ({ severity: a.severity, title: a.title })), appUrl, stop);
  if (!(await send(settings.digestEmail, { ...mail, headers: unsubscribeHeaders(stop) }))) return 0;
  await sql()`update alerts set email_notified_at = now() where id = any(${due.map((a) => a.id)}::uuid[])`;
  return due.length;
}

// Recompute alerts and today's snapshot, and push newly raised critical/warning alerts to
// Slack if the agency configured a webhook. Returns a small summary.
export async function refreshInsights(installationId: string): Promise<{ accounts: number; openAlerts: number; created: number }> {
  const { settings, accounts } = await loadAccounts(installationId);
  await snapshotMetrics(installationId, accounts);
  const drafts = computeAlerts(accounts, await domainStatuses(installationId), settings);
  const created = await syncAlerts(installationId, drafts);

  const worth = created.filter((a) => a.severity !== "info");
  if (worth.length > 0 && settings.slackWebhookUrl) {
    const lines = worth.slice(0, 10).map((a) => `• ${a.severity === "critical" ? ":red_circle:" : ":large_orange_circle:"} ${a.title}`);
    const more = worth.length > 10 ? `\n…and ${worth.length - 10} more` : "";
    if (await postToSlack(settings.slackWebhookUrl, `*SubSync alerts*\n${lines.join("\n")}${more}`)) {
      await markNotified(worth.map((a) => a.id));
    }
  }
  await emailPendingAlerts(installationId, settings);
  return { accounts: accounts.length, openAlerts: drafts.length, created: created.length };
}

export async function sendDigest(installationId: string, agencyLabel: string): Promise<boolean> {
  const { settings, accounts } = await loadAccounts(installationId);
  if (!settings.slackWebhookUrl) return false;
  const open = await listAlerts(installationId, false, 500);
  return postToSlack(settings.slackWebhookUrl, buildDigest(agencyLabel, accounts, open.length));
}
