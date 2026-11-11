import { sql } from "../db";
import { resolveEntitlements } from "../flags";
import { safeError } from "../safe-log";
import { createPrivateAlert, sendOperationalAlerts, type PrivateAlertInput } from "./inbox-breach-alerts";
import { sweepMoatEvents } from "./moat-record";
import { accountReceipt } from "./moat-queries";
import { mondayOf, weeklyDue, weeklyProofText } from "./moat-core";

// Hourly: (1) D1 keeps the raw record current (flag moat_record), (2) E3 on Monday morning (UTC 08:00 to 09:59) writes one weekly proof receipt per client account to its
// account admin through the notification dispatcher, EMAIL IN DRY-RUN ONLY (the gated transport writes "would send" and sends nothing until the live switch is on).
// The dedupe key holds the week's Monday, so the hourly run cannot send a second one.

export type MoatCronReport = { companies: number; events: number; receipts: number; failures: number };

export async function runMoatCron(now = Date.now()): Promise<MoatCronReport> {
  const rep: MoatCronReport = { companies: 0, events: 0, receipts: 0, failures: 0 };
  const rows = await sql()`select id, plan from installations where uninstalled_at is null and not is_demo order by id`;
  for (const row of rows) {
    const installationId = row.id as string;
    try {
      const ent = await resolveEntitlements((row.plan as "free" | "starter" | "pro") ?? "pro", installationId);
      const rec = ent.features.moat_record && !ent.locked.includes("moat_record");
      const mail = ent.features.inbox_proof_email && !ent.locked.includes("inbox_proof_email");
      if (!rec && !mail) continue;
      rep.companies++;
      if (rec) rep.events += Object.values(await sweepMoatEvents(installationId)).reduce((a, b) => a + b, 0);
      if (mail && weeklyDue(now)) rep.receipts += await weeklyProofReceipts(installationId, now);
    } catch (error) {
      rep.failures++;
      console.error("Moat refresh failed for one company", safeError(error));
    }
  }
  return rep;
}

async function weeklyProofReceipts(installationId: string, now: number): Promise<number> {
  const monday = mondayOf(now);
  const to = new Date(`${monday}T00:00:00Z`);
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const accounts = await sql()`
    select l.location_id, coalesce(l.name, 'A client account') name,
      (select u.user_id from location_users u where u.installation_id = l.installation_id and u.location_id = l.location_id and u.role = 'account_admin' order by u.seen_at desc limit 1) admin_id
    from locations l where l.installation_id = ${installationId} and not l.ignored`;
  const created: Array<{ id: string; input: PrivateAlertInput }> = [];
  for (const a of accounts) {
    if (!a.admin_id) continue;
    const receipt = await accountReceipt(installationId, a.location_id as string, from, to);
    if (!receipt || (!receipt.alerts && !receipt.lateLeads)) continue;
    const input: PrivateAlertInput = {
      locationId: a.location_id as string, recipientUserKey: a.admin_id as string, accountName: a.name as string, kind: "moat_weekly_proof",
      dedupeKey: `moat-weekly-proof:${a.location_id}:${monday}`,
      title: weeklyProofText(a.name as string, receipt),
      detail: { week: monday, alerts: receipt.alerts, saved: receipt.saved, bookedAfter: receipt.bookedAfter, medianReplyMinutes: receipt.medianReplyMinutes, lateLeads: receipt.lateLeads },
    };
    const id = await createPrivateAlert(installationId, input, now);
    if (id) created.push({ id, input });
  }
  await sendOperationalAlerts(installationId, created, now);
  return created.length;
}
