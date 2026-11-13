import { createHash } from "node:crypto";
import { sql } from "../db";
import { APP_TZ, localDay } from "../design/zone";
import { rollupCloses, rollupFlow, rollupFresh, rollupHeadline, rollupOpenByStage } from "./pipeline3-rollup";
import { ttlCache } from "../ttl-cache";
import { dealScopeJoins, outOfScope, valueSuspect } from "./stage-rules-sql";
import { dealTrust } from "./deal-trust-queries";
import { TEST_NAME_PATTERN, HOW_LEFT_OUT, HOW_STALE_WORKED_OUT, countingLine, leftOutLine, MIN_STAGE_STAYS, STAGE_LIMIT_CAP_DAYS, STAGE_LIMIT_FLOOR_DAYS } from "./deal-trust";
import {
  atRiskEstimate, bucketOf, buildReplay, buildStages, clampSize, coachingLine, DAY, DEFAULT_LIMIT_DAYS, eventText, findLeak, forecastEstimate, headlineOf, healthScore, dealHealth, MIN_CLOSED, MIN_LOST_REASONS,
  MIN_STAYS, median, money, NO_EST, pickButton, rate, slug, stageKey, stageProbability, trackRecord, velocityEstimate, weightedPipeline, type DayMove, type StageAgg, type StageLoss, type StageMeta,
  parseDealCursor,
} from "./pipeline3-intel.ts";
import type {
  FlowDrain, FlowEdge, FlowPerson, Page, Pl3Attention, Pl3Bucket, Pl3Detail, Pl3Forecast, Pl3Health, Pl3HistoryEvent, Pl3MoneyFlow, Pl3Overview, Pl3People, Pl3Person, Pl3Receipt, Pl3Replay, Pl3Row,
  Pl3Sources, Pl3StageHistory, Pl3WonLost,
} from "./pipeline3-types.ts";

// The reads behind /api/app/pipeline3?part=... Read only; every figure is a SQL aggregate and every list is server-paged, so a million deals cost the same as a hundred. The
// accounts a caller may see (`allowed`) come from the signed session in the router, never from the request; a `location` filter can only NARROW that set. ONE definition of
// every derived column lives in `deals()` below, so a count and the list behind it cannot disagree. Deals removed in the CRM (deal_facts.removed_at) are in no number. Our own
// writes (deal_history.actor_kind = 'subsync') are never counted as team activity. Definitions: docs/METRICS.md "Pipeline 3".

export type Db = ReturnType<typeof sql>;
export type Frag = ReturnType<Db>;
export type Scope = { inst: string; allowed: string[] | null };
export type Filters = { from: Date; to: Date; location?: string | null; pipeline?: string | null; stage?: string | null; stageKey?: string | null; owner?: string | null; source?: string | null; q?: string | null; bucket?: Pl3Bucket | null; reason?: string | null; includeTest?: boolean };
export type Rec = Record<string, unknown>;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const cleanId = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
// A `date` column comes back as midnight UTC of its own label, so reading it by its UTC label is right (it is already a local day: see the rollups and `at time zone ${APP_TZ}` below).
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
export const plCache = ttlCache<unknown>(30_000, 300);

/** Whole words that make a deal look like a test: the one pattern in deal-trust.ts. The company switch (settings.count_test_deals) or the per-screen toggle counts such deals anyway. */
const TEST_RE = TEST_NAME_PATTERN;

export function locs(s: Scope, location?: string | null): Frag {
  const db = sql();
  const one = cleanId(location);
  return db`select l.location_id, l.name from locations l where l.installation_id = ${s.inst} and not l.ignored ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``} ${one ? db`and l.location_id = ${one}` : db``}`;
}

