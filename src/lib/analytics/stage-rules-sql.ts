import { sql } from "../db";
import { CLOSED_OUT_STAGE_PATTERN, NOT_IN_USE_PIPELINE_PATTERN, type StoredRule } from "./stage-rules";
import {
  DEFAULT_VALUE_MIN_DEALS, DEFAULT_VALUE_MIN_SHARE_DEALS, DEFAULT_VALUE_SHARE, LEFT_OUT_REASONS, MIN_STAGE_STAYS, OUTLIER_MIN_DEALS, OUTLIER_MULTIPLE, OUTREACH_MIN_DEALS, OUTREACH_SHARE,
  ROUND_AMOUNT, STAGE_LIMIT_CAP_DAYS, STAGE_LIMIT_FLOOR_DAYS, TEST_NAME_PATTERN, type LeftOutPart, type LeftOutReason, type LeftOutSummary,
} from "./deal-trust";

// The SQL side of stage-rules.ts: one pair of fragments that every deal query uses, so "is this deal in play?" is answered once.
//   dealScopeJoins(o)  joins the deal's pipeline, its stage name and the owner's rules for them
//   outOfScope()       true for a deal in a closed-out or ignored stage, or in a pipeline that is not in use
// Written for the alias `o` (cached_opportunities). The treatment is the same as treatmentOf() in stage-rules.ts: the owner's rule wins; with
// none, the name decides.

/** Joins to put after `from cached_opportunities o`. Adds sc_pl (pipeline), sc_st (stage name), sc_pr (pipeline rule) and sc_sr (stage rule). */
export function dealScopeJoins() {
  const db = sql();
  return db`
    left join pipelines sc_pl on sc_pl.installation_id = o.installation_id and sc_pl.location_id = o.location_id and sc_pl.pipeline_id = o.pipeline_id
    left join (select p.installation_id, p.location_id, p.pipeline_id, t.s->>'id' sid, min(t.s->>'name') nm, min(t.ord) ord from pipelines p, jsonb_array_elements(coalesce(p.stages, '[]'::jsonb)) with ordinality t(s, ord) group by 1, 2, 3, 4) sc_st
      on sc_st.installation_id = o.installation_id and sc_st.location_id = o.location_id and sc_st.pipeline_id = o.pipeline_id and sc_st.sid = o.stage_id
    left join stage_rules sc_pr on sc_pr.installation_id = o.installation_id and sc_pr.pipeline_key = lower(btrim(coalesce(sc_pl.name, ''))) and sc_pr.stage_key = ''
    left join stage_rules sc_sr on sc_sr.installation_id = o.installation_id and sc_sr.pipeline_key = lower(btrim(coalesce(sc_pl.name, '')))
      and sc_sr.stage_key = lower(btrim(coalesce(sc_st.nm, ''))) and sc_sr.stage_key <> ''
    ${trustJoins()}`;
}

/**
 * The relations the dollar trust rules read (deal-trust.ts): sc_vg (per pipeline, stage and amount: how many valued, owned open deals share it, how many the stage and the pipeline hold, the biggest
 * stage-and-amount cell of the pipeline), sc_md (per account: the median valued deal) and sc_ss (the stage's finished-stay history, for "stale for THIS stage"). Each is a grouped scan of open
 * deals that includes the installation column in its grouping, so the caller's `o.installation_id = ...` reaches it.
 */
