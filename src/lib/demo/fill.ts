import { sql } from "../db";
import { agencySettings, appointmentsForAllAccounts, messageHistory, openPermissions, peopleAndCalendars, speedForAllAccounts, step } from "./fill-core";
import { fillMoney } from "./fill-money";
import { fillDeals } from "./fill-deals";
import { fillMeetings } from "./fill-meetings";
import { fillWorkflowsAndAi } from "./fill-more";
import { rebuildDerived } from "./fill-derived";

// Makes every module of the demo company ("demo-agency") show data: see docs/DEMO_SCREENSHOTS.md. Called by ensureDemo (seed.ts) after the older, smaller demo steps. Additive and idempotent
// (every step looks for its own rows first), only ever writes rows of the demo installation, never a CRM. A failing step is logged and skipped; the demo still opens.
// The cheap steps run in the request that signs in (a few seconds, once per server start). The stored totals (rollups) are rebuilt after the demo's dates were moved forward and when they are
// still empty: that takes minutes against a remote database, so a running server does it in the background; `npm run demo:fill` waits for it.
let rebuilding: Promise<void> | null = null;

export async function fillDemo(inst: string, opts: { moved?: boolean; wait?: boolean } = {}): Promise<void> {
  await step("permissions", () => openPermissions(inst));
  await step("settings", () => agencySettings(inst));
  await step("speed records", () => speedForAllAccounts(inst));
  await step("appointments", () => appointmentsForAllAccounts(inst));
  await step("people and calendars", () => peopleAndCalendars(inst));
  await step("message history", () => messageHistory(inst));
  await step("deals", () => fillDeals(inst));
  await step("money", () => fillMoney(inst));
  await step("meetings", () => fillMeetings(inst));
  await step("workflows and AI", () => fillWorkflowsAndAi(inst));
  const [r] = await sql()`select (select count(*) from user_daily where installation_id = ${inst})::int u, (select count(*) from pipeline_rollup where installation_id = ${inst})::int p, (select count(*) from speed_daily where installation_id = ${inst})::int s`;
  const needs = opts.moved === true || process.env.DEMO_FILL_REBUILD === "1" || Number(r?.u) === 0 || Number(r?.p) === 0 || Number(r?.s) === 0;
  if (!needs) return;
  rebuilding ??= rebuildDerived(inst).catch((e) => console.error("[demo fill] rebuild failed:", e instanceof Error ? e.message : String(e))).finally(() => { rebuilding = null; });
  if (opts.wait) await rebuilding;
}