/** The derived deal set, as CTE definitions to put after `with`: d0 (raw), d1 (counted, stale), lo (open totals per account), d (outlier flag). Alias `d` in every query. */
export function deals(s: Scope, f: Filters): Frag {
  const db = sql();
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m).slice(0, 60)}%` : null;
  const pipe = f.pipeline ? slug(f.pipeline) : null;
  return db`
    d0 as (
      select o.location_id, o.opportunity_id, o.pipeline_id, o.stage_id, o.contact_id, o.name, lower(coalesce(o.status, 'open')) status, coalesce(o.monetary_value, 0)::float8 value,
        o.assigned_to owner, nullif(btrim(o.source), '') source, o.created_remote_at created_at, o.last_stage_change_at, o.last_status_change_at,
        greatest(o.last_action_at, o.updated_remote_at) last_activity_at, l.name account_name,
        ${like ? db`coalesce(nullif(c.full_name, ''), nullif(o.contact_name, ''), 'Unnamed contact')` : db`coalesce(nullif(o.contact_name, ''), 'Unnamed contact')`} contact_name, ${like ? db`coalesce(c.dnd, false)` : db`false`} dnd,
        coalesce(sc_pl.name, 'Pipeline') pipeline_name, coalesce(sc_st.nm, 'Unknown stage') stage_name, coalesce(sc_st.ord, 999)::int stage_ord,
        df.lost_reason_id, df.lost_reason,
        (case when ss.stays >= ${MIN_STAGE_STAYS} and ss.p75_days is not null then greatest(${STAGE_LIMIT_FLOOR_DAYS}::numeric, least(${STAGE_LIMIT_CAP_DAYS}::numeric, ss.p75_days)) end)::float8 limit_days, false limit_est, ss.median_days::float8 norm_days, coalesce(ss.stays, 0) stays,
        extract(epoch from (now() - coalesce(o.last_stage_change_at, o.created_remote_at, o.synced_at))) / 86400 days_in_stage,
        ((coalesce(o.name, '') ~* ${TEST_RE} or coalesce(o.contact_name, '') ~* ${TEST_RE}) and not coalesce(sc_cfg.count_test_deals, false)) is_test,
        (o.assigned_to is not null or coalesce(sc_cfg.count_ownerless_deals, false)) owner_ok,
        ${outOfScope()} out_of_scope, ${valueSuspect(f.includeTest === true)} suspect
      from cached_opportunities o
      join (${locs(s, f.location)}) l on l.location_id = o.location_id
      ${dealScopeJoins()}
      ${like ? db`left join cached_contacts c on c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = o.contact_id` : db``}
      left join deal_facts df on df.installation_id = o.installation_id and df.location_id = o.location_id and df.opportunity_id = o.opportunity_id
      left join deal_stage_stats ss on ss.installation_id = o.installation_id and ss.location_id = o.location_id and ss.stage_id = o.stage_id
      where o.installation_id = ${s.inst} and df.removed_at is null
        ${pipe ? db`and lower(btrim(coalesce(sc_pl.name, ''))) = ${pipe}` : db``}
        ${f.stage ? db`and o.stage_id = ${f.stage}` : db``}
        ${f.stageKey ? db`and lower(regexp_replace(btrim(coalesce(sc_pl.name, '')), '[[:space:]]+', ' ', 'g')) || '|' || lower(regexp_replace(btrim(coalesce(sc_st.nm, '')), '[[:space:]]+', ' ', 'g')) = ${f.stageKey}` : db``}
        ${f.owner ? (f.owner === "none" ? db`and o.assigned_to is null` : db`and o.assigned_to = ${f.owner}`) : db``}
        ${f.source ? (f.source === "none" ? db`and nullif(btrim(o.source), '') is null` : db`and o.source = ${f.source}`) : db``}
        ${like ? db`and (o.name ilike ${like} or o.contact_name ilike ${like} or c.full_name ilike ${like})` : db``}
    ),
    d1 as (
      select d0.*, (d0.value > 0 and d0.owner_ok and not d0.out_of_scope ${f.includeTest ? db`` : db`and not d0.is_test`}) counted from d0
    ),
    /* MATERIALIZED: left inlined, the planner re-ran this total once per deal (92 s at 55,000 deals; 2.5 s now). docs/QA_SCALE.md */
    lo as materialized (select location_id, sum(value)::float8 total, count(*)::int n from d1 where status = 'open' and counted group by 1),
    d as (
      select d1.*, lo.total loc_total, (d1.status = 'open' and d1.counted and ((lo.n >= 3 and d1.value > 0.4 * lo.total) or d1.suspect is not null)) outlier,
        (d1.status = 'open' and d1.counted and coalesce(d1.days_in_stage > d1.limit_days, false)) stale
      from d1 left join lo on lo.location_id = d1.location_id
    )`;
}

export const P_OPEN = (db: Db) => db`d.status = 'open' and d.counted and not d.outlier`;
export const P_STALE = (db: Db) => db`d.status = 'open' and d.counted and not d.outlier and d.stale`;
export const P_NO_OWNER = (db: Db) => db`d.status = 'open' and not d.out_of_scope and not d.is_test and d.value > 0 and not d.owner_ok`;
export const P_NO_VALUE = (db: Db) => db`d.status = 'open' and not d.out_of_scope and not d.is_test and d.value <= 0`;
const P_FLAG = (db: Db) => db`(d.status = 'open' and not d.out_of_scope and (d.is_test or d.stale or d.outlier or (d.value > 0 and not d.owner_ok) or d.value <= 0))`;

function bucketCond(db: Db, s: Scope, f: Filters): Frag {
  const win = db`d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to} and not d.is_test`;
  switch (f.bucket) {
    case "open": return db`and ${P_OPEN(db)}`;
    case "stale": return db`and ${P_STALE(db)}`;
    case "healthy": return db`and ${P_OPEN(db)} and not d.stale`;
    case "outlier": return db`and d.outlier`;
    case "no_owner": return db`and ${P_NO_OWNER(db)}`;
    case "no_value": return db`and ${P_NO_VALUE(db)}`;
    case "test": return db`and d.is_test and d.status = 'open' and not d.out_of_scope`;
    case "won": return db`and d.status = 'won' and ${win}`;
    case "lost": return db`and d.status = 'lost' and ${win}`;
    case "abandoned": return db`and d.status = 'abandoned' and ${win}`;
    case "no_reason": return db`and d.status = 'lost' and ${win} and d.lost_reason_id is null and d.lost_reason is null`;
    case "booked_appt": return db`and d.contact_id is not null and exists (select 1 from cached_appointments a where a.installation_id = ${s.inst} and a.location_id = d.location_id and a.contact_id = d.contact_id and a.status not in ('cancelled', 'invalid'))`;
    case "no_appt": return db`and (d.contact_id is null or not exists (select 1 from cached_appointments a where a.installation_id = ${s.inst} and a.location_id = d.location_id and a.contact_id = d.contact_id and a.status not in ('cancelled', 'invalid')))`;
    default: return db``;
  }
}

export async function names(inst: string): Promise<(id: string | null | undefined) => string> {
  const rows = await sql()`select user_id, name from team_names where installation_id = ${inst}`;
  const m = new Map(rows.map((r) => [r.user_id as string, r.name as string]));
  return (id) => (!id || id === "unassigned" ? "Not assigned" : m.get(id) ?? "Team member (name not available)");
}

type StageInfo = StageMeta & { pipelineKey: string; locationId: string; stageId: string };
/** Every stage of every pipeline the caller may see: (account, stage id) to the merged key, name and order. */
async function stageMap(s: Scope, location?: string | null): Promise<Map<string, StageInfo>> {
  const db = sql();
  const rows = await db`select p.location_id, p.pipeline_id, p.name, p.stages from pipelines p join (${locs(s, location)}) l on l.location_id = p.location_id where p.installation_id = ${s.inst}`;
  const m = new Map<string, StageInfo>();
  for (const r of rows) {
    const stages = (r.stages as Array<{ id?: string; name?: string }>) ?? [];
    stages.forEach((st, i) => {
      if (!st?.id) return;
      const pn = (r.name as string | null) ?? "Pipeline", sn = st.name ?? "Stage";
      m.set(`${r.location_id}|${st.id}`, { key: stageKey(pn, sn), name: sn, order: i + 1, pipelineName: pn, pipelineKey: slug(pn), locationId: r.location_id as string, stageId: st.id });
    });
  }
  return m;
}
const OTHER_STAGE = "other-stage";
const keyOf = (m: Map<string, StageInfo>, loc: unknown, stage: unknown) => m.get(`${loc}|${stage}`) ?? null;

// ---------- row mapping ----------

async function trustFor(s: Scope, location?: string | null): Promise<Pl3Overview["trust"]> {
  try {
    const rows = await sql()`select x.location_id from (${locs(s, location)}) x`;
    const ids = rows.map((r) => r.location_id as string), t = await dealTrust(s.inst, ids);
    return { counting: countingLine(t.counted.deals, t.leftOut), leftOutLine: leftOutLine(t.leftOut), leftOutDeals: t.leftOut.deals, notJudged: t.leftOut.notJudged, howStale: HOW_STALE_WORKED_OUT, howLeftOut: HOW_LEFT_OUT };
  } catch { return null; }
}
const LEFT_OUT_WHY: Record<string, string> = {
  outreach: "Looks like part of an outreach list, not a sales deal (left out of the dollar totals)",
  default_value: "Looks like a default value: the same amount is on many deals in this step (left out of the dollar totals)",
  outlier: "Looks like a test or placeholder amount (left out of the dollar totals)",
  test: "Looks like a test deal (left out of the dollar totals)",
};
export function toRow(r: Rec, label: (id: string | null | undefined) => string, link: ((loc: string, contact: string) => string) | null): Pl3Row {
  const st = String(r.status ?? "open"), status: Pl3Row["status"] = st === "won" || st === "lost" || st === "abandoned" ? st : "open";
  const value = num(r.value), ownerId = (r.owner as string | null) ?? null, daysInStage = r.days_in_stage === null || r.days_in_stage === undefined ? null : Math.round(Number(r.days_in_stage) * 10) / 10;
  const limit = r.limit_days === null || r.limit_days === undefined ? null : Number(r.limit_days);
  const stale = r.stale === true, outlier = r.outlier === true, isTest = r.is_test === true, counted = r.counted === true;
  const activity = r.last_activity_at instanceof Date ? Math.floor((Date.now() - r.last_activity_at.getTime()) / DAY) : null;
  const h = dealHealth({ status, value, ownerId, isTest, daysInStage, staleLimitDays: limit, daysSinceActivity: activity, hasAppointment: !!r.appt_id, dnd: (r.cdnd ?? r.dnd) === true });
  const bucket = bucketOf({ status, stale, outlier, isTest, ownerId, value, counted });
  const reason = (r.lost_reason as string | null) ?? (r.lost_reason_id ? `Reason ${String(r.lost_reason_id).slice(-4)}` : null);
  const why = stale ? `In ${r.stage_name} ${Math.floor(daysInStage ?? 0)} days, the usual limit is ${Math.round(limit ?? 0)}${r.limit_est === true ? " (estimate)" : ""}`
    : outlier ? (LEFT_OUT_WHY[String(r.suspect ?? "")] ?? `One large deal: more than 40% of this account's open money`) : bucket === "no_owner" ? "Nobody owns this deal" : bucket === "no_value" ? "No value set" : isTest ? "Looks like a test deal" : null;
  return {
    opportunityId: String(r.opportunity_id), locationId: String(r.location_id), accountName: (r.account_name as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null,
    contactName: ((r.cfull as string | null) || (r.contact_name as string | null)) ?? "Unnamed contact", name: (r.name as string | null) ?? null, url: link && r.contact_id ? link(String(r.location_id), String(r.contact_id)) : null,
    pipelineId: (r.pipeline_id as string | null) ?? null, pipelineName: (r.pipeline_name as string | null) ?? null, stageId: (r.stage_id as string | null) ?? null, stageName: (r.stage_name as string | null) ?? null,
    status, value, bucket, ownerId, ownerName: ownerId ? label(ownerId) : null, source: (r.source as string | null) ?? null, lostReason: status === "lost" ? reason : null,
    createdAt: iso(r.created_at), lastStageChangeAt: iso(r.last_stage_change_at), daysInStage, staleLimitDays: limit, stale,
    health: h.score, healthWhy: h.why,
    appointment: r.appt_id ? { appointmentId: String(r.appt_id), startAt: iso(r.appt_start) as string, status: String(r.appt_status ?? "") } : null,
    why, dnd: (r.cdnd ?? r.dnd) === true, outlier, isTest, leftOutReason: ((r.suspect as Pl3Row["leftOutReason"] | undefined) ?? null),
  };
}

export const offsetOf = (p: number, size: number) => Math.min(100_000, Math.max(0, Math.floor(p)) * size);
function sortOf(db: Db, sort: string | null | undefined, dir?: string | null): Frag {
  const asc = dir === "asc";
  switch (sort) {
    case "value": return asc ? db`d.value asc, d.opportunity_id` : db`d.value desc, d.opportunity_id`;
    case "age": return asc ? db`d.days_in_stage asc, d.opportunity_id` : db`d.days_in_stage desc, d.opportunity_id`;
    case "name": return asc ? db`d.contact_name asc, d.opportunity_id` : db`d.contact_name desc, d.opportunity_id`;
    case "closed": return asc ? db`d.last_status_change_at asc nulls last, d.opportunity_id` : db`d.last_status_change_at desc nulls last, d.opportunity_id`;
    default: return db`d.value desc, d.opportunity_id`;
  }
}

export type ListOpts = { f: Filters; page: number; size: number; sort?: string | null; dir?: string | null; extra?: Frag; after?: string | null; knownTotal?: number | null };
/** One page of deals. With the default order and a cursor (`after`), the page starts right after that deal (no offset to skip, and the total is not counted again: the caller passes the one it already has). */
export async function dealList(s: Scope, o: ListOpts, link: ((loc: string, contact: string) => string) | null): Promise<Page<Pl3Row>> {
  const db = sql(), size = clampSize(o.size), label = await names(s.inst);
  const w = deals(s, o.f), cond = bucketCond(db, s, o.f);
  const reasonCond = o.f.reason ? (o.f.reason === "none" ? db`and d.status = 'lost' and d.lost_reason_id is null and d.lost_reason is null` : db`and coalesce(d.lost_reason, 'Reason ' || right(d.lost_reason_id, 4)) = ${o.f.reason}`) : db``;
  const p = Math.max(0, Math.floor(o.page)), plainSort = !o.sort || o.sort === "value", cur = plainSort && o.dir !== "asc" ? parseDealCursor(o.after) : null;
  const keyset = cur ? db`and (d.value < ${cur.v} or (d.value = ${cur.v} and d.opportunity_id > ${cur.id}))` : db``;
  const rowsQ = db`with ${w} select pg.*, c.full_name cfull, c.dnd cdnd from (select x.*, ap.appointment_id appt_id, ap.start_at appt_start, ap.status appt_status from (select d.*, row_number() over (order by ${sortOf(db, o.sort, o.dir)}) rn from d where true ${cond} ${reasonCond} ${o.extra ?? db``} ${keyset} order by ${sortOf(db, o.sort, o.dir)} limit ${size + 1} offset ${cur ? 0 : offsetOf(p, size)}) x
      left join lateral (select a.appointment_id, a.start_at, a.status from cached_appointments a where a.installation_id = ${s.inst} and a.location_id = x.location_id and x.contact_id is not null and a.contact_id = x.contact_id and a.status not in ('cancelled', 'invalid') order by a.start_at desc limit 1) ap on true) pg
      left join cached_contacts c on c.installation_id = ${s.inst} and c.location_id = pg.location_id and c.contact_id = pg.contact_id order by pg.rn`;
  const countQ = cur && o.knownTotal != null ? Promise.resolve([{ n: o.knownTotal }] as Rec[]) : db`with ${w} select count(*)::int n from d where true ${cond} ${reasonCond} ${o.extra ?? db``}`;
  const [rows, c] = await Promise.all([rowsQ, countQ]);
  const total = num(c[0]?.n), more = rows.length > size, page = rows.slice(0, size), last = page[page.length - 1];
  return { rows: page.map((r) => toRow(r, label, link)), total, page: p, size, pages: Math.max(1, Math.ceil(total / size)), truncated: false, next: more && last && plainSort ? `${num(last.value)}|${last.opportunity_id}` : null };
}

