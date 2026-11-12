import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { decodeCur, encodeCur } from "../dq/dq-core";
import { LEAD_SQL } from "./dq-queries";
import { cleanId, type Scope } from "./appointments3-queries.ts";
import {
  AGE_BANDS, forecastOf, stepIndex, weekStart, ZERO, type CohortRow, type Dim, type Forecast, type StepKey, type Tot,
} from "./bf-core.ts";

// Booking funnel (stage BF): every read behind /api/app/appointments/funnel?part=... Read only. The counts come from bf_funnel_daily (a copy of what the contacts, touches, appointments and deals
// already say, rebuilt lazily per account, at most once an hour) or from its identical live twin when an account is not fresh yet. A million leads cost the same as a hundred. The accounts a
// caller may read (`s.allowed`) come from the signed session in the router, never from the request; every name is resolved here, no id is sent for display. SQL text comes from constants
// in this file and dq-queries.ts only: nothing a person typed is put into SQL text.

type Db = ReturnType<typeof sql>;
type Frag = ReturnType<Db>;
export type BfFilters = {
  from: Date; to: Date; location?: string | null; calendar?: string | null; setter?: string | null; closer?: string | null; owner?: string | null;
  source?: string | null; form?: string | null; hour?: number | null; dow?: number | null; age?: string | null;
};
export const bfCache = ttlCache<unknown>(30_000, 200);
const DAY = 86_400_000, FRESH_MS = 60 * 60 * 1000;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? new Date(v).toISOString() : null);

type Loc = { id: string; name: string; tz: string };
export async function accountsOf(s: Scope, one?: string | null): Promise<Loc[]> {
  const db = sql(), id = cleanId(one);
  const r = await db`select l.location_id id, l.name, coalesce(z.name, 'UTC') tz from locations l left join pg_timezone_names z on z.name = l.timezone
    where l.installation_id = ${s.inst} and not l.ignored ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``} ${id ? db`and l.location_id = ${id}` : db``}`;
  return r.map((x) => ({ id: x.id as string, name: (x.name as string) || "Client account", tz: x.tz as string }));
}
const locFrag = (locs: Loc[]) => sql()`select * from unnest(${locs.map((l) => l.id)}::text[], ${locs.map((l) => l.tz)}::text[]) as t(location_id, tz)`;

// ---------- one row per lead: the definition every number and every list shares ----------
/** Each lead that came in during the window (by the day it was created in its account's time zone), with the furthest step it has reached (depth 1 to 6) and the facts behind it. */
function perLead(s: Scope, locs: Loc[], win: { from: Date; to: Date }): Frag {
  const db = sql();
  return db`
    select c.location_id, c.contact_id, c.date_added, (c.date_added at time zone l.tz)::date as day, extract(hour from (c.date_added at time zone l.tz))::smallint as hour,
      left(btrim(coalesce(c.source, '')), 60) as src, coalesce(fm.ext_id, '') as form_id, coalesce(c.assigned_to, '') as owner_id, coalesce(ap.setter, '') as setter_id,
      coalesce(ap.closer, '') as closer_id, coalesce(ap.cal, '') as calendar_id, tt.touch_at, ap.booked_at, ap.showed_at, dl.won, dl.won_at, dl.n_deals, dl.all_lost, dl.won_value,
      case when dl.won then 6 when dl.n_deals > 0 then 5 when ap.showed_at is not null then 4 when ap.booked_at is not null then 3 when tt.touch_at is not null then 2 else 1 end as depth
    from cached_contacts c
    join (${locFrag(locs)}) l on l.location_id = c.location_id
    left join lateral (select s2.ext_id from dq_submissions s2 where s2.installation_id = c.installation_id and s2.location_id = c.location_id and s2.contact_id = c.contact_id order by s2.submitted_at limit 1) fm on true
    left join lateral (select min(t.at) touch_at from touch_events t where t.installation_id = c.installation_id and t.location_id = c.location_id and t.contact_id = c.contact_id
      and t.direction = 'outbound' and not t.automated and t.at >= c.date_added) tt on true
    left join lateral (select (array_agg(a.calendar_id order by coalesce(a.created_remote_at, a.start_at), a.appointment_id))[1] cal, (array_agg(a.booked_by_user order by coalesce(a.created_remote_at, a.start_at), a.appointment_id))[1] setter,
        (array_agg(a.assigned_to order by coalesce(a.created_remote_at, a.start_at), a.appointment_id))[1] closer, min(coalesce(a.created_remote_at, a.start_at)) booked_at,
        min(a.start_at) filter (where lower(coalesce(a.status, '')) = 'showed') showed_at
      from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id and lower(coalesce(a.status, '')) <> 'invalid') ap on true
    left join lateral (select count(*)::int n_deals, coalesce(bool_or(o.status = 'won'), false) won, coalesce(bool_and(o.status = 'lost'), false) all_lost,
        coalesce(sum(o.monetary_value) filter (where o.status = 'won'), 0) won_value, max(coalesce(o.last_status_change_at, o.synced_at)) filter (where o.status = 'won') won_at
      from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id) dl on true
    where c.installation_id = ${s.inst} and c.date_added is not null and c.date_added >= ${new Date(win.from.getTime() - DAY)} and c.date_added < ${new Date(win.to.getTime() + DAY)}
      and (c.date_added at time zone l.tz)::date >= ${ymd(win.from)}::date and (c.date_added at time zone l.tz)::date < ${ymd(win.to)}::date
      and not ${db.unsafe(LEAD_SQL.dup)} and not ${db.unsafe(LEAD_SQL.junk)}`;
}

