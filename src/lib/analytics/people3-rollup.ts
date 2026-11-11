import { sql } from "../db";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";
import { DAY, WAIT_HOURS } from "./people3-intel";

// The database side of the per-person numbers: the daily rollup (user_daily), its identical live twin, and the "right now" workload. Every read starts from a list of account ids the
// route already narrowed to the caller's own accounts, and every query filters by installation_id again. Attribution rules (docs/METRICS.md "Team 3"):
//   actions (messages, calls) are credited to the ACTOR (touch_events.user_id, not automated); a message with no person is '~unknown', a workflow message '~automated';
//   outcomes (showed, won, lost) are credited to the OWNER AT THE TIME, read from the append-only owner history (appointment_history / deal_history kind = 'owner');
//   "who booked it" is the creator the CRM records on the appointment (booked_by_user); with none, the last human touch on that contact in the 7 days before is the LIKELY booker (an estimate, own column).
// Dates are UTC days. Our own writes never count: touch_events holds only customer-facing messages and calls (internal comments are dropped at ingest).

type Db = ReturnType<typeof sql>;
export type Frag = import("postgres").PendingQuery<import("postgres").Row[]>;
const day = (d: Date) => d.toISOString().slice(0, 10);

export const STALE_DEAL_DAYS = 30;

/** The owner of an appointment or deal at an instant: the last owner event at or before it; with none that early, the first owner we saw; with no history, the record's current owner.
 *  '~none' when it was explicitly unassigned. `at` is a SQL expression on the outer row. */
export function ownerAt(db: Db, kind: "appointment" | "deal", alias: string, at: string): Frag {
  const tbl = kind === "appointment" ? db`appointment_history` : db`deal_history`;
  const idc = kind === "appointment" ? db`appointment_id` : db`opportunity_id`;
  const idv = kind === "appointment" ? db`${db(alias)}.appointment_id` : db`${db(alias)}.opportunity_id`;
  const atv = db`${db(alias)}.${db(at)}`;
  const base = db`h.installation_id = ${db(alias)}.installation_id and h.location_id = ${db(alias)}.location_id and h.${idc} = ${idv} and h.kind = 'owner'`;
  return db`coalesce(
    (select coalesce(h.to_value, '~none') from ${tbl} h where ${base} and h.at <= ${atv} order by h.at desc, h.id desc limit 1),
    (select coalesce(h.to_value, '~none') from ${tbl} h where ${base} order by h.at asc, h.id asc limit 1),
    ${db`${db(alias)}.assigned_to`})`;
}

