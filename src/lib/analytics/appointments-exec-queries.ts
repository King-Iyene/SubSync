import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { appointmentList, cleanId, toRow, type Scope } from "./appointments3-queries.ts";
import { DEFAULT_DEAL_WINDOW_DAYS } from "./appointments3-intel.ts";
import {
  addTot, briefText, closeRate, DAY, decisionsOf, delta, funnelOf, headlineOf, LEAD_BANDS, lostToNoShows, noshowRate, paceOf, peopleOf, rescheduleRate, showRate, showToClose, slotsOf, topMovers,
  weekStartOf, ZERO, avgDeal, cancelRate, median, type Cell, type Decision, type PersonAgg, type Tot,
} from "./appointments-exec-intel.ts";
import type { Page, Appt3Row } from "./appointments3-types.ts";

// The reads behind /api/app/appointments/exec?part=... (Appointments, Leadership tab). Read only. Everything is a SQL aggregate over the daily rollup (or its identical live twin
// when a filter the rollup does not hold is set, or "booked on" is chosen), so a million appointments cost the same as a hundred. The accounts a caller may read (`s.allowed`)
// come from the signed session in the router, never from the request. A person or account name is always resolved here: no id is ever sent for display.

type Db = ReturnType<typeof sql>;
type Frag = ReturnType<Db>;
export type ExecFilters = {
  from: Date; to: Date; basis: "appt" | "booked"; location?: string | null; calendar?: string | null; user?: string | null; setter?: string | null; closer?: string | null;
  source?: string | null; status?: string | null; stage?: string | null; bookedFrom?: Date | null; bookedTo?: Date | null;
};
export const execCache = ttlCache<unknown>(30_000, 200);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function dealDays(inst: string): Promise<number> {
  try { const r = await sql()`select appointment_deal_window_days d from settings where installation_id = ${inst}`; const d = Number(r[0]?.d); return Number.isInteger(d) && d >= 7 && d <= 180 ? d : DEFAULT_DEAL_WINDOW_DAYS; } catch { return DEFAULT_DEAL_WINDOW_DAYS; }
}

type Loc = { id: string; name: string; tz: string };
async function accounts(s: Scope, one?: string | null): Promise<Loc[]> {
  const db = sql(), id = cleanId(one);
  const r = await db`select l.location_id id, l.name, coalesce(z.name, 'UTC') tz from locations l left join pg_timezone_names z on z.name = l.timezone
    where l.installation_id = ${s.inst} and not l.ignored ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``} ${id ? db`and l.location_id = ${id}` : db``}`;
  return r.map((x) => ({ id: x.id as string, name: (x.name as string) || "Client account", tz: x.tz as string }));
}
const locFrag = (locs: Loc[]) => sql()`select * from unnest(${locs.map((l) => l.id)}::text[], ${locs.map((l) => l.tz)}::text[]) as t(location_id, tz)`;

// ---------- the facts: rollup or live twin, one column set ----------