/** The same rows, added up by the day, hour, source, form, people and calendar. This is what the rollup stores and what the live twin returns. */
function grouped(s: Scope, locs: Loc[], win: { from: Date; to: Date }): Frag {
  const db = sql();
  const within = (col: string, n: number) => `(${col} is not null and ${col} <= x.date_added + interval '${n} days')`;
  const secs = (col: string) => `extract(epoch from (${col} - x.date_added))`;
  return db`
    select x.location_id, x.day, x.hour, x.src, x.form_id, x.owner_id, x.setter_id, x.closer_id, x.calendar_id,
      count(*)::float8 leads, count(*) filter (where x.depth >= 2)::float8 reach_answered, count(*) filter (where x.depth >= 3)::float8 reach_booked, count(*) filter (where x.depth >= 4)::float8 reach_showed,
      count(*) filter (where x.depth >= 5)::float8 reach_deal, count(*) filter (where x.depth >= 6)::float8 reach_won, coalesce(sum(x.won_value) filter (where x.won), 0)::float8 won_value,
      count(*) filter (where x.n_deals > 0 and not x.won and x.all_lost)::float8 lost,
      coalesce(sum(${db.unsafe(secs("x.touch_at"))}) filter (where x.touch_at >= x.date_added), 0)::float8 t_touch_secs, count(*) filter (where x.touch_at >= x.date_added)::float8 t_touch_n,
      coalesce(sum(${db.unsafe(secs("x.booked_at"))}) filter (where x.booked_at >= x.date_added), 0)::float8 t_book_secs, count(*) filter (where x.booked_at >= x.date_added)::float8 t_book_n,
      coalesce(sum(${db.unsafe(secs("x.showed_at"))}) filter (where x.showed_at >= x.date_added), 0)::float8 t_show_secs, count(*) filter (where x.showed_at >= x.date_added)::float8 t_show_n,
      coalesce(sum(${db.unsafe(secs("x.won_at"))}) filter (where x.won and x.won_at >= x.date_added), 0)::float8 t_win_secs, count(*) filter (where x.won and x.won_at >= x.date_added)::float8 t_win_n,
      count(*) filter (where x.date_added <= now() - interval '7 days')::float8 mature7, count(*) filter (where x.date_added <= now() - interval '14 days')::float8 mature14, count(*) filter (where x.date_added <= now() - interval '30 days')::float8 mature30,
      count(*) filter (where ${db.unsafe(within("x.booked_at", 7))})::float8 booked7, count(*) filter (where ${db.unsafe(within("x.booked_at", 14))})::float8 booked14, count(*) filter (where ${db.unsafe(within("x.booked_at", 30))})::float8 booked30,
      count(*) filter (where ${db.unsafe(within("x.showed_at", 7))})::float8 showed7, count(*) filter (where ${db.unsafe(within("x.showed_at", 14))})::float8 showed14, count(*) filter (where ${db.unsafe(within("x.showed_at", 30))})::float8 showed30,
      count(*) filter (where x.won and ${db.unsafe(within("x.won_at", 7))})::float8 won7, count(*) filter (where x.won and ${db.unsafe(within("x.won_at", 14))})::float8 won14, count(*) filter (where x.won and ${db.unsafe(within("x.won_at", 30))})::float8 won30
    from (${perLead(s, locs, win)}) x group by 1, 2, 3, 4, 5, 6, 7, 8, 9`;
}

