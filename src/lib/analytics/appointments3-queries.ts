import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import {
  buildFlowTree, clampSize, DAY, DEFAULT_DEAL_WINDOW_DAYS, fairness, headlineOf, leadTimeBand, MIN_SHOW, parseApptWindow, pickButton, rate, reportedShowRate, revenueAtRisk,
  SPEED_LABELS, trueShowRate, type FlowAgg,
} from "./appointments3-intel.ts";
import type {
  Appt3Bucket, Appt3BookingShare, Appt3Calendars, Appt3Conflict, Appt3Detail, Appt3FlowTree, Appt3Health, Appt3NeedsOutcome, Appt3Overview, Appt3PersonShare,
  Appt3Receipt, Appt3Recovery, Appt3Reminders, Appt3Row, Appt3Sources, Page, Rate,
} from "./appointments3-types.ts";

// The reads behind /api/app/appointments?part=... Read only; every figure is a SQL aggregate and every list is server-paged, so a million appointments cost the
// same as a hundred. The accounts a caller may see (`allowed`) come from the signed session in the router, never from the request; a `location` filter can only
// NARROW that set. One definition of every derived column lives in `base()` below, so a count and the list behind it cannot disagree. Deleted ones
// (appointment_facts.deleted_at) are in no number. Our own writes (appointment_history.actor_kind = 'subsync') are never counted as activity here.

type Db = ReturnType<typeof sql>;
type Frag = ReturnType<Db>;
export type Scope = { inst: string; allowed: string[] | null };
export type Filters = { from: Date; to: Date; location?: string | null; calendar?: string | null; user?: string | null; source?: string | null; q?: string | null; bucket?: Appt3Bucket | null; setter?: string | null; closer?: string | null };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const cleanId = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);

async function dealDays(inst: string): Promise<number> {
  try {
    const r = await sql()`select appointment_deal_window_days d from settings where installation_id = ${inst}`;
    const d = Number(r[0]?.d);
    return Number.isInteger(d) && d >= 7 && d <= 180 ? d : DEFAULT_DEAL_WINDOW_DAYS;
  } catch { return DEFAULT_DEAL_WINDOW_DAYS; }
}

/** The accounts in play: the caller's set, narrowed by an optional single account. Returns the SQL for `locs`. */
function locs(s: Scope, location?: string | null): Frag {
  const db = sql();
  const one = cleanId(location);
  return db`select l.location_id, l.name, coalesce(z.name, 'UTC') tz from locations l left join pg_timezone_names z on z.name = l.timezone
    where l.installation_id = ${s.inst} and not l.ignored ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``} ${one ? db`and l.location_id = ${one}` : db``}`;
}

/** The derived appointment set (alias `ap` when used as a CTE body). `grace` = hours after the start before an appointment "needs an outcome". */
function base(s: Scope, f: Filters, dd: number, extra?: Frag): Frag {
  const db = sql();
  const like = f.q ? `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m).slice(0, 60)}%` : null;
  return db`
    select a.location_id, a.appointment_id, a.calendar_id, a.calendar_name, a.contact_id, a.status, a.start_at, a.end_at, a.assigned_to owner, a.booked_by_user booker,
      a.created_remote_at created_at, l.name account_name, l.tz,
      coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') contact_name, nullif(c.source, '') source, coalesce(c.dnd, false) dnd,
      d.opportunity_id deal_id, d.status deal_status, d.monetary_value deal_value,
      t.lead_at, t.touch_at,
      coalesce(fa.reminders_sent, 0) reminders, fa.confirmed_at, coalesce(fa.reschedule_count, 0) resched, fa.snoozed_until,
      (a.status not in ('showed', 'noshow', 'cancelled', 'invalid') and a.start_at < now() - interval '3 hours') unmarked,
      (a.status not in ('cancelled', 'invalid') and a.start_at > now()) upcoming,
      exists (select 1 from cached_appointments b where b.installation_id = a.installation_id and b.location_id = a.location_id and b.contact_id = a.contact_id
        and a.contact_id is not null and b.start_at > a.start_at and b.appointment_id <> a.appointment_id and b.status not in ('cancelled', 'invalid')) rebooked
    from cached_appointments a
    join (${locs(s, f.location)}) l on l.location_id = a.location_id
    left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
    left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id and a.contact_id is not null
    left join lateral (
      select o.opportunity_id, o.status, o.monetary_value from cached_opportunities o
      where a.contact_id is not null and o.installation_id = a.installation_id and o.location_id = a.location_id and o.contact_id = a.contact_id
        and (o.status = 'open' or coalesce(o.last_status_change_at, o.synced_at) between a.start_at - interval '1 day' and a.start_at + make_interval(days => ${dd}::int))
      order by case o.status when 'won' then 0 when 'lost' then 1 else 2 end, coalesce(o.last_status_change_at, o.synced_at) desc limit 1) d on true
    left join lateral (
      select x.lead_at, x.touch_at from lead_touches x
      where a.contact_id is not null and x.installation_id = a.installation_id and x.location_id = a.location_id and x.contact_id = a.contact_id and x.lead_at <= coalesce(a.created_remote_at, a.start_at)
      order by x.lead_at desc limit 1) t on true
    where a.installation_id = ${s.inst} and a.start_at >= ${f.from} and a.start_at < ${f.to} and fa.deleted_at is null
      ${f.calendar && cleanId(f.calendar) ? db`and a.calendar_id = ${f.calendar}` : db``}
      ${f.user && cleanId(f.user) ? db`and (a.assigned_to = ${f.user} or a.booked_by_user = ${f.user})` : db``}
      ${f.setter !== undefined && f.setter !== null ? (f.setter === "none" ? db`and a.booked_by_user is null` : db`and a.booked_by_user = ${f.setter}`) : db``}
      ${f.closer !== undefined && f.closer !== null ? (f.closer === "none" ? db`and a.assigned_to is null` : db`and a.assigned_to = ${f.closer}`) : db``}
      ${f.source ? (f.source === "none" ? db`and nullif(c.source, '') is null` : db`and c.source = ${f.source.slice(0, 120)}`) : db``}
      ${like ? db`and (c.full_name ilike ${like} or c.email ilike ${like} or a.calendar_name ilike ${like})` : db``}
      ${extra ?? db``}`;
}

/** Filter on one of our groups of statuses, applied on the derived set. */
function bucketCond(b: Appt3Bucket | null | undefined): Frag {
  const db = sql();
  switch (b) {
    case "unmarked": return db`and unmarked`;
    case "showed": case "completed": return db`and status = 'showed'`;
    case "noshow": return db`and status = 'noshow'`;
    case "cancelled": return db`and status = 'cancelled'`;
    case "invalid": return db`and status = 'invalid'`;
    case "upcoming": return db`and upcoming`;
    case "booked": return db`and status <> 'invalid'`;
    case "won": return db`and deal_status = 'won' and status <> 'invalid'`;
    case "lost": return db`and deal_status = 'lost' and status <> 'invalid'`;
    case "open": return db`and deal_status = 'open' and status <> 'invalid'`;
    case "no_deal": return db`and deal_id is null and status <> 'invalid'`;
    case "confirmed": return db`and (status in ('confirmed', 'showed', 'noshow') or confirmed_at is not null)`;
    case "recovered": return db`and status = 'noshow' and rebooked`;
    case "burned": return db`and (status in ('noshow', 'cancelled') or (unmarked and start_at < now() - interval '3 days')) and not rebooked and deal_status is distinct from 'won'`;
    default: return db``;
  }
}