// ---------- shared basis: closed deals, stage probabilities, cycle ----------

type Basis = { won: number; closed: number; prior: number | null; cycle: number | null; avgWon: number | null; probs: Map<string, { wins: number; passed: number }>; stageNames: Map<string, string> };
const basisMemo = ttlCache<Basis>(600_000, 200);
/** The win-rate basis moves slowly (a year of closed deals), so it is remembered for ten minutes. */
async function basis(s: Scope, f: Filters, sm: Map<string, StageInfo>): Promise<Basis> {
  const bk = JSON.stringify([s.inst, s.allowed, f.location ?? null, f.pipeline ?? null, f.owner ?? null, f.source ?? null, f.q ?? null]), hit = basisMemo.get(bk);
  if (hit) return hit;
  const v = await basisNow(s, f, sm);
  basisMemo.set(bk, v);
  return v;
}
async function basisNow(s: Scope, f: Filters, sm: Map<string, StageInfo>): Promise<Basis> {
  const db = sql();
  const w = deals(s, { ...f, bucket: null });
  const [[t], probRows] = await Promise.all([
    db`with ${w} select count(*) filter (where d.status = 'won')::int won, count(*) filter (where d.status in ('won', 'lost'))::int closed,
        percentile_cont(0.5) within group (order by extract(epoch from (d.last_status_change_at - d.created_at)) / 86400) filter (where d.status = 'won' and d.created_at is not null and d.last_status_change_at >= d.created_at) cycle,
        avg(d.value) filter (where d.status = 'won' and d.value > 0)::float8 avg_won
      from d where d.status in ('won', 'lost') and not d.is_test and d.last_status_change_at > now() - interval '365 days'`,
    db`with ${w}, reach as (select distinct d.location_id, h.to_value stage_id, d.opportunity_id, d.status from deal_history h join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id
        where h.installation_id = ${s.inst} and h.kind in ('created', 'stage') and h.to_value is not null and d.status in ('won', 'lost') and not d.is_test and h.at > now() - interval '365 days')
      select location_id, stage_id, count(*)::int passed, count(*) filter (where status = 'won')::int wins from reach group by 1, 2`,
  ]);
  const won = num(t?.won), closed = num(t?.closed), probs = new Map<string, { wins: number; passed: number }>(), stageNames = new Map<string, string>();
  for (const r of probRows) {
    const si = keyOf(sm, r.location_id, r.stage_id);
    if (!si) continue;
    const c = probs.get(si.key) ?? { wins: 0, passed: 0 };
    probs.set(si.key, { wins: c.wins + num(r.wins), passed: c.passed + num(r.passed) });
    stageNames.set(si.key, si.name);
  }
  return { won, closed, prior: closed >= MIN_CLOSED ? won / closed : null, cycle: numOrNull(t?.cycle), avgWon: numOrNull(t?.avg_won), probs, stageNames };
}

type OpenRow = { key: string; name: string; value: number; n: number; staleValue: number; staleN: number };
async function openByStage(s: Scope, f: Filters, sm: Map<string, StageInfo>, fromRollup = false): Promise<OpenRow[]> {
  const db = sql();
  const rows = fromRollup ? await rollupOpenByStage(s, f) : await db`with ${deals(s, { ...f, bucket: null })} select d.location_id, d.stage_id, count(*) filter (where ${P_OPEN(db)})::int n, coalesce(sum(d.value) filter (where ${P_OPEN(db)}), 0)::float8 v,
      count(*) filter (where ${P_STALE(db)})::int sn, coalesce(sum(d.value) filter (where ${P_STALE(db)}), 0)::float8 sv from d where d.status = 'open' group by 1, 2`;
  const m = new Map<string, OpenRow>();
  for (const r of rows) {
    const si = keyOf(sm, r.location_id, r.stage_id);
    const key = si?.key ?? `unknown|${r.stage_id ?? ""}`;
    const c = m.get(key) ?? { key, name: si?.name ?? "Unknown stage", value: 0, n: 0, staleValue: 0, staleN: 0 };
    m.set(key, { ...c, value: c.value + num(r.v), n: c.n + num(r.n), staleValue: c.staleValue + num(r.sv), staleN: c.staleN + num(r.sn) });
  }
  return [...m.values()];
}
const probOf = (b: Basis, key: string) => stageProbability(b.probs.get(key)?.wins ?? 0, b.probs.get(key)?.passed ?? 0, b.prior);

// ---------- overview ----------

export async function overview(s: Scope, f: Filters, windowDays: number): Promise<Pl3Overview> {
  // The basis under every dollar figure: the same shared function as Today, the Account audit and the Overview (deal-trust-queries.ts).
  const trust = await trustFor(s, f.location);
  const db = sql(), sm = await stageMap(s, f.location), base = { ...f, bucket: null };
  const w = deals(s, base), d30 = new Date(Math.floor((Date.now() - 30 * DAY) / DAY) * DAY); // whole days, so the rollup and the lists count the same deals
  const fresh = await rollupFresh(s, f.location);
  const [[t0], trend, [acc], [since], b, open0, closes0, [bigRow0]] = await Promise.all([
    fresh.fresh ? rollupHeadline(s, { location: f.location, pipeline: f.pipeline, d30 }).then((x) => [x]) : db`with ${w} select
        count(*) filter (where ${P_OPEN(db)})::int open_n, coalesce(sum(d.value) filter (where ${P_OPEN(db)}), 0)::float8 open_v,
        count(*) filter (where ${P_STALE(db)})::int stale_n, coalesce(sum(d.value) filter (where ${P_STALE(db)}), 0)::float8 stale_v,
        count(*) filter (where d.status = 'won' and not d.is_test and d.last_status_change_at >= ${d30})::int won_n, coalesce(sum(d.value) filter (where d.status = 'won' and not d.is_test and d.last_status_change_at >= ${d30}), 0)::float8 won_v,
        count(*) filter (where d.status = 'lost' and not d.is_test and d.last_status_change_at >= ${d30})::int lost_n, coalesce(sum(d.value) filter (where d.status = 'lost' and not d.is_test and d.last_status_change_at >= ${d30}), 0)::float8 lost_v,
        count(*) filter (where ${P_NO_OWNER(db)})::int no_owner, count(*) filter (where ${P_NO_VALUE(db)})::int no_value, count(*) filter (where d.is_test and d.status = 'open' and not d.out_of_scope)::int test,
        count(*) filter (where d.outlier)::int outliers, count(*) filter (where d.status = 'lost' and not d.is_test and d.last_status_change_at >= ${d30} and d.lost_reason_id is null and d.lost_reason is null)::int no_reason,
        count(*) filter (where d.status = 'open' and not d.out_of_scope)::int open_all, count(*) filter (where ${P_FLAG(db)})::int flagged
      from d`,
    db`select m.day, sum(m.open_value)::float8 v, sum(m.open_opportunities)::int n from account_metrics_daily m join (${locs(s, f.location)}) l on l.location_id = m.location_id
      where m.installation_id = ${s.inst} and m.day > current_date - ${Math.min(windowDays, 120)}::int group by m.day order by m.day`,
    db`select count(*)::int n from (${locs(s, f.location)}) x`,
    db`select min(h.at) since from deal_history h join (${locs(s, f.location)}) l on l.location_id = h.location_id where h.installation_id = ${s.inst}`,
    basis(s, base, sm), openByStage(s, base, sm, fresh.fresh),
    fresh.fresh ? rollupCloses(s, { location: f.location, pipeline: f.pipeline }, Math.min(windowDays, 120)) : db`with ${w} select (d.last_status_change_at at time zone ${APP_TZ})::date dy, count(*) filter (where d.status = 'won')::int won, count(*) filter (where d.status = 'lost')::int lost from d
      where d.status in ('won', 'lost') and not d.is_test and d.last_status_change_at >= now() - ${Math.min(windowDays, 120)}::int * interval '1 day' group by 1`,
    // Big open deals nobody has touched: the top tenth by value (needs 10 open deals), with no stage move, status change or update for 14 days.
    fresh.fresh ? Promise.resolve([undefined]) : db`with ${w}, big as (select percentile_cont(0.9) within group (order by d.value) p90, count(*) n from d where ${P_OPEN(db)})
      select count(*)::int n, coalesce(sum(d.value), 0)::float8 v from d, big where big.n >= 10 and ${P_OPEN(db)} and d.value >= big.p90
        and coalesce(greatest(d.last_activity_at, d.last_stage_change_at, d.last_status_change_at), d.created_at) < now() - interval '14 days'`,
  ]);
  const t = t0, open = open0, closes = closes0, bigRow = fresh.fresh ? { n: t0.big_n, v: t0.big_v } : bigRow0;
  const winRate = rate(b.won, b.closed), openN = num(t.open_n);
  const weighted = weightedPipeline(open.map((o) => ({ value: o.value, p: probOf(b, o.key) })), b.prior, b.closed);
  const atRisk = atRiskEstimate(open.filter((o) => o.staleN > 0).map((o) => ({ value: o.staleValue, p: probOf(b, o.key) })), b.prior, b.closed);
  const noOwner = num(t.no_owner), noReason = num(t.no_reason), staleN = num(t.stale_n), staleV = num(t.stale_v);
  const o: Pl3Overview = {
    headline: headlineOf({ openCount: openN, staleCount: staleN, staleValue: staleV, winRate, won30: num(t.won_n), noOwner }),
    button: pickButton({ staleCount: staleN, staleValue: staleV, noOwner, noReason }),
    openCount: openN, openValue: { value: num(t.open_v), n: openN }, weighted, atRisk, stale: { count: staleN, value: staleV },
    wonLast30: { value: num(t.won_v), n: num(t.won_n) }, lostLast30: { value: num(t.lost_v), n: num(t.lost_n) }, winRate,
    velocity: velocityEstimate(openN, b.closed >= MIN_CLOSED ? b.won / b.closed : null, b.avgWon, b.cycle, b.closed), medianWonCycleDays: b.cycle === null ? null : Math.round(b.cycle * 10) / 10,
    bigUntouched: { count: num(bigRow?.n), value: num(bigRow?.v), days: 14 },
    health: { score: healthScore(num(t.open_all), num(t.flagged)), noOwner, noValue: num(t.no_value), test: num(t.test), outliers: num(t.outliers) },
    cards: [
      { key: "stuck", title: "Which deals are stuck?", value: staleN, sub: staleN ? `${money(staleV)} waiting` : "Nothing past its limit", part: "attention", bucket: "stale" },
      { key: "flow", title: "Where does the money leak?", value: "Money Flow", sub: "Pipes, drain and vault", part: "money-flow", bucket: null },
      { key: "won", title: "What did we win lately?", value: money(num(t.won_v)), sub: `${num(t.won_n)} won in 30 days`, part: "won-lost", bucket: "won" },
    ],
    trend: trend.map((r) => { const c = closes.find((x) => day(x.dy) === day(r.day)); return { day: day(r.day), openValue: num(r.v), openCount: num(r.n), won: num(c?.won), lost: num(c?.lost) }; }),
    windowDays, accounts: num(acc.n), historySince: iso(since?.since), trust,
  };
  return o;
}