const COLS = "location_id, day, hour, src, form_id, owner_id, setter_id, closer_id, calendar_id, leads, reach_answered, reach_booked, reach_showed, reach_deal, reach_won, won_value, lost, t_touch_secs, t_touch_n, t_book_secs, t_book_n, t_show_secs, t_show_n, t_win_secs, t_win_n, mature7, mature14, mature30, booked7, booked14, booked30, showed7, showed14, showed30, won7, won14, won30";

// ---------- the rollup refresh (lazy, per account, idempotent) ----------
/** Recompute an account's days. Safe to run twice: the days in the window are replaced, never added to. Also exported for the scheduled sweep. */
export async function refreshBfRollup(inst: string, loc: Loc, sinceDays: number): Promise<void> {
  const db = sql(), s: Scope = { inst, allowed: [loc.id] };
  const win = { from: new Date(Date.now() - sinceDays * DAY), to: new Date(Date.now() + DAY) };
  await db.begin(async (tx) => {
    await tx`delete from bf_funnel_daily where installation_id = ${inst} and location_id = ${loc.id} and day >= ${ymd(win.from)}::date`;
    await tx`insert into bf_funnel_daily (installation_id, location_id, day, hour, src, form_id, owner_id, setter_id, closer_id, calendar_id, leads, reach_answered, reach_booked, reach_showed, reach_deal, reach_won, won_value, lost,
        t_touch_secs, t_touch_n, t_book_secs, t_book_n, t_show_secs, t_show_n, t_win_secs, t_win_n, mature7, mature14, mature30, booked7, booked14, booked30, showed7, showed14, showed30, won7, won14, won30)
      select ${inst}, ${db.unsafe(COLS)} from (${grouped(s, [loc], win)}) g`;
    await tx`insert into bf_funnel_state (installation_id, location_id, refreshed_at, first_day)
      values (${inst}, ${loc.id}, now(), (select min(day) from bf_funnel_daily where installation_id = ${inst} and location_id = ${loc.id}))
      on conflict (installation_id, location_id) do update set refreshed_at = now(), first_day = excluded.first_day`;
  });
}
const refreshing = new Map<string, Promise<void>>();
async function ensureFresh(s: Scope, locs: Loc[]): Promise<boolean> {
  const db = sql();
  const st = await db`select location_id, refreshed_at from bf_funnel_state where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[])`.catch(() => null);
  if (!st) return false; // the table is not there yet: the live twin answers
  const seen = new Map(st.map((r) => [r.location_id as string, (r.refreshed_at as Date).getTime()]));
  const stale = locs.filter((l) => !seen.has(l.id) || Date.now() - (seen.get(l.id) as number) > FRESH_MS);
  if (stale.length === 0) return true;
  const run = (l: Loc) => {
    const k = `${s.inst}:${l.id}`, cur = refreshing.get(k) ?? refreshBfRollup(s.inst, l, seen.has(l.id) ? 120 : 400).finally(() => refreshing.delete(k));
    refreshing.set(k, cur); return cur;
  };
  if (stale.length > 3) { for (const l of stale.slice(0, 3)) void run(l).catch(() => undefined); return false; } // fill three more in the background; this answer is live, the next ones use the rollup
  try { await Promise.all(stale.map(run)); } catch { return false; }
  return true;
}

