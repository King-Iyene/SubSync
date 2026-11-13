import { sql } from "../db";
import { step } from "./fill-core";
import { sweepAppointmentHistory } from "../analytics/appointments3-record";
import { refreshStageStats, sweepDealHistory } from "../analytics/pipeline3-record";
import { refreshClientRollup } from "../analytics/clients3-queries";
import { refreshUserRollup, snapshotWorkload } from "../analytics/people3-rollup";
import { rebuildSpeedDaily } from "../analytics/touch-events-db";
import { sweepMoatEvents } from "../analytics/moat-record";
import { recordSnapshot } from "../analytics/finance-queries";
import { sweepAuditHistory } from "../analytics/au-sweep";
import { recordToday } from "../analytics/today3-queries";
import { sweepDeals, sweepRecover } from "../analytics/cash-queries";
import { sweepWallet } from "../analytics/wg-queries";
import { refreshInsights } from "../analytics/service";

// The stored totals and records the screens read, rebuilt from the demo's own rows by the SAME functions the hourly job uses on a real install. Only database work: none of these
// reads a CRM (the ones that do, such as the team list, the plans and the payments reads, are not called here; fill-money.ts and fill-core.ts write those rows directly).
export async function rebuildDerived(inst: string): Promise<void> {
  const now = Date.now(), year = 24 * 400;
  const [st] = await sql()`select coalesce(speed_target_minutes, 5) m from settings where installation_id = ${inst}`;
  await step("account insights", () => refreshInsights(inst));
  await step("appointment history", () => sweepAppointmentHistory(inst, year));
  await step("deal history", () => sweepDealHistory(inst, year));
  await step("stage stats", () => refreshStageStats(inst));
  await step("client rollup", () => refreshClientRollup(inst, now));
  await step("people rollup", async () => { await refreshUserRollup(inst, 120, now); await snapshotWorkload(inst); });
  await step("speed rollup", () => rebuildSpeedDaily(inst, Number(st?.m ?? 5), 35, now));
  await step("moat events", () => sweepMoatEvents(inst, year));
  await step("wallet", () => sweepWallet(inst, now));
  await step("money record", () => recordSnapshot(inst, now));
  await step("audit history", () => sweepAuditHistory(inst, now));
  await step("today record", () => recordToday(inst, now));
  await step("save recover", () => sweepRecover(inst, { force: true }));
  await step("save deals", () => sweepDeals(inst, { force: true }));
}
