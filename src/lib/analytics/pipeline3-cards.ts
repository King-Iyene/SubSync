import { sql } from "../db.ts";
import { DEFAULT_LIMIT_DAYS } from "./pipeline3-intel.ts";
import type { Pl3Cards, PipeCard } from "./pipeline3-types.ts";

// RANKED PIPELINE CARDS: one row per (account, pipeline), straight from cached_opportunities with SQL aggregates (never loads deals), paged with a KEYSET cursor
// (open money, account, pipeline) so page 500 costs the same as page 1. Stages are never mixed across pipelines: every number here is stage-independent
// (open, won, lost money and counts, stuck and no-owner counts). Open money counts deals that have a value and an owner, the same rule as the stacks' tiles.
export type CardScope = { inst: string; allowed: string[] | null };
export type CardOpts = { from: Date; to: Date; location?: string | null; q?: string | null; showEmpty?: boolean; after?: string | null; size: number };

/** The cursor is "value|account|pipeline", checked on the way in (a bad one is the first page). */
export function parseCursor(c: string | null | undefined): { v: number; loc: string; pid: string } | null {
  const m = /^(\d{1,15}(?:\.\d{1,2})?)\|([A-Za-z0-9_-]{1,64})\|([A-Za-z0-9_-]{1,64})$/.exec(c ?? "");
  return m ? { v: Number(m[1]), loc: m[2], pid: m[3] } : null;
}