async function names(inst: string): Promise<(id: string | null | undefined) => string> {
  const rows = await sql()`select user_id, name from team_names where installation_id = ${inst}`;
  const m = new Map(rows.map((r) => [r.user_id as string, r.name as string]));
  return (id) => (!id || id === "unassigned" ? "Not assigned" : m.get(id) ?? "Team member (name not available)");
}

export function toRow(r: Record<string, unknown>, label: (id: string | null | undefined) => string, link: ((loc: string, contact: string) => string) | null, extraWhy: string | null = null): Appt3Row {
  const start = (r.start_at as Date).getTime(), status = String(r.status ?? "new"), now = Date.now();
  const unmarked = r.unmarked === true, upcoming = r.upcoming === true;
  const bucket: Appt3Bucket = status === "invalid" ? "invalid" : status === "cancelled" ? "cancelled" : status === "showed" ? "showed" : status === "noshow" ? "noshow" : unmarked ? "unmarked" : upcoming ? "upcoming" : "booked";
  const ago = Math.floor((now - start) / DAY);
  const created = r.created_at instanceof Date ? r.created_at.getTime() : null, leadAt = r.lead_at instanceof Date ? r.lead_at.getTime() : null, touchAt = r.touch_at instanceof Date ? r.touch_at.getTime() : null;
  return {
    appointmentId: String(r.appointment_id), locationId: String(r.location_id), accountName: (r.account_name as string | null) ?? null,
    contactId: (r.contact_id as string | null) ?? null, contactName: (r.contact_name as string | null) ?? (r.contact_id ? "Contact not in the copy yet" : "No contact on this booking"),
    url: r.contact_id && link ? link(String(r.location_id), String(r.contact_id)) : null,
    calendarId: (r.calendar_id as string | null) ?? null, calendarName: (r.calendar_name as string | null) ?? null,
    startAt: new Date(start).toISOString(), endAt: iso(r.end_at), status, bucket,
    ownerId: (r.owner as string | null) ?? null, ownerName: r.owner ? label(r.owner as string) : null, bookerId: (r.booker as string | null) ?? null, bookerName: r.booker ? label(r.booker as string) : null,
    source: (r.source as string | null) ?? null,
    dealStatus: r.deal_status === "won" || r.deal_status === "lost" || r.deal_status === "open" ? r.deal_status : null, dealValue: r.deal_value === null || r.deal_value === undefined ? null : Number(r.deal_value),
    leadToBookedMinutes: created !== null && leadAt !== null && created >= leadAt ? Math.round((created - leadAt) / 60_000) : null,
    firstReplyMinutes: touchAt !== null && leadAt !== null && touchAt >= leadAt ? Math.round((touchAt - leadAt) / 60_000) : null,
    rescheduleCount: num(r.resched), reminders: num(r.reminders), confirmed: status === "confirmed" || r.confirmed_at instanceof Date, hasConflict: r.has_conflict === true,
    why: extraWhy ?? (unmarked ? `Time passed ${ago < 1 ? "today" : ago === 1 ? "1 day ago" : `${ago} days ago`}, no outcome` : null), dnd: r.dnd === true,
  };
}

async function page<T>(rowsQ: Promise<Array<Record<string, unknown>>>, countQ: Promise<Array<Record<string, unknown>>>, p: number, size: number, map: (r: Record<string, unknown>) => T): Promise<Page<T>> {
  const [rows, c] = await Promise.all([rowsQ, countQ]);
  const total = num(c[0]?.n);
  return { rows: rows.map(map), total, page: p, size, pages: Math.max(1, Math.ceil(total / size)), truncated: false };
}
const offsetOf = (p: number, size: number) => Math.min(100_000, Math.max(0, Math.floor(p)) * size);
const sortOf = (sort: string | null | undefined) => {
  const db = sql();
  return sort === "value" ? db`deal_value desc nulls last, start_at desc` : sort === "name" ? db`contact_name asc, start_at desc` : sort === "oldest" ? db`start_at asc` : db`start_at desc`;
};

export type ListOpts = { f: Filters; page: number; size: number; sort?: string | null; extra?: Frag };
export async function appointmentList(s: Scope, o: ListOpts, link: ((loc: string, contact: string) => string) | null, why?: (r: Record<string, unknown>) => string | null): Promise<Page<Appt3Row>> {
  const db = sql(), size = clampSize(o.size), dd = await dealDays(s.inst), label = await names(s.inst);
  const b = base(s, o.f, dd, o.extra);
  return page(
    db`with ap as (${b}) select * from ap where true ${bucketCond(o.f.bucket)} order by ${sortOf(o.sort)} limit ${size} offset ${offsetOf(o.page, size)}`,
    db`with ap as (${b}) select count(*)::int n from ap where true ${bucketCond(o.f.bucket)}`,
    Math.max(0, Math.floor(o.page)), size, (r) => toRow(r, label, link, why ? why(r) : null),
  );
}

// ---------- overview ----------

