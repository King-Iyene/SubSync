import { sql } from "../db";
import { currentVersion, DEAL_RULE_HISTORY } from "./definitions";

// The database side of definitions.ts: which daily snapshot rows were counted under the rules in force now (N39).

/** The version a snapshot written now would carry, for one installation (the code's rules plus how often the owner changed a stage rule). */
export async function currentSnapshotVersion(installationId: string): Promise<number> {
  const [r] = await sql()`select deal_rules_revision from settings where installation_id = ${installationId}`;
  return currentVersion(typeof r?.deal_rules_revision === "number" ? r.deal_rules_revision : 0);
}

/**
 * A boolean SQL expression: this row of account_metrics_daily was counted under `version`. A row written before the column existed (null) counts
 * as version 2 from 31 Oct 2026 and as version 1 before that, the same reading as rowVersion() in definitions.ts. `alias` is a constant from the
 * calling code, never user input.
 */
export function snapshotOk(alias: string, version: number) {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Bad alias");
  const v2 = DEAL_RULE_HISTORY[1].from;
  return sql().unsafe(`(coalesce(${alias}.definition_version, case when ${alias}.day >= date '${v2}' then 2000 else 1000 end) = ${Math.trunc(Number(version))})`);
}
