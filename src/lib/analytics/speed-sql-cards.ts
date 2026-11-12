import type { PendingQuery, Row } from "postgres";
import { sql } from "../db";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";
import { BOOKING_BUCKETS, bookingFromCounts, type BookingKey } from "./speed5";
import { leadSet, rowOfSql, type Scope, type SetOpts } from "./speed-sql";
import { filterActive, STEPS, STEP_LABEL, type JourneyStep, type LeadFilter, type Step } from "./speed-v4-more";
import { DEFAULT_HOURS } from "./speed-v3";
import type { LoadedRow } from "./speed-parts";

// The Speed cards that used to read every lead (Pace, People, journey, Race, coverage) as SQL aggregates (stage SPEED7). Each one is a grouped query over the same lead set as the lists
// (speed-sql.ts `leadSet`), so a card's number and the list behind it still come from one definition. Exact at 100,000+ leads per account; lists inside them are cut to a sample in the database.
type Db = ReturnType<typeof sql>;
type Frag = PendingQuery<Row[]>;
const DAY = 86_400_000;
const SAMPLE = 8;

export const needsLocal = (f: LeadFilter) => f.hourFrom !== undefined || f.hourTo !== undefined || f.dow !== undefined;
const norm = (db: Db) => db`btrim(regexp_replace(coalesce(x.source, ''), '\s+', ' ', 'g'))`;

/** The advanced lead filter (speed-v4-more `applyFilter`) as a WHERE fragment over the lead set. */
export function filterSql(db: Db, f: LeadFilter, s: Scope): Frag {
  const ps: Frag[] = [db`true`];
  if (f.account) ps.push(db`x.location_id = ${f.account}`);
  if (f.source) ps.push(f.source === "No source recorded" ? db`${norm(db)} = ''` : db`(${norm(db)} = ${f.source} or (${norm(db)} ~ '[a-z]' and ${norm(db)} !~ '[A-Z]' and ${norm(db)} = lower(${f.source})))`);
  if (f.owner) ps.push(db`x.assigned_to = ${f.owner}`);
  if (f.tag) ps.push(db`exists (select 1 from unnest(coalesce(x.tags, '{}'::text[])) tg where lower(tg) = ${f.tag})`);
  if (needsLocal(f)) {
    const hour = db`extract(hour from (x.lead_at at time zone x.tzn))::int`, dow = db`extract(dow from (x.lead_at at time zone x.tzn))::int`;
    if (f.dow !== undefined) ps.push(db`${dow} = ${f.dow}`);
    const lo = f.hourFrom ?? 0, hi = f.hourTo ?? 23;
    ps.push(lo <= hi ? db`(${hour} >= ${lo} and ${hour} <= ${hi})` : db`(${hour} >= ${lo} or ${hour} <= ${hi})`);
  }
  if (f.status) ps.push(db`x.status = ${f.status}`);
  if (f.bucket) {
    const b = f.bucket;
    ps.push(b === "none" ? db`x.resp_s is null` : b === "<1m" ? db`x.resp_s < 60` : b === "1-5m" ? db`(x.resp_s >= 60 and x.resp_s < 300)` : b === "5-15m" ? db`(x.resp_s >= 300 and x.resp_s < 900)`
      : b === "15-60m" ? db`(x.resp_s >= 900 and x.resp_s < 3600)` : b === "1-4h" ? db`(x.resp_s >= 3600 and x.resp_s < 14400)` : db`x.resp_s >= 14400`);
  }
  if (f.channel) ps.push(db`exists (select 1 from touch_events e where e.installation_id = ${s.installationId} and e.location_id = x.location_id and e.contact_id = x.contact_id and e.direction = 'outbound' and not e.automated and e.channel = ${f.channel} and e.at > ${new Date(s.now - 60 * DAY)})`);
  return ps.reduce((acc, p, i) => (i === 0 ? p : db`${acc} and ${p}`));
}
const optsFor = (f: LeadFilter, extra: SetOpts = {}): SetOpts => ({ ...extra, local: extra.local || needsLocal(f) });
export const filtered = (db: Db, s: Scope, f: LeadFilter, extra: SetOpts = {}) => ({ set: leadSet(db, s, optsFor(f, extra)), where: filterSql(db, f, s) });