// ---------- attention (the unclog list) ----------

export async function attention(s: Scope, o: Omit<ListOpts, "extra">, link: ((a: string, b: string) => string) | null): Promise<Pl3Attention> {
  const db = sql(), sm = await stageMap(s, o.f.location), f = { ...o.f, bucket: "stale" as const };
  const w = deals(s, { ...o.f, bucket: null });
  const [p, rows, [t]] = await Promise.all([
    dealList(s, { ...o, f, sort: o.sort ?? "value" }, link),
    db`with ${w} select d.location_id, d.stage_id, count(*)::int n, sum(d.value)::float8 v, avg(d.limit_days)::float8 lim, bool_or(d.limit_est) est from d where ${P_STALE(db)} group by 1, 2`,
    db`with ${w} select coalesce(sum(d.value), 0)::float8 v, max(d.days_in_stage)::float8 oldest from d where ${P_STALE(db)}`,
  ]);
  const by = new Map<string, { stageId: string; stageName: string; pipelineName: string | null; stale: number; value: number; limitDays: number; limitIsEstimate: boolean }>();
  for (const r of rows) {
    const si = keyOf(sm, r.location_id, r.stage_id), key = si?.key ?? `unknown|${r.stage_id}`;
    const c = by.get(key);
    by.set(key, { stageId: key, stageName: si?.name ?? "Unknown stage", pipelineName: si?.pipelineName ?? null, stale: (c?.stale ?? 0) + num(r.n), value: (c?.value ?? 0) + num(r.v), limitDays: Math.round(num(r.lim)), limitIsEstimate: (c?.limitIsEstimate ?? false) || r.est === true });
  }
  return { ...p, byStage: [...by.values()].sort((a, b) => b.value - a.value).slice(0, 40), totalValue: num(t?.v), oldestDays: t?.oldest === null || t?.oldest === undefined ? null : Math.floor(Number(t.oldest)) };
}

// ---------- won and lost ----------

export async function wonLost(s: Scope, o: Omit<ListOpts, "extra">, link: ((a: string, b: string) => string) | null): Promise<Pl3WonLost> {
  const db = sql(), f = o.f, w = deals(s, { ...f, bucket: null }), sm = await stageMap(s, f.location), b = await basis(s, { ...f, bucket: null }, sm);
  const win = db`d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to} and not d.is_test`;
  const [[t], reasons, months, [bk]] = await Promise.all([
    db`with ${w} select count(*) filter (where d.status = 'won')::int won_n, coalesce(sum(d.value) filter (where d.status = 'won'), 0)::float8 won_v,
        count(*) filter (where d.status = 'lost')::int lost_n, coalesce(sum(d.value) filter (where d.status = 'lost'), 0)::float8 lost_v from d where ${win}`,
    db`with ${w} select coalesce(d.lost_reason, case when d.lost_reason_id is not null then 'Reason ' || right(d.lost_reason_id, 4) end) reason, count(*)::int n, coalesce(sum(d.value), 0)::float8 v
      from d where d.status = 'lost' and ${win} group by 1 order by n desc limit 30`,
    db`with ${w} select to_char(date_trunc('month', d.last_status_change_at), 'YYYY-MM') m, count(*) filter (where d.status = 'won')::int won, count(*) filter (where d.status = 'lost')::int lost,
        coalesce(sum(d.value) filter (where d.status = 'won'), 0)::float8 wv, coalesce(sum(d.value) filter (where d.status = 'lost'), 0)::float8 lv
      from d where d.status in ('won', 'lost') and not d.is_test and d.last_status_change_at > now() - interval '6 months' group by 1 order by 1`,
    db`with ${w} select count(*)::int booked, count(*) filter (where d.status = 'won')::int won from d where d.status in ('won', 'lost') and ${win} and d.contact_id is not null
      and exists (select 1 from cached_appointments a where a.installation_id = ${s.inst} and a.location_id = d.location_id and a.contact_id = d.contact_id and a.status not in ('cancelled', 'invalid')
        and a.start_at between coalesce(d.created_at, d.last_status_change_at) - interval '7 days' and d.last_status_change_at)`,
  ]);
  const lostN = num(t?.lost_n), noReasonN = num(reasons.find((r) => r.reason === null)?.n);
  const list = await dealList(s, { ...o, f: { ...f, bucket: f.bucket ?? "won" }, sort: o.sort ?? "closed" }, link);
  return {
    won: { value: num(t?.won_v), n: num(t?.won_n) }, lost: { value: num(t?.lost_v), n: lostN }, winRate: rate(num(t?.won_n), num(t?.won_n) + lostN),
    avgWon: { value: b.avgWon, n: b.won, enough: b.won >= MIN_CLOSED }, medianCycleDays: b.cycle === null ? null : Math.round(b.cycle * 10) / 10,
    lostReasons: reasons.map((r) => ({ reason: (r.reason as string | null) ?? "No reason recorded", count: num(r.n), value: num(r.v), noReason: r.reason === null })),
    lostReasonsEnough: lostN >= MIN_LOST_REASONS, noReasonShare: lostN ? noReasonN / lostN : null,
    bookedToWon: { booked: num(bk?.booked), won: num(bk?.won), rate: rate(num(bk?.won), num(bk?.booked)) },
    byMonth: months.map((r) => ({ month: String(r.m), won: num(r.won), lost: num(r.lost), wonValue: num(r.wv), lostValue: num(r.lv) })), list,
  };
}

// ---------- forecast ----------

export async function forecast(s: Scope, f: Filters): Promise<Pl3Forecast> {
  const db = sql(), sm = await stageMap(s, f.location), base = { ...f, bucket: null }, w = deals(s, base);
  const [b, open, [cap], track] = await Promise.all([
    basis(s, base, sm), openByStage(s, base, sm),
    db`with ${w}, o as (select * from d where ${P_OPEN(db)}) select count(*)::int n, coalesce(sum(value), 0)::float8 v,
        case when count(*) >= 20 then percentile_cont(0.95) within group (order by value) end cap from o`,
    db`select f.day, sum(f.low)::float8 low, sum(f.mid)::float8 mid, sum(f.high)::float8 high, sum(f.actual)::float8 actual from (
        select g.day, g.low, g.mid, g.high, (select coalesce(sum(o.monetary_value), 0) from cached_opportunities o where o.installation_id = g.installation_id and o.location_id = g.location_id
          and lower(o.status) = 'won' and o.last_status_change_at >= g.day and o.last_status_change_at < g.day + 30) actual
        from deal_forecast_log g join (${locs(s, f.location)}) l on l.location_id = g.location_id where g.installation_id = ${s.inst} and g.day <= current_date - 30 order by g.day desc limit 600) f group by f.day order by f.day`,
  ]);
  const capV = numOrNull(cap?.cap);
  let openValue = num(cap?.v), capped: Pl3Forecast["capped"] = [];
  if (capV !== null) {
    const rows = await db`with ${w} select d.opportunity_id, d.name, d.value from d where ${P_OPEN(db)} and d.value > ${capV} order by d.value desc limit 20`;
    capped = rows.map((r) => ({ opportunityId: r.opportunity_id as string, name: (r.name as string | null) ?? null, value: num(r.value), cappedTo: capV }));
    const [sum] = await db`with ${w} select coalesce(sum(least(d.value, ${capV})), 0)::float8 v from d where ${P_OPEN(db)}`;
    openValue = num(sum?.v);
  }
  const stageProb = [...b.probs.keys()].map((key) => {
    const p = probOf(b, key), n = b.probs.get(key)?.passed ?? 0;
    const est = p.p === null || !b.prior ? NO_EST("Chance a deal that reached this stage is won, from your own history, shrunk toward your overall win rate (80% range).", `Not enough data: needs 20 closed deals that reached this stage, has ${n}.`)
      : { value: p.p, low: p.low, high: p.high, enough: p.enough, estimate: true as const, formula: "Chance a deal that reached this stage is won, from your own history, shrunk toward your overall win rate (80% range).", minNote: p.enough ? null : `Fewer than 20 deals reached this stage (${n}); your overall rate is used.` };
    return { stageId: key, stageName: b.stageNames.get(key) ?? key, p: est, passed: n, assumed: p.assumed };
  }).sort((x, y) => y.passed - x.passed).slice(0, 40);
  const tr = trackRecord(track.map((r) => ({ day: day(r.day), low: num(r.low), mid: num(r.mid), high: num(r.high), actual: num(r.actual) })));
  return {
    next30: forecastEstimate(openValue, b.won, b.closed, b.cycle),
    weightedOpen: weightedPipeline(open.map((o) => ({ value: o.value, p: probOf(b, o.key) })), b.prior, b.closed),
    velocity: velocityEstimate(num(cap?.n), b.closed >= MIN_CLOSED ? b.won / b.closed : null, b.avgWon, b.cycle, b.closed),
    stageProb, capped, track: tr, minClosed: MIN_CLOSED, closedDeals: b.closed,
  };
}

