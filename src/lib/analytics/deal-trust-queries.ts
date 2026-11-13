import { sql } from "../db";
import { type LeftOutPart, type LeftOutReason, type LeftOutSummary, LEFT_OUT_REASONS } from "./deal-trust";
import { inPipelineSql } from "./pipeline-pick";
import { dealIsStale, dealScopeJoins, daysInStepSql, outOfScope, stepNotJudged, valueSuspect } from "./stage-rules-sql";

// THE shared dollar function (docs/METRICS.md "Deal dollars you can trust"). Pipeline, Today (money row, This week, Numbers), the Account audit, Clients, the brief and the Money views all
// take their open-pipeline and stale-deal dollars from the same SQL fragments (countedInScope, dealIsStale in stage-rules-sql.ts) and their "Left out" line from here, so the figures cannot
// disagree. Read only. The caller passes the account ids it is allowed to see (never an id from the address).

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export type DealTrust = {
  counted: { deals: number; dollars: number };
  /** Counted open deals past their own step's usual time (judged steps only). */
  stale: { deals: number; dollars: number };
  leftOut: LeftOutSummary;
};
export const EMPTY_TRUST: DealTrust = { counted: { deals: 0, dollars: 0 }, stale: { deals: 0, dollars: 0 }, leftOut: { parts: [], deals: 0, dollars: 0, notJudged: 0, pipelinesCounted: 0, pipelinesTotal: 0 } };

export async function dealTrust(inst: string, ids: string[], pipeline?: string | null): Promise<DealTrust> {
  if (!ids.length) return EMPTY_TRUST;
  const db = sql();
  const pipe = inPipelineSql(db, pipeline);
  const rows = await db`
    with b as materialized (
      select o.location_id || '|' || coalesce(o.pipeline_id, '') pk, coalesce(sc_pl.name, 'Pipeline') pname, o.monetary_value::float8 v, ${valueSuspect()} reason, ${dealIsStale()} stale, ${stepNotJudged()} nj
      from cached_opportunities o
      join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
      ${dealScopeJoins()}
      where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) ${pipe} and o.status = 'open' and coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null and not ${outOfScope()}
    )
    select 'reason' k, reason::text a, null::float8 v, count(*)::int c, coalesce(sum(v), 0)::float8 d, count(distinct pk)::int p, max(v)::float8 mx from b group by reason
    union all
    select 'top', t.reason, t.v, t.c, t.d, 0, 0 from (select reason::text, v, count(*)::int c, sum(v)::float8 d, row_number() over (partition by reason order by count(*) desc, v desc) rn from b where reason in ('default_value', 'outlier') group by reason, v) t where t.rn = 1
    union all
    select 'pipes', null, null, count(distinct pk)::int, 0, count(distinct pk) filter (where reason is null)::int, 0 from b
    union all
    select 'stale', null, null, count(*) filter (where reason is null and stale)::int, coalesce(sum(v) filter (where reason is null and stale), 0)::float8, count(*) filter (where reason is null and nj)::int, 0 from b`;
  const ok = rows.find((r) => r.k === "reason" && r.a === null);
  const byReason = new Map<string, Record<string, unknown>>(rows.filter((r) => r.k === "reason" && r.a !== null).map((r) => [r.a as string, r]));
  const top = new Map<string, Record<string, unknown>>(rows.filter((r) => r.k === "top").map((r) => [r.a as string, r]));
  const outreachPipes = await db`
    select count(distinct pname)::int c from (
      select coalesce(sc_pl.name, 'Pipeline') pname, ${valueSuspect()} reason
      from cached_opportunities o ${dealScopeJoins()}
      where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) ${pipe} and o.status = 'open' and coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null and not ${outOfScope()}
    ) x where reason = 'outreach'`.catch(() => [{ c: 0 }]);
  const parts: LeftOutPart[] = [];
  for (const reason of LEFT_OUT_REASONS) {
    const r = byReason.get(reason);
    if (!r || n(r.c) === 0) continue;
    const t = top.get(reason);
    let detail: string | null = null;
    if (reason === "default_value" && t) detail = `the same ${usd(n(t.v))} on ${n(t.c).toLocaleString("en-US")} deals`;
    if (reason === "outlier") detail = `largest ${usd(n(r.mx))}`;
    if (reason === "outreach") { const c = n(outreachPipes[0]?.c); detail = `in ${c} outreach ${c === 1 ? "list" : "lists"}`; }
    parts.push({ reason: reason as LeftOutReason, deals: n(r.c), dollars: Math.round(n(r.d)), detail });
  }
  const pipes = rows.find((r) => r.k === "pipes"), st = rows.find((r) => r.k === "stale");
  return {
    counted: { deals: n(ok?.c), dollars: Math.round(n(ok?.d)) },
    stale: { deals: n(st?.c), dollars: Math.round(n(st?.d)) },
    leftOut: { parts, deals: parts.reduce((s, p) => s + p.deals, 0), dollars: parts.reduce((s, p) => s + p.dollars, 0), notJudged: n(st?.p), pipelinesCounted: n(pipes?.p), pipelinesTotal: n(pipes?.c) },
  };
}

export type LeftOutRow = { opportunityId: string; locationId: string; locationName: string | null; name: string | null; contactId: string | null; contactName: string; pipeline: string; stage: string; value: number; reason: LeftOutReason; daysInStep: number };

/** The deals behind a "Left out" line (all reasons, or one), biggest first. Same base and same reason as dealTrust, so the count equals the rows. */
export async function leftOutRows(inst: string, ids: string[], reason: LeftOutReason | null, size: number, offset: number, pipeline?: string | null): Promise<{ rows: LeftOutRow[]; total: number }> {
  if (!ids.length) return { rows: [], total: 0 };
  const db = sql();
  const pipe = inPipelineSql(db, pipeline);
  const rows = await db`
    select x.*, count(*) over ()::int total from (
      select o.opportunity_id, o.location_id, l.name location_name, o.name deal_name, o.contact_id, coalesce(nullif(o.contact_name, ''), o.name, 'Unnamed deal') contact_name, coalesce(sc_pl.name, 'Pipeline') pipeline, coalesce(sc_st.nm, 'Unknown stage') stage,
        o.monetary_value::float8 v, ${valueSuspect()} reason, ${daysInStepSql()} days_in_step
      from cached_opportunities o
      join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
      ${dealScopeJoins()}
      where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) ${pipe} and o.status = 'open' and coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null and not ${outOfScope()}
    ) x where x.reason is not null ${reason ? db`and x.reason = ${reason}` : db``}
    order by x.v desc, x.opportunity_id limit ${size} offset ${offset}`;
  return {
    total: rows[0] ? n(rows[0].total) : 0,
    rows: rows.map((r) => ({ opportunityId: r.opportunity_id as string, locationId: r.location_id as string, locationName: (r.location_name as string | null) ?? null, name: (r.deal_name as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null, contactName: r.contact_name as string, pipeline: r.pipeline as string, stage: r.stage as string, value: n(r.v), reason: r.reason as LeftOutReason, daysInStep: n(r.days_in_step) })),
  };
}

/** Every account id of the installation that is not ignored (the caller then keeps only the ones it may see). */
export async function liveLocationIds(inst: string): Promise<string[]> {
  return (await sql()`select location_id from locations where installation_id = ${inst} and not ignored`).map((r) => r.location_id as string);
}