/** True when any touch event is stored in the last 60 days for the scope (journeyReach then trusts "sent something back"). */
export async function eventsRecorded(db: Db, s: Scope): Promise<boolean> {
  const r = await db`select 1 from touch_events where installation_id = ${s.installationId} and at > ${new Date(s.now - 60 * DAY)} ${s.allowed ? db`and location_id = any(${s.allowed}::text[])` : db``} limit 1`.catch(() => []);
  return r.length > 0;
}

// ---------------------------------------------------------------- by day, velocity

export async function dayCountsSql(db: Db, s: Scope, f: LeadFilter) {
  const { set, where } = filtered(db, s, f);
  const rows = await db`select to_char(x.lead_at at time zone 'UTC', 'YYYY-MM-DD') ld, to_char(x.touch_at at time zone 'UTC', 'YYYY-MM-DD') td, count(*)::int n from ${set} where ${where} group by 1, 2`;
  const days: Array<{ day: string; n: number }> = []; const idx = new Map<string, number>();
  for (let t = Math.floor((s.fromMs + 1) / DAY) * DAY; t < s.toMs && days.length < 120; t += DAY) { const d = new Date(t).toISOString().slice(0, 10); idx.set(d, days.length); days.push({ day: d, n: 0 }); }
  const leadsByDay = days.map((d) => ({ ...d })), repliesByDay = days.map((d) => ({ ...d }));
  let total = 0;
  for (const r of rows) {
    const n = r.n as number; total += n;
    const a = idx.get(r.ld as string); if (a !== undefined) leadsByDay[a].n += n;
    const b = r.td ? idx.get(r.td as string) : undefined; if (b !== undefined) repliesByDay[b].n += n;
  }
  return { total, leadsByDay, repliesByDay };
}

/** Closing velocity: the median days from a lead arriving to its first booking (speed6 `velocity`: 5 booked leads minimum). */
export async function velocitySql(db: Db, s: Scope, f: LeadFilter) {
  const { set, where } = filtered(db, s, f);
  const r = (await db`
    select count(*)::int n, percentile_cont(0.5) within group (order by greatest(0, extract(epoch from (b.first_at - x.lead_at)) / 86400.0)) med
    from ${set} join lateral (select min(coalesce(a.created_remote_at, a.start_at)) first_at from cached_appointments a
      where a.installation_id = ${s.installationId} and a.location_id = x.location_id and a.contact_id = x.contact_id and a.status not in ('cancelled', 'invalid')) b on b.first_at is not null
    where ${where} and b.first_at >= x.lead_at - interval '60 seconds'`.catch(() => [{ n: 0, med: null }]))[0] ?? { n: 0, med: null };
  const n = Number(r.n ?? 0);
  return { days: n >= 5 && r.med !== null ? Math.round(Number(r.med) * 10) / 10 : null, n };
}

// ---------------------------------------------------------------- waiting leads: reasons and ready to act

export type ReasonCount = { key: string; n: number };
/** The main reason each waiting lead (nobody touched it yet) waits, first match wins (speed6 `delayReason`), counted and sampled in the database. */
export async function reasonsSql(db: Db, s: Scope, f: LeadFilter) {
  const { set, where } = filtered(db, s, f, { local: true });
  const h = DEFAULT_HOURS;
  const rows = await db`
    with w as (
      select x.*, case when x.assigned_to is not null then count(*) over (partition by x.assigned_to) end held from ${set} where x.touch_at is null and ${where}
    ), busy as (
      select greatest(3, ceil(coalesce(avg(held), 0) * 1.5))::int busy_at from (select distinct assigned_to, held from w where assigned_to is not null) d
    ), r as (
      select w.*, case
        when w.dnd then 'dnd' when w.assigned_to is null then 'no_owner' when w.held >= busy.busy_at then 'owner_busy'
        when (extract(dow from (w.lead_at at time zone w.tzn)) in (0, 6) or extract(hour from (w.lead_at at time zone w.tzn)) < ${h.start} or extract(hour from (w.lead_at at time zone w.tzn)) >= ${h.end}) then 'after_hours'
        when nullif(w.phone, '') is null then 'no_phone' else 'unclear' end reason
      from w cross join busy
    ), c as (select reason, count(*)::int n from r group by 1),
    smp as (select r.*, row_number() over (partition by reason order by lead_at desc, location_id, contact_id) rn from r)
    select 'count' kind, c.reason, c.n, null::jsonb row from c
    union all select 'row', smp.reason, null, to_jsonb(smp) - 'tags' from smp where rn <= ${SAMPLE}`;
  const counts = new Map<string, number>(); const sample = new Map<string, Array<{ row: LoadedRow; status: "within" | "late" | "waiting" }>>();
  for (const r of rows) {
    if (r.kind === "count") { counts.set(r.reason as string, Number(r.n)); continue; }
    const j = r.row as Record<string, unknown>;
    const list = sample.get(r.reason as string) ?? []; list.push({ row: rowOfSql(jsonRow(j), s.targetMinutes), status: ((j.status as string | null) ?? "waiting") as "within" | "late" | "waiting" }); sample.set(r.reason as string, list);
  }
  return { counts, sample };
}