/** The rows every total reads: the rollup when every account is fresh, else the live twin. Both have the same columns. */
async function facts(s: Scope, f: BfFilters, locs: Loc[]): Promise<{ frag: Frag; live: boolean }> {
  const db = sql();
  if (await ensureFresh(s, locs)) return { frag: db`select ${db.unsafe(COLS)} from bf_funnel_daily where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[]) and day >= ${ymd(f.from)}::date and day < ${ymd(f.to)}::date`, live: false };
  return { frag: grouped(s, locs, { from: f.from, to: f.to }), live: true };
}
/** Filters on the columns both kinds of rows have. */
function where(db: Db, f: BfFilters): Frag {
  const none = (v: string) => (v === "none" ? db`''` : db`${v}`);
  return db`true ${f.calendar ? db`and calendar_id = ${f.calendar}` : db``} ${f.setter ? db`and setter_id = ${f.setter === "none" ? "" : f.setter}` : db``} ${f.closer ? db`and closer_id = ${f.closer === "none" ? "" : f.closer}` : db``}
    ${f.owner ? db`and owner_id = ${f.owner === "none" ? "" : f.owner}` : db``} ${f.source ? db`and src = ${none(f.source)}` : db``} ${f.form ? db`and form_id = ${none(f.form)}` : db``}
    ${f.hour !== null && f.hour !== undefined ? db`and hour = ${f.hour}` : db``} ${f.dow !== null && f.dow !== undefined ? db`and extract(dow from day)::int = ${f.dow}` : db``} ${ageWhere(db, f.age)}`;
}
function ageWhere(db: Db, age?: string | null): Frag {
  const band = AGE_BANDS.find((b) => b.key === age);
  if (!band) return db``;
  const d = db`(now() at time zone 'UTC')::date - day`;
  return band.key === "d0" ? db`and ${d} < 1` : band.key === "d1_7" ? db`and ${d} between 1 and 7` : band.key === "d8_30" ? db`and ${d} between 8 and 30` : db`and ${d} > 30`;
}
const SUMS = (db: Db) => db`${db.unsafe(
  "coalesce(sum(leads),0)::float8 leads, coalesce(sum(reach_answered),0)::float8 answered, coalesce(sum(reach_booked),0)::float8 booked, coalesce(sum(reach_showed),0)::float8 showed, coalesce(sum(reach_deal),0)::float8 deal, coalesce(sum(reach_won),0)::float8 won, " +
  "coalesce(sum(won_value),0)::float8 won_value, coalesce(sum(lost),0)::float8 lost, coalesce(sum(t_touch_secs),0)::float8 t_touch_secs, coalesce(sum(t_touch_n),0)::float8 t_touch_n, coalesce(sum(t_book_secs),0)::float8 t_book_secs, coalesce(sum(t_book_n),0)::float8 t_book_n, " +
  "coalesce(sum(t_show_secs),0)::float8 t_show_secs, coalesce(sum(t_show_n),0)::float8 t_show_n, coalesce(sum(t_win_secs),0)::float8 t_win_secs, coalesce(sum(t_win_n),0)::float8 t_win_n, " +
  "coalesce(sum(mature7),0)::float8 mature7, coalesce(sum(mature14),0)::float8 mature14, coalesce(sum(mature30),0)::float8 mature30, coalesce(sum(booked7),0)::float8 booked7, coalesce(sum(booked14),0)::float8 booked14, coalesce(sum(booked30),0)::float8 booked30, " +
  "coalesce(sum(showed7),0)::float8 showed7, coalesce(sum(showed14),0)::float8 showed14, coalesce(sum(showed30),0)::float8 showed30, coalesce(sum(won7),0)::float8 won7, coalesce(sum(won14),0)::float8 won14, coalesce(sum(won30),0)::float8 won30")}`;
