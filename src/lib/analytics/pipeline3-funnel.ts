import { sql } from "../db";
import { clampSize, slug } from "./pipeline3-intel.ts";
import { deals, locs, names, offsetOf, toRow, type Db, type Filters, type Frag, type Rec, type Scope } from "./pipeline3-queries";
import type { FunnelDrill, HistorySettings, Pl3Funnel, Pl3FunnelDeals, Pl3Stuck, StuckStage } from "./pipeline3-funnel-types";

// The history funnel and the stuck-in-stage list (flag pl_history_funnel). Read only. Both read what SubSync recorded itself (deal_history, one row per stage move, append only),
// because the CRM keeps only the last move on a deal. ONE definition of "who entered a step and what became of them" lives in cohortCtes(), so a number and the list behind it
// cannot disagree. Accounts come from the caller's scope (never from the request). Deals that look like tests are left out unless the person turns that off in Settings.
// Definitions: docs/METRICS.md "Pipeline history funnel".

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
const r1 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
export const DEFAULT_MIN_SAMPLE = 10;
/** A step counts as "stuck" when a deal has sat longer than the 75th percentile of finished stays in that step, never under 3 days. */
export const STUCK_FLOOR_DAYS = 3;

export async function historySettings(inst: string): Promise<Omit<HistorySettings, "canEdit">> {
  const [r] = await sql()`select min_sample, exclude_test, default_pipeline from pl_history_settings where installation_id = ${inst}`;
  return { minSample: r ? num(r.min_sample) : DEFAULT_MIN_SAMPLE, excludeTest: r ? r.exclude_test === true : true, defaultPipeline: (r?.default_pipeline as string | null) ?? null };
}

export async function saveHistorySettings(inst: string, body: { minSample?: unknown; excludeTest?: unknown; defaultPipeline?: unknown }): Promise<Omit<HistorySettings, "canEdit">> {
  const cur = await historySettings(inst);
  const m = Number(body.minSample);
  const minSample = body.minSample !== undefined && Number.isFinite(m) ? Math.min(100, Math.max(5, Math.floor(m))) : cur.minSample;
  const excludeTest = typeof body.excludeTest === "boolean" ? body.excludeTest : cur.excludeTest;
  const dp = body.defaultPipeline === undefined ? cur.defaultPipeline : typeof body.defaultPipeline === "string" ? body.defaultPipeline.trim().slice(0, 120) || null : null;
  await sql()`insert into pl_history_settings (installation_id, min_sample, exclude_test, default_pipeline, updated_at) values (${inst}, ${minSample}, ${excludeTest}, ${dp}, now())
    on conflict (installation_id) do update set min_sample = excluded.min_sample, exclude_test = excluded.exclude_test, default_pipeline = excluded.default_pipeline, updated_at = now()`;
  return { minSample, excludeTest, defaultPipeline: dp };
}

const norm = (db: Db, col: Frag) => db`lower(regexp_replace(btrim(coalesce(${col}, '')), '[[:space:]]+', ' ', 'g'))`;

/** CTE definitions (put after `with ${deals(...)},`): sm (the steps of the chosen pipeline), ev (every recorded entry into one of them), seq, and co (one row per deal per step: its FIRST entry in the dates, what became of it, and how long that stay lasted). */
export function cohortCtes(db: Db, s: Scope, f: Filters, pipeSlug: string): Frag {
  const dealOk = f.includeTest ? db`true` : db`not d.is_test`;
  return db`
    sm as (
      select pl.location_id, t.st->>'id' stage_id, ${norm(db, db`t.st->>'name'`)} skey, coalesce(t.st->>'name', 'Step') sname, t.ord::int ord
      from pipelines pl join (${locs(s, f.location)}) l on l.location_id = pl.location_id, jsonb_array_elements(pl.stages) with ordinality t(st, ord)
      where pl.installation_id = ${s.inst} and ${norm(db, db`pl.name`)} = ${pipeSlug} and t.st->>'id' is not null
    ),
    ev as (
      select h.location_id, h.opportunity_id, h.at, h.id, sm.stage_id, sm.skey, sm.sname, sm.ord
      from deal_history h join sm on sm.location_id = h.location_id and sm.stage_id = h.to_value
      join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id
      where h.installation_id = ${s.inst} and h.kind in ('created', 'stage') and ${dealOk}
    ),
    seq as (
      select ev.*, lead(ev.at) over w next_at,
        max(ev.ord) over (partition by ev.location_id, ev.opportunity_id order by ev.at, ev.id rows between 1 following and unbounded following) later_max
      from ev window w as (partition by ev.location_id, ev.opportunity_id order by ev.at, ev.id)
    ),
    co as (
      select x.location_id, x.opportunity_id, x.skey, x.sname, x.ord, x.at,
        case when x.next_at is null then null else extract(epoch from (x.next_at - x.at)) / 86400 end stay_days,
        case when x.later_max > x.ord or d.status = 'won' then 'advanced'
          when d.status in ('lost', 'abandoned') then 'dropped'
          when d.status = 'open' and d.stage_id = x.stage_id then 'here'
          else 'other' end outcome
      from (select distinct on (location_id, opportunity_id, skey) * from seq where at >= ${f.from} and at < ${f.to} order by location_id, opportunity_id, skey, at, id) x
      join d on d.location_id = x.location_id and d.opportunity_id = x.opportunity_id
    )`;
}