/** to_jsonb turns timestamps into strings: give them back as dates so rowOfSql reads one shape. */
export function jsonRow(j: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...j };
  for (const k of ["lead_at", "raw_lead_at", "touch_at", "auto_touch_at", "human_touch_at"]) if (typeof out[k] === "string") out[k] = new Date(out[k] as string);
  return out;
}

/** "Ready to act now": waiting leads with nobody touching them and no booking, ranked by open money then wait (speed6 `readyScore`), the top `n`. */
export async function readySql(db: Db, s: Scope, f: LeadFilter, n: number) {
  const { set, where } = filtered(db, s, f, { journey: { recorded: false } });
  const rows = await db`
    with d as (
      select o.location_id, o.contact_id, sum(o.monetary_value)::float8 dollars from cached_opportunities o ${dealScopeJoins()}
      where o.installation_id = ${s.installationId} and o.status = 'open' and ${countedInScope()} ${s.allowed ? db`and o.location_id = any(${s.allowed}::text[])` : db``} group by 1, 2
    )
    select x.*, coalesce(d.dollars, 0) dollars,
      round((log(greatest(0, coalesce(d.dollars, 0)) + 1) * 10 + least(40, (greatest(0, round(extract(epoch from (${new Date(s.now)}::timestamptz - x.lead_at)) / 60)) / 1440.0) * 4)) * 10) / 10 score
    from ${set} left join d on d.location_id = x.location_id and d.contact_id = x.contact_id
    where x.touch_at is null and ${where} and not x.b_booked order by score desc, x.lead_at desc, x.location_id, x.contact_id limit ${n}`;
  return rows.map((r) => ({ row: rowOfSql(r, s.targetMinutes), status: ((r.status as string | null) ?? "waiting") as "within" | "late" | "waiting", dollars: Number(r.dollars) }));
}

export async function waitingCountSql(db: Db, s: Scope, f: LeadFilter) {
  const { set, where } = filtered(db, s, f);
  // The same people the "Waiting for a first reply" list opens (status waiting), so "See all N" and the rows agree.
  return Number((await db`select count(*)::int n from ${set} where x.touch_at is null and x.status = 'waiting' and ${where}`)[0]?.n ?? 0);
}

// ---------------------------------------------------------------- the person table

export type PersonAgg = { owner: string | null; loc: string; leads: number; replied: number; booked: number; showed: number };
export async function personAgg(db: Db, s: Scope, f: LeadFilter, recorded: boolean) {
  const { set, where } = filtered(db, s, f, { journey: { recorded } });
  const rows = await db`
    with b as materialized (select x.* from ${set} where ${where}),
    a as (select assigned_to, min(location_id) loc, count(*)::int leads, count(*) filter (where r_replied)::int replied, count(*) filter (where r_booked)::int booked, count(*) filter (where r_showed)::int showed from b group by assigned_to),
    smp as (select b.*, row_number() over (partition by coalesce(assigned_to, '__none') order by lead_at desc, location_id, contact_id) rn from b)
    select 'agg' kind, a.assigned_to owner, a.loc, a.leads, a.replied, a.booked, a.showed, null::jsonb row from a
    union all select 'row', smp.assigned_to, smp.location_id, null, null, null, null, to_jsonb(smp) - 'tags' from smp where rn <= ${SAMPLE}`;
  const aggs: PersonAgg[] = []; const sample = new Map<string, Array<{ row: LoadedRow; status: "within" | "late" | "waiting"; replied: boolean; booked: boolean; showed: boolean }>>();
  for (const r of rows) {
    if (r.kind === "agg") { aggs.push({ owner: (r.owner as string | null) ?? null, loc: r.loc as string, leads: Number(r.leads), replied: Number(r.replied), booked: Number(r.booked), showed: Number(r.showed) }); continue; }
    const j = r.row as Record<string, unknown>; const k = (r.owner as string | null) ?? "__none";
    const list = sample.get(k) ?? []; list.push({ row: rowOfSql(jsonRow(j), s.targetMinutes), status: ((j.status as string | null) ?? "waiting") as "within" | "late" | "waiting", replied: j.r_replied === true, booked: j.r_booked === true, showed: j.r_showed === true }); sample.set(k, list);
  }
  return { aggs, sample };
}