/** The live twin of the rollup (and what the rollup refresh stores). `axisCol` is the appointment time or the time it was booked. */
function liveFacts(s: Scope, f: ExecFilters, locs: Loc[], dd: number, window: { from: Date; to: Date }, axisCol: "start_at" | "created_remote_at"): Frag {
  const db = sql(), ax = axisCol === "start_at" ? db`a.start_at` : db`a.created_remote_at`;
  const from = ymd(window.from), to = ymd(window.to);
  return db`
    select a.location_id, (${ax} at time zone l.tz)::date as day, coalesce(a.calendar_id, '') calendar_id, coalesce(a.assigned_to, '') owner_id, coalesce(a.booked_by_user, '') booker_id, coalesce(nullif(c.source, ''), '') as source,
      count(*)::float8 booked,
      count(*) filter (where a.status = 'confirmed' or fa.confirmed_at is not null)::float8 confirmed,
      count(*) filter (where a.status = 'showed')::float8 showed, count(*) filter (where a.status = 'noshow')::float8 noshow, count(*) filter (where a.status = 'cancelled')::float8 cancelled,
      count(*) filter (where a.status not in ('showed', 'noshow', 'cancelled') and a.start_at < now() - interval '3 hours')::float8 unmarked,
      count(*) filter (where coalesce(fa.reschedule_count, 0) > 0)::float8 rescheduled,
      count(*) filter (where d.status = 'won')::float8 won, coalesce(sum(d.monetary_value) filter (where d.status = 'won'), 0)::float8 won_value, count(*) filter (where d.status = 'lost')::float8 lost,
      coalesce(sum(extract(epoch from (a.created_remote_at - t.lead_at)) / 60) filter (where t.lead_at is not null and a.created_remote_at >= t.lead_at and a.created_remote_at - t.lead_at < interval '30 days'), 0)::float8 ltb_sum_min,
      count(*) filter (where t.lead_at is not null and a.created_remote_at >= t.lead_at and a.created_remote_at - t.lead_at < interval '30 days')::float8 ltb_n,
      coalesce(sum(extract(epoch from (a.start_at - a.created_remote_at)) / 3600) filter (where a.created_remote_at is not null and a.start_at >= a.created_remote_at and a.status <> 'cancelled'), 0)::float8 b2m_sum_hours,
      count(*) filter (where a.created_remote_at is not null and a.start_at >= a.created_remote_at and a.status <> 'cancelled')::float8 b2m_n
    from cached_appointments a
    join (${locFrag(locs)}) l on l.location_id = a.location_id
    left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
    left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id and a.contact_id is not null
    left join lateral (
      select o.status, o.monetary_value, o.stage_name from cached_opportunities o
      where a.contact_id is not null and o.installation_id = a.installation_id and o.location_id = a.location_id and o.contact_id = a.contact_id
        and (o.status = 'open' or coalesce(o.last_status_change_at, o.synced_at) between a.start_at - interval '1 day' and a.start_at + make_interval(days => ${dd}::int))
      order by case o.status when 'won' then 0 when 'lost' then 1 else 2 end, coalesce(o.last_status_change_at, o.synced_at) desc limit 1) d on true
    left join lateral (
      select x.lead_at from lead_touches x where a.contact_id is not null and x.installation_id = a.installation_id and x.location_id = a.location_id and x.contact_id = a.contact_id
        and x.lead_at <= coalesce(a.created_remote_at, a.start_at) order by x.lead_at desc limit 1) t on true
    where a.installation_id = ${s.inst} and a.status <> 'invalid' and fa.deleted_at is null and ${ax} is not null
      and ${ax} >= ${new Date(window.from.getTime() - DAY)} and ${ax} < ${new Date(window.to.getTime() + DAY)}
      and (${ax} at time zone l.tz)::date >= ${from}::date and (${ax} at time zone l.tz)::date < ${to}::date
      ${f.calendar ? db`and a.calendar_id = ${f.calendar}` : db``}
      ${f.user ? db`and (a.assigned_to = ${f.user} or a.booked_by_user = ${f.user})` : db``}
      ${f.setter ? db`and a.booked_by_user = ${f.setter}` : db``} ${f.closer ? db`and a.assigned_to = ${f.closer}` : db``}
      ${f.source ? (f.source === "none" ? db`and nullif(c.source, '') is null` : db`and c.source = ${f.source.slice(0, 120)}`) : db``}
      ${f.status && /^[a-z_]{1,20}$/.test(f.status) ? db`and a.status = ${f.status}` : db``}
      ${f.stage ? db`and d.stage_name = ${f.stage.slice(0, 120)}` : db``}
      ${f.bookedFrom ? db`and a.created_remote_at >= ${f.bookedFrom} and a.created_remote_at < ${f.bookedTo ?? new Date(Date.now() + DAY)}` : db``}
    group by 1, 2, 3, 4, 5, 6`;
}

function rollupFacts(s: Scope, f: ExecFilters, locs: Loc[], window: { from: Date; to: Date }): Frag {
  const db = sql();
  return db`select location_id, day, calendar_id, owner_id, booker_id, source, booked, confirmed, showed, noshow, cancelled, unmarked, rescheduled, won, won_value, lost, ltb_sum_min, ltb_n, b2m_sum_hours, b2m_n
    from appointment_exec_daily where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[]) and day >= ${ymd(window.from)}::date and day < ${ymd(window.to)}::date
      ${f.calendar ? db`and calendar_id = ${f.calendar}` : db``} ${f.user ? db`and (owner_id = ${f.user} or booker_id = ${f.user})` : db``}
      ${f.setter ? db`and booker_id = ${f.setter}` : db``} ${f.closer ? db`and owner_id = ${f.closer}` : db``}
      ${f.source ? (f.source === "none" ? db`and source = ''` : db`and source = ${f.source.slice(0, 120)}`) : db``}`;
}

/** The rollup is used when every account in play is fresh and no filter the rollup does not hold is set. */
async function facts(s: Scope, f: ExecFilters, locs: Loc[], window: { from: Date; to: Date }): Promise<{ frag: Frag; live: boolean }> {
  const dd = await dealDays(s.inst);
  const needsLive = f.basis === "booked" || !!f.status || !!f.stage || !!f.bookedFrom;
  if (!needsLive && (await ensureFresh(s, locs))) return { frag: rollupFacts(s, f, locs, window), live: false };
  return { frag: liveFacts(s, f, locs, dd, window, f.basis === "booked" ? "created_remote_at" : "start_at"), live: true };
}

const SUMS = () => sql()`coalesce(sum(booked), 0)::float8 booked, coalesce(sum(confirmed), 0)::float8 confirmed, coalesce(sum(showed), 0)::float8 showed, coalesce(sum(noshow), 0)::float8 noshow,
  coalesce(sum(cancelled), 0)::float8 cancelled, coalesce(sum(unmarked), 0)::float8 unmarked, coalesce(sum(rescheduled), 0)::float8 rescheduled, coalesce(sum(won), 0)::float8 won,
  coalesce(sum(won_value), 0)::float8 won_value, coalesce(sum(lost), 0)::float8 lost, coalesce(sum(ltb_sum_min), 0)::float8 ltb_sum_min, coalesce(sum(ltb_n), 0)::float8 ltb_n,
  coalesce(sum(b2m_sum_hours), 0)::float8 b2m_sum_hours, coalesce(sum(b2m_n), 0)::float8 b2m_n`;