/** One row per account, person and day, counted straight from the synced records. The hourly sweep writes exactly this into user_daily; screens use it live when the table is stale. */
export function userDailySource(inst: string, ids: string[], since: Date): Frag {
  const db = sql();
  const S = day(since);
  return db`
    select location_id, user_id, day,
      sum(touches_sms)::int touches_sms, sum(touches_email)::int touches_email, sum(touches_call)::int touches_call, sum(touches_other)::int touches_other,
      sum(first_replies)::int first_replies, sum(in_time)::int in_time, max(median_seconds)::int median_seconds,
      sum(appts_set)::int appts_set, sum(appts_set_est)::int appts_set_est, sum(set_showed)::int set_showed, sum(set_noshow)::int set_noshow, sum(held)::int held, sum(no_show)::int no_show,
      sum(deals_won)::int deals_won, sum(won_value)::float8 won_value, sum(deals_lost)::int deals_lost, sum(lost_value)::float8 lost_value
    from (
      -- 1. what people did: messages and calls sent, by the person who sent them
      select t.location_id, case when t.automated then '~automated' when t.user_id is null then '~unknown' else t.user_id end user_id, (t.at at time zone 'UTC')::date as day,
        (count(*) filter (where t.channel = 'sms'))::int touches_sms, (count(*) filter (where t.channel = 'email'))::int touches_email, (count(*) filter (where t.channel = 'call'))::int touches_call,
        (count(*) filter (where t.channel not in ('sms', 'email', 'call')))::int touches_other,
        0::int first_replies, 0::int in_time, null::int median_seconds, 0::int appts_set, 0::int appts_set_est, 0::int set_showed, 0::int set_noshow, 0::int held, 0::int no_show,
        0::int deals_won, 0::float8 won_value, 0::int deals_lost, 0::float8 lost_value
      from touch_events t where t.installation_id = ${inst} and t.location_id = any(${ids}::text[]) and t.at >= ${S}::date and t.direction = 'outbound' and t.kind in ('message', 'call')
      group by 1, 2, 3
      union all
      -- 2. new leads whose first reply came from this person (by the lead's date): in time, and the middle of the reply times (the account's business-hours clock)
      select z.location_id, z.user_id, z.day, 0, 0, 0, 0, count(*)::int, (count(*) filter (where z.secs <= z.target * 60))::int, (percentile_cont(0.5) within group (order by z.secs))::int,
        0, 0, 0, 0, 0, 0, 0, 0::float8, 0, 0::float8
      from (select lt.location_id, lt.touch_user_id user_id, (lt.lead_at at time zone 'UTC')::date as day, tg.m target,
              greatest(0, extract(epoch from (lt.touch_at - coalesce(lt.clock_start, lt.lead_at)))) secs
            from lead_touches lt
            join (select l.location_id, coalesce(l.speed_target_minutes, s.speed_target_minutes, 15) m from locations l left join settings s on s.installation_id = l.installation_id
                  where l.installation_id = ${inst} and l.location_id = any(${ids}::text[])) tg on tg.location_id = lt.location_id
            where lt.installation_id = ${inst} and lt.location_id = any(${ids}::text[]) and lt.excluded is null and lt.touch_at is not null and lt.touch_user_id is not null and lt.lead_at >= ${S}::date) z
      group by 1, 2, 3
      union all
      -- 3. appointments created by this person (the creator the CRM records)
      select a.location_id, a.booked_by_user, (a.created_remote_at at time zone 'UTC')::date, 0, 0, 0, 0, 0, 0, null::int, count(*)::int, 0, 0, 0, 0, 0, 0, 0::float8, 0, 0::float8
      from cached_appointments a where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and a.booked_by_user is not null and a.created_remote_at >= ${S}::date and a.status is distinct from 'invalid'
      group by 1, 2, 3
      union all
      -- 3b. no recorded creator: the last human touch on that contact in the 7 days before it was created is the LIKELY booker (an estimate, counted apart)
      select a.location_id, x.user_id, (a.created_remote_at at time zone 'UTC')::date, 0, 0, 0, 0, 0, 0, null::int, 0, count(*)::int, 0, 0, 0, 0, 0, 0::float8, 0, 0::float8
      from cached_appointments a
      cross join lateral (select t.user_id from touch_events t where t.installation_id = a.installation_id and t.location_id = a.location_id and t.contact_id = a.contact_id
        and t.direction = 'outbound' and not t.automated and t.user_id is not null and t.at <= a.created_remote_at and t.at > a.created_remote_at - interval '7 days' order by t.at desc limit 1) x
      where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and a.booked_by_user is null and a.contact_id is not null and a.created_remote_at >= ${S}::date and a.status is distinct from 'invalid'
      group by 1, 2, 3
      union all
      -- 4. what became of the appointments a person SET (by the day it started)
      select a.location_id, a.booked_by_user, (a.start_at at time zone 'UTC')::date, 0, 0, 0, 0, 0, 0, null::int, 0, 0, (count(*) filter (where a.status = 'showed'))::int, (count(*) filter (where a.status = 'noshow'))::int, 0, 0, 0, 0::float8, 0, 0::float8
      from cached_appointments a where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and a.booked_by_user is not null and a.start_at >= ${S}::date and a.start_at < now() and a.status in ('showed', 'noshow')
      group by 1, 2, 3
      union all
      -- 5. what became of the appointments a person OWNED at the time (held and no-show)
      select z.location_id, z.ou, (z.start_at at time zone 'UTC')::date, 0, 0, 0, 0, 0, 0, null::int, 0, 0, 0, 0, (count(*) filter (where z.status = 'showed'))::int, (count(*) filter (where z.status = 'noshow'))::int, 0, 0::float8, 0, 0::float8
      from (select a.location_id, a.start_at, a.status, ${ownerAt(db, "appointment", "a", "start_at")} ou from cached_appointments a
            where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and a.start_at >= ${S}::date and a.start_at < now() and a.status in ('showed', 'noshow')) z
      where z.ou is not null and z.ou not like '~%' group by 1, 2, 3
      union all
      -- 6. deals won and lost, credited to the owner when the status changed
      select z.location_id, z.ou, z.day, 0, 0, 0, 0, 0, 0, null::int, 0, 0, 0, 0, 0, 0, (count(*) filter (where z.status = 'won'))::int, coalesce(sum(z.v) filter (where z.status = 'won'), 0)::float8,
        (count(*) filter (where z.status = 'lost'))::int, coalesce(sum(z.v) filter (where z.status = 'lost'), 0)::float8
      from (select o.location_id, o.status, o.monetary_value::float8 v, (o.last_status_change_at at time zone 'UTC')::date as day, ${ownerAt(db, "deal", "o", "last_status_change_at")} ou
            from cached_opportunities o where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) and o.status in ('won', 'lost') and o.last_status_change_at >= ${S}::date and coalesce(o.monetary_value, 0) > 0) z
      where z.ou is not null and z.ou not like '~%' group by 1, 2, 3
    ) u where day is not null and user_id is not null group by location_id, user_id, day`;
}