export async function overview(s: Scope, f: Filters, windowDays: number): Promise<Appt3Overview> {
  const db = sql(), dd = await dealDays(s.inst);
  const b = base(s, f, dd);
  const [[t], trend, [risk], [rec], [acc]] = await Promise.all([
    db`with ap as (${b}) select
        count(*) filter (where status <> 'invalid')::int booked, count(*) filter (where unmarked)::int unmarked,
        count(*) filter (where status = 'showed')::int showed, count(*) filter (where status = 'noshow')::int noshow,
        count(*) filter (where status in ('confirmed', 'showed', 'noshow') or confirmed_at is not null)::int confirmed,
        count(*) filter (where deal_status = 'won' and status <> 'invalid')::int won, coalesce(sum(deal_value) filter (where deal_status = 'won' and status <> 'invalid'), 0)::float8 won_value,
        count(*) filter (where deal_id is null and status <> 'invalid')::int no_deal, count(*) filter (where upcoming)::int upcoming,
        count(*) filter (where unmarked and deal_status = 'open' and coalesce(deal_value, 0) > 0)::int unmarked_deals,
        coalesce(sum(deal_value) filter (where unmarked and deal_status = 'open' and deal_value > 0), 0)::float8 unmarked_value
      from ap`,
    db`with ap as (${b}) select (start_at at time zone tz)::date as day, count(*) filter (where status <> 'invalid')::int booked, count(*) filter (where status = 'showed')::int showed,
        count(*) filter (where status = 'noshow')::int noshow, count(*) filter (where unmarked)::int unmarked from ap group by 1 order by 1`,
    // No-shows of the last 7 days not rebooked, and the open deal dollars on them (independent of the chosen period).
    db`with ap as (${base(s, { ...f, from: new Date(Date.now() - 7 * DAY), to: new Date() }, dd, db`and a.status = 'noshow'`)})
      select count(*) filter (where not rebooked and (snoozed_until is null or snoozed_until < now()))::int n,
        count(*) filter (where not rebooked and deal_status = 'open' and deal_value > 0)::int deals,
        coalesce(sum(deal_value) filter (where not rebooked and deal_status = 'open' and deal_value > 0), 0)::float8 value from ap`,
    db`with ap as (${base(s, { ...f, from: new Date(Date.now() - 30 * DAY), to: new Date(Date.now() - DAY) }, dd, db`and a.status = 'noshow'`)}) select count(*) filter (where rebooked)::int n from ap`,
    db`select count(*)::int n from (${locs(s, f.location)}) x`,
  ]);
  const showed = num(t.showed), noshow = num(t.noshow), unmarked = num(t.unmarked), booked = num(t.booked);
  const trueR = trueShowRate(showed, noshow, unmarked), repR = reportedShowRate(showed, noshow);
  const nsToRecover = num(risk.n);
  const o: Appt3Overview = {
    headline: "", button: pickButton({ unmarked, noshowToRecover: nsToRecover, noDeal: num(t.no_deal) }), booked, unmarked, trueShowRate: trueR, reportedShowRate: repR,
    noshowToRecover: nsToRecover, recoveredLast30: num(rec.n), noDealLinked: num(t.no_deal), upcoming: num(t.upcoming),
    revenueAtRisk: revenueAtRisk({ value: num(risk.value), n: num(risk.deals) }, { value: num(t.unmarked_value), n: num(t.unmarked_deals) }),
    revenueWon: { value: num(t.won_value), n: num(t.won) },
    journey: [
      { key: "booked", label: "Booked", count: booked, bucket: "booked" }, { key: "confirmed", label: "Confirmed", count: num(t.confirmed), bucket: "confirmed" },
      { key: "showed", label: "Showed", count: showed, bucket: "showed" }, { key: "won", label: "Won", count: num(t.won), bucket: "won" },
    ],
    cards: [
      { key: "outcome", title: "Which appointments need an outcome?", value: unmarked, sub: trueR.enough ? `True show rate ${Math.round((trueR.value ?? 0) * 100)}%` : null, part: "needs-outcome", bucket: "unmarked" },
      { key: "recover", title: "Which no-shows can still be saved?", value: nsToRecover, sub: `${num(rec.n)} rebooked in 30 days`, part: "noshow-recovery", bucket: "noshow" },
      { key: "nodeal", title: "Which bookings have no deal?", value: num(t.no_deal), sub: `Deal counted within ${dd} days`, part: "list", bucket: "no_deal" },
    ],
    trend: trend.map((r) => ({ day: String(r.day instanceof Date ? r.day.toISOString().slice(0, 10) : r.day), booked: num(r.booked), showed: num(r.showed), noshow: num(r.noshow), unmarked: num(r.unmarked) })),
    windowDays, dealWindowDays: dd, accounts: num(acc.n),
  };
  o.headline = headlineOf({ unmarked, trueRate: trueR, reportedRate: repR, noshowToRecover: nsToRecover, booked });
  return o;
}

// ---------- needs outcome and recovery ----------

export async function needsOutcome(s: Scope, o: Omit<ListOpts, "extra">, link: ((a: string, b: string) => string) | null): Promise<Appt3NeedsOutcome> {
  const db = sql();
  const f = { ...o.f, bucket: "unmarked" as const };
  const p = await appointmentList(s, { ...o, f, sort: o.sort ?? "value" }, link);
  // A suggestion from a later deal move: a deal won or lost after the time suggests the person came. Never applied automatically.
  const suggestions: Appt3NeedsOutcome["suggestions"] = {};
  const ids = p.rows.filter((r) => r.dealStatus === "won").map((r) => r.appointmentId);
  for (const r of p.rows) if (ids.includes(r.appointmentId)) suggestions[r.appointmentId] = { outcome: "showed", reason: "The deal was won after this time, so the person most likely came." };
  const [old] = await db`with ap as (${base(s, { ...f, from: new Date(Date.now() - 366 * DAY), to: new Date() }, await dealDays(s.inst))}) select min(start_at) m from ap where unmarked`;
  return { ...p, suggestions, oldestDays: old?.m instanceof Date ? Math.floor((Date.now() - old.m.getTime()) / DAY) : null };
}

export async function noshowRecovery(s: Scope, o: Omit<ListOpts, "extra">, link: ((a: string, b: string) => string) | null): Promise<Appt3Recovery> {
  const db = sql(), dd = await dealDays(s.inst);
  const win = { ...o.f, from: new Date(Date.now() - 7 * DAY), to: new Date(), bucket: undefined };
  const label = await names(s.inst), size = clampSize(o.size);
  const b = base(s, win, dd, db`and a.status = 'noshow'`);
  const [p, [rec]] = await Promise.all([
    page(
      db`with ap as (${b}) select * from ap where not rebooked order by ${sortOf(o.sort ?? "value")} limit ${size} offset ${offsetOf(o.page, size)}`,
      db`with ap as (${b}) select count(*)::int n from ap where not rebooked`,
      Math.max(0, Math.floor(o.page)), size, (r) => ({ ...toRow(r, label, link, `No-show ${Math.max(0, Math.floor((Date.now() - (r.start_at as Date).getTime()) / DAY))} days ago, not rebooked`), rebooked: false, snoozedUntil: iso(r.snoozed_until), daysSince: Math.floor((Date.now() - (r.start_at as Date).getTime()) / DAY) }),
    ),
    db`with ap as (${base(s, { ...win, from: new Date(Date.now() - 30 * DAY), to: new Date(Date.now() - DAY) }, dd, db`and a.status = 'noshow'`)})
      select count(*) filter (where rebooked)::int rebooked, count(*)::int total,
        coalesce(sum(deal_value) filter (where rebooked and deal_status = 'won'), 0)::float8 value,
        count(*) filter (where exists (select 1 from cached_appointments b where b.installation_id = ${s.inst} and b.location_id = ap.location_id and b.contact_id = ap.contact_id
          and b.created_remote_at >= ap.start_at and b.created_remote_at <= ap.start_at + interval '24 hours' and b.start_at > ap.start_at and b.status not in ('cancelled', 'invalid')))::int fast from ap`,
  ]);
  return { ...p, recovered: { count: num(rec.rebooked), value: num(rec.value), rebookedWithin24hRate: rate(num(rec.fast), num(rec.total)) } };
}

// ---------- booking share, flow tree ----------

async function personStats(s: Scope, f: Filters, dd: number, by: "booker" | "owner") {
  const db = sql();
  const col = by === "booker" ? db`booker` : db`owner`;
  return db`with ap as (${base(s, { ...f, bucket: undefined }, dd)}) select ${col} uid, count(*) filter (where status <> 'invalid')::int booked,
      count(*) filter (where status = 'showed')::int showed, count(*) filter (where status = 'noshow')::int noshow, count(*) filter (where status = 'cancelled')::int cancelled,
      count(*) filter (where unmarked)::int unmarked, count(*) filter (where upcoming)::int upcoming, count(*) filter (where deal_status = 'won' and status <> 'invalid')::int won,
      count(*) filter (where deal_status = 'lost' and status <> 'invalid')::int lost, count(*) filter (where deal_status = 'open' and status <> 'invalid')::int open,
      coalesce(sum(deal_value) filter (where deal_status = 'won' and status <> 'invalid'), 0)::float8 won_value,
      count(*) filter (where (status in ('noshow', 'cancelled') or (unmarked and start_at < now() - interval '3 days')) and not rebooked and deal_status is distinct from 'won')::int burned,
      (percentile_cont(0.5) within group (order by extract(epoch from (created_at - lead_at)) / 60) filter (where lead_at is not null and created_at >= lead_at))::float8 ltb
    from ap group by 1`;
}