const totOf = (r: Record<string, unknown>): Tot => ({
  booked: num(r.booked), confirmed: num(r.confirmed), showed: num(r.showed), noshow: num(r.noshow), cancelled: num(r.cancelled), unmarked: num(r.unmarked), rescheduled: num(r.rescheduled),
  won: num(r.won), wonValue: num(r.won_value), lost: num(r.lost), ltbSumMin: num(r.ltb_sum_min), ltbN: num(r.ltb_n), b2mSumHours: num(r.b2m_sum_hours), b2mN: num(r.b2m_n),
});

// ---------- the rollup refresh (lazy, per account, idempotent) ----------
const FRESH_MS = 60 * 60 * 1000;
/** Recompute an account's days. Safe to run twice: the days in the window are replaced, never added to. Also exported for the scheduled sweep. */
export async function refreshExecRollup(inst: string, loc: Loc, sinceDays: number): Promise<void> {
  const db = sql(), dd = await dealDays(inst), s: Scope = { inst, allowed: [loc.id] };
  const win = { from: new Date(Date.now() - sinceDays * DAY), to: new Date(Date.now() + 120 * DAY) };
  const f: ExecFilters = { from: win.from, to: win.to, basis: "appt" };
  await db.begin(async (tx) => {
    await tx`delete from appointment_exec_daily where installation_id = ${inst} and location_id = ${loc.id} and day >= ${ymd(win.from)}::date`;
    await tx`insert into appointment_exec_daily (installation_id, location_id, day, calendar_id, owner_id, booker_id, source, booked, confirmed, showed, noshow, cancelled, unmarked, rescheduled, won, won_value, lost, ltb_sum_min, ltb_n, b2m_sum_hours, b2m_n)
      select ${inst}, location_id, day, calendar_id, owner_id, booker_id, source, booked, confirmed, showed, noshow, cancelled, unmarked, rescheduled, won, won_value, lost, ltb_sum_min, ltb_n, b2m_sum_hours, b2m_n
      from (${liveFacts(s, f, [loc], dd, win, "start_at")}) x`;
    await tx`insert into appointment_exec_state (installation_id, location_id, refreshed_at, first_day)
      values (${inst}, ${loc.id}, now(), (select min(day) from appointment_exec_daily where installation_id = ${inst} and location_id = ${loc.id}))
      on conflict (installation_id, location_id) do update set refreshed_at = now(), first_day = excluded.first_day`;
  });
}
const refreshing = new Map<string, Promise<void>>();
/** True when every account is fresh (refreshing up to 4 stale ones now). More stale accounts than that: the caller uses the live twin this time. */
async function ensureFresh(s: Scope, locs: Loc[]): Promise<boolean> {
  const db = sql();
  const st = await db`select location_id, refreshed_at from appointment_exec_state where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[])`.catch(() => null);
  if (!st) return false; // the rollup is not there yet: the live twin answers
  const seen = new Map(st.map((r) => [r.location_id as string, (r.refreshed_at as Date).getTime()]));
  const stale = locs.filter((l) => !seen.has(l.id) || Date.now() - (seen.get(l.id) as number) > FRESH_MS);
  if (stale.length === 0) return true;
  const run = (l: Loc) => {
    const k = `${s.inst}:${l.id}`, cur = refreshing.get(k) ?? refreshExecRollup(s.inst, l, seen.has(l.id) ? 45 : 400).finally(() => refreshing.delete(k));
    refreshing.set(k, cur); return cur;
  };
  if (stale.length > 4) { for (const l of stale.slice(0, 4)) void run(l).catch(() => undefined); return false; } // fill four more in the background; this answer is live, the next ones use the rollup
  try { await Promise.all(stale.map(run)); } catch { return false; }
  return true;
}
async function historyStarts(s: Scope, locs: Loc[]): Promise<string | null> {
  const r = await sql()`select min(first_day) d from appointment_exec_state where installation_id = ${s.inst} and location_id = any(${locs.map((l) => l.id)}::text[])`.catch(() => []);
  const d = r[0]?.d; return d ? (d instanceof Date ? ymd(d) : String(d).slice(0, 10)) : null;
}

