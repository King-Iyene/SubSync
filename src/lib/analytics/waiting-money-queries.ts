import { sql } from "../db";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";
import { summariseWaitingMoney, type CountedDeal, type WaitingMoney } from "./waiting-money";

// The read behind the counted money line (pure parts in waiting-money.ts).
/** Counted open deals of the given people (`account:contact` keys), read with the shared counted-deal rule. Read only. */
export async function countedDealsOf(installationId: string, keys: readonly string[]): Promise<CountedDeal[]> {
  const byLoc = new Map<string, string[]>();
  for (const k of new Set(keys)) { const i = k.indexOf(":"); if (i > 0) byLoc.set(k.slice(0, i), [...(byLoc.get(k.slice(0, i)) ?? []), k.slice(i + 1)]); }
  const out: CountedDeal[] = [];
  for (const [locationId, contacts] of byLoc) {
    for (let i = 0; i < contacts.length; i += 5_000) {
      const rows = await sql()`
        select o.opportunity_id, o.location_id, o.contact_id, o.monetary_value::float8 v
        from cached_opportunities o ${dealScopeJoins()}
        where o.installation_id = ${installationId} and o.location_id = ${locationId} and o.status = 'open' and o.contact_id = any(${contacts.slice(i, i + 5_000)}::text[]) and ${countedInScope()}`;
      for (const r of rows) out.push({ opportunityId: r.opportunity_id as string, locationId: r.location_id as string, contactId: r.contact_id as string, value: r.v as number });
    }
  }
  return out;
}

/** The whole read: the waiting people's counted deals, summarised. Null when the read fails (the screen then shows only the next best action). */
export async function waitingMoney(installationId: string, keys: readonly string[]): Promise<WaitingMoney | null> {
  try { return summariseWaitingMoney(keys, await countedDealsOf(installationId, keys)); } catch { return null; }
}