export const totOf = (r: Record<string, unknown>): Tot => ({
  leads: num(r.leads), answered: num(r.answered), booked: num(r.booked), showed: num(r.showed), deal: num(r.deal), won: num(r.won), wonValue: num(r.won_value), lost: num(r.lost),
  tTouchSecs: num(r.t_touch_secs), tTouchN: num(r.t_touch_n), tBookSecs: num(r.t_book_secs), tBookN: num(r.t_book_n), tShowSecs: num(r.t_show_secs), tShowN: num(r.t_show_n), tWinSecs: num(r.t_win_secs), tWinN: num(r.t_win_n),
  mature7: num(r.mature7), mature14: num(r.mature14), mature30: num(r.mature30), booked7: num(r.booked7), booked14: num(r.booked14), booked30: num(r.booked30),
  showed7: num(r.showed7), showed14: num(r.showed14), showed30: num(r.showed30), won7: num(r.won7), won14: num(r.won14), won30: num(r.won30),
});

export async function historyStarts(s: Scope, locs: Loc[]): Promise<string | null> {
  if (!locs.length) return null;
  const r = await sql()`select min(first_day) d from bf_funnel_state where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[])`.catch(() => [{ d: null }]);
  const d = r[0]?.d; return d ? (d instanceof Date ? ymd(d) : String(d).slice(0, 10)) : null;
}

export async function totals(s: Scope, f: BfFilters): Promise<{ tot: Tot; live: boolean; historyStarts: string | null }> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length) return { tot: ZERO, live: false, historyStarts: null };
  const db = sql(), { frag, live } = await facts(s, f, locs);
  const [r] = await db`select ${SUMS(db)} from (${frag}) f where ${where(db, f)}`;
  return { tot: totOf(r ?? {}), live, historyStarts: await historyStarts(s, locs) };
}

// ---------- breakdowns ----------
export type BfRow = { id: string; name: string; tot: Tot };
const KEY: Record<Dim, string> = {
  account: "location_id", source: "src", form: "form_id", calendar: "calendar_id", setter: "setter_id", closer: "closer_id", owner: "owner_id", dow: "extract(dow from day)::int::text", hour: "hour::int::text",
  age: "case when (now() at time zone 'UTC')::date - day < 1 then 'd0' when (now() at time zone 'UTC')::date - day <= 7 then 'd1_7' when (now() at time zone 'UTC')::date - day <= 30 then 'd8_30' else 'd31' end",
};
async function teamNames(inst: string): Promise<(id: string) => string> {
  const rows = await sql()`select user_id, name from team_names where installation_id = ${inst}`.catch(() => []);
  const m = new Map(rows.map((r) => [r.user_id as string, r.name as string]));
  return (id) => (!id ? "Not recorded" : m.get(id) ?? "Team member (name not available)");
}
async function calendarNames(s: Scope, locs: Loc[], ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>(); const want = [...new Set(ids.filter(Boolean))].slice(0, 200);
  if (!want.length) return out;
  const r = await sql()`select distinct on (calendar_id) calendar_id, calendar_name from cached_appointments where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[])
    and calendar_id = any(${want}::text[]) and calendar_name is not null order by calendar_id, start_at desc`;
  for (const x of r) out.set(x.calendar_id as string, x.calendar_name as string);
  return out;
}
async function formNames(s: Scope, locs: Loc[], ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>(); const want = [...new Set(ids.filter(Boolean))].slice(0, 200);
  if (!want.length) return out;
  const r = await sql()`select distinct on (ext_id) ext_id, name from dq_forms where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[]) and ext_id = any(${want}::text[]) order by ext_id, seen_at desc`.catch(() => []);
  for (const x of r) out.set(x.ext_id as string, x.name as string);
  return out;
}