export async function bookingShare(s: Scope, f: Filters, p: number, size0: number, sort?: string | null): Promise<Appt3BookingShare> {
  const db = sql(), dd = await dealDays(s.inst), size = clampSize(size0), label = await names(s.inst);
  const [bk, ow] = await Promise.all([personStats(s, f, dd, "booker"), personStats(s, f, dd, "owner")]);
  const ids = new Set<string | null>([...bk.map((r) => r.uid as string | null), ...ow.map((r) => r.uid as string | null)]);
  const B = new Map(bk.map((r) => [r.uid as string | null, r])), O = new Map(ow.map((r) => [r.uid as string | null, r]));
  let people: Appt3PersonShare[] = [...ids].map((id) => {
    const b = B.get(id), o = O.get(id), booked = num(b?.booked), owned = num(o?.booked);
    const m = booked >= owned ? b : o; // the side this person mostly works on gives the outcome figures
    const showed = num(m?.showed), noshow = num(m?.noshow), unmarked = num(m?.unmarked), won = num(m?.won), lost = num(m?.lost);
    return {
      userId: id, name: id ? label(id) : "Not recorded", role: !id ? "none" : booked && owned ? "both" : booked ? "setter" : "closer",
      booked, owned, showed, noshow, unmarked, won, lost, showRate: trueShowRate(showed, noshow, unmarked), noshowRate: rate(noshow, showed + noshow + unmarked),
      closeRate: rate(won, won + lost, 10), wonValue: num(m?.won_value), leadToBookedMedianMinutes: b?.ltb === null || b?.ltb === undefined ? null : Math.round(Number(b.ltb)),
      burned: num(m?.burned), trend: [],
    };
  });
  if (f.q) people = people.filter((x) => x.name.toLowerCase().includes(f.q!.toLowerCase()));
  const key = (x: Appt3PersonShare) => (sort === "show" ? x.showRate.value ?? -1 : sort === "burned" ? x.burned : sort === "revenue" ? x.wonValue : sort === "owned" ? x.owned : x.booked);
  people.sort((a, b) => key(b) - key(a));
  const total = people.length, off = offsetOf(p, size);
  const rows = people.slice(off, off + size);
  const uids = rows.map((r) => r.userId).filter((x): x is string => !!x);
  if (uids.length) {
    const tr = await db`with ap as (${base(s, { ...f, bucket: undefined }, dd)}) select booker uid, date_trunc('week', start_at)::date wk, count(*) filter (where status <> 'invalid')::int booked,
        count(*) filter (where status = 'showed')::int showed, count(*) filter (where status in ('showed', 'noshow') or unmarked)::int decided from ap where booker = any(${uids}::text[]) group by 1, 2 order by 2`;
    for (const r of tr) { const x = rows.find((y) => y.userId === r.uid); x?.trend.push({ week: String(r.wk instanceof Date ? r.wk.toISOString().slice(0, 10) : r.wk), booked: num(r.booked), showRate: num(r.decided) >= MIN_SHOW ? num(r.showed) / num(r.decided) : null }); }
  }
  const owned = people.filter((x) => x.userId && x.owned > 0).map((x) => x.owned);
  return {
    rows, total, page: Math.max(0, Math.floor(p)), size, pages: Math.max(1, Math.ceil(total / size)), truncated: false,
    unassigned: num(B.get(null)?.booked), ownerless: num(O.get(null)?.booked), fairness: fairness(owned),
  };
}

export async function flowTree(s: Scope, f: Filters, topN: number, compare: [string, string] | null): Promise<Appt3FlowTree> {
  const db = sql(), dd = await dealDays(s.inst), label = await names(s.inst);
  const rows = await db`with ap as (${base(s, { ...f, bucket: undefined }, dd)}) select booker setter, owner closer, count(*) filter (where status <> 'invalid')::int booked,
      count(*) filter (where status = 'showed')::int showed, count(*) filter (where status = 'noshow')::int noshow, count(*) filter (where status = 'cancelled')::int cancelled,
      count(*) filter (where unmarked)::int unmarked, count(*) filter (where upcoming)::int upcoming, count(*) filter (where deal_status = 'won' and status <> 'invalid')::int won,
      count(*) filter (where deal_status = 'lost' and status <> 'invalid')::int lost, count(*) filter (where deal_status = 'open' and status <> 'invalid')::int open,
      coalesce(sum(deal_value) filter (where deal_status = 'won' and status <> 'invalid'), 0)::float8 won_value,
      count(*) filter (where (status in ('noshow', 'cancelled') or (unmarked and start_at < now() - interval '3 days')) and not rebooked and deal_status is distinct from 'won')::int burned,
      (percentile_cont(0.5) within group (order by extract(epoch from (created_at - lead_at)) / 60) filter (where lead_at is not null and created_at >= lead_at))::float8 ltb
    from ap group by 1, 2 having count(*) filter (where status <> 'invalid') > 0`;
  const aggs: FlowAgg[] = rows.map((r) => ({
    setter: (r.setter as string | null) ?? null, closer: (r.closer as string | null) ?? null, booked: num(r.booked), showed: num(r.showed), noshow: num(r.noshow), cancelled: num(r.cancelled),
    unmarked: num(r.unmarked), upcoming: num(r.upcoming), won: num(r.won), lost: num(r.lost), open: num(r.open), wonValue: num(r.won_value), burned: num(r.burned),
    ltbMedianMin: r.ltb === null || r.ltb === undefined ? null : Math.round(Number(r.ltb)),
  }));
  return buildFlowTree(aggs, (id) => (id ? label(id) : "Not recorded"), { from: f.from.toISOString(), to: f.to.toISOString() }, Math.max(3, Math.min(30, topN)), compare);
}

// ---------- cross-account health ----------

