import { sql } from "../db";
import type { Deal } from "./pipeline-intel";
import { countedInScope, dealScopeJoins, outOfScope } from "./stage-rules-sql";
import { inPipelineSql } from "./pipeline-pick";
import { currentSnapshotVersion, snapshotOk } from "./definitions-sql";

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);

// All deals for the installation (ignored accounts left out), with pipeline and stage names. When
// the plan limits accounts, `allowed` lists the visible ones. Capped so one huge agency cannot
// exhaust memory; the cap keeps the most recently active deals.
export async function loadDeals(installationId: string, allowed: string[] | null, locationId?: string, pipeline?: string | null): Promise<Deal[]> {
  const db = sql();
  const only = locationId ? db`and o.location_id = ${locationId}` : db``;
  const pipe = inPipelineSql(db, pipeline);
  const limited = allowed ? db`and o.location_id = any(${allowed}::text[])` : db``;
  const rows = await db`
    select o.opportunity_id, o.location_id, l.name location_name, coalesce(o.pipeline_id, '') pipeline_id,
      coalesce(sc_pl.name, 'Pipeline') pipeline_name, o.stage_id, coalesce(sc_st.nm, 'Unknown stage') stage_name, coalesce(sc_st.ord, 999)::int stage_order,
      o.name, o.contact_name, coalesce(o.monetary_value, 0)::float8 value, o.status, o.assigned_to,
      o.created_remote_at, o.last_stage_change_at, o.last_status_change_at,
      greatest(o.last_action_at, o.updated_remote_at) last_activity_at,
      (case when sc_ss.stays >= 10 and sc_ss.p75_days is not null then greatest(3::numeric, least(60::numeric, sc_ss.p75_days)) end)::float8 stage_limit
    from cached_opportunities o
    join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
    ${dealScopeJoins()}
    where o.installation_id = ${installationId} ${only} ${limited} ${pipe}
      and (o.status <> 'open' or ${countedInScope()})
    order by coalesce(greatest(o.last_action_at, o.updated_remote_at, o.last_stage_change_at), o.created_remote_at, o.synced_at) desc nulls last
    limit 60000`;
  return rows.map((r) => ({
    opportunityId: r.opportunity_id, locationId: r.location_id, locationName: r.location_name, pipelineId: r.pipeline_id,
    pipelineName: r.pipeline_name, stageId: r.stage_id, stageName: r.stage_name, stageOrder: r.stage_order, name: r.name,
    contactName: r.contact_name, value: r.value, status: r.status, assignedTo: r.assigned_to ?? null, createdAt: ms(r.created_remote_at),
    stageLimitDays: r.stage_limit === null || r.stage_limit === undefined ? null : Number(r.stage_limit), stageChangedAt: ms(r.last_stage_change_at), statusChangedAt: ms(r.last_status_change_at), lastActivityAt: ms(r.last_activity_at),
  }));
}

// Open deals left out of every dollar figure and count (metrics.ts: a counted deal has a value above zero and an owner, and stage-rules.ts: it
// is not in a closed-out or ignored stage or in a pipeline marked not in use). loadDeals above never returns them, so each screen that shows a
// total says how many were left out and why. The three reasons never overlap: a deal in a closed-out stage is counted there only.
export async function excludedOpenDeals(installationId: string, allowed: string[] | null, locationId?: string, pipeline?: string | null) {
  const db = sql();
  const pipe = inPipelineSql(db, pipeline);
  const only = locationId ? db`and o.location_id = ${locationId}` : db``;
  const limited = allowed ? db`and o.location_id = any(${allowed}::text[])` : db``;
  const [r] = await db`
    select count(*)::int total,
      count(*) filter (where ${outOfScope()})::int closed_out,
      count(*) filter (where not ${outOfScope()} and not (coalesce(o.monetary_value, 0) > 0))::int no_value,
      count(*) filter (where not ${outOfScope()} and coalesce(o.monetary_value, 0) > 0 and o.assigned_to is null)::int no_owner
    from cached_opportunities o
    join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
    ${dealScopeJoins()}
    where o.installation_id = ${installationId} ${only} ${limited} ${pipe}
      and o.status = 'open' and not ${countedInScope()}`;
  return { count: (r?.total as number) ?? 0, closedOut: (r?.closed_out as number) ?? 0, noValue: (r?.no_value as number) ?? 0, noOwner: (r?.no_owner as number) ?? 0 };
}

// The open pipeline over time. Only days counted under today's rules are drawn (definitions.ts, N39): a line that mixed the old way of counting
// with the new one would show a fall that never happened. `leftOut` is how many earlier days were not drawn, and `since` the first day that was.
export async function pipelineTrend(installationId: string, allowed: string[] | null, days = 60) {
  const db = sql();
  const version = await currentSnapshotVersion(installationId);
  const limited = allowed ? db`and m.location_id = any(${allowed}::text[])` : db``;
  const rows = await db`
    select m.day, bool_and(${snapshotOk("m", version)}) ok, sum(m.open_value)::float8 open_value, sum(m.open_opportunities)::int open_opps
    from account_metrics_daily m
    join locations l on l.installation_id = m.installation_id and l.location_id = m.location_id and not l.ignored
    where m.installation_id = ${installationId} and m.day > current_date - ${days}::int ${limited}
    group by m.day order by m.day`;
  const all = rows.map((r) => ({ day: (r.day instanceof Date ? r.day.toISOString() : String(r.day)).slice(0, 10), ok: r.ok === true, openValue: r.open_value as number, openOpps: r.open_opps as number }));
  const kept = all.filter((p) => p.ok);
  const leftOut = all.length - kept.length;
  return {
    points: kept.map(({ day, openValue, openOpps }) => ({ day, openValue, openOpps })),
    leftOut, since: kept[0]?.day ?? null,
    note: leftOut > 0
      ? `The way deals are counted changed, so the ${leftOut} earlier ${leftOut === 1 ? "day is" : "days are"} not drawn${kept[0] ? `; this line starts on ${kept[0].day}` : ". The line is drawn once there are two days counted the new way"}. A line that mixed the two ways of counting would show a change that never happened.`
      : null,
  };
}

export const GOAL_METRICS = ["monthly_revenue", "monthly_leads", "monthly_deals_won"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export async function getGoals(installationId: string): Promise<Partial<Record<GoalMetric, number>>> {
  const rows = await sql()`select metric, target::float8 target from goals where installation_id = ${installationId}`;
  const out: Partial<Record<GoalMetric, number>> = {};
  for (const r of rows) if ((GOAL_METRICS as readonly string[]).includes(r.metric)) out[r.metric as GoalMetric] = r.target;
  return out;
}

export async function setGoal(installationId: string, metric: GoalMetric, target: number | null) {
  const db = sql();
  if (target === null) {
    await db`delete from goals where installation_id = ${installationId} and metric = ${metric}`;
    return;
  }
  await db`
    insert into goals (installation_id, metric, target) values (${installationId}, ${metric}, ${target})
    on conflict (installation_id, metric) do update set target = excluded.target, updated_at = now()`;
}