/** The funnel split by one thing (account, source, form, calendar, person, weekday, hour or lead age), biggest first. At most 200 rows. */
export async function breakdown(s: Scope, f: BfFilters, by: Dim, limit = 200): Promise<{ rows: BfRow[]; live: boolean }> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length) return { rows: [], live: false };
  const db = sql(), { frag, live } = await facts(s, f, locs);
  const raw = await db`select ${db.unsafe(KEY[by])} k, ${SUMS(db)} from (${frag}) f where ${where(db, f)} group by 1 order by sum(leads) desc, 1 limit ${Math.min(500, limit)}`;
  const ids = raw.map((r) => String(r.k ?? ""));
  const tn = by === "setter" || by === "closer" || by === "owner" ? await teamNames(s.inst) : null;
  const cal = by === "calendar" ? await calendarNames(s, locs, ids) : null, fm = by === "form" ? await formNames(s, locs, ids) : null;
  const acct = new Map(locs.map((l) => [l.id, l.name]));
  const nameOf = (k: string): string => {
    if (by === "account") return acct.get(k) ?? "Client account";
    if (by === "source") return k || "No source";
    if (by === "form") return k ? fm?.get(k) ?? "Form (name not available)" : "No form";
    if (by === "calendar") return k ? cal?.get(k) ?? "Calendar (name not available)" : "No booking yet";
    if (tn) return k ? tn(k) : by === "owner" ? "No owner" : "No booking yet";
    if (by === "dow") return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(k)] ?? k;
    if (by === "hour") { const h = Number(k); return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? " am" : " pm"}`; }
    return AGE_BANDS.find((b) => b.key === k)?.label ?? k;
  };
  const rows = raw.map((r, i) => ({ id: ids[i], name: nameOf(ids[i]), tot: totOf(r) }));
  if (by === "dow" || by === "hour") rows.sort((a, b) => Number(a.id) - Number(b.id));
  if (by === "age") rows.sort((a, b) => AGE_BANDS.findIndex((x) => x.key === a.id) - AGE_BANDS.findIndex((x) => x.key === b.id));
  return { rows, live };
}

/** Weekday by hour cells for the step `stepIdx`: how many leads reached the step before it, and how many got through. Feeds the "mostly Tuesday mornings" line. */
export async function cells(s: Scope, f: BfFilters, stepIdx: number): Promise<Array<{ dow: number; hour: number; before: number; after: number }>> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length || stepIdx < 1 || stepIdx > 5) return [];
  const db = sql(), { frag } = await facts(s, f, locs);
  const col = (i: number) => ["leads", "reach_answered", "reach_booked", "reach_showed", "reach_deal", "reach_won"][i];
  const r = await db`select extract(dow from day)::int dow, hour::int hour, sum(${db.unsafe(col(stepIdx - 1))})::float8 b, sum(${db.unsafe(col(stepIdx))})::float8 a from (${frag}) f where ${where(db, f)} group by 1, 2`;
  return r.map((x) => ({ dow: x.dow as number, hour: x.hour as number, before: num(x.b), after: num(x.a) }));
}

// ---------- medians (live, over the latest leads of the filters) ----------
const SAMPLE = 20_000;
/** The median time between steps, from the latest 20,000 leads of these filters (a median cannot be added up from a rollup, so it is read live from a bounded sample). */
export async function medians(s: Scope, f: BfFilters): Promise<{ touch: number | null; book: number | null; show: number | null; win: number | null; sample: number }> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length) return { touch: null, book: null, show: null, win: null, sample: 0 };
  const db = sql();
  const w = (col: string, v: unknown) => (v ? db`and ${db.unsafe(col)} = ${v === "none" ? "" : (v as string)}` : db``);
  const r = await db`select count(*)::int n,
      percentile_cont(0.5) within group (order by extract(epoch from (touch_at - date_added))) filter (where touch_at >= date_added) touch,
      percentile_cont(0.5) within group (order by extract(epoch from (booked_at - date_added))) filter (where booked_at >= date_added) book,
      percentile_cont(0.5) within group (order by extract(epoch from (showed_at - date_added))) filter (where showed_at >= date_added) show,
      percentile_cont(0.5) within group (order by extract(epoch from (won_at - date_added))) filter (where won and won_at >= date_added) win
    from (select * from (${perLead(s, locs, { from: f.from, to: f.to })}) x where true ${w("calendar_id", f.calendar)} ${w("setter_id", f.setter)} ${w("closer_id", f.closer)} ${w("owner_id", f.owner)} ${w("src", f.source)} ${w("form_id", f.form)}
      ${f.hour !== null && f.hour !== undefined ? db`and hour = ${f.hour}` : db``} ${f.dow !== null && f.dow !== undefined ? db`and extract(dow from day)::int = ${f.dow}` : db``} order by date_added desc limit ${SAMPLE}) y`;
  const x = r[0] ?? {};
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { touch: n(x.touch), book: n(x.book), show: n(x.show), win: n(x.win), sample: num(x.n) };
}

// ---------- cohorts and forecast ----------
export async function cohorts(s: Scope, f: BfFilters): Promise<{ rows: CohortRow[]; live: boolean; historyStarts: string | null }> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length) return { rows: [], live: false, historyStarts: null };
  const db = sql(), { frag, live } = await facts(s, f, locs);
  const r = await db`select day::text d, ${SUMS(db)} from (${frag}) f where ${where(db, f)} group by day order by day`;
  const by = new Map<string, CohortRow>();
  for (const x of r) {
    const wk = weekStart(String(x.d)), t = totOf(x), c = by.get(wk) ?? { week: wk, leads: 0, mature7: 0, mature14: 0, mature30: 0, booked7: 0, booked14: 0, booked30: 0, showed7: 0, showed14: 0, showed30: 0, won7: 0, won14: 0, won30: 0 };
    for (const k of Object.keys(c) as Array<keyof CohortRow>) if (k !== "week") c[k] += t[k as keyof Tot] ?? 0;
    by.set(wk, c);
  }
  return { rows: [...by.values()].sort((a, b) => a.week.localeCompare(b.week)), live, historyStarts: await historyStarts(s, locs) };
}

export async function forecast(s: Scope, f: BfFilters): Promise<Forecast & { historyStarts: string | null }> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length) return { ...forecastOf({ leads28: 0, mature30: 0, booked30: 0, showed30: 0, won30: 0, wonValue: 0, wonN: 0, liveDays: 0 }), historyStarts: null };
  const now = Date.now(), today = new Date(now - (now % DAY));
  const wide = { ...f, from: new Date(today.getTime() - 120 * DAY), to: new Date(today.getTime() + DAY) };
  const recent = { ...f, from: new Date(today.getTime() - 27 * DAY), to: new Date(today.getTime() + DAY) };
  const [a, b, h] = await Promise.all([totals(s, wide), totals(s, recent), historyStarts(s, locs)]);
  const liveDays = h ? Math.max(0, Math.floor((now - Date.parse(h)) / DAY)) : 0;
  return { ...forecastOf({ leads28: b.tot.leads, mature30: a.tot.mature30, booked30: a.tot.booked30, showed30: a.tot.showed30, won30: a.tot.won30, wonValue: a.tot.wonValue, wonN: a.tot.won, liveDays }), historyStarts: h };
}

// ---------- the people behind a number (keyset pages) ----------
export type LeadRow = { contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; owner: string | null; source: string | null; createdAt: string | null; dnd: boolean; depth: number; won: boolean };
export type ListSpec = { step: StepKey; mode: "reached" | "dropped" };
/** The one WHERE of every list and count: the same dates, filters and step as the totals, so a number and its rows are the same set. */
function listWhere(db: Db, f: BfFilters, spec: ListSpec): Frag {
  const i = stepIndex(spec.step);
  const depth = spec.mode === "reached" ? db`x.depth >= ${i + 1}` : db`x.depth = ${Math.max(1, i)}`; // dropped at step i = reached step i - 1 and no further (depth is 1 based)
  const w = (col: string, v: unknown) => (v ? db`and ${db.unsafe(col)} = ${v === "none" ? "" : (v as string)}` : db``);
  return db`${depth} ${w("x.calendar_id", f.calendar)} ${w("x.setter_id", f.setter)} ${w("x.closer_id", f.closer)} ${w("x.owner_id", f.owner)} ${w("x.src", f.source)} ${w("x.form_id", f.form)}
    ${f.hour !== null && f.hour !== undefined ? db`and x.hour = ${f.hour}` : db``} ${f.dow !== null && f.dow !== undefined ? db`and extract(dow from x.day)::int = ${f.dow}` : db``}`;
}
export async function listLeads(s: Scope, f: BfFilters, spec: ListSpec, after: string | null, limit = 25): Promise<{ rows: LeadRow[]; next: string | null }> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length) return { rows: [], next: null };
  const db = sql(), lim = Math.min(100, Math.max(1, limit)), cur = after ? decodeCur(after, 3) : null;
  const rows = await db`select x.location_id, x.contact_id, x.date_added, x.depth, x.won, c.full_name, c.email, c.phone, c.assigned_to, c.source, c.dnd, l.name loc_name
    from (${perLead(s, locs, { from: f.from, to: f.to })}) x
    join cached_contacts c on c.installation_id = ${s.inst} and c.location_id = x.location_id and c.contact_id = x.contact_id
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id
    where ${listWhere(db, f, spec)} ${ageList(db, f.age)}
      ${cur ? db`and (x.date_added, x.location_id, x.contact_id) < (${String(cur[0])}::timestamptz, ${String(cur[1])}, ${String(cur[2])})` : db``}
    order by x.date_added desc, x.location_id desc, x.contact_id desc limit ${lim + 1}`;
  const page = rows.slice(0, lim), last = page[page.length - 1];
  return {
    rows: page.map((r) => ({ contactId: r.contact_id as string, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null, name: ((r.full_name as string | null)?.trim() || (r.email as string | null) || "Unnamed contact"),
      email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null, owner: (r.assigned_to as string | null) || null, source: (r.source as string | null) || null, createdAt: iso(r.date_added), dnd: r.dnd === true, depth: Number(r.depth), won: r.won === true })),
    next: rows.length > lim && last ? encodeCur([iso(last.date_added) as string, last.location_id as string, last.contact_id as string]) : null,
  };
}
function ageList(db: Db, age?: string | null): Frag {
  const band = AGE_BANDS.find((b) => b.key === age);
  if (!band) return db``;
  const d = db`((now() at time zone 'UTC')::date - x.day)`;
  return band.key === "d0" ? db`and ${d} < 1` : band.key === "d1_7" ? db`and ${d} between 1 and 7` : band.key === "d8_30" ? db`and ${d} between 8 and 30` : db`and ${d} > 30`;
}
export async function countLeads(s: Scope, f: BfFilters, spec: ListSpec, cap = 10_000): Promise<{ n: number; capped: boolean }> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length) return { n: 0, capped: false };
  const db = sql();
  const [r] = await db`select count(*)::int n from (select 1 from (${perLead(s, locs, { from: f.from, to: f.to })}) x where ${listWhere(db, f, spec)} ${ageList(db, f.age)} limit ${cap + 1}) y`;
  const n = (r?.n as number) ?? 0;
  return { n: Math.min(n, cap), capped: n > cap };
}

/** The forms of the accounts a caller may see, for the picker (names only). */
export async function formOptions(s: Scope, f: BfFilters): Promise<Array<{ id: string; name: string }>> {
  const locs = await accountsOf(s, f.location);
  if (!locs.length) return [];
  const r = await sql()`select distinct on (ext_id) ext_id, name from dq_forms where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[]) order by ext_id, seen_at desc limit 300`.catch(() => []);
  return r.map((x) => ({ id: x.ext_id as string, name: x.name as string }));
}