function trustJoins() {
  const db = sql();
  return db`
    left join (
      select installation_id, location_id, coalesce(pipeline_id, '') pk, coalesce(stage_id, '') sk, monetary_value, count(*)::int n_same,
        (sum(count(*)) over (partition by installation_id, location_id, coalesce(pipeline_id, ''), coalesce(stage_id, '')))::int n_stage,
        (sum(count(*)) over (partition by installation_id, location_id, coalesce(pipeline_id, '')))::int n_pipe,
        (max(count(*)) over (partition by installation_id, location_id, coalesce(pipeline_id, '')))::int max_cell
      from cached_opportunities where status = 'open' and monetary_value > 0 and assigned_to is not null
      group by installation_id, location_id, coalesce(pipeline_id, ''), coalesce(stage_id, ''), monetary_value
    ) sc_vg on sc_vg.installation_id = o.installation_id and sc_vg.location_id = o.location_id and sc_vg.pk = coalesce(o.pipeline_id, '') and sc_vg.sk = coalesce(o.stage_id, '') and sc_vg.monetary_value = o.monetary_value
    left join (
      select installation_id, location_id, count(*)::int n, percentile_cont(0.5) within group (order by monetary_value) med
      from cached_opportunities where status = 'open' and monetary_value > 0 and assigned_to is not null group by installation_id, location_id
    ) sc_md on sc_md.installation_id = o.installation_id and sc_md.location_id = o.location_id
    left join deal_stage_stats sc_ss on sc_ss.installation_id = o.installation_id and sc_ss.location_id = o.location_id and sc_ss.stage_id = o.stage_id`;
}

/** This pipeline is a bulk outreach list (no owner rule says otherwise): enough deals, and one stage-and-amount cell holds most of them. Needs dealScopeJoins(). */
export function pipelineLooksLikeOutreach() {
  const db = sql();
  return db`(sc_pr.class is null and coalesce(sc_vg.n_pipe, 0) >= ${OUTREACH_MIN_DEALS}::numeric and sc_vg.max_cell >= ${OUTREACH_SHARE}::numeric * sc_vg.n_pipe)`;
}

/**
 * Why a valued, owned open deal's dollars are left out, or null when they count: 'test', 'outlier' (a round million, or 100 times the account's median), 'outreach' (the pipeline is a bulk
 * outreach list) or 'default_value' (the same amount on many deals in the stage). A pipeline the owner marked "in use" is never judged outreach or default value. Needs dealScopeJoins().
 */
export function valueSuspect() {
  const db = sql();
  return db`(case
    when coalesce(o.name, '') ~* ${TEST_NAME_PATTERN} or coalesce(o.contact_name, '') ~* ${TEST_NAME_PATTERN} then 'test'
    when o.monetary_value >= ${ROUND_AMOUNT}::numeric and mod(o.monetary_value, ${ROUND_AMOUNT}::numeric) = 0 then 'outlier'
    when sc_md.n >= ${OUTLIER_MIN_DEALS}::numeric and o.monetary_value >= ${OUTLIER_MULTIPLE}::numeric * sc_md.med then 'outlier'
    when ${pipelineLooksLikeOutreach()} then 'outreach'
    when coalesce(sc_pr.class, '') <> 'in_use' and (sc_vg.n_same >= ${DEFAULT_VALUE_MIN_DEALS}::numeric or (sc_vg.n_same >= ${DEFAULT_VALUE_MIN_SHARE_DEALS}::numeric and sc_vg.n_same >= ${DEFAULT_VALUE_SHARE}::numeric * sc_vg.n_stage)) then 'default_value'
  end)`;
}

/** SQL for "this deal has sat in its step longer than that step usually takes" (deal-trust.ts stageLimitDays). Needs dealScopeJoins(). Steps with too little history judge nothing: see stepNotJudged(). */
export function dealIsStale() {
  const db = sql();
  return db`(sc_ss.stays >= ${MIN_STAGE_STAYS}::numeric and sc_ss.p75_days is not null
    and coalesce(o.last_stage_change_at, o.created_remote_at, o.synced_at) < now() - (greatest(${STAGE_LIMIT_FLOOR_DAYS}::numeric, least(${STAGE_LIMIT_CAP_DAYS}::numeric, sc_ss.p75_days)) * interval '1 day'))`;
}
/** The step has too few finished stays to say what is usual, so no deal in it is judged. Needs dealScopeJoins(). */
export function stepNotJudged() {
  const db = sql();
  return db`(coalesce(sc_ss.stays, 0) < ${MIN_STAGE_STAYS}::numeric or sc_ss.p75_days is null)`;
}
/** Whole days the deal has sat in its step. */
export function daysInStepSql() {
  const db = sql();
  return db`floor(extract(epoch from (now() - coalesce(o.last_stage_change_at, o.created_remote_at, o.synced_at))) / 86400)::int`;
}

