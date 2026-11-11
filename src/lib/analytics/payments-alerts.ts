import { sql } from "../db";
import { dispatchIntents, loadContext } from "../notifications/service";
import type { Intent } from "../notifications/dispatcher";
import { createPrivateAlert, type PrivateAlertInput } from "./inbox-breach-alerts";
import { daysUntil, fmtMoney, stageFor, todayIn, type Stage } from "./payments-logic";

// Dispute due-date alerts (flag pm_disputes), checked by the hourly job. The platform has no dispute data, so these come from the log the person keeps: 3 days before, 1 day before, on the day, and
// once a day while it is overdue. They go through the SAME alert engine as every other alert (createPrivateAlert, then the notification dispatcher): deduped (one per dispute and stage), held in
// quiet hours, in the bell and in the daily brief, and email stays in dry run until the live switch is on. They go to the person who wrote the dispute down. Nothing is sent to a customer.

export const DISPUTE_ALERTS_PER_RUN = 20;
const WORDS: Record<Stage, string> = { three_days: "is due in 3 days", one_day: "is due tomorrow", today: "is due today", overdue: "is overdue" };

export async function runDisputeAlerts(installationId: string, now: number): Promise<number> {
  const rows = await sql()`select d.id, d.location_id, d.customer, d.amount, d.currency, d.status, d.evidence_due_on::text due, d.created_by, coalesce(nullif(l.name, ''), 'A client account') account, l.timezone
    from pm_disputes d join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id
    where d.installation_id = ${installationId} and d.status = 'open' and d.evidence_due_on is not null and d.created_by is not null and d.evidence_due_on <= (now() + interval '4 days')::date`;
  const created: Array<{ id: string; input: PrivateAlertInput }> = [];
  for (const r of rows) {
    if (created.length >= DISPUTE_ALERTS_PER_RUN) break;
    const today = todayIn((r.timezone as string | null) ?? null, now), left = daysUntil((r.due as string | null) ?? null, today), stage = stageFor(r.status as string, left);
    if (!stage) continue;
    const dedupeKey = stage === "overdue" ? `pm-dispute:${r.id}:overdue:${today}` : `pm-dispute:${r.id}:${stage}`;
    const [seen] = await sql()`select 1 from alerts where installation_id = ${installationId} and dedupe_key = ${dedupeKey} limit 1`;
    if (seen) continue;
    const amount = r.amount === null ? "" : ` (${fmtMoney(Number(r.amount), r.currency as string | null)})`;
    const input: PrivateAlertInput = { locationId: r.location_id as string, recipientUserKey: r.created_by as string, accountName: r.account as string, kind: "pm_dispute_due", dedupeKey, title: `The evidence for the payment dispute from ${r.customer as string}${amount} ${WORDS[stage]}`, detail: { disputeId: r.id, stage, due: r.due } };
    const id = await createPrivateAlert(installationId, input, now);
    if (id) created.push({ id, input });
  }
  if (created.length) {
    const loaded = await loadContext(installationId);
    const intents: Intent[] = created.map(({ id, input }) => ({
      type: "other_alerts", locationId: input.locationId, severity: "warning", recipientUserKey: input.recipientUserKey, respectQuietHours: true, emailDryRunOnly: true,
      dedupeKey: `alert:${id}`, alertId: id, values: { account: input.accountName ?? "A client account", problem: input.title }, link: { view: "payments", locationId: input.locationId },
    }));
    await dispatchIntents(installationId, intents, now, loaded);
  }
  return created.length;
}