// ---------- people ----------

export async function people(s: Scope, f: Filters, p: number, size: number, sort: string | null): Promise<Pl3People> {
  const db = sql(), label = await names(s.inst), w = deals(s, { ...f, bucket: null }), sz = clampSize(size);
  const y = new Date(Date.now() - 365 * DAY), d3 = "3 days";
  const order = sort === "won" ? db`won_v desc` : sort === "stale" ? db`stale_v desc` : sort === "name" ? db`owner asc` : db`open_v desc`;
  const [rows, [cnt], [un], [team]] = await Promise.all([
    db`with ${w}, a as (select d.owner,
        count(*) filter (where ${P_OPEN(db)})::int open_n, coalesce(sum(d.value) filter (where ${P_OPEN(db)}), 0)::float8 open_v,
        count(*) filter (where d.status = 'won' and not d.is_test and d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to})::int won_n,
        coalesce(sum(d.value) filter (where d.status = 'won' and not d.is_test and d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to}), 0)::float8 won_v,
        count(*) filter (where d.status = 'lost' and not d.is_test and d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to})::int lost_n,
        coalesce(sum(d.value) filter (where d.status = 'lost' and not d.is_test and d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to}), 0)::float8 lost_v,
        count(*) filter (where ${P_STALE(db)})::int stale_n, coalesce(sum(d.value) filter (where ${P_STALE(db)}), 0)::float8 stale_v,
        count(*) filter (where d.status = 'won' and not d.is_test and d.last_status_change_at >= ${y})::int won_y, count(*) filter (where d.status in ('won', 'lost') and not d.is_test and d.last_status_change_at >= ${y})::int closed_y,
        avg(d.value) filter (where d.status = 'won' and d.value > 0 and d.last_status_change_at >= ${y})::float8 avg_won,
        percentile_cont(0.5) within group (order by extract(epoch from (d.last_status_change_at - d.created_at)) / 86400) filter (where d.status = 'won' and d.created_at is not null and d.last_status_change_at >= d.created_at and d.last_status_change_at >= ${y}) cycle,
        count(*) filter (where d.status = 'lost' and not d.is_test and d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to} and d.last_status_change_at - coalesce(d.last_stage_change_at, d.created_at) >= ${d3}::interval)::int burned
      from d where d.owner is not null group by d.owner)
      select * from a order by ${order}, owner limit ${sz} offset ${offsetOf(p, sz)}`,
    db`with ${w} select count(distinct d.owner)::int n from d where d.owner is not null`,
    db`with ${w} select count(*)::int n, coalesce(sum(d.value), 0)::float8 v from d where d.status = 'open' and d.owner is null and d.value > 0 and not d.out_of_scope and not d.is_test`,
    db`with ${w} select count(*) filter (where d.status = 'won')::int won, count(*)::int closed from d where d.status in ('won', 'lost') and not d.is_test and d.last_status_change_at >= ${y}`,
  ]);
  const owners = rows.map((r) => r.owner as string);
  const weekly = owners.length ? await db`with ${w} select d.owner, to_char(date_trunc('week', d.last_status_change_at), 'YYYY-MM-DD') wk, count(*) filter (where d.status = 'won')::int won, count(*) filter (where d.status = 'lost')::int lost
      from d where d.owner = any(${owners}::text[]) and d.status in ('won', 'lost') and not d.is_test and d.last_status_change_at > now() - interval '8 weeks' group by 1, 2 order by 2` : [];
  const teamRate = num(team?.closed) >= MIN_CLOSED ? num(team?.won) / num(team?.closed) : null;
  const out: Pl3Person[] = rows.map((r) => {
    const winRate = rate(num(r.won_y), num(r.closed_y), 10), lost = num(r.lost_n), burned = num(r.burned);
    return {
      ownerId: r.owner as string, name: label(r.owner as string), open: { value: num(r.open_v), n: num(r.open_n) }, won: { value: num(r.won_v), n: num(r.won_n) }, lost: { value: num(r.lost_v), n: lost },
      staleCount: num(r.stale_n), staleValue: num(r.stale_v), winRate, avgWon: r.avg_won === null ? null : Math.round(num(r.avg_won)), medianCycleDays: r.cycle === null ? null : Math.round(num(r.cycle) * 10) / 10, burned,
      coaching: coachingLine({ winRate, burned, lost, staleCount: num(r.stale_n), open: num(r.open_n), teamWinRate: teamRate }),
      trend: weekly.filter((x) => x.owner === r.owner).map((x) => ({ week: String(x.wk), won: num(x.won), lost: num(x.lost) })),
    };
  });
  const total = num(cnt?.n);
  return { rows: out, total, page: p, size: sz, pages: Math.max(1, Math.ceil(total / sz)), truncated: false, unowned: { value: num(un?.v), n: num(un?.n) } };
}

// ---------- sources ----------

export async function sources(s: Scope, f: Filters): Promise<Pl3Sources> {
  const db = sql(), w = deals(s, { ...f, bucket: null, source: null });
  const cohort = db`d.created_at >= ${f.from} and d.created_at < ${f.to} and not d.is_test`;
  const [rows, bands, [blank]] = await Promise.all([
    db`with ${w} select coalesce(d.source, 'Not recorded') src, count(*)::int created, count(*) filter (where d.status = 'open')::int open_n, count(*) filter (where d.status = 'won')::int won, count(*) filter (where d.status = 'lost')::int lost,
        coalesce(sum(d.value) filter (where d.status = 'won'), 0)::float8 won_v,
        avg(extract(epoch from (d.last_status_change_at - d.created_at)) / 86400) filter (where d.status = 'won' and d.last_status_change_at >= d.created_at)::float8 cycle
      from d where ${cohort} group by 1 order by created desc limit 40`,
    db`with ${w} select case when d.value < 1000 then 'Under $1,000' when d.value < 5000 then '$1,000 to $5,000' when d.value < 20000 then '$5,000 to $20,000' else '$20,000 and over' end band,
        min(d.value) lo, count(*) filter (where d.status = 'won')::int won, count(*) filter (where d.status = 'lost')::int lost from d where d.status in ('won', 'lost') and d.value > 0 and ${cohort} group by 1 order by lo`,
    db`with ${w} select count(*) filter (where d.source is null)::int n from d where ${cohort}`,
  ]);
  return {
    bySource: rows.map((r) => ({ source: r.src as string, created: num(r.created), open: num(r.open_n), won: num(r.won), lost: num(r.lost), winRate: rate(num(r.won), num(r.won) + num(r.lost)), wonValue: num(r.won_v), avgCycleDays: r.cycle === null ? null : Math.round(num(r.cycle) * 10) / 10 })),
    byValueBand: bands.map((r) => ({ band: r.band as string, won: num(r.won), lost: num(r.lost), winRate: rate(num(r.won), num(r.won) + num(r.lost)) })),
    sourceBlank: num(blank?.n),
  };
}

// ---------- stage history ----------

