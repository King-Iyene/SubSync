import { sql } from "../db";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";

// The database side of the Clients book. Read only. Every function takes the client accounts the caller may see (`ids`, decided by the router from the signed session);
// nothing here reads outside them.

export type DealMoney = { pipeline30: number; dealsStarted30: number; won30: number; wonCount30: number };
const DAY = 86_400_000;

/**
 * What each client's deals did in the last 30 days, counted by the rule every page uses (client-success.ts `dealFigures`): a deal counts when it has a value above zero and an
 * owner, and an open deal also has to be in play (not in a closed-out stage or an unused pipeline). `pipeline30` is the value of the deals that started in the window,
 * `won30` the value of those won in it. One query for every client, so a client list does not read the deals once per row. tests/unit/clients-v2-db.test.ts holds it equal to
 * `dealFigures` over `loadDeals` on a fixture.
 */
export async function countedDealMoney(installationId: string, ids: string[], now: number): Promise<Map<string, DealMoney>> {
  const out = new Map<string, DealMoney>();
  if (ids.length === 0) return out;
  const db = sql();
  const from = new Date(now - 30 * DAY);
  const to = new Date(now);
  const rows = await db`
    select o.location_id,
      coalesce(sum(o.monetary_value) filter (where o.created_remote_at >= ${from} and o.created_remote_at < ${to}), 0)::float8 pipeline,
      (count(*) filter (where o.created_remote_at >= ${from} and o.created_remote_at < ${to}))::int started,
      coalesce(sum(o.monetary_value) filter (where o.status = 'won' and o.last_status_change_at >= ${from} and o.last_status_change_at < ${to}), 0)::float8 won,
      (count(*) filter (where o.status = 'won' and o.last_status_change_at >= ${from} and o.last_status_change_at < ${to}))::int won_n
    from cached_opportunities o
    join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
    ${dealScopeJoins()}
    where o.installation_id = ${installationId} and o.location_id = any(${ids}::text[])
      and (o.status <> 'open' or ${countedInScope()})
      and coalesce(o.monetary_value, 0) > 0 and coalesce(o.assigned_to, '') <> ''
    group by o.location_id`;
  for (const r of rows) out.set(r.location_id as string, { pipeline30: r.pipeline as number, dealsStarted30: r.started as number, won30: r.won as number, wonCount30: r.won_n as number });
  return out;
}

/** The profile of each client the agency typed (fee, renewal, industry) and when it was added, for the clients the caller may see. */
export async function profilesOf(installationId: string, ids: string[]) {
  const out = new Map<string, { installedAt: number | null; monthlyFee: number | null; renewalDate: string | null; industry: string | null; lastContactedAt: number | null }>();
  if (ids.length === 0) return out;
  const db = sql();
  const rows = await db`
    select l.location_id, l.installed_at, ap.monthly_fee::float8 monthly_fee, ap.renewal_date::text renewal_date, ap.industry, ap.last_contacted_at
    from locations l left join account_profiles ap on ap.installation_id = l.installation_id and ap.location_id = l.location_id
    where l.installation_id = ${installationId} and l.location_id = any(${ids}::text[]) and not l.ignored`;
  for (const r of rows) {
    out.set(r.location_id as string, {
      installedAt: r.installed_at instanceof Date ? r.installed_at.getTime() : null, monthlyFee: (r.monthly_fee as number | null) ?? null, renewalDate: (r.renewal_date as string | null) ?? null,
      industry: (r.industry as string | null) ?? null, lastContactedAt: r.last_contacted_at instanceof Date ? r.last_contacted_at.getTime() : null,
    });
  }
  return out;
}