// ---------------------------------------------------------------- the journey

export async function journeySql(db: Db, s: Scope, f: LeadFilter, recorded: boolean): Promise<JourneyStep[]> {
  const { set, where } = filtered(db, s, f, { journey: { recorded } });
  const r = (await db`
    select count(*)::int arrived, count(*) filter (where x.r_touched)::int touched, count(*) filter (where x.r_replied)::int replied, count(*) filter (where x.r_booked)::int booked,
      count(*) filter (where x.r_showed)::int showed, count(*) filter (where x.r_won)::int won,
      percentile_disc(0.5) within group (order by x.resp_s) filter (where x.r_touched and x.resp_s is not null) med_touch,
      percentile_disc(0.5) within group (order by x.first_s) filter (where x.r_replied and x.first_s is not null) med_reply
    from ${set} where ${where}`)[0] ?? {};
  const out: JourneyStep[] = []; let prev = 0;
  STEPS.forEach((step, i) => {
    const count = Number(r[step] ?? 0);
    out.push({ step, label: STEP_LABEL[step], count, dropped: i === 0 ? 0 : Math.max(0, prev - count), dropShare: i === 0 || prev === 0 ? null : (prev - count) / prev,
      medianFromPrev: step === "touched" && r.med_touch !== null ? Number(r.med_touch) : step === "replied" && r.med_reply !== null ? Number(r.med_reply) : null });
    prev = count;
  });
  return out;
}

export async function journeyMembersSql(db: Db, s: Scope, f: LeadFilter, recorded: boolean, step: Step, dropped: boolean, n: number) {
  const { set, where } = filtered(db, s, f, { journey: { recorded } });
  const i = STEPS.indexOf(step);
  const col = (st: Step) => db`${db.unsafe(st === "arrived" ? "true" : `x.r_${st === "touched" ? "touched" : st}`)}`;
  const pred = dropped ? (i > 0 ? db`(${col(STEPS[i - 1])} and not ${col(step)})` : db`false`) : col(step);
  const c = Number((await db`select count(*)::int n from ${set} where ${where} and ${pred}`)[0]?.n ?? 0);
  const rows = c === 0 ? [] : await db`select x.* from ${set} where ${where} and ${pred} order by x.lead_at desc, x.location_id, x.contact_id limit ${n}`;
  return { count: c, rows: rows.map((r) => ({ row: rowOfSql(r, s.targetMinutes), status: ((r.status as string | null) ?? "waiting") as "within" | "late" | "waiting" })) };
}

// ---------------------------------------------------------------- Race, booking, coverage, proof

export type ScoreAgg = { loc: string | null; judged: number; within: number; secs: number | null; /** Leads that got a first reply (the typical reply time is worked out from these only). */ answered: number };
/** The speed score inputs per account and overall (speed-v4 `speedScore`): judged leads, those answered in time, the typical first reply. */
export async function scoresSql(db: Db, s: Scope, f: LeadFilter): Promise<ScoreAgg[]> {
  const { set, where } = filtered(db, s, f);
  const rows = await db`select x.location_id, grouping(x.location_id)::int g, count(*) filter (where x.status is not null)::int judged, count(*) filter (where x.status = 'within')::int w_in, count(*) filter (where x.resp_s is not null)::int answered,
    percentile_disc(0.5) within group (order by x.resp_s) filter (where x.status is not null) med from ${set} where ${where} group by grouping sets ((x.location_id), ())`;
  return rows.map((r) => ({ loc: Number(r.g) === 1 ? null : (r.location_id as string), judged: Number(r.judged), within: Number(r.w_in), secs: r.med === null ? null : Number(r.med), answered: Number(r.answered) }));
}