/** A boolean expression: this deal is in a closed-out or ignored stage, or in a pipeline that is not in use. Needs dealScopeJoins(). */
export function outOfScope() {
  const db = sql();
  return db`(
    (case when sc_pr.class is not null then sc_pr.class = 'not_in_use' else coalesce(sc_pl.name, '') ~* ${NOT_IN_USE_PIPELINE_PATTERN} end)
    or (case when sc_sr.class is not null then sc_sr.class in ('closed_out', 'ignore') else coalesce(sc_st.nm, '') ~* ${CLOSED_OUT_STAGE_PATTERN} end)
  )`;
}

/** A counted deal (metrics.ts, isCounted) that is also in play: value above zero, an owner, and not in a closed-out stage or an unused pipeline. */
export function countedInScope() {
  const db = sql();
  return db`(coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null and not ${outOfScope()} and ${valueSuspect()} is null)`;
}

/** The owner's stored rules for one installation. */
export async function loadStageRules(installationId: string): Promise<StoredRule[]> {
  const rows = await sql()`select pipeline_key, stage_key, class, win_probability from stage_rules where installation_id = ${installationId}`;
  return rows.map((r) => ({ pipelineKey: r.pipeline_key as string, stageKey: r.stage_key as string, cls: (r.class as string | null) ?? null, winProbability: (r.win_probability as number | null) ?? null }));
}

/** Every pipeline and stage the installation has (names only, over the accounts the caller may see) with how many open deals sit in each. */
export async function stageInventory(installationId: string, allowed: string[] | null) {
  const db = sql();
  const rows = await db`
    select coalesce(sc_pl.name, 'Pipeline') pipeline, coalesce(sc_st.nm, 'Unknown stage') stage, count(*)::int deals,
      count(*) filter (where ${countedInScope()})::int counted_deals, bool_or(${pipelineLooksLikeOutreach()}) outreach, max(coalesce(sc_vg.n_pipe, 0))::int pipe_deals
    from cached_opportunities o
    join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
    ${dealScopeJoins()}
    where o.installation_id = ${installationId} and o.status = 'open' ${allowed ? db`and o.location_id = any(${allowed}::text[])` : db``}
    group by 1, 2 order by 1, 2 limit 400`;
  return rows.map((r) => ({ pipeline: r.pipeline as string, stage: r.stage as string, deals: r.deals as number, countedDeals: r.counted_deals as number, outreach: r.outreach === true, pipeDeals: r.pipe_deals as number }));
}

/** Save one rule (or clear it). Bumps the revision so history drawn under the old rules is not mixed with the new (N39). */
export async function saveStageRule(installationId: string, actor: string | null, p: { pipelineKey: string; stageKey: string; cls?: string | null; winProbability?: number | null }): Promise<void> {
  const db = sql();
  await db.begin(async (tx) => {
    const [cur] = await tx`select class, win_probability from stage_rules where installation_id = ${installationId} and pipeline_key = ${p.pipelineKey} and stage_key = ${p.stageKey}`;
    const cls = "cls" in p ? p.cls ?? null : (cur?.class as string | null) ?? null;
    const prob = "winProbability" in p ? p.winProbability ?? null : (cur?.win_probability as number | null) ?? null;
    if (cls === null && prob === null) {
      await tx`delete from stage_rules where installation_id = ${installationId} and pipeline_key = ${p.pipelineKey} and stage_key = ${p.stageKey}`;
    } else {
      await tx`
        insert into stage_rules (installation_id, pipeline_key, stage_key, class, win_probability, updated_by)
        values (${installationId}, ${p.pipelineKey}, ${p.stageKey}, ${cls}, ${prob}, ${actor})
        on conflict (installation_id, pipeline_key, stage_key) do update set class = excluded.class, win_probability = excluded.win_probability, updated_at = now(), updated_by = excluded.updated_by`;
    }
    // Only a change of class changes which deals count; a probability only feeds the forecast, which is not drawn over time.
    if ("cls" in p && (p.cls ?? null) !== ((cur?.class as string | null) ?? null)) {
      await tx`update settings set deal_rules_revision = deal_rules_revision + 1 where installation_id = ${installationId}`;
    }
  });
}
