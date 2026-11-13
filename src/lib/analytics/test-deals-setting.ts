import { sql } from "../db";
import { TEST_NAME_PATTERN } from "./deal-trust";
import { dealScopeJoins, outOfScope } from "./stage-rules-sql";

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

// The company's second switch: open deals with a value but no owner. Default OFF (an ownerless deal has nobody answering for it, so it stays out of the money and is said out loud).
export async function loadCountOwnerlessDeals(inst: string): Promise<boolean> {
  try { const r = await sql()`select count_ownerless_deals from settings where installation_id = ${inst}`; return r[0]?.count_ownerless_deals === true; } catch { return false; }
}

/** What the switch would change right now: how many open deals with a value and no owner there are, and their money (test-named and closed-out deals are not part of it). Null when it cannot be read. */
export async function ownerlessPreview(inst: string, allowed: string[] | null): Promise<{ deals: number; dollars: number } | null> {
  try {
    const db = sql();
    const [r] = await db`
      select count(*)::int n, coalesce(sum(o.monetary_value), 0)::float8 v
      from cached_opportunities o join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
      ${dealScopeJoins()}
      where o.installation_id = ${inst} and o.status = 'open' and coalesce(o.monetary_value, 0) > 0 and o.assigned_to is null and not ${outOfScope()}
        and not (coalesce(o.name, '') ~* ${TEST_NAME_PATTERN} or coalesce(o.contact_name, '') ~* ${TEST_NAME_PATTERN}) ${allowed ? db`and o.location_id = any(${allowed}::text[])` : db``}`;
    return { deals: Number(r?.n ?? 0), dollars: Math.round(Number(r?.v ?? 0)) };
  } catch { return null; }
}

/** Saves the switch, rebuilds the stored pipeline totals (drawn under the old rule) and moves the deal-rules revision so history is not mixed across the change. */
export async function saveCountOwnerlessDeals(inst: string, on: boolean): Promise<boolean> {
  try {
    await sql().begin(async (tx) => {
      const [cur] = await tx`select count_ownerless_deals from settings where installation_id = ${inst}`;
      await tx`insert into settings (installation_id, count_ownerless_deals) values (${inst}, ${on})
        on conflict (installation_id) do update set count_ownerless_deals = excluded.count_ownerless_deals`;
      if ((cur?.count_ownerless_deals === true) !== on) {
        await tx`update settings set deal_rules_revision = deal_rules_revision + 1 where installation_id = ${inst}`;
        await tx`delete from pipeline_rollup_state where installation_id = ${inst}`;
      }
    });
    return true;
  } catch (e) { if (isMissing(e)) return false; throw e; }
}