export async function health(s: Scope, f: Filters, p: number, size0: number): Promise<Appt3Health> {
  const db = sql(), dd = await dealDays(s.inst), size = clampSize(size0);
  const [rows, st, prof] = await Promise.all([
    db`with ap as (${base(s, { ...f, bucket: undefined }, dd)}) select location_id, max(account_name) name, count(*) filter (where status <> 'invalid')::int booked, count(*) filter (where status = 'showed')::int showed,
        count(*) filter (where status = 'noshow')::int noshow, count(*) filter (where status = 'cancelled')::int cancelled, count(*) filter (where unmarked)::int unmarked,
        count(*) filter (where resched > 0)::int resched from ap group by 1`,
    db`select appointment_show_rate_target t from settings where installation_id = ${s.inst}`.catch(() => []),
    db`select location_id, vertical from account_profiles where installation_id = ${s.inst}`.catch(() => []),
  ]);
  const target = Number(st[0]?.t) >= 30 ? Number(st[0].t) : 75;
  const vert = new Map(prof.map((r) => [r.location_id as string, (r.vertical as string | null) ?? null]));
  let accounts = rows.map((r) => {
    const showed = num(r.showed), noshow = num(r.noshow), unmarked = num(r.unmarked), booked = num(r.booked);
    const sr = trueShowRate(showed, noshow, unmarked);
    const reason = unmarked >= 3 && unmarked / Math.max(1, booked) > 0.2 ? `${unmarked} appointments with no outcome` : sr.enough && (sr.value ?? 1) * 100 < target ? `Show rate ${Math.round((sr.value ?? 0) * 100)}%, under the ${target}% target` : rate(noshow, showed + noshow + unmarked).enough && noshow / Math.max(1, showed + noshow + unmarked) > 0.3 ? "More than 3 in 10 no-shows" : null;
    return {
      locationId: r.location_id as string, accountName: (r.name as string | null) ?? null, vertical: vert.get(r.location_id as string) ?? null, booked, showRate: sr,
      cancelRate: rate(num(r.cancelled), booked), noshowRate: rate(noshow, showed + noshow + unmarked), unmarked, rescheduleRate: rate(num(r.resched), booked), target,
      belowTarget: sr.enough && (sr.value ?? 1) * 100 < target, worstReason: reason,
    };
  });
  if (f.q) accounts = accounts.filter((a) => (a.accountName ?? "").toLowerCase().includes(f.q!.toLowerCase()));
  accounts.sort((a, b) => (a.showRate.value ?? 2) - (b.showRate.value ?? 2) || b.unmarked - a.unmarked);
  const by = new Map<string, { showed: number; all: number; n: number }>();
  for (const r of rows) { const v = vert.get(r.location_id as string); if (!v) continue; const e = by.get(v) ?? { showed: 0, all: 0, n: 0 }; e.showed += num(r.showed); e.all += num(r.showed) + num(r.noshow) + num(r.unmarked); e.n++; by.set(v, e); }
  const off = offsetOf(p, size);
  return { rows: accounts.slice(off, off + size), total: accounts.length, page: Math.max(0, Math.floor(p)), size, pages: Math.max(1, Math.ceil(accounts.length / size)), truncated: false, verticals: [...by].map(([vertical, e]) => ({ vertical, accounts: e.n, showRate: rate(e.showed, e.all) })) };
}

// ---------- sources and speed ----------

export async function sources(s: Scope, f: Filters): Promise<Appt3Sources> {
  const db = sql(), dd = await dealDays(s.inst);
  const b = base(s, { ...f, bucket: undefined }, dd);
  const d = () => db`count(*) filter (where status <> 'invalid')::int booked, count(*) filter (where status = 'showed')::int showed, count(*) filter (where status in ('showed', 'noshow') or unmarked)::int decided,
    count(*) filter (where deal_status = 'won')::int won, count(*) filter (where deal_status in ('won', 'lost'))::int closed`;
  const [src, speed, lead, wd] = await Promise.all([
    db`with ap as (${b}) select coalesce(source, '') k, ${d()} from ap group by 1 order by 2 desc limit 25`,
    db`with ap as (${b}) select case when lead_at is null or touch_at is null or touch_at < lead_at then 'none' when touch_at - lead_at < interval '5 minutes' then 'under_5m' when touch_at - lead_at < interval '30 minutes' then '5_to_30m'
        when touch_at - lead_at < interval '2 hours' then '30m_to_2h' else 'over_2h' end k, ${d()} from ap group by 1`,
    db`with ap as (${b}) select floor(extract(epoch from (start_at - coalesce(created_at, start_at))) / 86400)::int k, ${d()} from ap group by 1`,
    db`with ap as (${b}) select extract(dow from start_at at time zone tz)::int wd, extract(hour from start_at at time zone tz)::int hr, ${d()} from ap group by 1, 2`,
  ]);
  const sr = (r: Record<string, unknown>): Rate => rate(num(r.showed), num(r.decided));
  const bySource = src.filter((r) => r.k !== "").map((r) => ({ source: r.k as string, booked: num(r.booked), showRate: sr(r), closeRate: rate(num(r.won), num(r.closed), 10) }));
  const bands = new Map<string, { booked: number; showed: number; decided: number }>();
  for (const r of lead) { const k = leadTimeBand(Math.max(0, num(r.k))); const e = bands.get(k) ?? { booked: 0, showed: 0, decided: 0 }; e.booked += num(r.booked); e.showed += num(r.showed); e.decided += num(r.decided); bands.set(k, e); }
  const wk = new Map<number, { booked: number; showed: number; decided: number }>(), hh = new Map<number, { booked: number; showed: number; decided: number }>();
  const slots: Array<{ weekday: number; hour: number; showRate: number; n: number }> = [];
  for (const r of wd) {
    for (const [m, k] of [[wk, num(r.wd)], [hh, num(r.hr)]] as const) { const e = m.get(k) ?? { booked: 0, showed: 0, decided: 0 }; e.booked += num(r.booked); e.showed += num(r.showed); e.decided += num(r.decided); m.set(k, e); }
    if (num(r.decided) >= 10) slots.push({ weekday: num(r.wd), hour: num(r.hr), showRate: num(r.showed) / num(r.decided), n: num(r.decided) });
  }
  const mapR = (e: { booked: number; showed: number; decided: number }) => ({ booked: e.booked, showRate: rate(e.showed, e.decided) });
  return {
    bySource, sourceBlank: num(src.find((r) => r.k === "")?.booked),
    bySpeed: (["under_5m", "5_to_30m", "30m_to_2h", "over_2h", "none"] as const).map((k) => { const r = speed.find((x) => x.k === k); return { band: k, label: SPEED_LABELS[k], booked: num(r?.booked), showRate: r ? sr(r) : rate(0, 0) }; }),
    byLeadTime: ["Same day", "1 to 2 days", "3 to 6 days", "A week or more"].map((k) => ({ band: k, ...mapR(bands.get(k) ?? { booked: 0, showed: 0, decided: 0 }) })),
    byWeekday: [0, 1, 2, 3, 4, 5, 6].map((k) => ({ weekday: k, ...mapR(wk.get(k) ?? { booked: 0, showed: 0, decided: 0 }) })),
    byHour: [...hh].sort((a, b) => a[0] - b[0]).map(([k, e]) => ({ hour: k, ...mapR(e) })),
    bestSlots: slots.sort((a, b) => b.showRate - a.showRate).slice(0, 5),
  };
}

// ---------- calendars and conflicts ----------

