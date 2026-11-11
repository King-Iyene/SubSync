import { sql } from "../db";
import { featureOn } from "../flags";
import { refreshRollup } from "./pipeline3-rollup";
import { diffDeal, OWN_WRITE_WINDOW_MS, type DealEvent, type DealKind, type DealSnap } from "./pipeline3-diff.ts";
import { dealForecastRange, staleLimitFrom } from "./pipeline3-intel.ts";
export type { DealEvent, DealKind, DealSnap };

// The Pipeline moat writer. Fills the append-only deal_history and the per-deal deal_facts, flag pl_record. Idempotent everywhere: every event has a unique event_key per
// account (keys use the platform's own change time), so a repeated webhook, a retry, the sync page that sees the same change or an overlapping hourly sweep inserts nothing
// twice. Metadata only: no message text. Three sources: (a) webhooks, (b) sync pages (both diffed against the stored row BEFORE the cache is updated), (c) the hourly sweep
// (backfill of older deal_events once, a catch-up for missed webhooks, the per-stage dwell table and the daily forecast log). A change matching a recent write of our own
// (a 'subsync' row for the same deal and value) is recorded with actor_kind = 'subsync' and so is never counted as team activity.

type Meta = { installationId: string; locationId: string; opportunityId: string; contactId: string | null };
const asMs = (v: unknown) => (v instanceof Date ? v.getTime() : null);
const iso = (v: unknown) => (v === null || v === undefined ? null : Number.isFinite(Date.parse(String(v))) ? Date.parse(String(v)) : null);

/** Where recording began for this installation (set once). Older deal_events are backfilled only up to here. */
async function ensureState(installationId: string): Promise<void> {
  await sql()`insert into deal_record_state (installation_id) values (${installationId}) on conflict do nothing`;
}

/** Stage names for the events (renamed or reordered stages keep the name they had at the time). One small read per pipeline. */
async function stageNames(installationId: string, locationId: string, pipelineIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = [...new Set(pipelineIds.filter((x): x is string => !!x))];
  const m = new Map<string, string>();
  if (!ids.length) return m;
  const rows = await sql()`select stages from pipelines where installation_id = ${installationId} and location_id = ${locationId} and pipeline_id = any(${ids}::text[])`;
  for (const r of rows) for (const s of (r.stages as Array<{ id?: string; name?: string }>) ?? []) if (s?.id && s?.name) m.set(s.id, s.name);
  return m;
}

/** Writes events and updates the facts. Returns how many new history rows were written. */
export async function recordDealHistory(m: Meta, events: DealEvent[], lostReasonId?: string | null): Promise<number> {
  const db = sql();
  let written = 0;
  if (events.length) {
    const names = await stageNames(m.installationId, m.locationId, events.map((e) => e.pipelineId));
    for (const e of events) {
      const isStage = e.kind === "stage" || e.kind === "created";
      const r = await db`
        insert into deal_history (installation_id, location_id, opportunity_id, contact_id, pipeline_id, kind, event_key, from_value, to_value, from_name, to_name, value, dwell_seconds, actor_id, actor_kind, at)
        values (${m.installationId}, ${m.locationId}, ${m.opportunityId}, ${m.contactId}, ${e.pipelineId}, ${e.kind}, ${e.key}, ${e.from}, ${e.to},
          ${isStage && e.from ? names.get(e.from) ?? null : null}, ${isStage && e.to ? names.get(e.to) ?? null : null}, ${e.value}, ${e.dwellSeconds}, ${e.actorId}, ${e.actorKind}, ${new Date(e.at)})
        on conflict (installation_id, location_id, event_key) do nothing returning 1`;
      if (r.length) written++;
    }
  }
  if (lostReasonId) {
    await db`insert into deal_facts (installation_id, location_id, opportunity_id, lost_reason_id) values (${m.installationId}, ${m.locationId}, ${m.opportunityId}, ${lostReasonId})
      on conflict (installation_id, location_id, opportunity_id) do update set lost_reason_id = excluded.lost_reason_id, updated_at = now()`;
  }
  return written;
}