export async function pipelineNames(s: Scope, f: Filters): Promise<Array<{ name: string; n: number }>> {
  const db = sql();
  const rows = await db`select p.name, count(o.opportunity_id)::int n from pipelines p join (${locs(s, f.location)}) l on l.location_id = p.location_id
    left join cached_opportunities o on o.installation_id = p.installation_id and o.location_id = p.location_id and o.pipeline_id = p.pipeline_id
    where p.installation_id = ${s.inst} and p.name is not null group by p.name order by n desc, p.name`;
  const seen = new Map<string, { name: string; n: number }>();
  for (const r of rows) { const k = slug(r.name as string); const c = seen.get(k); seen.set(k, { name: c?.name ?? (r.name as string), n: (c?.n ?? 0) + num(r.n) }); }
  return [...seen.values()].sort((a, b) => b.n - a.n);
}

export async function funnel(s: Scope, f: Filters, st: Omit<HistorySettings, "canEdit">): Promise<Pl3Funnel> {
  const db = sql(), list = await pipelineNames(s, f), listNames = list.map((p) => p.name);
  const want = f.pipeline ?? st.defaultPipeline;
  const chosen = (want && list.find((p) => slug(p.name) === slug(want))?.name) ?? list[0]?.name ?? null;
  const [since] = await db`select min(h.at) since from deal_history h join (${locs(s, f.location)}) l on l.location_id = h.location_id where h.installation_id = ${s.inst} and h.kind in ('stage', 'created')`;
  const historySince = iso(since?.since);
  const base: Pl3Funnel = { pipeline: chosen, pipelines: listNames, steps: [], historySince, windowStartsBeforeHistory: !!historySince && new Date(historySince) > f.from, minSample: st.minSample, excludedTests: st.excludeTest, empty: true };
  if (!chosen) return base;
  const ff: Filters = { ...f, pipeline: chosen, bucket: null, includeTest: !st.excludeTest };
  const rows = await db`with ${deals(s, ff)}, ${cohortCtes(db, s, ff, slug(chosen))}
    select skey, min(ord)::int ord, max(sname) name, count(*)::int entered, count(*) filter (where outcome = 'advanced')::int advanced, count(*) filter (where outcome = 'dropped')::int dropped,
      count(*) filter (where outcome = 'here')::int here, count(*) filter (where outcome = 'other')::int other, count(stay_days)::int stays,
      percentile_cont(0.5) within group (order by stay_days)::float8 med
    from co group by skey order by min(ord), skey`;
  const steps = rows.map((r) => {
    const entered = num(r.entered), stays = num(r.stays), enough = entered >= st.minSample;
    return {
      key: r.skey as string, name: r.name as string, order: num(r.ord), entered, advanced: num(r.advanced), dropped: num(r.dropped), here: num(r.here), other: num(r.other),
      advanceRate: enough ? Math.round((num(r.advanced) / entered) * 1000) / 1000 : null, medianDays: stays >= st.minSample ? r1(r.med) : null, stays, enough,
    };
  });
  return { ...base, steps, empty: steps.length === 0 };
}