export async function calendars(s: Scope, f: Filters, p: number, size0: number, link: ((a: string, b: string) => string) | null): Promise<Appt3Calendars> {
  const db = sql(), size = clampSize(size0), label = await names(s.inst);
  const from = f.from, to = f.to;
  const L = locs(s, f.location);
  const pair = db`
    from cached_appointments a
    join cached_appointments b on b.installation_id = a.installation_id and b.location_id = a.location_id and b.appointment_id > a.appointment_id
      and (b.calendar_id = a.calendar_id or (a.assigned_to is not null and b.assigned_to = a.assigned_to))
      and b.start_at < a.end_at and a.start_at < b.end_at and b.start_at >= ${new Date(from.getTime() - DAY)} and b.start_at < ${new Date(to.getTime() + DAY)}
    join (${L}) l on l.location_id = a.location_id
    where a.installation_id = ${s.inst} and a.start_at >= ${from} and a.start_at < ${to} and a.end_at is not null and b.end_at is not null
      and a.status not in ('cancelled', 'invalid') and b.status not in ('cancelled', 'invalid')`;
  const dd = await dealDays(s.inst);
  const [crow, cnt, dis, trend, rr, cap, acc, calAll, ppl, remGap] = await Promise.all([
    db`select a.location_id, l.name account_name, a.appointment_id a_id, a.calendar_id a_cal, a.calendar_name a_calname, a.contact_id a_contact, a.status a_status, a.start_at a_start, a.end_at a_end, a.assigned_to a_owner, a.booked_by_user a_booker, a.created_remote_at a_created,
        b.appointment_id b_id, b.contact_id b_contact, b.status b_status, b.start_at b_start, b.end_at b_end, b.assigned_to b_owner, b.booked_by_user b_booker, b.created_remote_at b_created, b.calendar_id b_cal, b.calendar_name b_calname,
        (b.calendar_id is not distinct from a.calendar_id) same_cal, extract(epoch from (least(a.end_at, b.end_at) - greatest(a.start_at, b.start_at))) / 60 mins
      ${pair} order by a.start_at desc limit ${size} offset ${offsetOf(p, size)}`,
    db`select count(*)::int n, count(*) filter (where (case when coalesce(b.created_remote_at, 'epoch') > coalesce(a.created_remote_at, 'epoch') then b.booked_by_user else a.booked_by_user end) is not null
        and greatest(coalesce(a.created_remote_at, 'epoch'), coalesce(b.created_remote_at, 'epoch')) > 'epoch')::int forced ${pair}`,
    db`select l.location_id, l.name account_name, c.calendar_id, max(c.calendar_name) calendar_name, max(c.start_at) last_at
       from cached_appointments c join (${L}) l on l.location_id = c.location_id where c.installation_id = ${s.inst} and c.calendar_id is not null
       group by 1, 2, 3 having max(c.start_at) < now() - interval '30 days' and max(c.start_at) > now() - interval '120 days' limit 50`,
    db`select date_trunc('week', a.start_at)::date wk, count(*)::int booked, count(*) filter (where coalesce(fa.reschedule_count, 0) > 0)::int resched, count(*) filter (where a.status = 'cancelled')::int cancelled
       from cached_appointments a join (${L}) l on l.location_id = a.location_id left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
       where a.installation_id = ${s.inst} and a.start_at >= ${from} and a.start_at < ${to} group by 1 order by 1`,
    db`select a.location_id, a.calendar_id, max(a.calendar_name) calendar_name, a.assigned_to uid, count(*)::int n from cached_appointments a join (${L}) l on l.location_id = a.location_id
       where a.installation_id = ${s.inst} and a.start_at >= ${from} and a.start_at < ${to} and a.calendar_id is not null and a.status <> 'invalid' group by 1, 2, 4 order by 5 desc limit 400`,
    db`select to_char(a.start_at, 'YYYY-MM') m, count(*)::int booked from cached_appointments a join (${L}) l on l.location_id = a.location_id
       where a.installation_id = ${s.inst} and a.start_at >= date_trunc('month', now()) and a.start_at < date_trunc('month', now()) + interval '3 months' and a.status not in ('cancelled', 'invalid') group by 1 order by 1`,
    db`select count(*) filter (where appointments_access = 'needs_permission')::int n from locations where installation_id = ${s.inst} ${s.allowed ? db`and location_id = any(${s.allowed}::text[])` : db``}`,
    db`select l.location_id, l.name account_name, c.calendar_id, max(c.calendar_name) calendar_name,
        count(*) filter (where c.start_at >= ${from} and c.start_at < ${to} and c.status <> 'invalid')::int n, max(c.start_at) filter (where c.status <> 'invalid' and c.start_at <= now()) last_at
       from cached_appointments c join (${L}) l on l.location_id = c.location_id where c.installation_id = ${s.inst} and c.calendar_id is not null
       group by 1, 2, 3 order by 5 desc, 6 desc nulls last limit 200`,
    db`with x as (select a.assigned_to uid, count(*) filter (where a.start_at >= ${from} and a.start_at < ${to} and a.status <> 'invalid')::int n, max(a.start_at) filter (where a.status <> 'invalid' and a.start_at <= now()) last_at
         from cached_appointments a join (${L}) l on l.location_id = a.location_id where a.installation_id = ${s.inst} and a.assigned_to is not null group by 1)
       select coalesce(t.user_id, x.uid) uid, coalesce(x.n, 0)::int n, x.last_at, (x.uid is not null) ever
       from (select user_id from team_names where installation_id = ${s.inst}) t full join x on x.uid = t.user_id order by 2 desc, 3 desc nulls last limit 200`,
    db`with ap as (${base(s, { ...f, from: new Date(), to: new Date(Date.now() + 7 * DAY), bucket: undefined }, dd, db`and a.status not in ('cancelled', 'invalid')`)}) select count(*) filter (where reminders = 0)::int n from ap`,
  ]);
  const mk = (r: Record<string, unknown>, k: "a" | "b"): Appt3Row => toRow({
    appointment_id: r[`${k}_id`], location_id: r.location_id, account_name: r.account_name, contact_id: r[`${k}_contact`], contact_name: "Booking", calendar_id: r[`${k}_cal`] ?? r.a_cal, calendar_name: r[`${k}_calname`] ?? r.a_calname,
    status: r[`${k}_status`], start_at: r[`${k}_start`], end_at: r[`${k}_end`], owner: r[`${k}_owner`], booker: r[`${k}_booker`], created_at: r[`${k}_created`], unmarked: false, upcoming: false, has_conflict: true,
  }, label, link);
  const conflicts: Page<Appt3Conflict> = {
    rows: crow.map((r) => {
      const later = (r.b_created as Date | null)?.getTime() ?? 0, earlier = (r.a_created as Date | null)?.getTime() ?? 0;
      // Forced: the later-created booking was made by a named person (not the booking page) on top of an existing one.
      const forced = Boolean((later > earlier ? r.b_booker : r.a_booker) && Math.max(later, earlier) > 0);
      return { kind: forced ? "forced_overlap" as const : "double_booking" as const, locationId: r.location_id as string, accountName: (r.account_name as string | null) ?? null, calendarName: (r.a_calname as string | null) ?? null, a: mk(r, "a"), b: mk(r, "b"), overlapMinutes: Math.round(Number(r.mins)) };
    }),
    total: num(cnt[0]?.n), page: Math.max(0, Math.floor(p)), size, pages: Math.max(1, Math.ceil(num(cnt[0]?.n) / size)), truncated: false,
  };
  const rrMap = new Map<string, Appt3Calendars["roundRobin"][number]>();
  for (const r of rr) {
    const k = `${r.location_id}:${r.calendar_id}`;
    const e = rrMap.get(k) ?? { calendarId: r.calendar_id as string, calendarName: (r.calendar_name as string | null) ?? null, locationId: r.location_id as string, members: [] };
    e.members.push({ userId: (r.uid as string | null) ?? null, name: r.uid ? label(r.uid as string) : "Not assigned", owned: num(r.n), sharePct: 0 });
    rrMap.set(k, e);
  }
  const roundRobin = [...rrMap.values()].filter((e) => e.members.filter((m) => m.userId).length >= 2).map((e) => { const t = e.members.reduce((x, m) => x + m.owned, 0); for (const m of e.members) m.sharePct = t ? Math.round((m.owned / t) * 100) : 0; return e; }).slice(0, 30);
  const daysAgo = (v: unknown) => (v instanceof Date ? Math.max(0, Math.floor((Date.now() - v.getTime()) / DAY)) : null);
  const calendarsAll = calAll.map((r) => ({ locationId: r.location_id as string, accountName: (r.account_name as string | null) ?? null, calendarId: r.calendar_id as string, calendarName: (r.calendar_name as string | null) ?? null, bookings: num(r.n), lastBookingAt: iso(r.last_at), daysSince: daysAgo(r.last_at) }));
  const totalOwned = ppl.reduce((x, r) => x + num(r.n), 0);
  const peopleAll = ppl.filter((r) => r.uid).map((r) => ({ userId: r.uid as string, name: label(r.uid as string), bookings: num(r.n), sharePct: totalOwned ? Math.round((num(r.n) / totalOwned) * 100) : 0, lastBookingAt: iso(r.last_at), daysSince: daysAgo(r.last_at), everBooked: r.ever === true }));
  const forced = num(cnt[0]?.forced), doubles = Math.max(0, num(cnt[0]?.n) - forced);
  const idle = calendarsAll.filter((c) => c.bookings === 0 || (c.daysSince !== null && c.daysSince >= 30)).length;
  const problems: NonNullable<Appt3Calendars["problems"]> = [
    { key: "double_booking", label: "Double bookings", tone: "red", count: doubles, why: "Two people booked into the same slot. One of them will wait or not be seen.", available: true },
    { key: "forced_overlap", label: "Forced overlaps", tone: "red", count: forced, why: "Someone booked on top of an existing booking by hand. The meeting will run short or one lead is left waiting.", available: true },
    { key: "disconnected", label: "Calendars not syncing", tone: "red", count: dis.length, why: "No bookings for 30 days after earlier ones. The calendar may be disconnected, so new leads cannot book.", available: true },
    { key: "idle_calendar", label: "Idle calendars", tone: "amber", count: idle, why: "Calendars with no bookings in these dates or none for 30 days. Paid ads or reps may be pointed at a dead page.", available: true },
    { key: "idle_person", label: "People with no bookings", tone: "amber", count: peopleAll.filter((x) => x.bookings === 0).length, why: "Named team members who took no meetings in these dates. Their capacity is unused.", available: true },
    { key: "no_calendar_user", label: "People with no calendar seen", tone: "amber", count: peopleAll.filter((x) => !x.everBooked).length, why: "People who have never owned a booking. They may not have a calendar set up.", available: true },
    { key: "reminder_gap", label: "Next 7 days with no reminder", tone: "amber", count: num(remGap[0]?.n), why: "Upcoming appointments nobody has been reminded about. Reminders cut no-shows.", available: true },
    { key: "one_way_sync", label: "One-way calendar sync", tone: "amber", count: 0, why: "Needs the calendar connection details, which the platform does not give us yet.", available: false },
    { key: "no_availability", label: "Calendars with no availability", tone: "amber", count: 0, why: "Needs the open-hours settings of each calendar, which the platform does not give us yet.", available: false },
  ];
  return {
    conflicts, needsPermission: num(acc[0]?.n) > 0, calendarsAll, peopleAll, problems,
    disconnected: dis.map((r) => ({ locationId: r.location_id as string, accountName: (r.account_name as string | null) ?? null, calendarId: r.calendar_id as string, calendarName: (r.calendar_name as string | null) ?? null, lastBookingAt: iso(r.last_at), reason: "no_bookings_30d" as const })),
    trend: trend.map((r) => ({ week: String(r.wk instanceof Date ? r.wk.toISOString().slice(0, 10) : r.wk), booked: num(r.booked), rescheduled: num(r.resched), cancelled: num(r.cancelled) })),
    roundRobin, capacity: cap.map((r) => ({ month: r.m as string, booked: num(r.booked) })),
  };
}

