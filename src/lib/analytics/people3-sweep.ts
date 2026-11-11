import { sql } from "../db";
import { refreshTeamIdentity } from "./people3-identity";
import { refreshUserRollup, snapshotWorkload } from "./people3-rollup";

// The hourly Team sweep (flag pp_rollup): who the people are, the per-person daily rows, and today's workload snapshot. Idempotent: running it twice writes the same rows.
// The recent 14 days are recomputed every hour (an outcome marked days late, an owner change); the full 120 days on the first run and once a day at 03:00 UTC.
export type PeopleSweepReport = { people: number; rows: number; snapshots: number };

export async function sweepPeople(inst: string, now = Date.now()): Promise<PeopleSweepReport> {
  const id = await refreshTeamIdentity(inst);
  const have = await sql()`select 1 from user_rollup_state where installation_id = ${inst} limit 1`.catch(() => []);
  const days = !have.length || new Date(now).getUTCHours() === 3 ? 120 : 14;
  const rows = await refreshUserRollup(inst, days, now);
  const snapshots = await snapshotWorkload(inst);
  return { people: id.fromCompany + id.fromActivity, rows, snapshots };
}