/** The sweep: upsert the recent days of every account's per-person rows, plus when it ran. Safe to run twice. `days` is 120 for a first or daily full run, 14 otherwise. Returns rows written. */
export async function refreshUserRollup(inst: string, days = 14, now = Date.now()): Promise<number> {
  const db = sql();
  const accts = await db`select location_id from locations where installation_id = ${inst} and not ignored`;
  const ids = accts.map((r) => r.location_id as string);
  if (!ids.length) return 0;
  const since = new Date(now - days * DAY);
  const wrote = await db`
    insert into user_daily (installation_id, location_id, user_id, day, touches_sms, touches_email, touches_call, touches_other, first_replies, in_time, median_seconds, appts_set, appts_set_est,
      set_showed, set_noshow, held, no_show, deals_won, won_value, deals_lost, lost_value, refreshed_at)
    select ${inst}::uuid, s.location_id, s.user_id, s.day, s.touches_sms, s.touches_email, s.touches_call, s.touches_other, s.first_replies, s.in_time, s.median_seconds, s.appts_set, s.appts_set_est,
      s.set_showed, s.set_noshow, s.held, s.no_show, s.deals_won, s.won_value, s.deals_lost, s.lost_value, now() from (${userDailySource(inst, ids, since)}) s
    on conflict (installation_id, location_id, user_id, day) do update set touches_sms = excluded.touches_sms, touches_email = excluded.touches_email, touches_call = excluded.touches_call,
      touches_other = excluded.touches_other, first_replies = excluded.first_replies, in_time = excluded.in_time, median_seconds = excluded.median_seconds, appts_set = excluded.appts_set,
      appts_set_est = excluded.appts_set_est, set_showed = excluded.set_showed, set_noshow = excluded.set_noshow, held = excluded.held, no_show = excluded.no_show, deals_won = excluded.deals_won,
      won_value = excluded.won_value, deals_lost = excluded.deals_lost, lost_value = excluded.lost_value, refreshed_at = now()
    returning 1`;
  await db`
    insert into user_rollup_state (installation_id, location_id, refreshed_at, first_day, people)
    select ${inst}::uuid, l.location_id, now(), (select min(d.day) from user_daily d where d.installation_id = ${inst} and d.location_id = l.location_id),
      (select count(distinct d.user_id) from user_daily d where d.installation_id = ${inst} and d.location_id = l.location_id and d.user_id not like '~%')::int
    from locations l where l.installation_id = ${inst} and not l.ignored
    on conflict (installation_id, location_id) do update set refreshed_at = now(), first_day = excluded.first_day, people = excluded.people`;
  return wrote.length;
}

