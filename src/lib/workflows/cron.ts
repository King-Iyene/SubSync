import { sql } from "../db";
import { dispatchAlerts } from "../notifications/service";
import { resolveEntitlements } from "../flags";
import { outward } from "../live-flags";
import { unsubscribeUrl } from "../unsubscribe";
import { getSettings } from "../analytics/queries";
import { locationAccessToken } from "../sync/engine";
import { parseGranted } from "../scope-groups";
import { applyMarks, proofOf } from "./detail";
import { failingIds } from "./reports";
import { dueToday, proofEmail } from "./proof-email";
import { currentFindings, raiseAlerts, syncAccount } from "./sync";
import { gapDraftsFor } from "./outcomes-run";
import { recordOutcomes } from "./outcomes-db";
import { accountNames, loadItems, loadLabels, loadWorkflowAlerts, recordDaily } from "./store";

// The scheduled refresh (hourly) and the weekly Proof email. Per company: read each client account's workflows and campaigns (a few per run, the least recently
// read first), raise this module's alerts through the same dispatcher as every other alert, keep the daily record, and on Monday morning send the Proof.
// Read only. The Proof email is composed and rehearsed only: it is written to the log as "WOULD SEND" and never sent from here, because only the notification dispatcher may send.
export const PER_RUN_ACCOUNTS = 8;
export const MAX_COMPANIES = 60;

export type CronReport = { companies: number; accounts: number; alerts: number; proofs: number };

export async function runWorkflowsCron(now = new Date()): Promise<CronReport> {
  const rep: CronReport = { companies: 0, accounts: 0, alerts: 0, proofs: 0 };
  let rows;
  try {
    rows = await sql()`select id, company_id, plan, scope from installations where uninstalled_at is null and not is_demo order by id limit ${MAX_COMPANIES}`;
  } catch { return rep; }
  for (const inst of rows) {
    const installationId = inst.id as string, companyKey = inst.company_id as string;
    const ent = await resolveEntitlements((inst.plan as never) ?? "pro", installationId).catch(() => null);
    // Off by default, and the health part is the paid plan's.
    if (!ent || ent.features.workflows === false || ent.features.workflows_pro === false || ent.locked.includes("workflows_pro")) continue;
    rep.companies++;
    const granted = typeof inst.scope === "string" && inst.scope.trim() ? parseGranted(inst.scope as string) : null;
    const accounts = (await accountNames(installationId, null)).filter((a) => !a.ignored);
    const seen = await sql()`select location_id, max(last_seen_at) at from workflow_items where installation_id = ${installationId} group by 1`.catch(() => []);
    const when = new Map(seen.map((r) => [r.location_id as string, (r.at as Date).getTime()]));
    const order = [...accounts].sort((a, b) => (when.get(a.locationId) ?? 0) - (when.get(b.locationId) ?? 0)).slice(0, PER_RUN_ACCOUNTS);
    for (const a of order) {
      await syncAccount({ installationId, locationId: a.locationId, granted, now: now.getTime(), token: () => locationAccessToken(companyKey, a.locationId) }).catch(() => null);
      rep.accounts++;
    }
    const { findings } = await currentFindings(installationId, null, now.getTime());
    const labels = await loadLabels(installationId, null);
    const { open } = applyMarks(findings, new Map([...labels].map(([k, v]) => [k, { fixedAt: v.fixedAt, snoozedUntil: v.snoozedUntil }])), now.getTime());
    // Outcome gaps (second pass): our daily record is kept whenever the flag is on; the alerts only when the Today feed is on too, so a switched-off feed also clears its alerts.
    let gapDrafts: Awaited<ReturnType<typeof gapDraftsFor>>["drafts"] = [];
    if (ent.features.wf_outcomes === true) {
      const g = await gapDraftsFor(installationId, now.getTime()).catch(() => null);
      if (g) {
        await recordOutcomes(installationId, g.rows.map((r) => ({ locationId: r.locationId, counts: r.counts })), now.toISOString().slice(0, 10)).catch(() => null);
        if (ent.features.wf_today === true) gapDrafts = g.drafts;
      }
    }
    const created = await raiseAlerts(installationId, open, gapDrafts);
    if (created.length) { rep.alerts += created.length; await dispatchAlerts(installationId, created).catch(() => null); }
    const { items } = await loadItems(installationId, null);
    await recordDaily(installationId, items, failingIds(open), now.toISOString().slice(0, 10));
    if (await sendProof(installationId, now)) rep.proofs++;
  }
  return rep;
}

async function sendProof(installationId: string, now: Date): Promise<boolean> {
  const [s] = await sql()`select digest_email, digest_enabled, digest_timezone, brand_name from settings where installation_id = ${installationId}`.catch(() => []);
  if (!s?.digest_email || s.digest_enabled === false) return false;
  const [last] = await sql()`select filters from saved_views where installation_id = ${installationId} and owner = 'system' and page = 'workflows_proof' and name = 'sent'`.catch(() => []);
  const [first] = await sql()`select timezone from locations where installation_id = ${installationId} and timezone is not null order by name limit 1`.catch(() => []);
  const zone = (s.digest_timezone as string | null) ?? (first?.timezone as string | null) ?? "UTC";
  const due = dueToday(now, zone, ((last?.filters ?? {}) as { day?: string }).day ?? null);
  if (!due.due) return false;
  const alerts = await loadWorkflowAlerts(installationId, null, now.getTime() - 7 * 86_400_000);
  if (alerts.length === 0) return false;
  const p = proofOf(alerts, now.getTime(), 7);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const stop = unsubscribeUrl(appUrl, installationId, s.digest_email as string);
  const mail = proofEmail({ brand: (s.brand_name as string | null) ?? "Your workflows", caught: p.raised.length, cleared: p.cleared.length, open: p.open.length, openTitles: p.open.map((a) => a.title), crmDomain: (await getSettings(installationId)).appDomain, stopUrl: stop });
  const done = await outward({ flag: "SEND_EMAIL_LIVE", verb: "SEND", what: "workflows.proof.email", installationId }, async () => false /* Sending needs its own notification type in the dispatcher (the one place allowed to send). Until then this is a rehearsal even with the live switch on. */);
  // Marked sent even as a dry run, so a rehearsal is not repeated every hour of the morning.
  await sql()`insert into saved_views (installation_id, owner, page, name, filters) values (${installationId}, 'system', 'workflows_proof', 'sent', ${sql().json({ day: due.day } as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`.catch(() => null);
  void mail;
  return done.live ? done.result : true;
}
