import { sql } from "../db";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";

// Missed calls nobody called back: THE one definition, in SQL, for Speed > Coverage and Speed > Call mode (docs/METRICS.md, "Missed calls").
//
// A caller is WAITING when, inside the date range (default last 30 days) and the accounts the person may read:
//   1. their latest missed call (a recorded inbound call that was not answered) falls in the range, and
//   2. no outbound touch of any kind (a person's call or message, or an automatic text; a send that failed does not count) came after it, and
//   3. no call outcome was logged for them in Call mode after it.
// One row per caller (account + contact), not per call. Dollars are the counted open deals of that caller (value above zero, an owner, a stage in play).
// Ranked: counted dollars first, then the newest missed call. Everything here is an aggregate or one ranked page: no query reads all the rows into the server.

export const MISSED_DEFAULT_DAYS = 30;
export const RECOVERY_SECONDS = 900;
export const TEXT_BACK_SECONDS = 60;
export const PAGE_SIZES = [20, 50, 100] as const;
export const pageSize = (v: unknown) => ((PAGE_SIZES as readonly number[]).includes(Number(v)) ? Number(v) : 50);

export type MissedScope = { installationId: string; allowed: string[] | null; fromMs: number; toMs: number; /** A client's staff: only the callers assigned to this person ("" = nobody). */ ownerId?: string | null };
export type MissedRow = {
  locationId: string; contactId: string; missedAt: number; name: string | null; email: string | null; phone: string | null; dnd: boolean; source: string | null; owner: string | null;
  locationName: string | null; timeZone: string | null; dollars: number;
  /** False when SubSync holds no record of this caller yet (the missed call is known, the contact is not synced): no name, no number, but the CRM has them. */
  hasRecord: boolean;
};
// How a caller is named on every screen (Coverage and Call mode) lives in dial.ts so it can be tested without a database.
export { callerLabel } from "../dial/dial";
export const defaultRange = (now: number) => ({ fromMs: now - MISSED_DEFAULT_DAYS * 86_400_000, toMs: now + 86_400_000 });

type Db = ReturnType<typeof sql>;
const inPlace = (db: Db, s: MissedScope) => (s.allowed ? db`and e.location_id = any(${s.allowed}::text[])` : db``);

/** Latest missed call per caller in the range. */
function latestMissed(db: Db, s: MissedScope) {
  return db`
    m as (
      select distinct on (e.location_id, e.contact_id) e.location_id, e.contact_id, e.at missed_at from touch_events e
      where e.installation_id = ${s.installationId} and e.kind = 'missed_call' and e.at >= ${new Date(s.fromMs)} and e.at < ${new Date(s.toMs)} ${inPlace(db, s)}
      order by e.location_id, e.contact_id, e.at desc)`;
}

/** The callers nobody reached after their latest missed call. */
function waitingCte(db: Db, s: MissedScope) {
  return db`
    ${latestMissed(db, s)},
    w as (
      select m.* from m
      where not exists (select 1 from touch_events o where o.installation_id = ${s.installationId} and o.location_id = m.location_id and o.contact_id = m.contact_id
          and o.direction = 'outbound' and o.kind <> 'failed' and o.at > m.missed_at)
        and not exists (select 1 from call_outcomes co where co.installation_id = ${s.installationId} and co.location_id = m.location_id and co.contact_id = m.contact_id and co.created_at > m.missed_at))`;
}

const rowOf = (r: Record<string, unknown>): MissedRow => ({
  locationId: r.location_id as string, contactId: r.contact_id as string, missedAt: new Date(r.missed_at as string).getTime(), name: (r.name as string | null) ?? null, email: (r.email as string | null) ?? null,
  phone: (r.phone as string | null) ?? null, dnd: r.dnd === true, source: (r.source as string | null) ?? null, owner: (r.owner as string | null) ?? null,
  locationName: (r.location_name as string | null) ?? null, timeZone: (r.timezone as string | null) ?? null, dollars: Number(r.dollars ?? 0), hasRecord: r.has_record !== false,
});