/** Leads past their target (late or still waiting) in the scope: the count, those nobody touched, per account, and the counted open deals of those people. */
export async function leakSql(db: Db, s: Scope, f: LeadFilter) {
  const { set, where } = filtered(db, s, f);
  const rows = await db`select x.location_id, grouping(x.location_id)::int g, count(*)::int leaked, count(*) filter (where x.touch_at is null)::int no_touch
    from ${set} where x.status in ('late', 'waiting') and ${where} group by grouping sets ((x.location_id), ())`;
  const byLoc = new Map<string, number>(); let leaked = 0, noTouch = 0;
  for (const r of rows) { if (Number(r.g) === 1) { leaked = Number(r.leaked); noTouch = Number(r.no_touch); } else byLoc.set(r.location_id as string, Number(r.leaked)); }
  const d = (await db`select count(*)::int deals, count(distinct (o.location_id || ':' || o.contact_id))::int people, coalesce(sum(o.monetary_value), 0)::float8 dollars
    from ${set} join cached_opportunities o on o.installation_id = ${s.installationId} and o.location_id = x.location_id and o.contact_id = x.contact_id and o.status = 'open' ${dealScopeJoins()}
    where x.status in ('late', 'waiting') and ${where} and ${countedInScope()}`.catch(() => [{} as Row]))[0] ?? {};
  return { leaked, noTouch, byLoc, deals: Number(d.deals ?? 0), people: Number(d.people ?? 0), dollars: Number(d.dollars ?? 0) };
}

/** The newest leads of the window (the live race feed), `n` rows. */
export async function feedSql(db: Db, s: Scope, f: LeadFilter, n: number) {
  const { set, where } = filtered(db, s, f);
  const rows = await db`select x.* from ${set} where ${where} order by x.lead_at desc, x.location_id, x.contact_id limit ${n}`;
  return rows.map((r) => ({ row: rowOfSql(r, s.targetMinutes), status: ((r.status as string | null) ?? "waiting") as "within" | "late" | "waiting" }));
}

/** Round robin: for each account, who replied in the window and how many leads each holds (open = nobody touched yet and not answered in time). */
export async function holdersSql(db: Db, s: Scope, locs: string[]) {
  if (locs.length === 0) return [] as Array<{ loc: string; userId: string; open: number; recent: number }>;
  const rows = await db`
    with people as (select distinct x.location_id, x.touch_user_id u from ${leadSet(db, s)} where x.touch_user_id is not null and x.touch_user_id <> '' and x.location_id = any(${locs}::text[])),
    held as (select x.location_id, x.assigned_to u, count(*) filter (where x.touch_at is null and x.status is distinct from 'within')::int open, count(*)::int recent
      from ${leadSet(db, s)} where x.assigned_to is not null and x.location_id = any(${locs}::text[]) group by 1, 2)
    select p.location_id, p.u, coalesce(h.open, 0)::int open, coalesce(h.recent, 0)::int recent from people p left join held h on h.location_id = p.location_id and h.u = p.u`;
  return rows.map((r) => ({ loc: r.location_id as string, userId: r.u as string, open: Number(r.open), recent: Number(r.recent) }));
}

/** The booking chart's counts per first-reply bucket: leads and those booked within 14 days (speed5 `bookingByReplyTime`). */
export async function bookingSql(db: Db, s: Scope) {
  const whens = BOOKING_BUCKETS.filter((b) => b.key !== "none" && b.to !== Infinity).map((b) => `when x.resp_s <= ${b.to} then '${b.key}'`).join(" ");
  const key = db.unsafe(`case when x.resp_s is null then 'none' ${whens} else 'late' end`);
  const rows = await db`
    select ${key} bucket, count(*)::int leads, count(*) filter (where bk.first_at is not null and bk.first_at >= x.lead_at - interval '60 seconds' and bk.first_at <= x.lead_at + interval '14 days')::int booked
    from ${leadSet(db, s)} left join lateral (select min(coalesce(a.created_remote_at, a.start_at)) first_at from cached_appointments a
      where a.installation_id = ${s.installationId} and a.location_id = x.location_id and a.contact_id = x.contact_id and a.status not in ('cancelled', 'invalid')) bk on true
    group by 1`;
  const counts = new Map<BookingKey, { leads: number; booked: number }>(rows.map((r) => [r.bucket as BookingKey, { leads: Number(r.leads), booked: Number(r.booked) }]));
  const rec = (await db`select exists (select 1 from cached_appointments where installation_id = ${s.installationId} and contact_id is not null and status not in ('cancelled', 'invalid') ${s.allowed ? db`and location_id = any(${s.allowed}::text[])` : db``}) e`.catch(() => [{ e: false }]))[0]?.e === true;
  return { ...bookingFromCounts(counts), appointmentsRecorded: rec };
}