async function snapOf(installationId: string, locationId: string, id: string): Promise<DealSnap | null> {
  const [r] = await sql()`select stage_id, pipeline_id, status, monetary_value, assigned_to, source, contact_id, last_stage_change_at, last_status_change_at, created_remote_at
    from cached_opportunities where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = ${id}`;
  if (!r) return null;
  const f = await sql()`select lost_reason_id from deal_facts where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = ${id}`;
  return {
    stageId: (r.stage_id as string | null) ?? null, pipelineId: (r.pipeline_id as string | null) ?? null, status: (r.status as string | null) ?? null,
    value: r.monetary_value === null || r.monetary_value === undefined ? null : Number(r.monetary_value), ownerId: (r.assigned_to as string | null) ?? null, source: (r.source as string | null) ?? null,
    lostReasonId: (f[0]?.lost_reason_id as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null,
    lastStageChangeAt: asMs(r.last_stage_change_at), lastStatusChangeAt: asMs(r.last_status_change_at), createdAt: asMs(r.created_remote_at),
  };
}

async function ownWrites(installationId: string, locationId: string, id: string, at: number) {
  const own = await sql()`select kind, to_value, at from deal_history where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = ${id}
    and actor_kind = 'subsync' and at > ${new Date(at - OWN_WRITE_WINDOW_MS)}`;
  return own.map((r) => ({ kind: r.kind as DealKind, to: (r.to_value as string | null) ?? null, at: asMs(r.at) ?? at }));
}

/** Webhook hook: call BEFORE the cache row is updated or removed. Never throws (the webhook must still apply). */
export async function recordDealFromWebhook(i: { installationId: string; locationId: string; opportunityId: string; type: "OpportunityCreate" | "OpportunityUpdate" | "OpportunityDelete"; next?: Partial<DealSnap>; actorId?: string | null; at?: number }): Promise<number> {
  try {
    const at = i.at ?? Date.now();
    await ensureState(i.installationId);
    const prev = await snapOf(i.installationId, i.locationId, i.opportunityId);
    const meta: Meta = { installationId: i.installationId, locationId: i.locationId, opportunityId: i.opportunityId, contactId: prev?.contactId ?? i.next?.contactId ?? null };
    if (i.type === "OpportunityDelete") {
      const r = await sql()`insert into deal_history (installation_id, location_id, opportunity_id, contact_id, pipeline_id, kind, event_key, from_value, value, actor_id, actor_kind, at)
        values (${i.installationId}, ${i.locationId}, ${i.opportunityId}, ${meta.contactId}, ${prev?.pipelineId ?? null}, 'deleted', ${`deleted|${i.opportunityId}`}, ${prev?.status ?? null}, ${prev?.value ?? null}, ${i.actorId ?? null}, ${i.actorId ? "person" : "unknown"}, ${new Date(at)})
        on conflict (installation_id, location_id, event_key) do nothing returning 1`;
      await sql()`insert into deal_facts (installation_id, location_id, opportunity_id, removed_at) values (${i.installationId}, ${i.locationId}, ${i.opportunityId}, ${new Date(at)})
        on conflict (installation_id, location_id, opportunity_id) do update set removed_at = coalesce(deal_facts.removed_at, excluded.removed_at), updated_at = now()`;
      return r.length;
    }
    const n = i.next ?? {};
    const next: DealSnap = {
      stageId: n.stageId ?? prev?.stageId ?? null, pipelineId: n.pipelineId ?? prev?.pipelineId ?? null, status: n.status ?? prev?.status ?? null, value: n.value ?? prev?.value ?? null,
      ownerId: n.ownerId === undefined ? prev?.ownerId ?? null : n.ownerId, source: n.source ?? prev?.source ?? null, lostReasonId: n.lostReasonId ?? prev?.lostReasonId ?? null, contactId: meta.contactId,
      lastStageChangeAt: n.lastStageChangeAt ?? prev?.lastStageChangeAt ?? null, lastStatusChangeAt: n.lastStatusChangeAt ?? prev?.lastStatusChangeAt ?? null, createdAt: n.createdAt ?? prev?.createdAt ?? null,
    };
    const events = diffDeal(i.opportunityId, prev, next, { at, actorId: i.actorId ?? null, own: await ownWrites(i.installationId, i.locationId, i.opportunityId, at) });
    return recordDealHistory(meta, events, next.lostReasonId);
  } catch (e) {
    console.error("deal history not recorded", { message: e instanceof Error ? e.message : "error" });
    return 0;
  }
}

export type SyncDeal = { opportunityId: string; stageId: string | null; pipelineId: string | null; status: string; monetaryValue: number; assignedTo: string | null; source: string | null; contactId: string | null;
  lastStageChangeAt: string | null; lastStatusChangeAt: string | null; createdAt: string | null; lostReasonId?: string | null };

/** Sync hook: a page of deals, diffed against the stored rows BEFORE the cache is written. Flag pl_record. Never throws. */
export async function recordDealsFromSync(installationId: string, locationId: string, incoming: SyncDeal[]): Promise<number> {
  try {
    if (!incoming.length || !(await featureOn("pl_record"))) return 0;
    await ensureState(installationId);
    const db = sql(), ids = incoming.map((o) => o.opportunityId), at = Date.now();
    const [before, facts, own] = await Promise.all([
      db`select opportunity_id, stage_id, pipeline_id, status, monetary_value, assigned_to, source, contact_id, last_stage_change_at, last_status_change_at, created_remote_at from cached_opportunities
        where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = any(${ids}::text[])`,
      db`select opportunity_id, lost_reason_id from deal_facts where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = any(${ids}::text[])`,
      db`select opportunity_id, kind, to_value, at from deal_history where installation_id = ${installationId} and location_id = ${locationId} and opportunity_id = any(${ids}::text[]) and actor_kind = 'subsync' and at > ${new Date(at - OWN_WRITE_WINDOW_MS)}`,
    ]);
    const prevMap = new Map(before.map((r) => [r.opportunity_id as string, r]));
    const factMap = new Map(facts.map((r) => [r.opportunity_id as string, (r.lost_reason_id as string | null) ?? null]));
    let written = 0;
    for (const o of incoming) {
      const p = prevMap.get(o.opportunityId);
      const prev: DealSnap | null = p
        ? { stageId: (p.stage_id as string | null) ?? null, pipelineId: (p.pipeline_id as string | null) ?? null, status: (p.status as string | null) ?? null, value: p.monetary_value === null ? null : Number(p.monetary_value), ownerId: (p.assigned_to as string | null) ?? null,
            source: (p.source as string | null) ?? null, lostReasonId: factMap.get(o.opportunityId) ?? null, contactId: (p.contact_id as string | null) ?? null, lastStageChangeAt: asMs(p.last_stage_change_at), lastStatusChangeAt: asMs(p.last_status_change_at), createdAt: asMs(p.created_remote_at) }
        : null;
      const next: DealSnap = { stageId: o.stageId, pipelineId: o.pipelineId, status: o.status, value: o.monetaryValue, ownerId: o.assignedTo, source: o.source, lostReasonId: o.lostReasonId ?? prev?.lostReasonId ?? null, contactId: o.contactId,
        lastStageChangeAt: iso(o.lastStageChangeAt), lastStatusChangeAt: iso(o.lastStatusChangeAt), createdAt: iso(o.createdAt) };
      const events = diffDeal(o.opportunityId, prev, next, { at, own: own.filter((w) => w.opportunity_id === o.opportunityId).map((w) => ({ kind: w.kind as DealKind, to: (w.to_value as string | null) ?? null, at: asMs(w.at) ?? at })) });
      written += await recordDealHistory({ installationId, locationId, opportunityId: o.opportunityId, contactId: o.contactId }, events, next.lostReasonId !== prev?.lostReasonId ? next.lostReasonId : null);
    }
    return written;
  } catch (e) {
    console.error("deal history not recorded (sync)", { message: e instanceof Error ? e.message : "error" });
    return 0;
  }
}

/** Hourly sweep, set-based and idempotent. Returns counts per step. */
export async function sweepDealHistory(installationId: string, sinceHours = 72): Promise<Record<string, number>> {
  const db = sql(), rep: Record<string, number> = {};
  await ensureState(installationId);
  // 1. One-time backfill of the older deal_events (kept by the sync since install), only for what happened BEFORE recording began here, so nothing is counted twice.
  const [st] = await db`select since, backfilled_at from deal_record_state where installation_id = ${installationId}`;
  if (st && !st.backfilled_at) {
    rep.backfill = (await db`
      insert into deal_history (installation_id, location_id, opportunity_id, contact_id, pipeline_id, kind, event_key, from_value, to_value, value, actor_kind, at, detail)
      select e.installation_id, e.location_id, e.opportunity_id, o.contact_id, o.pipeline_id, e.kind, 'ev|' || e.id, e.from_value, e.to_value, e.value, 'unknown', e.at, '{"src":"deal_events"}'::jsonb
      from deal_events e left join cached_opportunities o on o.installation_id = e.installation_id and o.location_id = e.location_id and o.opportunity_id = e.opportunity_id
      where e.installation_id = ${installationId} and e.at < ${st.since as Date}
      on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;
    await db`update deal_record_state set backfilled_at = now() where installation_id = ${installationId}`;
  }
  // 2. Catch-up for missed webhooks: a recently changed cached deal whose stage or status differs from the last one recorded gets the same content-keyed event the webhook would have written.
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  rep.created = (await db`
    insert into deal_history (installation_id, location_id, opportunity_id, contact_id, pipeline_id, kind, event_key, to_value, value, actor_kind, at)
    select o.installation_id, o.location_id, o.opportunity_id, o.contact_id, o.pipeline_id, 'created', 'created|' || o.opportunity_id,
      case when o.last_stage_change_at is null or o.last_stage_change_at <= coalesce(o.created_remote_at, o.synced_at) + interval '1 minute' then o.stage_id end,
      o.monetary_value, 'system', coalesce(o.created_remote_at, o.synced_at)
    from cached_opportunities o where o.installation_id = ${installationId} and o.synced_at > ${since}
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;
  rep.stages = (await db`
    insert into deal_history (installation_id, location_id, opportunity_id, contact_id, pipeline_id, kind, event_key, from_value, to_value, value, actor_kind, at)
    select o.installation_id, o.location_id, o.opportunity_id, o.contact_id, o.pipeline_id, 'stage', 'stage|' || o.opportunity_id || '|' || o.stage_id || '|' || (extract(epoch from o.last_stage_change_at) * 1000)::bigint,
      (select h.to_value from deal_history h where h.installation_id = o.installation_id and h.location_id = o.location_id and h.opportunity_id = o.opportunity_id and h.kind in ('created', 'stage') and h.to_value is not null order by h.at desc limit 1),
      o.stage_id, o.monetary_value, 'unknown', o.last_stage_change_at
    from cached_opportunities o where o.installation_id = ${installationId} and o.synced_at > ${since} and o.stage_id is not null and o.last_stage_change_at is not null
      and o.stage_id is distinct from (select h.to_value from deal_history h where h.installation_id = o.installation_id and h.location_id = o.location_id and h.opportunity_id = o.opportunity_id and h.kind in ('created', 'stage') and h.to_value is not null order by h.at desc limit 1)
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;
  rep.statuses = (await db`
    insert into deal_history (installation_id, location_id, opportunity_id, contact_id, pipeline_id, kind, event_key, from_value, to_value, value, actor_kind, at)
    select o.installation_id, o.location_id, o.opportunity_id, o.contact_id, o.pipeline_id, 'status', 'status|' || o.opportunity_id || '|' || lower(o.status) || '|' || (extract(epoch from o.last_status_change_at) * 1000)::bigint,
      coalesce((select h.to_value from deal_history h where h.installation_id = o.installation_id and h.location_id = o.location_id and h.opportunity_id = o.opportunity_id and h.kind = 'status' order by h.at desc limit 1), 'open'),
      lower(o.status), o.monetary_value, 'unknown', o.last_status_change_at
    from cached_opportunities o where o.installation_id = ${installationId} and o.synced_at > ${since} and o.status is not null and o.last_status_change_at is not null
      and lower(o.status) <> coalesce((select h.to_value from deal_history h where h.installation_id = o.installation_id and h.location_id = o.location_id and h.opportunity_id = o.opportunity_id and h.kind = 'status' order by h.at desc limit 1), 'open')
    on conflict (installation_id, location_id, event_key) do nothing returning 1`).length;
  rep.stats = await refreshStageStats(installationId);
  try { rep.rollup = (await refreshRollup(installationId)).rebuilt; } catch { rep.rollup = -1; } // the stored deal totals; the screens fall back to the live scan if this fails
  rep.forecast = await logForecast(installationId);
  return rep;
}

/** Per-stage dwell from the account's own completed stays, plus the stale limit for every stage of every pipeline (own p75 when there are 20 stays, else an estimate). */
export async function refreshStageStats(installationId: string): Promise<number> {
  const db = sql();
  const rows = await db`
    with ev as (
      select location_id, opportunity_id, kind, to_value, at, id from deal_history
      where installation_id = ${installationId} and kind in ('created', 'stage', 'status') and at > now() - interval '365 days'
    ), st as (
      select location_id, to_value stage_id, kind, at, lead(at) over (partition by location_id, opportunity_id order by at, id) exit_at from ev
    ), stays as (
      select location_id, stage_id, extract(epoch from (exit_at - at)) / 86400 days from st where kind in ('created', 'stage') and stage_id is not null and exit_at is not null and exit_at >= at
    ), agg as (
      select location_id, stage_id, count(*)::int n, percentile_cont(0.5) within group (order by days) med, percentile_cont(0.75) within group (order by days) p75, percentile_cont(0.9) within group (order by days) p90
      from stays group by 1, 2
    ), won as (
      select location_id, count(*)::int n, percentile_cont(0.5) within group (order by extract(epoch from (last_status_change_at - created_remote_at)) / 86400) cycle
      from cached_opportunities where installation_id = ${installationId} and status = 'won' and created_remote_at is not null and last_status_change_at >= created_remote_at group by 1
    ), allst as (
      select pl.location_id, s->>'id' stage_id, jsonb_array_length(pl.stages) cnt from pipelines pl, jsonb_array_elements(pl.stages) s where pl.installation_id = ${installationId}
    )
    select a.location_id, a.stage_id, coalesce(g.n, 0) stays, g.med, g.p75, g.p90, a.cnt, w.n won_n, w.cycle from allst a
      left join agg g on g.location_id = a.location_id and g.stage_id = a.stage_id left join won w on w.location_id = a.location_id where a.stage_id is not null`;
  let n = 0;
  for (const r of rows) {
    const lim = staleLimitFrom({ stays: Number(r.stays), p75: r.p75 === null ? null : Number(r.p75), stageCount: Number(r.cnt), wonN: r.won_n === null ? 0 : Number(r.won_n), wonCycleDays: r.cycle === null ? null : Number(r.cycle) });
    await db`insert into deal_stage_stats (installation_id, location_id, stage_id, stays, median_days, p75_days, p90_days, limit_days, is_estimate)
      values (${installationId}, ${r.location_id as string}, ${r.stage_id as string}, ${Number(r.stays)}, ${r.med}, ${r.p75}, ${r.p90}, ${lim.days}, ${lim.estimate})
      on conflict (installation_id, location_id, stage_id) do update set stays = excluded.stays, median_days = excluded.median_days, p75_days = excluded.p75_days, p90_days = excluded.p90_days,
        limit_days = excluded.limit_days, is_estimate = excluded.is_estimate, updated_at = now()`;
    n++;
  }
  return n;
}

/** One forecast range per account per day (idempotent), so the track record can later show how often the range held. Uses the same eligibility as the screen. */
export async function logForecast(installationId: string): Promise<number> {
  const db = sql();
  const rows = await db`
    with w as (select location_id, count(*) filter (where status = 'won')::int won, count(*) filter (where status = 'lost')::int lost,
          percentile_cont(0.5) within group (order by extract(epoch from (last_status_change_at - created_remote_at)) / 86400) filter (where status = 'won' and created_remote_at is not null and last_status_change_at >= created_remote_at) cycle
        from cached_opportunities
        where installation_id = ${installationId} and last_status_change_at > now() - interval '365 days' group by 1),
    o as (select location_id, coalesce(sum(monetary_value), 0)::float8 val, count(*)::int n from cached_opportunities
        where installation_id = ${installationId} and status = 'open' and monetary_value > 0 and assigned_to is not null group by 1)
    select o.location_id, o.val, o.n, coalesce(w.won, 0) won, coalesce(w.lost, 0) lost, w.cycle from o left join w on w.location_id = o.location_id`;
  let n = 0;
  for (const r of rows) {
    const won = Number(r.won), closed = won + Number(r.lost);
    const range = dealForecastRange(Number(r.val), won, closed, r.cycle === null ? null : Number(r.cycle));
    if (!range) continue;
    const ins = await db`insert into deal_forecast_log (installation_id, location_id, day, low, mid, high, open_value, open_count)
      values (${installationId}, ${r.location_id as string}, current_date, ${range.low}, ${range.mid}, ${range.high}, ${Number(r.val)}, ${Number(r.n)}) on conflict do nothing returning 1`;
    n += ins.length;
  }
  return n;
}