/** One ranked page of the waiting callers, with the true count and dollars of all of them. */
export async function missedWaitingPage(s: MissedScope, page: { limit: number; offset: number }): Promise<{ total: number; dollars: number; rows: MissedRow[] }> {
  if (s.ownerId === "") return { total: 0, dollars: 0, rows: [] };
  const db = sql();
  const owner = s.ownerId ? db`and c.assigned_to = ${s.ownerId}` : db``;
  const rows = await db`
    with ${waitingCte(db, s)},
    r as (
      select w.location_id, w.contact_id, w.missed_at, l.name location_name, l.timezone,
        nullif(coalesce(nullif(c.full_name, ''), nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')), '') name, c.email, c.phone, c.dnd, nullif(c.source, '') source, nullif(c.assigned_to, '') owner, (c.contact_id is not null) has_record,
        coalesce(d.v, 0)::float8 dollars
      from w
      join locations l on l.installation_id = ${s.installationId} and l.location_id = w.location_id and not l.ignored
      ${s.ownerId ? db`join` : db`left join`} cached_contacts c on c.installation_id = ${s.installationId} and c.location_id = w.location_id and c.contact_id = w.contact_id ${owner}
      left join lateral (
        select sum(o.monetary_value) v from cached_opportunities o ${dealScopeJoins()}
        where o.installation_id = ${s.installationId} and o.location_id = w.location_id and o.contact_id = w.contact_id and o.status = 'open' and ${countedInScope()}) d on true)
    select r.*, count(*) over ()::int total, coalesce(sum(r.dollars) over (), 0)::float8 total_dollars from r
    order by r.dollars desc, r.missed_at desc, r.location_id, r.contact_id limit ${page.limit} offset ${page.offset}`;
  if (rows.length === 0 && page.offset > 0) {
    // A page past the end: still say how many there are.
    const [t] = await db`with ${waitingCte(db, s)} select count(*)::int n from w join locations l on l.installation_id = ${s.installationId} and l.location_id = w.location_id and not l.ignored`;
    return { total: Number(t?.n ?? 0), dollars: 0, rows: [] };
  }
  return { total: Number(rows[0]?.total ?? 0), dollars: Number(rows[0]?.total_dollars ?? 0), rows: rows.map(rowOf) };
}

/** Every missed call in the range, and how many got a callback or text inside 15 minutes / a text inside 60 seconds. Counts calls, one aggregate. */
export async function missedStats(s: MissedScope): Promise<{ calls: number; recovered15: number; texted60: number }> {
  const db = sql();
  const [r] = await db`
    select count(*)::int calls,
      count(*) filter (where exists (select 1 from touch_events o where o.installation_id = e.installation_id and o.location_id = e.location_id and o.contact_id = e.contact_id
        and o.direction = 'outbound' and o.kind <> 'failed' and o.at >= e.at and o.at <= e.at + make_interval(secs => ${RECOVERY_SECONDS})))::int recovered15,
      count(*) filter (where exists (select 1 from touch_events o where o.installation_id = e.installation_id and o.location_id = e.location_id and o.contact_id = e.contact_id
        and o.direction = 'outbound' and o.kind <> 'failed' and o.channel in ('sms', 'whatsapp') and o.at >= e.at and o.at <= e.at + make_interval(secs => ${TEXT_BACK_SECONDS})))::int texted60
    from touch_events e join locations l on l.installation_id = e.installation_id and l.location_id = e.location_id and not l.ignored
    where e.installation_id = ${s.installationId} and e.kind = 'missed_call' and e.at >= ${new Date(s.fromMs)} and e.at < ${new Date(s.toMs)} ${inPlace(db, s)}`;
  return { calls: Number(r?.calls ?? 0), recovered15: Number(r?.recovered15 ?? 0), texted60: Number(r?.texted60 ?? 0) };
}

/** The newest callers whose latest missed call got a callback or text inside 15 minutes (a short list for the Coverage card). */
export async function missedRecoveredRows(s: MissedScope, limit: number): Promise<MissedRow[]> {
  const db = sql();
  const rows = await db`
    with ${latestMissed(db, s)}
    select m.location_id, m.contact_id, m.missed_at, l.name location_name, l.timezone, nullif(coalesce(nullif(c.full_name, ''), nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), '')), '') name,
      c.email, c.phone, c.dnd, nullif(c.source, '') source, nullif(c.assigned_to, '') owner, (c.contact_id is not null) has_record, 0::float8 dollars
    from m join locations l on l.installation_id = ${s.installationId} and l.location_id = m.location_id and not l.ignored
    left join cached_contacts c on c.installation_id = ${s.installationId} and c.location_id = m.location_id and c.contact_id = m.contact_id
    where exists (select 1 from touch_events o where o.installation_id = ${s.installationId} and o.location_id = m.location_id and o.contact_id = m.contact_id
      and o.direction = 'outbound' and o.kind <> 'failed' and o.at >= m.missed_at and o.at <= m.missed_at + make_interval(secs => ${RECOVERY_SECONDS}))
    order by m.missed_at desc limit ${limit}`;
  return rows.map(rowOf);
}
