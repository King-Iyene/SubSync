import { sql } from "../db";
import { CLOSED_OUT_STAGE_PATTERN, NOT_IN_USE_PIPELINE_PATTERN, type StoredRule } from "./stage-rules";

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
    left join lateral (
      select s->>'name' nm, t.ord from jsonb_array_elements(coalesce(sc_pl.stages, '[]'::jsonb)) with ordinality t(s, ord) where s->>'id' = o.stage_id limit 1
    ) sc_st on true
    left join stage_rules sc_pr on sc_pr.installation_id = o.installation_id and sc_pr.pipeline_key = lower(btrim(coalesce(sc_pl.name, ''))) and sc_pr.stage_key = ''
    left join stage_rules sc_sr on sc_sr.installation_id = o.installation_id and sc_sr.pipeline_key = lower(btrim(coalesce(sc_pl.name, '')))
      and sc_sr.stage_key = lower(btrim(coalesce(sc_st.nm, ''))) and sc_sr.stage_key <> ''`;
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
  return db`(coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null and not ${outOfScope()})`;
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
      count(*) filter (where coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null)::int counted_deals
    from cached_opportunities o
    join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
    ${dealScopeJoins()}
    where o.installation_id = ${installationId} and o.status = 'open' ${allowed ? db`and o.location_id = any(${allowed}::text[])` : db``}
    group by 1, 2 order by 1, 2 limit 400`;
  return rows.map((r) => ({ pipeline: r.pipeline as string, stage: r.stage as string, deals: r.deals as number, countedDeals: r.counted_deals as number }));
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
