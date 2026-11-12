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
import { sweepPayments } from "./payments-sweep";
import { runDisputeAlerts } from "./payments-alerts";
import { sendMonthlyAudit, sweepAuditHistory } from "./au-sweep";
import { recordToday } from "./today3-queries";
import { runTodayEmail } from "./today3-email";
import { runSaveDigest } from "./cash-email";
import { sweepWallet } from "./wg-queries";
import { runWalletAlerts } from "./wg-alerts";
import { runBriefs } from "./br-queries";
import { sweepDeals, sweepRecover } from "./cash-queries";
import { runPeopleAlerts } from "./people-alerts";
import { accountReceipt } from "./moat-queries";
import { mondayOf, weeklyDue, weeklyProofText } from "./moat-core";
import { autoPrepare } from "./proof-queries";
import { getSettings } from "./queries";
import { recordSnapshot } from "./finance-queries";

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
      const pmr = (ent.features.pm_module && !ent.locked.includes("pm_module")) || (ent.features.pm_disputes && !ent.locked.includes("pm_disputes"));
      const cfr = ent.features.cf_record && !ent.locked.includes("cf_record");
      const cfe = ent.features.cf_email && !ent.locked.includes("cf_email");
      const wgr = ent.features.wg_record && !ent.locked.includes("wg_record");
      const wga = ent.features.wg_alerts && !ent.locked.includes("wg_alerts");
      const bre = ent.features.br_email && !ent.locked.includes("br_email");
      const pra = ent.features.pr_auto && ent.features.pr_report && !ent.locked.includes("pr_auto") && !ent.locked.includes("pr_report");
      const fnr = ent.features.fn_mrr && ent.features.fn_module && !ent.locked.includes("fn_mrr") && !ent.locked.includes("fn_module");
      if (!rec && !mail && !apr && !plr && !clr && !clb && !ppr && !ppi && !auh && !aum && !tdr && !tde && !cfr && !cfe && !pmr && !wgr && !wga && !bre && !pra && !fnr) continue;
      rep.companies++;
      if (apr) rep.events += Object.values(await sweepAppointmentHistory(installationId)).reduce((x, y) => x + y, 0);
      if (plr) rep.events += Object.values(await sweepDealHistory(installationId)).reduce((x, y) => x + y, 0);
      if (clr) await refreshClientRollup(installationId);
      if (ppr) await sweepPeople(installationId, now).catch((e) => console.error("Team sweep failed", safeError(e)));
      if (ent.features.cl_billing && !ent.locked.includes("cl_billing")) await refreshClientBilling(installationId).catch((e) => console.error("Billing refresh failed", safeError(e)));
      if (ent.features.pm_disputes && !ent.locked.includes("pm_disputes")) await runDisputeAlerts(installationId, now).catch((e) => console.error("Dispute alerts failed", safeError(e)));
      if (pmr) rep.events += (await sweepPayments(installationId, now).catch((e) => { console.error("Payments sweep failed", safeError(e)); return { events: 0 }; })).events;
      if (auh) rep.events += await sweepAuditHistory(installationId, now).catch((e) => { console.error("Audit history sweep failed", safeError(e)); return 0; });
      if (aum) await sendMonthlyAudit(installationId, now).catch((e) => console.error("Monthly audit failed", safeError(e)));
      if (tdr) rep.events += await recordToday(installationId, now).catch((e) => { console.error("Today record failed", safeError(e)); return 0; });
      if (cfr) {
        await sweepRecover(installationId, { force: true }).catch((e) => console.error("Recover sweep failed", safeError(e)));
        await sweepDeals(installationId, { force: true }).catch((e) => console.error("Deals sweep failed", safeError(e)));
      }
      if (cfe) await runSaveDigest(installationId, now).catch((e) => console.error("Save digest failed", safeError(e)));
      // Wallet guard: keep our own record of each credit balance and work out burn, days left and spikes (wg_record); alerts for low, empty and spikes (wg_alerts, they need the record).
      if (wgr || wga) await sweepWallet(installationId, now).catch((e) => console.error("Wallet sweep failed", safeError(e)));
      if (wga) await runWalletAlerts(installationId, now).catch((e) => console.error("Wallet alerts failed", safeError(e)));
      // The 7 am brief, at each person's own hour of their own day (br_email). One per person per day; email stays a dry run until the live switch is on.
      if (bre) {
        const on = (k: string) => ent.features[k as keyof typeof ent.features] === true && !ent.locked.includes(k);
        await runBriefs(installationId, { cf_save: on("cf_save"), cf_recover: on("cf_recover"), cf_deals: on("cf_deals"), wg_wallet: on("wg_wallet"), pm_module: on("pm_module"), td_today: on("td_today"), fn_today: on("fn_today") }, now).catch((e) => console.error("Brief failed", safeError(e)));
      }
      if (tde) await runTodayEmail(installationId, now).catch((e) => console.error("Today email failed", safeError(e)));
      if (rec) rep.events += Object.values(await sweepMoatEvents(installationId)).reduce((a, b) => a + b, 0);
      if (ppi) await runPeopleAlerts(installationId, now).catch((e) => console.error("Team alerts failed for one company", safeError(e)));
      // Finance: one money record per client account per day (plan, payment status, monthly price). Our own history: the platform only shows "now". Idempotent (the same day is rewritten).
      if (fnr) rep.events += await recordSnapshot(installationId, now).catch((e) => { console.error("Money record failed", safeError(e)); return 0; });
      if (pra) {
        // The first days of a month: a draft report for last month for every client account that has none. It is only a draft; nothing goes to a client until the owner shares it.
        const st = await getSettings(installationId);
        await autoPrepare(installationId, { countAutomated: st.countAutomatedTouches, defaultTarget: st.speedTargetMinutes, businessHours: st.speedBusinessHours }, new Date(now)).catch((e) => console.error("Monthly draft failed", safeError(e)));
      }
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
