import { sql } from "../db";
import type { FlowPaths, PathSeg, PathStage } from "../design/flow-paths.ts";
import { MIN_CLOSED, slug } from "./pipeline3-intel.ts";
import { deals, flowWin, keyOf, names, P_NO_VALUE, P_OPEN, P_STALE, stageMap, type Filters, type Scope } from "./pipeline3-queries";

// part=flow-paths (flag pl_money_flow). Read only. The counts behind the river's ribbon labels and the funnel's bands and breakdowns, for ONE pipeline of ONE account.
// Every number is a SQL aggregate over the same derived deal set (deals()) and the same predicates the lists behind a click use (flowOpen, flowWin, flowReachCond in
// pipeline3-queries.ts), so a label and the rows it opens cannot disagree. Definitions: docs/METRICS.md "Pipeline money flow paths".

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const OTHERS_MAX = 20;

/** The pipeline step order for a step key, or null when the account or the step is not known. Used to open exactly the deals that got to that step. */
export async function reachOrdOf(s: Scope, location: string | null | undefined, pipeline: string | null | undefined, key: string | null): Promise<number | null> {
  if (!location || !pipeline || !key) return null;
  const sm = await stageMap(s, location), want = slug(pipeline);
  let ord: number | null = null;
  for (const si of sm.values()) if (si.pipelineKey === want && si.key === key) ord = ord === null ? si.order : Math.min(ord, si.order);
  return ord;
}

export async function flowPaths(s: Scope, f: Filters, opts: { people: boolean }): Promise<FlowPaths | null> {
  if (!f.pipeline) return null;
  const db = sql(), sm = await stageMap(s, f.location), want = slug(f.pipeline);
  const meta = new Map<string, { id: string; name: string; order: number; pipelineName: string }>();
  for (const si of sm.values()) if (si.pipelineKey === want) { const c = meta.get(si.key); meta.set(si.key, { id: si.key, name: si.name, order: Math.min(c?.order ?? 999, si.order), pipelineName: si.pipelineName }); }
  if (!meta.size) return null;
  const list = [...meta.values()].sort((a, b) => a.order - b.order);
  const stages = new Map<string, PathStage>(list.map((m) => [m.id, { id: m.id, name: m.name, order: m.order, open: 0, openCents: 0, noValue: 0, stuck: 0, stuckCents: 0, lost: 0, lostCents: 0 }]));
  const base: Filters = { ...f, bucket: null, stage: null, stageKey: null, reachOrd: null };
  const w = deals(s, base), win = flowWin(db, base);
  const [byStage, [won], owners, sources, label] = await Promise.all([
    db`with ${w} select d.location_id, d.stage_id,
        count(*) filter (where ${P_OPEN(db)})::int open_n, coalesce(sum(d.value) filter (where ${P_OPEN(db)}), 0)::float8 open_v, count(*) filter (where ${P_NO_VALUE(db)})::int nv_n,
        count(*) filter (where ${P_STALE(db)})::int stuck_n, coalesce(sum(d.value) filter (where ${P_STALE(db)}), 0)::float8 stuck_v,
        count(*) filter (where d.status = 'lost' and ${win})::int lost_n, coalesce(sum(d.value) filter (where d.status = 'lost' and ${win}), 0)::float8 lost_v
      from d group by 1, 2`,
    db`with ${w} select count(*)::int n, coalesce(sum(d.value), 0)::float8 v,
        percentile_cont(0.5) within group (order by extract(epoch from (d.last_status_change_at - d.created_at)) / 86400) filter (where d.created_at is not null and d.last_status_change_at >= d.created_at) med
      from d where d.status = 'won' and ${win}`,
    opts.people ? db`with ${w} select coalesce(d.owner, 'none') k, count(*)::int n, coalesce(sum(d.value), 0)::float8 v from d where d.status = 'won' and ${win} group by 1 order by n desc, k limit ${OTHERS_MAX}` : Promise.resolve([]),
    db`with ${w} select coalesce(d.source, 'none') k, count(*)::int n, coalesce(sum(d.value), 0)::float8 v from d where d.status = 'won' and ${win} group by 1 order by n desc, k limit ${OTHERS_MAX}`,
    names(s.inst),
  ]);
  let lostElsewhere = 0;
  for (const r of byStage) {
    const si = keyOf(sm, r.location_id, r.stage_id), st = si && si.pipelineKey === want ? stages.get(si.key) : undefined;
    if (!st) { lostElsewhere += num(r.lost_n); continue; }
    st.open += num(r.open_n); st.openCents += Math.round(num(r.open_v) * 100); st.noValue += num(r.nv_n);
    st.stuck += num(r.stuck_n); st.stuckCents += Math.round(num(r.stuck_v) * 100);
    st.lost += num(r.lost_n); st.lostCents += Math.round(num(r.lost_v) * 100);
  }
  const seg = (rows: Array<Record<string, unknown>>, name: (k: string) => string): PathSeg[] => rows.map((r) => ({ key: r.k as string, name: name(r.k as string), n: num(r.n), cents: Math.round(num(r.v) * 100) }));
  return {
    pipelineName: list[0].pipelineName, stages: list.map((m) => stages.get(m.id) as PathStage),
    won: {
      n: num(won?.n), cents: Math.round(num(won?.v) * 100), medianDays: won?.med === null || won?.med === undefined ? null : Math.round(Number(won.med) * 10) / 10,
      byOwner: seg(owners as Array<Record<string, unknown>>, (k) => (k === "none" ? "Nobody assigned" : label(k))),
      bySource: seg(sources as Array<Record<string, unknown>>, (k) => (k === "none" ? "No source recorded" : k)),
    },
    lostElsewhere, minDeals: MIN_CLOSED,
  };
}