export async function stageHistory(s: Scope, f: Filters, p: number, size: number, link?: unknown): Promise<Pl3StageHistory> {
  void link;
  const db = sql(), sm = await stageMap(s, f.location), sz = clampSize(size), w = deals(s, { ...f, bucket: null });
  const so = db`select pl.location_id, st->>'id' sid, t.ord from pipelines pl, jsonb_array_elements(pl.stages) with ordinality t(st, ord) where pl.installation_id = ${s.inst}`;
  const label = await names(s.inst);
  const [stats, [mv], [tot], recent, cnt] = await Promise.all([
    db`select ss.location_id, ss.stage_id, ss.stays, ss.median_days::float8 med, ss.p75_days::float8 p75, ss.p90_days::float8 p90, ss.limit_days::float8 lim, ss.is_estimate est from deal_stage_stats ss join (${locs(s, f.location)}) l on l.location_id = ss.location_id where ss.installation_id = ${s.inst}`,
    db`with ${w}, so as (${so}) select count(*) filter (where fo.ord is not null and tt.ord < fo.ord)::int backward, count(*) filter (where fo.ord is not null and tt.ord - fo.ord > 1)::int skipped
      from deal_history h join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id
      join so fo on fo.location_id = h.location_id and fo.sid = h.from_value join so tt on tt.location_id = h.location_id and tt.sid = h.to_value
      where h.installation_id = ${s.inst} and h.kind = 'stage' and h.at >= ${f.from} and h.at < ${f.to} and not d.is_test`,
    db`select count(*)::int n, min(h.at) since from deal_history h join (${locs(s, f.location)}) l on l.location_id = h.location_id where h.installation_id = ${s.inst}`,
    db`with ${w} select h.opportunity_id, h.location_id, h.kind, h.from_value, h.to_value, h.from_name, h.to_name, h.value::float8 hv, h.actor_id, h.actor_kind, h.at, d.name deal_name, d.account_name, d.contact_name
      from deal_history h join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id where h.installation_id = ${s.inst} and not d.is_test and h.at >= ${f.from} and h.at < ${f.to}
      order by h.at desc, h.id desc limit ${sz} offset ${offsetOf(p, sz)}`,
    db`with ${w} select count(*)::int n from deal_history h join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id where h.installation_id = ${s.inst} and not d.is_test and h.at >= ${f.from} and h.at < ${f.to}`,
  ]);
  const by = new Map<string, { key: string; name: string; pipeline: string | null; stays: number; med: number[]; p75: number[]; p90: number[]; lim: number[]; est: boolean }>();
  for (const r of stats) {
    const si = keyOf(sm, r.location_id, r.stage_id);
    if (!si) continue;
    const c = by.get(si.key) ?? { key: si.key, name: si.name, pipeline: si.pipelineName, stays: 0, med: [], p75: [], p90: [], lim: [], est: false };
    c.stays += num(r.stays);
    if (r.med !== null) c.med.push(num(r.med)); if (r.p75 !== null) c.p75.push(num(r.p75)); if (r.p90 !== null) c.p90.push(num(r.p90)); c.lim.push(num(r.lim));
    c.est = c.est || r.est === true; by.set(si.key, c);
  }
  const r1 = (xs: number[]) => (xs.length ? Math.round((median(xs) as number) * 10) / 10 : null);
  const evs = recent.map((r) => ({
    opportunityId: r.opportunity_id as string, locationId: r.location_id as string, accountName: (r.account_name as string | null) ?? null, dealName: ((r.deal_name as string | null) ?? (r.contact_name as string | null)) ?? null, value: numOrNull(r.hv),
    event: histEvent(r, sm, label),
  }));
  const total = num(cnt[0]?.n);
  return {
    dwell: [...by.values()].map((c) => ({ stageId: c.key, stageName: c.name, pipelineName: c.pipeline, stays: c.stays, medianDays: r1(c.med), p75Days: r1(c.p75), p90Days: r1(c.p90), enough: c.stays >= MIN_STAYS, staleLimitDays: r1(c.lim) ?? DEFAULT_LIMIT_DAYS, limitIsEstimate: c.est })).sort((a, b) => b.stays - a.stays).slice(0, 60),
    recent: { rows: evs, total, page: p, size: sz, pages: Math.max(1, Math.ceil(total / sz)), truncated: false },
    backward: num(mv?.backward), skipped: num(mv?.skipped), historySince: iso(tot?.since), eventsRecorded: num(tot?.n),
  };
}

function histEvent(r: Rec, sm: Map<string, StageInfo>, label: (id: string | null | undefined) => string): Pl3HistoryEvent {
  const kind = r.kind as Pl3HistoryEvent["kind"], loc = r.location_id;
  const stageName = (id: unknown, nm: unknown) => (nm as string | null) ?? (id ? keyOf(sm, loc, id)?.name ?? null : null);
  const from = kind === "stage" || kind === "created" ? stageName(r.from_value, r.from_name) : (r.from_value as string | null) ?? null;
  const to = kind === "stage" || kind === "created" ? stageName(r.to_value, r.to_name) : (r.to_value as string | null) ?? null;
  const actorKind = (r.actor_kind as Pl3HistoryEvent["actorKind"]) ?? "unknown";
  const actorName = actorKind === "subsync" ? "SubSync" : r.actor_id ? label(r.actor_id as string) : null;
  const ownerName = kind === "owner";
  const f2 = ownerName ? (from ? label(from) : null) : from, t2 = ownerName ? (to ? label(to) : null) : to;
  return { at: iso(r.at) as string, kind, from: f2, to: t2, actorName, actorKind, text: eventText(kind, f2, t2) };
}

// ---------- health ----------

export async function health(s: Scope, f: Filters, p: number, size: number): Promise<Pl3Health> {
  const db = sql(), sz = clampSize(size), w = deals(s, { ...f, bucket: null });
  const [rows, [cnt], [all]] = await Promise.all([
    db`with ${w} select d.location_id, max(d.account_name) account_name, count(*) filter (where d.status = 'open' and not d.out_of_scope)::int open_n, count(*) filter (where ${P_FLAG(db)})::int flagged,
        count(*) filter (where ${P_NO_OWNER(db)})::int no_owner, count(*) filter (where ${P_NO_VALUE(db)})::int no_value, count(*) filter (where d.is_test and d.status = 'open' and not d.out_of_scope)::int test,
        count(*) filter (where ${P_STALE(db)})::int stale, count(*) filter (where d.outlier)::int outliers,
        (select count(*)::int - count(distinct (x.contact_id, x.pipeline_id))::int from d x where x.location_id = d.location_id and x.status = 'open' and x.counted and x.contact_id is not null) dup
      from d group by d.location_id order by (count(*) filter (where ${P_FLAG(db)}))::float8 / greatest(1, count(*) filter (where d.status = 'open' and not d.out_of_scope)) desc, d.location_id limit ${sz} offset ${offsetOf(p, sz)}`,
    db`select count(*)::int n from (${locs(s, f.location)}) x`,
    db`with ${w} select count(*) filter (where d.status = 'open' and not d.out_of_scope)::int open_n, count(*) filter (where ${P_FLAG(db)})::int flagged from d`,
  ]);
  const rowsOut = rows.map((r) => {
    const cats: Array<[string, number]> = [["deals with no owner", num(r.no_owner)], ["deals with no value", num(r.no_value)], ["test deals", num(r.test)], ["stuck deals", num(r.stale)], ["one large deal", num(r.outliers)], ["duplicate deals", num(r.dup)]];
    const worst = cats.sort((a, b) => b[1] - a[1])[0];
    return { locationId: r.location_id as string, accountName: (r.account_name as string | null) ?? null, open: num(r.open_n), score: healthScore(num(r.open_n), num(r.flagged)), noOwner: num(r.no_owner), noValue: num(r.no_value), test: num(r.test),
      duplicates: num(r.dup), stale: num(r.stale), outliers: num(r.outliers), worstReason: worst[1] > 0 ? `${worst[1]} ${worst[0]}` : null };
  });
  const total = num(cnt?.n);
  return { rows: rowsOut, total, page: p, size: sz, pages: Math.max(1, Math.ceil(total / sz)), truncated: false, overall: healthScore(num(all?.open_n), num(all?.flagged)) };
}

// ---------- money flow ----------

async function flowParts(s: Scope, f: Filters, sm: Map<string, StageInfo>) {
  const db = sql(), w = deals(s, { ...f, bucket: null, pipeline: f.pipeline ?? null });
  const win = db`d.last_status_change_at >= ${f.from} and d.last_status_change_at < ${f.to} and not d.is_test`;
  // The stage rows, lost rows and won totals come from the stored totals when they are fresh and nothing narrows them to a person, source or search.
  const fast = !f.owner && !f.source && !f.q && !f.stage && !f.stageKey && (await rollupFresh(s, f.location)).fresh, rf = fast ? await rollupFlow(s, { location: f.location, pipeline: f.pipeline, from: f.from, to: f.to }) : null;
  const [open, edges, reached, drain, [vault], [hist]] = await Promise.all([
    rf ? Promise.resolve(rf.open) : db`with ${w} select d.location_id, d.stage_id, count(*)::int n, sum(d.value)::float8 v, count(*) filter (where d.stale)::int sn, coalesce(sum(d.value) filter (where d.stale), 0)::float8 sv,
        percentile_cont(0.5) within group (order by d.days_in_stage) med, max(d.norm_days) norm, max(d.stays)::int stays from d where ${P_OPEN(db)} group by 1, 2`,
    db`with ${w} select h.location_id, h.from_value, h.to_value, count(*)::int n, coalesce(sum(h.value), 0)::float8 v, percentile_cont(0.5) within group (order by h.dwell_seconds) filter (where h.dwell_seconds is not null) med
      from deal_history h join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id where h.installation_id = ${s.inst} and h.kind = 'stage' and h.from_value is not null and h.to_value is not null
        and h.actor_kind <> 'subsync' and h.at >= ${f.from} and h.at < ${f.to} and d.counted group by 1, 2, 3`,
    db`with ${w} select h.location_id, h.to_value stage_id, count(distinct h.opportunity_id)::int n, coalesce(sum(h.value), 0)::float8 v from deal_history h join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id
      where h.installation_id = ${s.inst} and h.kind in ('created', 'stage') and h.to_value is not null and h.at >= ${f.from} and h.at < ${f.to} and d.counted group by 1, 2`,
    rf ? Promise.resolve(rf.drain) : db`with ${w} select d.location_id, d.stage_id, coalesce(d.lost_reason, case when d.lost_reason_id is not null then 'Reason ' || right(d.lost_reason_id, 4) end) reason, count(*)::int n, coalesce(sum(d.value), 0)::float8 v
      from d where d.status = 'lost' and ${win} and d.value > 0 group by 1, 2, 3`,
    rf ? Promise.resolve([rf.vault]) : db`with ${w} select coalesce(sum(d.value) filter (where d.status = 'won' and ${win}), 0)::float8 won_v, count(*) filter (where d.status = 'won' and ${win})::int won_n,
        coalesce(sum(d.value) filter (where d.status = 'won' and not d.is_test and d.last_status_change_at >= now() - interval '7 days'), 0)::float8 w7v,
        count(*) filter (where d.status = 'won' and not d.is_test and d.last_status_change_at >= now() - interval '7 days')::int w7n from d`,
    db`select count(*)::int n, min(h.at) since from deal_history h join (${locs(s, f.location)}) l on l.location_id = h.location_id where h.installation_id = ${s.inst} and h.kind = 'stage' and h.at >= ${f.from} and h.at < ${f.to}`,
  ]);
  return { open, edges, reached, drain, vault, hist, sm };
}