// ---------- names ----------
async function teamNames(inst: string): Promise<(id: string | null) => string> {
  const rows = await sql()`select user_id, name from team_names where installation_id = ${inst}`;
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

// ---------- parts ----------
const win = (f: ExecFilters, shift: "prev" | "year" | "cur") => {
  const len = f.to.getTime() - f.from.getTime();
  if (shift === "prev") return { from: new Date(f.from.getTime() - len), to: new Date(f.from.getTime()) };
  if (shift === "year") return { from: new Date(f.from.getTime() - 364 * DAY), to: new Date(f.to.getTime() - 364 * DAY) };
  return { from: f.from, to: f.to };
};
async function sumOf(s: Scope, f: ExecFilters, locs: Loc[], w: { from: Date; to: Date }): Promise<{ t: Tot; live: boolean }> {
  const { frag, live } = await facts(s, f, locs, w);
  const [r] = await sql()`select ${SUMS()} from (${frag}) f`;
  return { t: totOf(r), live };
}

export type KpiOut = { key: string; label: string; value: number | null; display: "count" | "percent" | "money" | "minutes" | "hours"; prev: number | null; year: number | null; deltaPrev: ReturnType<typeof delta>; deltaYear: ReturnType<typeof delta>; spark: number[]; open: Record<string, string> | null; note: string | null; estimate: boolean; formula: string | null; good: "up" | "down" };

export async function summary(s: Scope, f: ExecFilters) {
  const db = sql(), locs = await accounts(s, f.location);
  if (!locs.length) return emptySummary();
  const [cur, prev, year, starts] = await Promise.all([sumOf(s, f, locs, win(f, "cur")), sumOf(s, f, locs, win(f, "prev")), sumOf(s, f, locs, win(f, "year")), historyStarts(s, locs)]);
  const { frag } = await facts(s, f, locs, win(f, "cur"));
  const trendRows = await db`select day, ${SUMS()} from (${frag}) f group by day order by day`;
  const days = trendRows.map((r) => ({ day: ymd(r.day as Date), t: totOf(r) }));
  const spark = (pick: (t: Tot) => number | null) => {
    // At most 14 points: sum days into equal buckets so the line stays small for any period.
    const n = Math.min(14, Math.max(1, days.length)), size = Math.ceil(days.length / n) || 1, out: number[] = [];
    for (let i = 0; i < days.length; i += size) { const t = days.slice(i, i + size).reduce((a, d) => addTot(a, d.t), ZERO); out.push(pick(t) ?? 0); }
    return out;
  };
  const c = cur.t, p = prev.t, y = year.t;
  const lost = lostToNoShows(c), funnel = funnelOf(c);
  const yearHas = y.booked >= 10 && (starts ? starts <= ymd(win(f, "year").from) : false);
  const mk = (key: string, label: string, display: KpiOut["display"], pick: (t: Tot) => number | null, kind: "count" | "rate", good: "up" | "down", open: Record<string, string> | null, extra: Partial<KpiOut> = {}): KpiOut => {
    const v = pick(c), pv = pick(p), yv = yearHas ? pick(y) : null;
    return { key, label, value: v, display, prev: pv, year: yv, deltaPrev: delta(v, p.booked >= 5 ? pv : null, kind), deltaYear: delta(v, yv, kind), spark: spark(pick), open, note: null, estimate: false, formula: null, good, ...extra };
  };
  const kpis: KpiOut[] = [
    mk("booked", "Appointments booked", "count", (t) => t.booked, "count", "up", { bucket: "booked" }),
    mk("showed", "Showed", "count", (t) => t.showed, "count", "up", { bucket: "showed" }),
    mk("show_rate", "Show rate", "percent", (t) => showRate(t).value, "rate", "up", { bucket: "completed" }, { note: showRate(c).enough ? null : "Not enough data yet" }),
    mk("noshow_rate", "No-show rate", "percent", (t) => noshowRate(t).value, "rate", "down", { bucket: "noshow" }, { note: noshowRate(c).enough ? null : "Not enough data yet" }),
    mk("cancel_rate", "Cancelled", "percent", (t) => cancelRate(t).value, "rate", "down", { bucket: "cancelled" }),
    mk("resched_rate", "Rescheduled", "percent", (t) => rescheduleRate(t).value, "rate", "down", { bucket: "rescheduled" }, { note: c.rescheduled === 0 ? `History starts ${starts ?? "today"}` : null }),
    mk("ltb", "Lead to booking", "minutes", (t) => median(t.ltbSumMin, t.ltbN) === null ? null : Math.round(t.ltbSumMin / t.ltbN), "count", "down", null, { note: c.ltbN >= 10 ? "Average time from a new lead to its booking" : "Not enough data yet" }),
    mk("b2m", "Booking to meeting", "hours", (t) => median(t.b2mSumHours, t.b2mN) === null ? null : Math.round((t.b2mSumHours / t.b2mN) * 10) / 10, "count", "down", null, { note: c.b2mN >= 10 ? "Average wait between booking and the meeting" : "Not enough data yet" }),
    mk("won", "Won from appointments", "count", (t) => t.won, "count", "up", { bucket: "won" }),
    mk("won_value", "Won deal value", "money", (t) => (t.won ? t.wonValue : null), "count", "up", { bucket: "won" }),
    { key: "lost_noshow", label: "Revenue lost to no-shows", value: lost.value, display: "money", prev: null, year: null, deltaPrev: delta(null, null, "count"), deltaYear: delta(null, null, "count"), spark: [], open: { bucket: "noshow" }, note: lost.minNote, estimate: true, formula: lost.formula, good: "down" },
  ];
  const diff = yearHas ? null : "No data for the same period last year.";
  return {
    headline: headlineOf(c, p.booked >= 5 ? p : null, funnel), kpis, funnel, avgDeal: avgDeal(c), closeRate: closeRate(c), showToClose: showToClose(c), yearNote: diff,
    historyStarts: starts, live: cur.live, period: { from: ymd(f.from), to: ymd(new Date(f.to.getTime() - DAY)) }, previous: { from: ymd(win(f, "prev").from), to: ymd(new Date(win(f, "prev").to.getTime() - DAY)) },
    totals: { cur: c, prev: p, year: y }, accountsCount: locs.length,
  };
}
const emptySummary = () => ({ headline: "No appointments in this period yet.", kpis: [] as KpiOut[], funnel: funnelOf(ZERO), avgDeal: null, closeRate: closeRate(ZERO), showToClose: showToClose(ZERO), yearNote: null, historyStarts: null, live: false, period: { from: "", to: "" }, previous: { from: "", to: "" }, totals: { cur: ZERO, prev: ZERO, year: ZERO }, accountsCount: 0 });

// ---------- pacing and targets ----------
export async function pace(s: Scope, f: ExecFilters) {
  const db = sql(), locs = await accounts(s, f.location);
  if (!locs.length) return { ...paceOf([], 0, Date.now(), null), targetScope: "", canSetTarget: false, targetUndo: false, narrowed: false };
  const now = Date.now(), from = new Date(weekStartOf(now) - 9 * 7 * DAY), monthStart = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
  const w = await db`select (date_trunc('week', (a.created_remote_at at time zone l.tz)))::date wk, count(*)::int n from cached_appointments a join (${locFrag(locs)}) l on l.location_id = a.location_id
    left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
    where a.installation_id = ${s.inst} and a.status <> 'invalid' and fa.deleted_at is null and a.created_remote_at >= ${from} and a.created_remote_at < ${new Date(now + DAY)}
      ${f.calendar ? db`and a.calendar_id = ${f.calendar}` : db``} ${f.user ? db`and (a.assigned_to = ${f.user} or a.booked_by_user = ${f.user})` : db``} group by 1 order by 1`;
  const weekly = w.map((r) => ({ weekStart: ymd(r.wk as Date), booked: num(r.n) }));
  const mtd = await db`select count(*)::int n from cached_appointments a join (${locFrag(locs)}) l on l.location_id = a.location_id
    left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
    where a.installation_id = ${s.inst} and a.status <> 'invalid' and fa.deleted_at is null and a.created_remote_at >= ${monthStart}
      ${f.calendar ? db`and a.calendar_id = ${f.calendar}` : db``} ${f.user ? db`and (a.assigned_to = ${f.user} or a.booked_by_user = ${f.user})` : db``}`;
  const scopeKey = f.location && locs.length === 1 ? locs[0].id : "";
  const t = await db`select monthly_target, previous_target from appointment_exec_targets where installation_id = ${s.inst} and location_id = ${scopeKey}`.catch(() => []);
  const target = t[0]?.monthly_target === null || t[0]?.monthly_target === undefined ? null : num(t[0].monthly_target);
  // A target only applies to the whole scope it was set for: a calendar or person filter narrows the numbers, so the target would not fit.
  const narrowed = !!f.calendar || !!f.user;
  const p = paceOf(weekly, num(mtd[0]?.n), now, narrowed ? null : target);
  return { ...p, targetScope: scopeKey, canSetTarget: !narrowed && (scopeKey !== "" ? true : s.allowed === null), targetUndo: !narrowed && t[0]?.previous_target !== undefined && t[0]?.previous_target !== null, narrowed };
}

/** Set, clear (null) or undo the monthly target. SubSync-only: nothing is written to the CRM. */
export async function setTarget(s: Scope, locationId: string | null, value: number | null | "undo", actor: string): Promise<{ target: number | null }> {
  const db = sql(), key = locationId ?? "";
  const cur = await db`select monthly_target, previous_target from appointment_exec_targets where installation_id = ${s.inst} and location_id = ${key}`;
  const was = cur[0]?.monthly_target === undefined || cur[0]?.monthly_target === null ? null : num(cur[0].monthly_target);
  const next = value === "undo" ? (cur[0]?.previous_target === null || cur[0]?.previous_target === undefined ? null : num(cur[0].previous_target)) : value;
  await db`insert into appointment_exec_targets (installation_id, location_id, monthly_target, previous_target, set_by, updated_at) values (${s.inst}, ${key}, ${next}, ${was}, ${actor}, now())
    on conflict (installation_id, location_id) do update set monthly_target = excluded.monthly_target, previous_target = excluded.previous_target, set_by = excluded.set_by, updated_at = now()`;
  await db`insert into audit_log (installation_id, actor, action, detail) values (${s.inst}, ${actor}, 'appointments.exec_target_changed', ${db.json({ scope: key === "" ? "all" : "account", from: was, to: next } as never)})`;
  return { target: next };
}

// ---------- people, calendars, sources, accounts ----------
export async function boards(s: Scope, f: ExecFilters) {
  const db = sql(), locs = await accounts(s, f.location);
  if (!locs.length) return { setters: [], closers: [], calendars: [], sources: [], accounts: [], movers: { up: [], down: [] }, fairness: true };
  const [{ frag }, prevF] = await Promise.all([facts(s, f, locs, win(f, "cur")), facts(s, f, locs, win(f, "prev"))]);
  const people = (col: "booker_id" | "owner_id", fr: Frag) => db`select ${db(col)} id, source, ${SUMS()} from (${fr}) f group by 1, 2 order by sum(booked) desc limit 4000`;
  const [bk, ow, bkP, owP, cal, src, acc, accP] = await Promise.all([
    people("booker_id", frag), people("owner_id", frag), people("booker_id", prevF.frag), people("owner_id", prevF.frag),
    db`select calendar_id id, ${SUMS()} from (${frag}) f group by 1 order by sum(booked) desc limit 60`,
    db`select source id, ${SUMS()} from (${frag}) f group by 1 order by sum(booked) desc limit 60`,
    db`select location_id id, ${SUMS()} from (${frag}) f group by 1 order by sum(booked) desc limit 200`,
    db`select location_id id, ${SUMS()} from (${prevF.frag}) f group by 1 limit 200`,
  ]);
  const name = await teamNames(s.inst), calNames = await calendarNames(s, locs, cal.map((r) => r.id as string));
  const agg = (rows: Array<Record<string, unknown>>): PersonAgg[] => rows.map((r) => ({ id: (r.id as string) || null, source: (r.source as string) || "", t: totOf(r) }));
  const setters = peopleOf(agg(bk), agg(bkP), name), closers = peopleOf(agg(ow), agg(owP), name);
  const accName = new Map(locs.map((l) => [l.id, l.name]));
  const prevAcc = new Map(accP.map((r) => [r.id as string, totOf(r)]));
  const named = (rows: Array<Record<string, unknown>>, label: (id: string) => string) => rows.map((r) => { const t = totOf(r), sr = showRate(t); return { id: (r.id as string) || "", name: label((r.id as string) || ""), booked: t.booked, showRate: sr, closeRate: closeRate(t), wonValue: t.wonValue, won: t.won, noshow: t.noshow, t }; });
  const accounts_ = named(acc, (id) => accName.get(id) ?? "Client account").map((a) => { const pt = prevAcc.get(a.id); const ps = pt ? showRate(pt) : null; return { ...a, movePoints: a.showRate.value !== null && ps?.value != null ? Math.round((a.showRate.value - ps.value) * 100) : null, prev: pt ?? ZERO }; });
  return {
    setters: setters.sort((a, b) => b.booked - a.booked).slice(0, 25), closers: closers.sort((a, b) => b.won - a.won || b.booked - a.booked).slice(0, 25),
    calendars: named(cal, (id) => (id ? calNames.get(id) ?? "Calendar (name not available)" : "No calendar recorded")), sources: named(src, (id) => id || "No source recorded"),
    accounts: accounts_, movers: { setters: topMovers(setters), closers: topMovers(closers) }, fairness: true,
  };
}

// ---------- heatmap, lead-time effect and capacity ----------
export async function slots(s: Scope, f: ExecFilters) {
  const db = sql(), locs = await accounts(s, f.location);
  if (!locs.length) return { cells: [] as Cell[], bands: [], best: null, worst: null, enough: false, capacity: { calendars: [], people: [], note: "" }, tzNote: "" };
  const w = win(f, "cur");
  const from = ymd(w.from), to = ymd(w.to);
  const axis = f.basis === "booked" ? db`a.created_remote_at` : db`a.start_at`;
  const common = db`from cached_appointments a join (${locFrag(locs)}) l on l.location_id = a.location_id
    left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
    left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id and a.contact_id is not null
    where a.installation_id = ${s.inst} and a.status <> 'invalid' and a.status <> 'cancelled' and fa.deleted_at is null and a.start_at < now() - interval '3 hours'
      and ${axis} >= ${new Date(w.from.getTime() - DAY)} and ${axis} < ${new Date(w.to.getTime() + DAY)} and (${axis} at time zone l.tz)::date >= ${from}::date and (${axis} at time zone l.tz)::date < ${to}::date
      ${f.calendar ? db`and a.calendar_id = ${f.calendar}` : db``} ${f.user ? db`and (a.assigned_to = ${f.user} or a.booked_by_user = ${f.user})` : db``}
      ${f.setter ? db`and a.booked_by_user = ${f.setter}` : db``} ${f.closer ? db`and a.assigned_to = ${f.closer}` : db``}
      ${f.source ? (f.source === "none" ? db`and nullif(c.source, '') is null` : db`and c.source = ${f.source.slice(0, 120)}`) : db``}
      ${f.status && /^[a-z_]{1,20}$/.test(f.status) ? db`and a.status = ${f.status}` : db``}
      ${f.bookedFrom ? db`and a.created_remote_at >= ${f.bookedFrom} and a.created_remote_at < ${f.bookedTo ?? new Date(Date.now() + DAY)}` : db``}
      `;
  const counts = db`count(*)::int booked, count(*) filter (where a.status = 'showed')::int showed, count(*) filter (where a.status = 'noshow')::int noshow, count(*) filter (where a.status not in ('showed', 'noshow'))::int unmarked`;
  const [cellRows, bandRows] = await Promise.all([
    db`select extract(dow from a.start_at at time zone l.tz)::int dow, extract(hour from a.start_at at time zone l.tz)::int as hour, ${counts} ${common} group by 1, 2`,
    db`select case when a.created_remote_at is null or a.start_at < a.created_remote_at then null when a.start_at - a.created_remote_at < interval '24 hours' then 'same_day' when a.start_at - a.created_remote_at < interval '72 hours' then 'd1_2'
        when a.start_at - a.created_remote_at < interval '192 hours' then 'd3_7' else 'd8_plus' end band, ${counts} ${common} group by 1`,
  ]);
  const cells: Cell[] = cellRows.map((r) => ({ dow: num(r.dow), hour: num(r.hour), booked: num(r.booked), showed: num(r.showed), noshow: num(r.noshow), unmarked: num(r.unmarked) }));
  const st = slotsOf(cells);
  const bands = LEAD_BANDS.map((b) => { const r = bandRows.find((x) => x.band === b.key); const showed = num(r?.showed), noshow = num(r?.noshow), unmarked = num(r?.unmarked), n = showed + noshow + unmarked; return { key: b.key, label: b.label, n, rate: n >= 10 ? showed / n : null }; });
  const capacity = await capacityOf(s, f, locs);
  return { cells, bands, ...st, capacity, tzNote: "Times are in each client account's own time zone." };
}

async function capacityOf(s: Scope, f: ExecFilters, locs: Loc[]) {
  const db = sql(), now = Date.now(), wk0 = weekStartOf(now), from = new Date(wk0 - 26 * 7 * DAY);
  const q = (col: "calendar_id" | "assigned_to") => db`select a.${db(col)} id, (date_trunc('week', (a.start_at at time zone l.tz)))::date wk, count(*)::int n
    from cached_appointments a join (${locFrag(locs)}) l on l.location_id = a.location_id left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
    where a.installation_id = ${s.inst} and a.status not in ('invalid', 'cancelled') and fa.deleted_at is null and a.${db(col)} is not null and a.start_at >= ${from} and a.start_at < ${new Date(wk0 + 14 * DAY)}
      ${f.calendar ? db`and a.calendar_id = ${f.calendar}` : db``} ${f.user ? db`and (a.assigned_to = ${f.user} or a.booked_by_user = ${f.user})` : db``} group by 1, 2`;
  const [cal, ppl] = await Promise.all([q("calendar_id"), q("assigned_to")]);
  const roll = (rows: Array<Record<string, unknown>>) => {
    const by = new Map<string, Map<string, number>>();
    for (const r of rows) { const id = r.id as string, m = by.get(id) ?? new Map<string, number>(); m.set(ymd(r.wk as Date), num(r.n)); by.set(id, m); }
    const thisWk = ymd(new Date(wk0)), nextWk = ymd(new Date(wk0 + 7 * DAY));
    return [...by.entries()].map(([id, m]) => {
      const past = [...m.entries()].filter(([w]) => w < thisWk).map(([, n]) => n), peak = Math.max(0, ...past), last4 = [...m.entries()].filter(([w]) => w < thisWk).sort().slice(-4).map(([, n]) => n);
      const avg4 = last4.length ? last4.reduce((a, b) => a + b, 0) / last4.length : 0;
      const thisWeek = m.get(thisWk) ?? 0, ahead = m.get(nextWk) ?? 0, total = past.reduce((a, b) => a + b, 0);
      return { id, peak, avg4: Math.round(avg4 * 10) / 10, thisWeek, nextWeek: ahead, total, utilisation: peak >= 5 ? Math.round((avg4 / peak) * 100) : null, idle: peak >= 5 && thisWeek === 0 && ahead === 0, over: peak >= 5 && Math.max(thisWeek, ahead) > peak };
    }).filter((r) => r.total > 0).sort((a, b) => b.total - a.total).slice(0, 25);
  };
  const cals = roll(cal), people = roll(ppl);
  const calNames = await calendarNames(s, locs, cals.map((c) => c.id)), name = await teamNames(s.inst);
  return {
    calendars: cals.map((c) => ({ ...c, name: calNames.get(c.id) ?? "Calendar (name not available)" })), people: people.map((p) => ({ ...p, name: name(p.id) })),
    note: "Compared with each calendar's or person's own busiest week. Open slots are not stored, so this is booked against your own peak, not against availability.",
  };
}

// ---------- decisions and brief ----------
export async function decisions(s: Scope, f: ExecFilters) {
  const [sm, bd, sl, pc] = await Promise.all([summary(s, f), boards(s, f), slots(s, f), pace(s, f)]);
  const cals = sl.capacity.calendars.map((c) => ({ id: c.id, name: c.name, weeklyNow: c.thisWeek, peak: c.peak }));
  const list: Decision[] = decisionsOf({
    unmarked: sm.totals.cur.unmarked, showRate: showRate(sm.totals.cur), people: bd.setters, slots: { best: sl.best ?? null, worst: sl.worst ?? null, enough: sl.enough },
    sources: bd.sources.map((x) => ({ source: x.name === "No source recorded" ? "" : x.name, t: x.t })), accounts: bd.accounts.map((a) => ({ id: a.id, name: a.name, t: a.t, prev: a.prev })), pace: pc, leak: sm.funnel.leak, calendars: cals,
  });
  return { decisions: list, brief: briefText({ title: "Appointments: weekly leadership brief", period: `${sm.period.from} to ${sm.period.to}`, cur: sm.totals.cur, prev: sm.totals.prev.booked >= 5 ? sm.totals.prev : null, funnel: sm.funnel, pace: pc, decisions: list, lost: lostToNoShows(sm.totals.cur) }) };
}

// ---------- the rows behind any number ----------
export type RowsParams = { bucket?: string | null; dow?: number | null; hour?: number | null; band?: string | null; month?: boolean; setter?: string | null; closer?: string | null; sort?: string | null; after?: string | null; page: number; size: number };
/** Exactly the appointments a number counted: the same filters, the same local-day window, the same definitions. */
export async function rows(s: Scope, f: ExecFilters, p: RowsParams, link: ((loc: string, contact: string) => string) | null): Promise<Page<Appt3Row>> {
  const db = sql(), locs = await accounts(s, f.location);
  if (!locs.length) return { rows: [], total: 0, page: 0, size: p.size, pages: 1, truncated: false };
  let w = win(f, "cur");
  if (p.month) { const d = new Date(); w = { from: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), to: new Date(Date.now() + DAY) }; }
  const booked = f.basis === "booked" || !!p.month, ax = booked ? db`a.created_remote_at` : db`a.start_at`;
  const bk = p.bucket ?? "booked";
  const conds: Record<string, Frag> = {
    booked: db``, completed: db`and (a.status in ('showed', 'noshow', 'cancelled') or a.start_at < now() - interval '3 hours')`, showed: db`and a.status = 'showed'`, noshow: db`and a.status = 'noshow'`, cancelled: db`and a.status = 'cancelled'`,
    unmarked: db`and a.status not in ('showed', 'noshow', 'cancelled') and a.start_at < now() - interval '3 hours'`, won: db`and d.status = 'won'`, lost: db`and d.status = 'lost'`,
    confirmed: db`and (a.status = 'confirmed' or fa.confirmed_at is not null)`, rescheduled: db`and coalesce(fa.reschedule_count, 0) > 0`,
  };
  const band = LEAD_BANDS.find((b) => b.key === p.band);
  const extra = db`
    and ${ax} is not null and (${ax} at time zone l.tz)::date >= ${ymd(w.from)}::date and (${ax} at time zone l.tz)::date < ${ymd(w.to)}::date
    ${conds[bk] ?? db``}
    ${p.dow !== null && p.dow !== undefined && p.dow >= 0 && p.dow <= 6 ? db`and extract(dow from a.start_at at time zone l.tz)::int = ${p.dow}` : db``}
    ${p.hour !== null && p.hour !== undefined && p.hour >= 0 && p.hour <= 23 ? db`and extract(hour from a.start_at at time zone l.tz)::int = ${p.hour}` : db``}
    ${band ? db`and a.created_remote_at is not null and a.start_at >= a.created_remote_at and extract(epoch from (a.start_at - a.created_remote_at)) / 3600 >= ${band.key === "same_day" ? 0 : band.key === "d1_2" ? 24 : band.key === "d3_7" ? 72 : 192} and extract(epoch from (a.start_at - a.created_remote_at)) / 3600 < ${band.maxHours === Infinity ? 1e9 : band.maxHours}` : db``}
    ${f.stage ? db`and d.stage_name = ${f.stage.slice(0, 120)}` : db``}
    ${f.bookedFrom ? db`and a.created_remote_at >= ${f.bookedFrom} and a.created_remote_at < ${f.bookedTo ?? new Date(Date.now() + DAY)}` : db``}`;
  // The base query narrows by start time; a wide window lets the day rule above decide. Deleted and invalid are excluded there as in every number.
  const wide = { from: new Date(w.from.getTime() - 400 * DAY), to: new Date(w.to.getTime() + 400 * DAY) };
  const flt = { from: booked || f.bookedFrom ? wide.from : new Date(w.from.getTime() - DAY), to: booked || f.bookedFrom ? wide.to : new Date(w.to.getTime() + DAY), location: f.location ?? null, calendar: f.calendar ?? null, user: f.user ?? null, source: f.source ?? null, status: f.status ?? null, setter: p.setter ?? f.setter ?? undefined, closer: p.closer ?? f.closer ?? undefined };
  const page = await appointmentList(s, { f: flt as never, page: p.page, size: p.size, sort: p.sort ?? "newest", after: p.after ?? null, extra: extra as never }, link);
  return { ...page, rows: page.rows.filter((r) => r.status !== "invalid") };
}

/** CSV of the headline numbers (what the screen shows), for a spreadsheet. */
export async function exportCsv(s: Scope, f: ExecFilters): Promise<string> {
  const sm = await summary(s, f), q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Measure", "This period", "Previous period", "Same period last year"].map(q).join(",")];
  for (const k of sm.kpis) { const fmt = (v: number | null) => (v === null ? "" : k.display === "percent" ? `${Math.round(v * 1000) / 10}%` : String(v)); lines.push([k.label, fmt(k.value), fmt(k.prev), fmt(k.year)].map(q).join(",")); }
  lines.push("", q(`Period: ${sm.period.from} to ${sm.period.to}`));
  return lines.join("\n");
}

export { toRow };