/** The daily rows as a fragment: the table when every account's rollup is under two hours old and the window is inside the 120 days it keeps, else the live scan (same columns). */
export async function dailyFrom(inst: string, ids: string[], since: Date, now = Date.now()): Promise<{ f: Frag; live: boolean }> {
  const db = sql();
  const cols = db`location_id, user_id, day, touches_sms, touches_email, touches_call, touches_other, first_replies, in_time, median_seconds, appts_set, appts_set_est, set_showed, set_noshow, held, no_show, deals_won, won_value, deals_lost, lost_value`;
  if (ids.length && since.getTime() >= now - 118 * DAY) {
    try {
      const r = await db`select count(*)::int c from user_rollup_state where installation_id = ${inst} and location_id = any(${ids}::text[]) and refreshed_at > now() - interval '2 hours'`;
      if (Number(r[0]?.c) === ids.length) {
        return { live: false, f: db`select ${cols} from user_daily where installation_id = ${inst} and location_id = any(${ids}::text[]) and day >= ${day(since)}::date` };
      }
    } catch { /* table not created yet: use the live scan */ }
  }
  return { live: true, f: userDailySource(inst, ids, since) };
}

// ---- "right now": who holds what ----

export type Work = { locationId: string; userId: string; waiting: number; waitingOld: number; openDeals: number; openValue: number; staleDeals: number; staleValue: number; upcoming: number; needsOutcome: number; lastTouchAt: Date | null };
export const NO_OWNER = "~none";
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Conversations whose last message came from the lead in the last 30 days (the Clients and Unanswered rule). Owner = the conversation's owner, else the contact's. Aliases: c, ct. */
export function waitingFrom(inst: string, ids: string[]): Frag {
  const db = sql();
  return db`from cached_conversations c left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
    where c.installation_id = ${inst} and c.location_id = any(${ids}::text[]) and c.last_message_direction = 'inbound' and c.last_message_at > now() - interval '30 days'`;
}
export const waitingOwner = () => sql()`coalesce(nullif(c.assigned_to, ''), nullif(ct.assigned_to, ''))`;
export const oldWait = () => sql()`c.last_message_at < now() - ${`${WAIT_HOURS} hours`}::interval`;
/** Open counted deals in play (same rule as the Pipeline and Clients). Alias o. */
export function openDealsFrom(inst: string, ids: string[]): Frag {
  const db = sql();
  return db`from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()}`;
}
export const staleDeal = () => sql()`coalesce(o.last_stage_change_at, o.created_remote_at) < now() - ${`${STALE_DEAL_DAYS} days`}::interval`;
export const upcomingFrom = (inst: string, ids: string[]): Frag => sql()`from cached_appointments a where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and a.assigned_to is not null and a.start_at >= now() and coalesce(a.status, '') not in ('cancelled', 'invalid')`;
export const needsOutcomeFrom = (inst: string, ids: string[]): Frag => sql()`from cached_appointments a where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and a.assigned_to is not null
  and a.status not in ('showed', 'noshow', 'cancelled', 'invalid') and a.start_at < now() - interval '3 hours' and a.start_at > now() - interval '90 days'`;