/** Per account: leads this period and last, and the speed score inputs of each (the printable proof). */
export async function proofSql(db: Db, s: Scope, windowDays = 30) {
  const cut = new Date(s.now - windowDays * DAY);
  const rows = await db`select x.location_id, (x.lead_at > ${cut}) cur, count(*) filter (where x.status is not null)::int judged, count(*) filter (where x.status = 'within')::int w_in, count(*)::int leads,
    percentile_disc(0.5) within group (order by x.resp_s) filter (where x.status is not null) med,
    count(*) filter (where x.touch_at is not null and x.lead_at > ${new Date(s.now - 30 * DAY)} and x.touch_at - x.lead_at <= interval '300 seconds')::int q5,
    count(*) filter (where x.touch_at is not null and x.lead_at > ${new Date(s.now - 30 * DAY)})::int replied
    from ${leadSet(db, s)} where x.lead_at > ${new Date(s.now - 2 * windowDays * DAY)} group by 1, 2`;
  return rows.map((r) => ({ loc: r.location_id as string, cur: r.cur === true, judged: Number(r.judged), within: Number(r.w_in), leads: Number(r.leads), med: r.med === null ? null : Number(r.med), q5: Number(r.q5), replied: Number(r.replied) }));
}

/** Coverage from the lead rows: lost at night (after hours, no person touch in 12 h), after-hours cover, the owner counts for the routing check. */
export async function coverageSql(db: Db, s: Scope, f: LeadFilter) {
  const { set, where } = filtered(db, s, f, { local: true });
  const h = DEFAULT_HOURS;
  const after = db`(extract(dow from (x.lead_at at time zone x.tzn)) in (0, 6) or extract(hour from (x.lead_at at time zone x.tzn)) < ${h.start} or extract(hour from (x.lead_at at time zone x.tzn)) >= ${h.end})`;
  const lostP = db`(${after} and (case when x.touch_at is null then extract(epoch from (${new Date(s.now)}::timestamptz - x.lead_at)) > 43200 else extract(epoch from (x.touch_at - x.lead_at)) > 43200 end))`;
  const agg = (await db`select count(*) filter (where ${after})::int after_leads, count(*) filter (where ${after} and x.touch_at is not null and extract(epoch from (x.touch_at - x.lead_at)) <= 43200)::int answered,
    count(*) filter (where ${lostP})::int lost from ${set} where ${where}`)[0] ?? {};
  const cells = await db`select extract(dow from (x.lead_at at time zone x.tzn))::int dow, extract(hour from (x.lead_at at time zone x.tzn))::int hr, count(*)::int n from ${set} where ${where} and ${lostP} group by 1, 2 having count(*) >= 2 order by 3 desc limit 8`;
  const lostByLoc = await db`select x.location_id, count(*)::int n from ${set} where ${where} and ${lostP} group by 1`;
  const lostRows = await db`select x.* from ${set} where ${where} and ${lostP} order by x.lead_at desc limit 50`;
  const owned = await db`select x.assigned_to u, count(*)::int n from ${set} where ${where} and x.assigned_to is not null group by 1`;
  const repliers = await db`select distinct x.touch_user_id u from ${set} where ${where} and x.touch_user_id is not null and x.touch_user_id <> ''`;
  // Dollars of the lost leads: counted deals of those people.
  const d = (await db`select count(distinct (o.location_id || ':' || o.contact_id))::int people, coalesce(sum(o.monetary_value), 0)::float8 dollars
    from ${set} join cached_opportunities o on o.installation_id = ${s.installationId} and o.location_id = x.location_id and o.contact_id = x.contact_id and o.status = 'open' ${dealScopeJoins()}
    where ${where} and ${lostP} and ${countedInScope()}`.catch(() => [{} as Row]))[0] ?? {};
  return {
    afterLeads: Number(agg.after_leads ?? 0), answeredSameNight: Number(agg.answered ?? 0), lost: Number(agg.lost ?? 0),
    hoursToCover: cells.map((r) => ({ dow: Number(r.dow), hour: Number(r.hr), leads: Number(r.n) })),
    lostByLoc: new Map(lostByLoc.map((r) => [r.location_id as string, Number(r.n)])),
    lostRows: lostRows.map((r) => ({ row: rowOfSql(r, s.targetMinutes), status: ((r.status as string | null) ?? "waiting") as "within" | "late" | "waiting" })),
    owned: new Map(owned.map((r) => [r.u as string, Number(r.n)])), repliers: new Set(repliers.map((r) => r.u as string)),
    lostDollars: Math.round(Number(d.dollars ?? 0)), lostPeopleWithDeals: Number(d.people ?? 0),
  };
}

export { filterActive };