export async function pipelineCards(s: CardScope, o: CardOpts): Promise<Pl3Cards> {
  const db = sql(), cur = parseCursor(o.after), size = Math.max(6, Math.min(60, o.size));
  const like = o.q ? `%${o.q.replace(/[\\%_]/g, (m) => "\\" + m).slice(0, 60)}%` : null;
  const r = (await db`
    with scope as (
      select l.location_id, l.name from locations l where l.installation_id = ${s.inst} and not l.ignored
        ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``} ${o.location ? db`and l.location_id = ${o.location}` : db``}
    ),
    agg as (
      select o.location_id, o.pipeline_id, max(o.pipeline_name) any_name,
        count(*) filter (where st = 'open' and o.monetary_value > 0 and o.assigned_to is not null)::int open_n,
        coalesce(sum(o.monetary_value) filter (where st = 'open' and o.monetary_value > 0 and o.assigned_to is not null), 0)::float8 open_v,
        count(*) filter (where st = 'won' and o.last_status_change_at >= ${o.from} and o.last_status_change_at < ${o.to})::int won_n,
        coalesce(sum(o.monetary_value) filter (where st = 'won' and o.last_status_change_at >= ${o.from} and o.last_status_change_at < ${o.to}), 0)::float8 won_v,
        count(*) filter (where st = 'lost' and o.last_status_change_at >= ${o.from} and o.last_status_change_at < ${o.to})::int lost_n,
        coalesce(sum(o.monetary_value) filter (where st = 'lost' and o.last_status_change_at >= ${o.from} and o.last_status_change_at < ${o.to}), 0)::float8 lost_v,
        count(*) filter (where st = 'open' and o.monetary_value > 0 and o.assigned_to is not null
          and extract(epoch from (now() - coalesce(o.last_stage_change_at, o.created_remote_at, o.synced_at))) / 86400 > coalesce(ss.limit_days, ${DEFAULT_LIMIT_DAYS}))::int stale_n,
        count(*) filter (where st = 'open' and o.assigned_to is null)::int no_owner_n,
        count(*) filter (where st = 'open' and coalesce(o.monetary_value, 0) <= 0)::int zero_n
      from (select o.*, lower(coalesce(o.status, 'open')) st from cached_opportunities o where o.installation_id = ${s.inst}) o
      join scope l on l.location_id = o.location_id
      left join deal_stage_stats ss on ss.installation_id = o.installation_id and ss.location_id = o.location_id and ss.stage_id = o.stage_id
      group by 1, 2
    ),
    keys as (select location_id, pipeline_id from agg union select p.location_id, p.pipeline_id from pipelines p join scope l on l.location_id = p.location_id where p.installation_id = ${s.inst}),
    cards as (
      select k.location_id, k.pipeline_id, l.name account_name, coalesce(nullif(btrim(p.name), ''), nullif(btrim(a.any_name), ''), 'Pipeline') name,
        coalesce(a.open_n, 0) open_n, round(coalesce(a.open_v, 0)::numeric, 2)::float8 open_v, coalesce(a.won_n, 0) won_n, coalesce(a.won_v, 0) won_v, coalesce(a.lost_n, 0) lost_n, coalesce(a.lost_v, 0) lost_v,
        coalesce(a.stale_n, 0) stale_n, coalesce(a.no_owner_n, 0) no_owner_n, coalesce(a.zero_n, 0) zero_n,
        (coalesce(a.open_n, 0) + coalesce(a.no_owner_n, 0) + coalesce(a.zero_n, 0) + coalesce(a.won_n, 0) + coalesce(a.lost_n, 0)) = 0 is_empty
      from keys k join scope l on l.location_id = k.location_id
      left join agg a on a.location_id = k.location_id and a.pipeline_id is not distinct from k.pipeline_id
      left join pipelines p on p.installation_id = ${s.inst} and p.location_id = k.location_id and p.pipeline_id = k.pipeline_id
      where k.pipeline_id is not null
    ),
    found as (select * from cards where true ${like ? db`and (name ilike ${like} or account_name ilike ${like})` : db``}),
    tot as (
      select count(*) filter (where not is_empty)::int shown, count(*) filter (where is_empty)::int empty_n, coalesce(sum(open_v), 0)::float8 open_v, coalesce(sum(won_v), 0)::float8 won_v,
        coalesce(sum(lost_v), 0)::float8 lost_v, coalesce(sum(open_n), 0)::int open_n, coalesce(sum(won_n), 0)::int won_n, coalesce(sum(lost_n), 0)::int lost_n,
        coalesce(sum(stale_n), 0)::int stale_n, coalesce(sum(no_owner_n), 0)::int no_owner_n
      from found
    ),
    pg as (
      select * from found where (${o.showEmpty ?? false} or not is_empty)
        ${cur ? db`and (open_v < ${cur.v} or (open_v = ${cur.v} and (location_id, pipeline_id) > (${cur.loc}, ${cur.pid})))` : db``}
      order by open_v desc, location_id, pipeline_id limit ${size + 1}
    )
    select (select coalesce(json_agg(pg order by pg.open_v desc, pg.location_id, pg.pipeline_id), '[]'::json) from pg) rows, (select row_to_json(tot) from tot) tot`)[0] ?? {};
  const rows = ((r.rows as Array<Record<string, unknown>>) ?? []);
  const more = rows.length > size, page = rows.slice(0, size);
  const t = (r.tot as Record<string, number> | null) ?? { shown: 0, empty_n: 0, open_v: 0, won_v: 0, lost_v: 0, open_n: 0, won_n: 0, lost_n: 0, stale_n: 0, no_owner_n: 0 };

  // The mini stacks: open money per stage for just the cards on this page, in the pipeline's own stage order; a stage the pipeline no longer has is "Other stage".
  const minis = new Map<string, Array<{ name: string; value: number }>>();
  if (page.length) {
    const locs = page.map((c) => c.location_id as string), pids = page.map((c) => c.pipeline_id as string);
    const [sv, defs] = await Promise.all([
      db`select o.location_id, o.pipeline_id, o.stage_id, sum(o.monetary_value)::float8 v from cached_opportunities o
         where o.installation_id = ${s.inst} and (o.location_id, o.pipeline_id) in (select * from unnest(${locs}::text[], ${pids}::text[]))
           and lower(coalesce(o.status, 'open')) = 'open' and o.monetary_value > 0 and o.assigned_to is not null group by 1, 2, 3`,
      db`select p.location_id, p.pipeline_id, p.stages from pipelines p where p.installation_id = ${s.inst} and (p.location_id, p.pipeline_id) in (select * from unnest(${locs}::text[], ${pids}::text[]))`,
    ]);
    for (const d of defs) {
      const key = `${d.location_id}|${d.pipeline_id}`, stages = ((d.stages as Array<{ id?: string; name?: string }>) ?? []).filter((x) => x?.id);
      const have = new Map(sv.filter((x) => x.location_id === d.location_id && x.pipeline_id === d.pipeline_id).map((x) => [x.stage_id as string, Number(x.v)]));
      const list = stages.map((x) => ({ name: x.name ?? "Stage", value: have.get(x.id as string) ?? 0 }));
      const known = new Set(stages.map((x) => x.id as string));
      const other = [...have.entries()].filter(([id]) => !known.has(id)).reduce((a, [, v]) => a + v, 0);
      if (other > 0) list.push({ name: "Other stage", value: other });
      minis.set(key, list);
    }
    for (const c of page) { const key = `${c.location_id}|${c.pipeline_id}`; if (!minis.has(key)) { const only = sv.filter((x) => `${x.location_id}|${x.pipeline_id}` === key).reduce((a, x) => a + Number(x.v), 0); minis.set(key, only > 0 ? [{ name: "Other stage", value: only }] : []); } }
  }
  const cards: PipeCard[] = page.map((c) => ({
    locationId: c.location_id as string, pipelineId: c.pipeline_id as string, accountName: (c.account_name as string | null) ?? "Account", name: c.name as string,
    openCount: Number(c.open_n), openValue: Math.round(Number(c.open_v)), wonCount: Number(c.won_n), wonValue: Math.round(Number(c.won_v)), lostCount: Number(c.lost_n), lostValue: Math.round(Number(c.lost_v)),
    staleCount: Number(c.stale_n), noOwnerCount: Number(c.no_owner_n), zeroValueCount: Number(c.zero_n), empty: c.is_empty === true,
    mini: (minis.get(`${c.location_id}|${c.pipeline_id}`) ?? []).slice(0, 12).map((x) => ({ name: x.name, value: Math.round(x.value) })),
  }));
  const last = page[page.length - 1];
  return {
    cards, next: more && last ? `${Number(last.open_v).toFixed(2).replace(/\.00$/, "")}|${last.location_id}|${last.pipeline_id}` : null,
    totals: { pipelines: t.shown, emptyHidden: o.showEmpty ? 0 : t.empty_n, openValue: Math.round(t.open_v), wonValue: Math.round(t.won_v), lostValue: Math.round(t.lost_v), openCount: t.open_n, wonCount: t.won_n, lostCount: t.lost_n, staleCount: t.stale_n, noOwnerCount: t.no_owner_n },
  };
}