export async function moneyFlow(s: Scope, f: Filters): Promise<Pl3MoneyFlow> {
  const db = sql(), sm = await stageMap(s, f.location);
  // Which pipeline: the one asked for, else the one with the most open money. Pipelines are merged across accounts by name.
  const pipeValue = new Map<string, { name: string; value: number; loc: string }>();
  for (const r of await db`with ${deals(s, { ...f, bucket: null })} select d.location_id, d.pipeline_name, sum(d.value)::float8 v from d where ${P_OPEN(db)} group by 1, 2`) {
    const key = slug(r.pipeline_name as string), c = pipeValue.get(key);
    pipeValue.set(key, { name: (r.pipeline_name as string) ?? "Pipeline", value: (c?.value ?? 0) + num(r.v), loc: c?.loc ?? (r.location_id as string) });
  }
  for (const si of sm.values()) if (!pipeValue.has(si.pipelineKey)) pipeValue.set(si.pipelineKey, { name: si.pipelineName, value: 0, loc: si.locationId });
  const pipelines = [...pipeValue.entries()].sort((a, b) => b[1].value - a[1].value).map(([id, v]) => ({ id, name: v.name, locationId: v.loc }));
  const chosen = f.pipeline && pipeValue.has(slug(f.pipeline)) ? slug(f.pipeline) : pipelines[0]?.id ?? null;
  const parts = await flowParts(s, { ...f, pipeline: chosen }, sm);

  const meta = new Map<string, StageMeta>();
  for (const si of sm.values()) if (si.pipelineKey === chosen) { const c = meta.get(si.key); meta.set(si.key, { key: si.key, name: si.name, order: Math.min(c?.order ?? 999, si.order), pipelineName: si.pipelineName }); }
  const aggs = new Map<string, StageAgg & { medW: number; normW: number }>();
  for (const r of parts.open) {
    const si = keyOf(sm, r.location_id, r.stage_id);
    if (si && si.pipelineKey !== chosen) continue;
    const sk = si ? si.key : OTHER_STAGE; // a stage renamed or deleted in the CRM keeps its money, as "Other stage"
    const c = aggs.get(sk) ?? { key: sk, openCount: 0, openValue: 0, staleCount: 0, staleValue: 0, medianDays: null, normalDays: null, staysN: 0, medW: 0, normW: 0 };
    const n = num(r.n), med = numOrNull(r.med), norm = numOrNull(r.norm);
    aggs.set(sk, { ...c, openCount: c.openCount + n, openValue: c.openValue + num(r.v), staleCount: c.staleCount + num(r.sn), staleValue: c.staleValue + num(r.sv), staysN: c.staysN + num(r.stays),
      medW: c.medW + (med === null ? 0 : med * n), normW: c.normW + (norm === null ? 0 : norm * n) });
  }
  if (aggs.has(OTHER_STAGE)) meta.set(OTHER_STAGE, { key: OTHER_STAGE, name: "Other stage", order: 9999, pipelineName: "" });
  const aggList: StageAgg[] = [...aggs.values()].map((a) => ({ ...a, medianDays: a.openCount && a.medW ? Math.round((a.medW / a.openCount) * 10) / 10 : null, normalDays: a.openCount && a.normW ? Math.round((a.normW / a.openCount) * 10) / 10 : null }));
  const stages = buildStages([...meta.values()], aggList, chosen ?? "");
  // Open deals with no value are real deals but not money: count them per step so a step is never shown as "0 deals" when it holds some.
  const nv = new Map<string, number>();
  for (const r of await db`with ${deals(s, { ...f, bucket: null, pipeline: chosen })} select d.location_id, d.stage_id, count(*)::int n from d where ${P_NO_VALUE(db)} group by 1, 2`) {
    const si = keyOf(sm, r.location_id, r.stage_id), k = si ? si.key : OTHER_STAGE;
    if (si && si.pipelineKey !== chosen) continue;
    nv.set(k, (nv.get(k) ?? 0) + num(r.n));
  }
  for (const st of stages) st.noValueCount = nv.get(st.id) ?? 0;
  const inPipe = new Set(stages.map((x) => x.id));

  const edgeMap = new Map<string, FlowEdge>();
  for (const r of parts.edges) {
    const a = keyOf(sm, r.location_id, r.from_value), b = keyOf(sm, r.location_id, r.to_value);
    if (!a || !b || !inPipe.has(a.key) || !inPipe.has(b.key) || a.key === b.key) continue;
    const k = `${a.key}>${b.key}`, c = edgeMap.get(k), med = numOrNull(r.med);
    edgeMap.set(k, { from: a.key, to: b.key, count: (c?.count ?? 0) + num(r.n), value: Math.round((c?.value ?? 0) + num(r.v)), medianDays: med === null ? c?.medianDays ?? null : Math.round((med / 86400) * 10) / 10 });
  }
  const edges: FlowEdge[] = [...edgeMap.values()].sort((a, b) => b.value - a.value).slice(0, 80);

  const lost = new Map<string, FlowDrain>();
  let drainValue = 0, drainN = 0;
  for (const r of parts.drain) {
    const si = keyOf(sm, r.location_id, r.stage_id);
    if (!si || !inPipe.has(si.key)) continue;
    const reason = (r.reason as string | null) ?? "No reason recorded", k = `${si.key}|${reason}`, c = lost.get(k);
    lost.set(k, { stageId: si.key, reason, count: (c?.count ?? 0) + num(r.n), value: Math.round((c?.value ?? 0) + num(r.v)), noReason: r.reason === null });
    drainValue += num(r.v); drainN += num(r.n);
  }
  const drain = [...lost.values()].sort((a, b) => b.value - a.value).slice(0, 60);

  const reachedBy = new Map<string, { n: number; v: number }>();
  for (const r of parts.reached) {
    const si = keyOf(sm, r.location_id, r.stage_id);
    if (!si || !inPipe.has(si.key)) continue;
    const c = reachedBy.get(si.key) ?? { n: 0, v: 0 };
    reachedBy.set(si.key, { n: c.n + num(r.n), v: c.v + num(r.v) });
  }
  const loss: StageLoss[] = stages.map((st, i) => {
    const lostHere = drain.filter((d) => d.stageId === st.id), rc = reachedBy.get(st.id);
    return { stageId: st.id, stageName: st.name, nextStageId: stages[i + 1]?.id ?? null, reachedValue: rc?.v ?? 0, reachedCount: rc?.n ?? 0, lostValue: lostHere.reduce((t, d) => t + d.value, 0), lostCount: lostHere.reduce((t, d) => t + d.count, 0) };
  });

  const [pp, outl, [lo]] = await Promise.all([people(s, { ...f, pipeline: chosen }, 0, 20, null), db`with ${deals(s, { ...f, bucket: null, pipeline: chosen })} select d.opportunity_id, d.name, d.value, d.stage_id, d.location_id, d.loc_total from d where d.outlier order by d.value desc limit 10`,
    // Every reason an open deal of this pipeline is left out of its money, with the SAME predicates the drill-down lists use (buckets no_value, no_owner, test, outlier), so the header, the rows and the clicked list agree.
    db`with ${deals(s, { ...f, bucket: null, pipeline: chosen })} select count(*) filter (where ${P_NO_VALUE(db)})::int no_value, count(*) filter (where ${P_NO_OWNER(db)})::int no_owner,
        count(*) filter (where d.is_test and d.status = 'open' and not d.out_of_scope and not ${f.includeTest === true}::boolean)::int test, count(*) filter (where d.outlier)::int outlier, coalesce(sum(d.value) filter (where d.outlier), 0)::float8 outlier_v,
        (select coalesce(count_ownerless_deals, false) from settings where installation_id = ${s.inst}) owner_counted from d`]);
  const perStage = await db`with ${deals(s, { ...f, bucket: null, pipeline: chosen })} select d.owner, d.location_id, d.stage_id, count(*)::int n, sum(d.value)::float8 v from d where ${P_OPEN(db)} and d.owner = any(${pp.rows.map((r) => r.ownerId as string)}::text[]) group by 1, 2, 3`;
  const peopleFlow: FlowPerson[] = pp.rows.map((r) => ({
    ownerId: r.ownerId, name: r.name, open: r.open, won: r.won, lost: r.lost, staleCount: r.staleCount,
    stages: perStage.filter((x) => x.owner === r.ownerId).flatMap((x) => { const k = keyOf(sm, x.location_id, x.stage_id)?.key; return k && inPipe.has(k) ? [{ stageId: k, count: num(x.n), value: Math.round(num(x.v)) }] : []; }),
  }));
  const histN = num(parts.hist?.n);
  return {
    stages, edges, drain, drainTotal: { value: Math.round(drainValue), n: drainN },
    vault: { won: { value: Math.round(num(parts.vault?.won_v)), n: num(parts.vault?.won_n) }, wonLast7: { value: Math.round(num(parts.vault?.w7v)), n: num(parts.vault?.w7n) }, target: null },
    people: peopleFlow, leak: findLeak(loss),
    outliers: outl.map((r) => ({ opportunityId: r.opportunity_id as string, name: (r.name as string | null) ?? null, value: num(r.value), sharePct: Math.round((num(r.value) / Math.max(1, num(r.loc_total))) * 100), stageId: keyOf(sm, r.location_id, r.stage_id)?.key ?? null })),
    leftOut: { noValue: num(lo?.no_value), noOwner: num(lo?.no_owner), test: num(lo?.test), outlier: num(lo?.outlier), outlierValue: Math.round(num(lo?.outlier_v)), ownerCounted: lo?.owner_counted === true, testsCounted: f.includeTest === true },
    period: { from: f.from.toISOString(), to: f.to.toISOString() }, pipelineId: chosen, pipelines,
    historyDays: parts.hist?.since instanceof Date ? Math.floor((Date.now() - parts.hist.since.getTime()) / DAY) : 0, enoughHistory: histN >= 20,
  };
}

