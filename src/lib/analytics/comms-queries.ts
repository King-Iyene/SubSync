import { sql } from "../db";
import { afterHoursSummary } from "./comms-intel";
import { inPipelineSql } from "./pipeline-pick";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";

function visible(installationId: string, allowed: string[] | null) {
  const db = sql();
  return db`select location_id, name, timezone from locations where installation_id = ${installationId} and not ignored
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
}

export type GapDeal = {
  opportunityId: string; locationId: string; locationName: string | null; contactName: string | null; name: string | null;
  contactId: string | null; stageName: string; pipelineName: string; value: number; daysSinceContact: number | null;
};

// 4.9: counted open deals (a value, an owner, in play: docs/METRICS.md) whose contact has not been touched (activity or a message) for `days` days
// or more. The total, the dollars and the stage breakdown are counted in the database over every such deal, never over a capped list, so the
// numbers are the real ones; only the rows shown are limited, and the screen says how many there are in all.
export async function communicationGaps(installationId: string, allowed: string[] | null, days = 7, rowLimit = 15, pipeline?: string | null) {
  const db = sql();
  const pipe = inPipelineSql(db, pipeline);
  const from = db`
    from cached_opportunities o join (${visible(installationId, allowed)}) loc on loc.location_id = o.location_id
    ${dealScopeJoins()}
    left join cached_contacts c on c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = o.contact_id
    left join lateral (
      select greatest(c.last_activity_at, (select max(v.last_message_at) from cached_conversations v
        where v.installation_id = o.installation_id and v.location_id = o.location_id and v.contact_id = o.contact_id)) t) touch on true
    where o.installation_id = ${installationId} ${pipe} and o.status = 'open' and ${countedInScope()} and o.contact_id is not null
      and (touch.t is null or touch.t < now() - make_interval(days => ${days}::int))`;
  const [totals, stageRows, rows] = await Promise.all([
    db`select count(*)::int n, coalesce(sum(o.monetary_value), 0)::float8 value ${from}`,
    db`select coalesce(sc_pl.name, 'Pipeline') pipeline_name, coalesce(sc_st.nm, 'Unknown stage') stage_name, count(*)::int n, coalesce(sum(o.monetary_value), 0)::float8 value ${from}
       group by 1, 2 order by value desc limit 10`,
    db`select o.opportunity_id, o.location_id, loc.name location_name, o.contact_id, o.contact_name, o.name,
         coalesce(sc_pl.name, 'Pipeline') pipeline_name, coalesce(sc_st.nm, 'Unknown stage') stage_name, coalesce(o.monetary_value, 0)::float8 value,
         floor(extract(epoch from (now() - touch.t)) / 86400)::int days_since ${from}
       order by o.monetary_value desc nulls last limit ${rowLimit}`,
  ]);
  const deals: GapDeal[] = rows.map((r) => ({
    opportunityId: r.opportunity_id, locationId: r.location_id, locationName: r.location_name, contactId: r.contact_id, contactName: r.contact_name,
    name: r.name, stageName: r.stage_name, pipelineName: r.pipeline_name, value: r.value, daysSinceContact: r.days_since,
  }));
  return {
    days, total: totals[0].n as number, value: totals[0].value as number,
    stages: stageRows.map((r) => ({ stage: `${r.pipeline_name}: ${r.stage_name}`, count: r.n as number, value: r.value as number })),
    deals,
  };
}

// 4.18: how many new contacts arrive outside business hours in the account's own time zone.
export async function afterHours(installationId: string, allowed: string[] | null) {
  const db = sql();
  const [r] = await db`
    with loc as (
      select v.location_id, coalesce(tz.name, 'UTC') tz from (${visible(installationId, allowed)}) v
      left join pg_timezone_names tz on tz.name = v.timezone),
    won as (
      select location_id, contact_id, sum(monetary_value) value from cached_opportunities
      where installation_id = ${installationId} and status = 'won' and contact_id is not null group by location_id, contact_id),
    x as (
      select c.location_id, c.contact_id,
        extract(isodow from c.date_added at time zone loc.tz) in (6, 7) weekend,
        (extract(isodow from c.date_added at time zone loc.tz) in (6, 7)
          or extract(hour from c.date_added at time zone loc.tz) < 9 or extract(hour from c.date_added at time zone loc.tz) >= 17) after_hours
      from cached_contacts c join loc on loc.location_id = c.location_id
      where c.installation_id = ${installationId} and c.date_added > now() - interval '90 days')
    select count(*)::int leads,
      count(*) filter (where x.after_hours)::int after_hours,
      count(*) filter (where x.weekend)::int weekend,
      coalesce(sum(w.value) filter (where x.after_hours), 0)::float8 won_value,
      count(w.contact_id) filter (where x.after_hours)::int won_count
    from x left join won w on w.location_id = x.location_id and w.contact_id = x.contact_id`;
  return afterHoursSummary({ leads: r.leads, afterHours: r.after_hours, weekend: r.weekend, afterHoursWonValue: r.won_value, afterHoursWonCount: r.won_count });
}