// ---------- reminders ----------

export async function reminders(s: Scope, f: Filters, p: number, size0: number, link: ((a: string, b: string) => string) | null): Promise<Appt3Reminders> {
  const db = sql(), dd = await dealDays(s.inst), size = clampSize(size0), label = await names(s.inst);
  const up = { ...f, from: new Date(), to: new Date(Date.now() + 7 * DAY), bucket: undefined };
  const noRem = base(s, up, dd, db`and a.status not in ('cancelled', 'invalid') and coalesce(fa.reminders_sent, 0) = 0`);
  const notConf = base(s, { ...up, to: new Date(Date.now() + 2 * DAY) }, dd, db`and a.status = 'new' and fa.confirmed_at is null`);
  const mkPage = (b: Frag) => page(db`with ap as (${b}) select * from ap order by start_at asc limit ${size} offset ${offsetOf(p, size)}`, db`with ap as (${b}) select count(*)::int n from ap`, Math.max(0, Math.floor(p)), size,
    (r) => toRow(r, label, link, `Starts ${new Date((r.start_at as Date).getTime()).toISOString().slice(0, 16).replace("T", " ")}, ${num(r.reminders) ? "reminder sent" : "no reminder sent"}${r.status === "new" ? ", not confirmed" : ""}`));
  const [a, b, eff, hist, risk] = await Promise.all([
    mkPage(noRem), mkPage(notConf),
    db`select count(*) filter (where a.status = 'showed' and coalesce(fa.reminders_sent, 0) > 0)::int ws, count(*) filter (where a.status in ('showed', 'noshow') and coalesce(fa.reminders_sent, 0) > 0)::int wd,
        count(*) filter (where a.status = 'showed' and coalesce(fa.reminders_sent, 0) = 0)::int os, count(*) filter (where a.status in ('showed', 'noshow') and coalesce(fa.reminders_sent, 0) = 0)::int od
      from cached_appointments a join (${locs(s, f.location)}) l on l.location_id = a.location_id
      left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
      where a.installation_id = ${s.inst} and a.start_at >= ${new Date(Date.now() - 90 * DAY)} and a.start_at < ${new Date(Date.now() - DAY)} and fa.deleted_at is null`,
    db`select extract(day from now() - min(recorded_at))::int d from appointment_history where installation_id = ${s.inst} and kind = 'reminder'`.catch(() => []),
    db`with ap as (${base(s, { ...up, to: new Date(Date.now() + 3 * DAY) }, dd, db`and a.status not in ('cancelled', 'invalid')`)}) select location_id, appointment_id, status = 'new' and confirmed_at is null nc, reminders = 0 nr,
        (created_at is not null and start_at - created_at < interval '3 hours') short,
        exists (select 1 from cached_appointments h where h.installation_id = ${s.inst} and h.location_id = ap.location_id and h.contact_id = ap.contact_id and ap.contact_id is not null and h.status = 'noshow' and h.start_at < now()) prior
      from ap order by start_at asc limit 200`,
  ]);
  const e = eff[0], withR = rate(num(e.ws), num(e.wd)), without = rate(num(e.os), num(e.od));
  return {
    noReminder: a, notConfirmed24h: b,
    effectiveness: { enough: withR.enough && without.enough && num(hist[0]?.d) >= 14, withReminder: withR, without, minNote: num(hist[0]?.d) >= 14 ? (withR.enough && without.enough ? null : "Not enough appointments with a recorded outcome yet.") : "Reminder history is still building; it is kept from the day it starts." },
    riskFlags: risk.map((r) => ({ appointmentId: r.appointment_id as string, locationId: r.location_id as string, flags: ([r.nc ? "not_confirmed" : null, r.nr ? "no_reminder" : null, r.prior ? "first_time_no_show_history" : null, r.short ? "short_notice" : null].filter(Boolean) as Appt3Reminders["riskFlags"][number]["flags"]) })).filter((r) => r.flags.length),
    historyDays: num(hist[0]?.d),
  };
}