// ---------- replay ----------

export async function replay(s: Scope, f: Filters, days: number): Promise<Pl3Replay> {
  const db = sql(), sm = await stageMap(s, f.location), n = Math.min(90, Math.max(2, Math.ceil(days) || 2));
  // The replay plays the bar's dates (its last 90 days at most), ending at the end of the window, never "the last N days from today".
  const end = f.to, from = new Date(end.getTime() - n * DAY), w = deals(s, { ...f, bucket: null });
  const [cur, moves, [since]] = await Promise.all([
    db`with ${w} select d.location_id, d.stage_id, count(*)::int n, sum(d.value)::float8 v from d where ${P_OPEN(db)} group by 1, 2`,
    db`with ${w} select (h.at at time zone ${APP_TZ})::date dy, h.kind, h.location_id, h.from_value, h.to_value, d.stage_id cur_stage, count(*)::int n, coalesce(sum(h.value), 0)::float8 v
      from deal_history h join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id
      where h.installation_id = ${s.inst} and h.actor_kind <> 'subsync' and d.counted and h.at >= ${from} and h.at < ${end} and ((h.kind in ('stage', 'created') and h.to_value is not null) or (h.kind = 'status' and h.to_value in ('won', 'lost')))
      group by 1, 2, 3, 4, 5, 6`,
    db`select min(h.at) since, count(*)::int n from deal_history h join (${locs(s, f.location)}) l on l.location_id = h.location_id where h.installation_id = ${s.inst} and h.kind = 'stage'`,
  ]);
  const stock = new Map<string, { stageId: string; count: number; value: number }>();
  for (const r of cur) { const k = keyOf(sm, r.location_id, r.stage_id)?.key; if (!k) continue; const c = stock.get(k); stock.set(k, { stageId: k, count: (c?.count ?? 0) + num(r.n), value: (c?.value ?? 0) + num(r.v) }); }
  const dm: DayMove[] = [];
  for (const r of moves) {
    const isStatus = r.kind === "status";
    const from2 = isStatus ? keyOf(sm, r.location_id, r.cur_stage)?.key ?? null : r.from_value ? keyOf(sm, r.location_id, r.from_value)?.key ?? null : null;
    const to2 = isStatus ? null : keyOf(sm, r.location_id, r.to_value)?.key ?? null;
    if (!isStatus && !to2) continue;
    dm.push({ day: day(r.dy), from: from2, to: to2, status: isStatus ? (r.to_value as "won" | "lost") : null, count: num(r.n), value: num(r.v) });
  }
  const dayList: string[] = [];
  for (let i = n - 1; i >= 0; i--) dayList.push(localDay(end.getTime() - 1 - i * DAY));
  const frames = buildReplay(dayList, [...stock.values()], dm);
  return { days: n, frames, enough: num(since?.n) >= 20, historySince: iso(since?.since) };
}

// ---------- weekly receipt ----------

export async function receipt(s: Scope, location: string | null, weekStart: Date): Promise<Pl3Receipt> {
  const db = sql(), from = weekStart, to = new Date(weekStart.getTime() + 7 * DAY), f: Filters = { from, to, location: location ?? undefined }, w = deals(s, f);
  const win = db`d.last_status_change_at >= ${from} and d.last_status_change_at < ${to} and not d.is_test`;
  const [[t], [mv], [ac], [one]] = await Promise.all([
    db`with ${w} select count(*) filter (where d.status = 'won' and ${win})::int won_n, coalesce(sum(d.value) filter (where d.status = 'won' and ${win}), 0)::float8 won_v,
        count(*) filter (where d.status = 'lost' and ${win})::int lost_n, coalesce(sum(d.value) filter (where d.status = 'lost' and ${win}), 0)::float8 lost_v,
        count(*) filter (where d.created_at >= ${from} and d.created_at < ${to} and not d.is_test)::int new_n, count(*) filter (where ${P_STALE(db)})::int stale_n from d`,
    db`with ${w} select count(distinct h.opportunity_id)::int moved, count(distinct h.opportunity_id) filter (where h.dwell_seconds is not null and ss.limit_days is not null and h.dwell_seconds / 86400.0 > ss.limit_days)::int unclogged
      from deal_history h join d on d.location_id = h.location_id and d.opportunity_id = h.opportunity_id left join deal_stage_stats ss on ss.installation_id = h.installation_id and ss.location_id = h.location_id and ss.stage_id = h.from_value
      where h.installation_id = ${s.inst} and h.kind = 'stage' and h.actor_kind <> 'subsync' and h.at >= ${from} and h.at < ${to} and not d.is_test`,
    db`select (select sum(m.open_value)::float8 from account_metrics_daily m join (${locs(s, location)}) l on l.location_id = m.location_id where m.installation_id = ${s.inst} and m.day = ${localDay(from.getTime())}::date) a,
        (select sum(m.open_value)::float8 from account_metrics_daily m join (${locs(s, location)}) l on l.location_id = m.location_id where m.installation_id = ${s.inst} and m.day = ${localDay(to.getTime() - 1)}::date) b`,
    location ? db`select name from locations where installation_id = ${s.inst} and location_id = ${location}` : db`select null::text name where false`,
  ]);
  const flow = await moneyFlow(s, { from, to, location: location ?? undefined }).catch(() => null);
  const pipelineChange = ac?.a !== null && ac?.a !== undefined && ac?.b !== null && ac?.b !== undefined ? Math.round(num(ac.b) - num(ac.a)) : null;
  const won = { value: num(t?.won_v), n: num(t?.won_n) }, lost = { value: num(t?.lost_v), n: num(t?.lost_n) };
  const body = { weekStart: localDay(from.getTime()), loc: location, moved: num(mv?.moved), won, lost, newDeals: num(t?.new_n), unclogged: num(mv?.unclogged) };
  const parts: string[] = [];
  if (won.n) parts.push(`${won.n} won (${money(won.value)})`);
  if (num(mv?.moved)) parts.push(`${num(mv?.moved)} deals moved forward`);
  if (num(mv?.unclogged)) parts.push(`${num(mv?.unclogged)} stuck deals got moving`);
  if (lost.n) parts.push(`${lost.n} lost (${money(lost.value)})`);
  return {
    weekStart: body.weekStart, weekEnd: localDay(to.getTime() - 1), locationId: location, accountName: (one?.name as string | null) ?? null,
    moved: body.moved, won, lost, newDeals: body.newDeals, unclogged: body.unclogged, stillStale: num(t?.stale_n), leakText: flow?.leak?.text ?? null, pipelineChange,
    headline: parts.length ? parts.join(", ") + "." : "A quiet week: no deals moved or closed.",
    verifyHash: createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16),
  };
}

// ---------- one deal ----------

export async function detail(s: Scope, locationId: string, opportunityId: string, link: ((a: string, b: string) => string) | null): Promise<Pl3Detail | null> {
  const db = sql(), loc = cleanId(locationId), id = cleanId(opportunityId);
  if (!loc || !id) return null;
  const label = await names(s.inst), sm = await stageMap(s, loc);
  const f: Filters = { from: new Date(Date.now() - 800 * DAY), to: new Date(Date.now() + DAY), location: loc, includeTest: true };
  const [rows, hist] = await Promise.all([
    db`with ${deals(s, f)} select d.*, ap.appointment_id appt_id, ap.start_at appt_start, ap.status appt_status from d
      left join lateral (select a.appointment_id, a.start_at, a.status from cached_appointments a where a.installation_id = ${s.inst} and a.location_id = d.location_id and d.contact_id is not null and a.contact_id = d.contact_id and a.status not in ('cancelled', 'invalid') order by a.start_at desc limit 1) ap on true
      where d.opportunity_id = ${id} limit 1`,
    db`select kind, from_value, to_value, from_name, to_name, actor_id, actor_kind, at, location_id from deal_history where installation_id = ${s.inst} and location_id = ${loc} and opportunity_id = ${id} order by at, id limit 300`,
  ]);
  const r = rows[0];
  if (!r) return null; // not in an account the caller may see, or not there: the same answer
  const row = toRow(r, label, link);
  const timeline = hist.map((h) => histEvent(h, sm, label));
  // Days in each stage, from the entries (a stay ends at the next stage entry or at the close).
  const entries = hist.filter((h) => h.kind === "created" || h.kind === "stage").filter((h) => h.to_value);
  const closedAt = hist.filter((h) => h.kind === "status" && (h.to_value === "won" || h.to_value === "lost")).map((h) => (h.at as Date).getTime()).pop() ?? null;
  const dwell = entries.map((e, i) => {
    const start = (e.at as Date).getTime(), end = entries[i + 1] ? (entries[i + 1].at as Date).getTime() : closedAt ?? Date.now();
    return { stageId: keyOf(sm, loc, e.to_value)?.key ?? String(e.to_value), stageName: keyOf(sm, loc, e.to_value)?.name ?? (e.to_name as string | null) ?? "Stage", days: Math.max(0, Math.round(((end - start) / DAY) * 10) / 10), current: i === entries.length - 1 && closedAt === null };
  });
  const appts = r.contact_id ? await db`select appointment_id, start_at, status from cached_appointments where installation_id = ${s.inst} and location_id = ${loc} and contact_id = ${r.contact_id as string} order by start_at desc limit 10` : [];
  const blockers: Pl3Detail["blockers"] = [];
  if (row.dnd) blockers.push("dnd");
  if (row.status === "open") blockers.push("open_deal");
  if (appts.some((a) => a.start_at instanceof Date && a.start_at.getTime() > Date.now() && a.status !== "cancelled")) blockers.push("upcoming");
  return { row, timeline, dwell, appointments: appts.map((a) => ({ appointmentId: a.appointment_id as string, startAt: iso(a.start_at) as string, status: a.status as string })), blockers, staleLimitDays: row.staleLimitDays };
}

