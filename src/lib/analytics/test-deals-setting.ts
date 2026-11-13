import { sql } from "../db";

// The company's one switch for deals whose name looks like a test. Default OFF, so real accounts stay protected. A missing column (migration not applied yet) reads as OFF, and a write says it is not ready.
const isMissing = (e: unknown) => /column .* does not exist|42703/i.test(String((e as Error)?.message ?? e));

export async function loadCountTestDeals(inst: string): Promise<boolean> {
  try { const r = await sql()`select count_test_deals from settings where installation_id = ${inst}`; return r[0]?.count_test_deals === true; } catch { return false; }
}

/** Saves the switch and makes the stored pipeline totals rebuild (they were drawn under the old rule); the deal-rules revision moves so history is not mixed across the change. */
export async function saveCountTestDeals(inst: string, on: boolean): Promise<boolean> {
  try {
    await sql().begin(async (tx) => {
      const [cur] = await tx`select count_test_deals from settings where installation_id = ${inst}`;
      await tx`insert into settings (installation_id, count_test_deals) values (${inst}, ${on})
        on conflict (installation_id) do update set count_test_deals = excluded.count_test_deals`;
      if ((cur?.count_test_deals === true) !== on) {
        await tx`update settings set deal_rules_revision = deal_rules_revision + 1 where installation_id = ${inst}`;
        await tx`delete from pipeline_rollup_state where installation_id = ${inst}`;
      }
    });
    return true;
  } catch (e) { if (isMissing(e)) return false; throw e; }
}
