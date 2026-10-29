import { sql } from "../db";
import { postToSlack } from "../notify";
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
  return { accounts: accounts.length, openAlerts: drafts.length, created: created.length };
}

export async function sendDigest(installationId: string, agencyLabel: string): Promise<boolean> {
  const { settings, accounts } = await loadAccounts(installationId);
  if (!settings.slackWebhookUrl) return false;
  const open = await listAlerts(installationId, false, 500);
  return postToSlack(settings.slackWebhookUrl, buildDigest(agencyLabel, accounts, open.length));
}
