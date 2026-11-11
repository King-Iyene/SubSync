import { sql } from "../db";
import { resolveEntitlements } from "../flags";
import { safeError } from "../safe-log";
import { createPrivateAlert, sendOperationalAlerts, type PrivateAlertInput } from "./inbox-breach-alerts";
import { sweepMoatEvents } from "./moat-record";
import { sweepAppointmentHistory } from "./appointments3-record";
import { sweepDealHistory } from "./pipeline3-record";
import { refreshClientRollup } from "./clients3-queries";
import { refreshClientBilling } from "./clients3-billing";
import { sweepPeople } from "./people3-sweep";
import { sendMonthlyAudit, sweepAuditHistory } from "./au-sweep";
import { recordToday } from "./today3-queries";
import { runTodayEmail } from "./today3-email";
import { runPeopleAlerts } from "./people-alerts";
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
      const apr = ent.features.appt_record && !ent.locked.includes("appt_record");
      const plr = ent.features.pl_record && !ent.locked.includes("pl_record");
      const clr = ent.features.cl_rollup && !ent.locked.includes("cl_rollup");
      const clb = ent.features.cl_billing && !ent.locked.includes("cl_billing");
      const ppr = ent.features.pp_rollup && !ent.locked.includes("pp_rollup");
      const ppi = ent.features.pp_idle && !ent.locked.includes("pp_idle");
      const auh = ent.features.au_history && !ent.locked.includes("au_history");
      const aum = ent.features.au_monthly && !ent.locked.includes("au_monthly");
      const tdr = ent.features.td_record && !ent.locked.includes("td_record");
      const tde = ent.features.td_email && !ent.locked.includes("td_email");
      if (!rec && !mail && !apr && !plr && !clr && !clb && !ppr && !ppi && !auh && !aum && !tdr && !tde) continue;
      rep.companies++;
      if (apr) rep.events += Object.values(await sweepAppointmentHistory(installationId)).reduce((x, y) => x + y, 0);
      if (plr) rep.events += Object.values(await sweepDealHistory(installationId)).reduce((x, y) => x + y, 0);
      if (clr) await refreshClientRollup(installationId);
      if (ppr) await sweepPeople(installationId, now).catch((e) => console.error("Team sweep failed", safeError(e)));
      if (ent.features.cl_billing && !ent.locked.includes("cl_billing")) await refreshClientBilling(installationId).catch((e) => console.error("Billing refresh failed", safeError(e)));
      if (auh) rep.events += await sweepAuditHistory(installationId, now).catch((e) => { console.error("Audit history sweep failed", safeError(e)); return 0; });
      if (aum) await sendMonthlyAudit(installationId, now).catch((e) => console.error("Monthly audit failed", safeError(e)));
      if (tdr) rep.events += await recordToday(installationId, now).catch((e) => { console.error("Today record failed", safeError(e)); return 0; });
      if (tde) await runTodayEmail(installationId, now).catch((e) => console.error("Today email failed", safeError(e)));
      if (rec) rep.events += Object.values(await sweepMoatEvents(installationId)).reduce((a, b) => a + b, 0);
      if (ppi) await runPeopleAlerts(installationId, now).catch((e) => console.error("Team alerts failed for one company", safeError(e)));
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