/** Open items per person per account right now. The counts here and the rows behind them (people3-queries list) share the fragments above, so a count equals its rows. */
export async function workItems(inst: string, ids: string[], pairs: Array<[string, string]> = []): Promise<Map<string, Work>> {
  const out = new Map<string, Work>();
  if (!ids.length) return out;
  const db = sql();
  const key = (l: string, u: string) => `${l}|${u}`;
  const get = (l: string, u: string): Work => {
    let w = out.get(key(l, u));
    if (!w) { w = { locationId: l, userId: u, waiting: 0, waitingOld: 0, openDeals: 0, openValue: 0, staleDeals: 0, staleValue: 0, upcoming: 0, needsOutcome: 0, lastTouchAt: null }; out.set(key(l, u), w); }
    return w;
  };
  const [wait, deals, up, nout] = await Promise.all([
    db`select c.location_id, coalesce(${waitingOwner()}, ${NO_OWNER}) uid, count(*)::int w, (count(*) filter (where ${oldWait()}))::int wold ${waitingFrom(inst, ids)} group by 1, 2`,
    db`select o.location_id, o.assigned_to uid, count(*)::int n, coalesce(sum(o.monetary_value), 0)::float8 v, (count(*) filter (where ${staleDeal()}))::int st,
        coalesce(sum(o.monetary_value) filter (where ${staleDeal()}), 0)::float8 sv ${openDealsFrom(inst, ids)} group by 1, 2`,
    db`select a.location_id, a.assigned_to uid, count(*)::int n ${upcomingFrom(inst, ids)} group by 1, 2`,
    db`select a.location_id, a.assigned_to uid, count(*)::int n ${needsOutcomeFrom(inst, ids)} group by 1, 2`,
  ]);
  for (const r of wait) { const w = get(r.location_id as string, r.uid as string); w.waiting = n(r.w); w.waitingOld = n(r.wold); }
  for (const r of deals) { const w = get(r.location_id as string, r.uid as string); w.openDeals = n(r.n); w.openValue = n(r.v); w.staleDeals = n(r.st); w.staleValue = n(r.sv); }
  for (const r of up) get(r.location_id as string, r.uid as string).upcoming = n(r.n);
  for (const r of nout) get(r.location_id as string, r.uid as string).needsOutcome = n(r.n);
  for (const [l, u] of pairs) get(l, u);
  // The last recorded human touch per person per account, by an index walk per pair (never a scan of every touch).
  const list = [...out.values()].filter((w) => w.userId !== NO_OWNER);
  if (list.length) {
    const rows = await db`
      select p.location_id, p.user_id, (select t.at from touch_events t where t.installation_id = ${inst} and t.location_id = p.location_id and t.user_id = p.user_id and t.direction = 'outbound' and not t.automated
        order by t.at desc limit 1) last_at
      from (select * from unnest(${list.map((w) => w.locationId)}::text[], ${list.map((w) => w.userId)}::text[]) as x(location_id, user_id)) p`;
    for (const r of rows) { const w = out.get(key(r.location_id as string, r.user_id as string)); if (w && r.last_at) w.lastTouchAt = r.last_at as Date; }
  }
  return out;
}

/** Writes today's snapshot of every person's workload (the CRM keeps no history of who held what). The last write of the day wins. Returns rows written. */
export async function snapshotWorkload(inst: string): Promise<number> {
  const db = sql();
  const accts = await db`select location_id from locations where installation_id = ${inst} and not ignored`;
  const ids = accts.map((r) => r.location_id as string);
  if (!ids.length) return 0;
  const access = await db`select location_id, user_id from team_member_access where installation_id = ${inst} and location_id = any(${ids}::text[])`.catch(() => []);
  const work = await workItems(inst, ids, access.map((r) => [r.location_id as string, r.user_id as string] as [string, string]));
  const rows = [...work.values()].filter((w) => w.userId !== NO_OWNER);
  let wrote = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    const res = await db`
      insert into user_workload_daily (installation_id, location_id, user_id, day, waiting, waiting_old, open_deals, open_value, stale_deals, stale_value, upcoming, needs_outcome, last_touch_at, refreshed_at)
      select ${inst}::uuid, x.location_id, x.user_id, (now() at time zone 'UTC')::date, x.waiting, x.waiting_old, x.open_deals, x.open_value, x.stale_deals, x.stale_value, x.upcoming, x.needs_outcome, x.last_touch_at, now()
      from unnest(${part.map((w) => w.locationId)}::text[], ${part.map((w) => w.userId)}::text[], ${part.map((w) => w.waiting)}::int[], ${part.map((w) => w.waitingOld)}::int[], ${part.map((w) => w.openDeals)}::int[],
        ${part.map((w) => w.openValue)}::float8[], ${part.map((w) => w.staleDeals)}::int[], ${part.map((w) => w.staleValue)}::float8[], ${part.map((w) => w.upcoming)}::int[], ${part.map((w) => w.needsOutcome)}::int[],
        ${part.map((w) => (w.lastTouchAt ? w.lastTouchAt.toISOString() : null))}::timestamptz[])
        as x(location_id, user_id, waiting, waiting_old, open_deals, open_value, stale_deals, stale_value, upcoming, needs_outcome, last_touch_at)
      on conflict (installation_id, location_id, user_id, day) do update set waiting = excluded.waiting, waiting_old = excluded.waiting_old, open_deals = excluded.open_deals, open_value = excluded.open_value,
        stale_deals = excluded.stale_deals, stale_value = excluded.stale_value, upcoming = excluded.upcoming, needs_outcome = excluded.needs_outcome, last_touch_at = excluded.last_touch_at, refreshed_at = now()
      returning 1`;
    wrote += res.length;
  }
  return wrote;
}