export async function funnelDeals(s: Scope, f: Filters, st: Omit<HistorySettings, "canEdit">, stepKey: string, drill: FunnelDrill, page: number, size: number, link: ((loc: string, contact: string) => string) | null): Promise<Pl3FunnelDeals> {
  const db = sql(), sz = clampSize(size), label = await names(s.inst);
  const ff: Filters = { ...f, bucket: null, includeTest: !st.excludeTest };
  if (!ff.pipeline) return { rows: [], total: 0, page, size: sz, pages: 1, truncated: false, stepName: null, drill };
  const cond = drill === "entered" ? db`` : db`and co.outcome = ${drill}`;
  const pre = db`with ${deals(s, ff)}, ${cohortCtes(db, s, ff, slug(ff.pipeline))}`;
  const [rows, [c]] = await Promise.all([
    db`${pre} select d.*, co.at entered_at, co.outcome, co.sname from d join co on co.location_id = d.location_id and co.opportunity_id = d.opportunity_id where co.skey = ${stepKey} ${cond}
      order by d.value desc, d.opportunity_id limit ${sz} offset ${offsetOf(page, sz)}`,
    db`${pre} select count(*)::int n from d join co on co.location_id = d.location_id and co.opportunity_id = d.opportunity_id where co.skey = ${stepKey} ${cond}`,
  ]);
  const out: Record<string, string> = { advanced: "moved on to a later step", dropped: "was lost or abandoned", here: "is still in this step", other: "moved somewhere else" };
  const total = num(c?.n);
  return {
    rows: rows.map((r: Rec) => {
      const row = toRow(r, label, link), when = iso(r.entered_at)?.slice(0, 10);
      return { ...row, why: `Entered ${r.sname} on ${when}, then ${out[r.outcome as string] ?? "moved"}` };
    }),
    total, page, size: sz, pages: Math.max(1, Math.ceil(total / sz)), truncated: false, stepName: (rows[0]?.sname as string | undefined) ?? null, drill,
  };
}

/** Open deals past the usual time for THEIR OWN step in THEIR OWN account (the 75th percentile of finished stays there, at least 3 days), only where the step has at least `minSample` finished stays. Ranked by deal value. $0, ownerless and test deals are left out. */
export async function stuck(s: Scope, f: Filters, st: Omit<HistorySettings, "canEdit">, page: number, size: number, link: ((loc: string, contact: string) => string) | null): Promise<Pl3Stuck> {
  const db = sql(), sz = clampSize(size), label = await names(s.inst);
  const ff: Filters = { ...f, bucket: null, includeTest: !st.excludeTest };
  const w = deals(s, ff);
  const from = db`from d join deal_stage_stats ss on ss.installation_id = ${s.inst} and ss.location_id = d.location_id and ss.stage_id = d.stage_id
    where d.status = 'open' and d.counted and ss.stays >= ${st.minSample} and ss.p75_days is not null and d.days_in_stage > greatest(${STUCK_FLOOR_DAYS}, ss.p75_days)`;
  const [rows, [t], by, [nj]] = await Promise.all([
    db`with ${w} select d.*, ss.p75_days::float8 p75, ss.median_days::float8 med, ss.stays ss_stays ${from} order by d.value desc, d.opportunity_id limit ${sz} offset ${offsetOf(page, sz)}`,
    db`with ${w} select count(*)::int n, coalesce(sum(d.value), 0)::float8 v ${from}`,
    db`with ${w} select d.pipeline_name, d.stage_name, count(*)::int n, sum(d.value)::float8 v, avg(ss.p75_days)::float8 usual ${from} group by 1, 2 order by v desc limit 12`,
    db`with ${w} select count(*)::int n from d left join deal_stage_stats ss on ss.installation_id = ${s.inst} and ss.location_id = d.location_id and ss.stage_id = d.stage_id
      where d.status = 'open' and d.counted and (ss.stays is null or ss.stays < ${st.minSample} or ss.p75_days is null)`,
  ]);
  const total = num(t?.n);
  return {
    rows: rows.map((r: Rec) => {
      const row = toRow(r, label, link), p75 = Math.max(STUCK_FLOOR_DAYS, num(r.p75)), d = Math.floor(num(r.days_in_stage));
      return { ...row, stale: true, staleLimitDays: Math.round(p75), why: `${d} days in ${r.stage_name}; deals here usually move within ${Math.ceil(p75)} days (from ${num(r.ss_stays)} past stays in this account)` };
    }),
    total, totalValue: num(t?.v), estimate: true,
    formula: `Open deals with a value and an owner that have been in their step longer than the usual time for that step in the same account (the 75th percentile of finished stays, at least ${STUCK_FLOOR_DAYS} days, from at least ${st.minSample} past stays). The dollars are the value of those deals. It is an estimate of what is at risk, not a forecast.`,
    byStage: by.map((r: Rec): StuckStage => ({ stage: r.stage_name as string, pipeline: (r.pipeline_name as string | null) ?? null, count: num(r.n), value: num(r.v), usualDays: r1(r.usual) })),
    notJudged: num(nj?.n), minSample: st.minSample,
    page, size: sz, pages: Math.max(1, Math.ceil(total / sz)), truncated: false,
  };
}