// ---------- weekly receipt ----------

export async function receipt(s: Scope, location: string | null, weekStart: Date): Promise<Appt3Receipt> {
  const db = sql(), dd = await dealDays(s.inst), end = new Date(weekStart.getTime() + 7 * DAY);
  const f: Filters = { from: weekStart, to: end, location };
  const [[t], [fix], [one]] = await Promise.all([
    db`with ap as (${base(s, f, dd)}) select count(*) filter (where status <> 'invalid')::int booked, count(*) filter (where status = 'showed')::int showed, count(*) filter (where status = 'noshow')::int noshow,
        count(*) filter (where unmarked)::int unmarked, count(*) filter (where status = 'noshow' and rebooked)::int recovered, count(*) filter (where deal_status = 'won')::int won,
        coalesce(sum(deal_value) filter (where deal_status = 'won'), 0)::float8 won_value from ap`,
    db`select count(*)::int n from appointment_history where installation_id = ${s.inst} and kind = 'status' and actor_kind = 'subsync' and at >= ${weekStart} and at < ${end} ${location && cleanId(location) ? db`and location_id = ${location}` : db``}`.catch(() => [{ n: 0 }]),
    db`select name from locations where installation_id = ${s.inst} and location_id = ${cleanId(location) ?? ""}`,
  ]);
  const tr = trueShowRate(num(t.showed), num(t.noshow), num(t.unmarked));
  const r: Appt3Receipt = {
    weekStart: weekStart.toISOString().slice(0, 10), weekEnd: new Date(end.getTime() - DAY).toISOString().slice(0, 10), locationId: cleanId(location), accountName: (one?.name as string | null) ?? null,
    booked: num(t.booked), showed: num(t.showed), noshow: num(t.noshow), recovered: num(t.recovered), stillUnmarked: num(t.unmarked), fixedByUs: num(fix.n), trueShowRate: tr, won: { value: num(t.won_value), n: num(t.won) }, headline: "", verifyHash: null,
  };
  r.headline = `${r.booked} booked, ${r.showed} showed, ${r.recovered} no-show${r.recovered === 1 ? "" : "s"} recovered, ${r.stillUnmarked} still without an outcome.`;
  return r;
}

// ---------- one appointment ----------

export async function detail(s: Scope, locationId: string, appointmentId: string, link: ((a: string, b: string) => string) | null): Promise<Appt3Detail | null> {
  const db = sql(), dd = await dealDays(s.inst), label = await names(s.inst);
  const loc = cleanId(locationId), id = cleanId(appointmentId);
  if (!loc || !id) return null;
  const wide = { from: new Date(Date.now() - 800 * DAY), to: new Date(Date.now() + 400 * DAY), location: loc };
  const [rows, hist, chain] = await Promise.all([
    db`with ap as (${base(s, wide, dd, db`and a.appointment_id = ${id}`)}) select * from ap limit 1`,
    db`select at, kind, from_value, to_value, actor_id, actor_kind, detail from appointment_history where installation_id = ${s.inst} and location_id = ${loc} and appointment_id = ${id} order by at limit 100`.catch(() => []),
    db`select a.appointment_id, a.start_at, a.status from cached_appointments a join appointment_facts f on f.installation_id = a.installation_id and f.location_id = a.location_id and f.appointment_id = a.appointment_id
       where a.installation_id = ${s.inst} and a.location_id = ${loc} and (a.appointment_id = (select rescheduled_from from appointment_facts where installation_id = ${s.inst} and location_id = ${loc} and appointment_id = ${id}) or f.rescheduled_from = ${id}) order by a.start_at`.catch(() => []),
  ]);
  const r = rows[0];
  if (!r) return null; // not in an account the caller may see, or not there: the same answer
  const row = toRow(r, label, link);
  const [deal] = r.deal_id ? await db`select opportunity_id, name, status, monetary_value, stage_name from cached_opportunities where installation_id = ${s.inst} and location_id = ${loc} and opportunity_id = ${r.deal_id as string}` : [];
  const blockers: Appt3Detail["blockers"] = [];
  if (row.dnd) blockers.push("dnd");
  if (deal?.status === "open") blockers.push("open_deal");
  if (row.bucket === "upcoming") blockers.push("upcoming");
  const kindText: Record<string, string> = { created: "Booked", status: "Status changed", time: "Time changed", owner: "Owner changed", calendar: "Calendar changed", booker: "Booker recorded", reminder: "Reminder sent", confirmed: "Confirmed", deal_linked: "Deal linked", rescheduled_from: "Rescheduled", deleted: "Deleted", note: "Note added" };
  return {
    row,
    timeline: hist.map((h) => ({ at: iso(h.at) as string, kind: h.kind as string, from: (h.from_value as string | null) ?? null, to: (h.to_value as string | null) ?? null, actorName: h.actor_id ? label(h.actor_id as string) : null, actorKind: h.actor_kind as "person" | "subsync" | "system" | "unknown",
      text: `${kindText[h.kind as string] ?? "Changed"}${h.from_value || h.to_value ? `: ${h.from_value ?? "none"} to ${h.to_value ?? "none"}` : ""}` })),
    rescheduleChain: chain.map((c) => ({ appointmentId: c.appointment_id as string, startAt: iso(c.start_at) as string, status: c.status as string })),
    deal: deal ? { opportunityId: deal.opportunity_id as string, name: (deal.name as string | null) ?? null, status: deal.status as string, value: deal.monetary_value === null ? null : Number(deal.monetary_value), stage: (deal.stage_name as string | null) ?? null } : null,
    reminders: hist.filter((h) => h.kind === "reminder").map((h) => ({ at: iso(h.at) as string, channel: ((h.detail as Record<string, unknown>)?.channel as string | undefined) ?? null })),
    blockers,
  };
}

// A short cache for the heavy aggregates: the same installation, accounts and filters share one read for 30 seconds.
export const apptCache = ttlCache<unknown>(30_000, 300);
export { parseApptWindow };
