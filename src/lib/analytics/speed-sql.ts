import type { PendingQuery, Row } from "postgres";
import { sql } from "../db";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";
import { MIN_FOR_MEDIAN, MIN_PER_PERSON, type AutoVsHuman, type Summary } from "./speed-intel";
import type { LoadedRow } from "./speed-parts";
import { properCase } from "./people-labels";
import type { LeadSort, LeadStatusFilter } from "./speed-v2";

// Speed to lead at scale (stage SPEED7): every figure is an SQL aggregate over lead_touches, never a read of every lead. One agency with 80+ client accounts and 100,000+ leads per
// account is counted exactly by ONE grouped query per card (grouping sets give each account and the total in one pass); lists are cut in the database (where, order, limit, offset).
// The judging rule is the same as speed-intel.ts `judge` (within / late / waiting / not judged yet) written once in `STATUS` below; tests/unit/speed7-scale-db.test.ts checks the two agree.
type Db = ReturnType<typeof sql>;
const DAY = 86_400_000;

export type Scope = { installationId: string; allowed: string[] | null; targetMinutes: number; now: number; fromMs: number; toMs: number; targetsReady: boolean };

const nameOf = (full: unknown, email: unknown, phone: unknown): string => {
  const pick = [full, email, phone].find((v) => typeof v === "string" && v.trim() !== "") as string | undefined;
  return pick ? properCase(pick) : "Unnamed contact";
};

export type SetOpts = {
  /** Adds the lead's local hour and weekday (needs the account's time zone; an unknown zone reads as UTC). */ local?: boolean;
  /** Adds what became of the lead: booked, showed, won, and the journey steps it reached. `recorded` says whether any touch events are stored (journeyReach). */ journey?: { recorded: boolean };
};

/** The lead set of a scope as a derived table `x`, with the judged status and the response time already worked out. */
export function leadSet(db: Db, s: Scope, o: SetOpts = {}) {
  const own = s.targetsReady ? db`l.speed_target_minutes` : db`null::int`;
  const inner = db`(
    select y.*, case when y.resp_s is not null then (case when y.resp_s <= y.target_s then 'within' else 'late' end)
      when extract(epoch from (${new Date(s.now)}::timestamptz - y.lead_at)) > y.target_s then 'waiting' end status
    from (
      select t.location_id, t.contact_id, coalesce(t.clock_start, t.lead_at) lead_at, t.lead_at raw_lead_at, t.touch_at, t.touch_user_id, t.auto_touch_at, t.human_touch_at, t.read_version,
        c.source, c.tags, c.full_name, c.email, c.phone, c.dnd, l.timezone, l.name account_name, nullif(c.assigned_to, '') assigned_to, ${own} own_target,
        ${o.local ? db`coalesce(z.name, 'UTC')` : db`'UTC'`} tzn,
        coalesce(${own}, ${s.targetMinutes}::int) * 60 target_s,
        case when t.touch_at is not null then greatest(0, round(extract(epoch from (t.touch_at - coalesce(t.clock_start, t.lead_at)))))::int end resp_s
      from lead_touches t
      left join cached_contacts c on c.installation_id = t.installation_id and c.location_id = t.location_id and c.contact_id = t.contact_id
      join locations l on l.installation_id = t.installation_id and l.location_id = t.location_id and not l.ignored
      ${o.local ? db`left join pg_timezone_names z on z.name = l.timezone` : db``}
      where t.installation_id = ${s.installationId} and t.excluded is null and t.lead_at > ${new Date(s.fromMs)} and t.lead_at < ${new Date(s.toMs)}
        ${s.allowed ? db`and t.location_id = any(${s.allowed}::text[])` : db``}
    ) y
  )`;
  if (!o.journey) return db`${inner} x`;
  // What became of each lead, from per-contact aggregates joined once (hash joins), never a lookup per lead: booked = the latest booking that is not cancelled starts after the lead arrived (the same
  // as "some such booking starts after it"), showed likewise, won = the contact has a won deal, replied = something came back after the first person touch.
  const al = s.allowed ? db`and location_id = any(${s.allowed}::text[])` : db``;
  return db`(
    select v.*, v.touch_at is not null r_touched,
      v.touch_at is not null and ((${o.journey.recorded} and v.b_rep) or v.b_booked or v.b_showed or v.b_won) r_replied,
      v.touch_at is not null and v.b_booked r_booked, (v.touch_at is not null and v.b_booked and v.b_showed) r_showed, (v.touch_at is not null and v.b_booked and v.b_showed and v.b_won) r_won
    from (
      select w.*, coalesce(ap.mb >= w.raw_lead_at, false) b_booked, coalesce(ap.ms >= w.raw_lead_at, false) b_showed, wn.contact_id is not null b_won,
        coalesce(w.touch_at is not null and ev.last_in > w.touch_at, false) b_rep,
        case when w.touch_at is not null and ev.last_in > w.touch_at then (select min(round(extract(epoch from (e.at - w.touch_at)))::int) from touch_events e
          where e.installation_id = ${s.installationId} and e.location_id = w.location_id and e.contact_id = w.contact_id and e.direction = 'inbound' and e.at > w.touch_at and e.at > ${new Date(s.now - 60 * DAY)}) end first_s
      from ${inner} w
      left join (select location_id, contact_id, max(start_at) filter (where coalesce(status, '') not in ('cancelled', 'canceled', 'invalid')) mb, max(start_at) filter (where status = 'showed') ms
        from cached_appointments where installation_id = ${s.installationId} ${al} group by 1, 2) ap on ap.location_id = w.location_id and ap.contact_id = w.contact_id
      left join (select location_id, contact_id from cached_opportunities where installation_id = ${s.installationId} and status = 'won' ${al} group by 1, 2) wn on wn.location_id = w.location_id and wn.contact_id = w.contact_id
      left join (select location_id, contact_id, max(at) last_in from touch_events where installation_id = ${s.installationId} and direction = 'inbound' and at > ${new Date(s.now - 60 * DAY)} ${al} group by 1, 2) ev
        on ev.location_id = w.location_id and ev.contact_id = w.contact_id
    ) v
  ) x`;
}

export function rowOfSql(r: Record<string, unknown>, defaultTarget: number): LoadedRow {
  const ms = (v: unknown) => (v instanceof Date ? v.getTime() : null);
  return {
    locationId: r.location_id as string, contactId: r.contact_id as string, leadAt: ms(r.lead_at) ?? 0, touchAt: ms(r.touch_at), userId: (r.touch_user_id as string | null) ?? null,
    source: (r.source as string | null) ?? null, tags: (r.tags as string[] | null) ?? [], assigned: r.assigned_to !== null && r.assigned_to !== undefined,
    autoAt: ms(r.auto_touch_at), humanAt: ms(r.human_touch_at), detailed: Number(r.read_version ?? 0) === 1,
    name: nameOf(r.full_name, r.email, r.phone), assignedTo: (r.assigned_to as string | null) ?? null,
    phone: (r.phone as string | null) || null, email: (r.email as string | null) || null, dnd: r.dnd === true, timeZone: (r.timezone as string | null) || null,
    targetMinutes: r.own_target === null || r.own_target === undefined ? null : Number(r.own_target) || defaultTarget,
  };
}

const summaryOf = (r: Record<string, unknown>): Summary => {
  const n = (k: string) => Number(r[k] ?? 0);
  const within = n("w_in"), late = n("w_late"), waiting = n("w_wait"), answered = n("answered");
  const judged = within + late + waiting;
  return {
    leads: judged, answered, withinTarget: within, answeredLate: late, stillWaiting: waiting,
    hitRate: judged >= MIN_FOR_MEDIAN ? within / judged : null,
    medianSeconds: answered >= MIN_FOR_MEDIAN ? Number(r.med) : null, p90Seconds: answered >= MIN_FOR_MEDIAN ? Number(r.p90) : null,
  };
};

/** ONE grouped query: the summary of every account and the overall summary of the scope. */
export async function summaries(db: Db, s: Scope): Promise<{ overall: Summary; byLoc: Map<string, Summary> }> {
  const rows = await db`
    select x.location_id, grouping(x.location_id)::int g,
      count(*) filter (where x.status = 'within')::int w_in, count(*) filter (where x.status = 'late')::int w_late, count(*) filter (where x.status = 'waiting')::int w_wait,
      count(x.resp_s)::int answered, percentile_disc(0.5) within group (order by x.resp_s) med, percentile_disc(0.9) within group (order by x.resp_s) p90
    from ${leadSet(db, s)} group by grouping sets ((x.location_id), ())`;
  const byLoc = new Map<string, Summary>(); let overall = summaryOf({});
  for (const r of rows) { if (Number(r.g) === 1) overall = summaryOf(r); else byLoc.set(r.location_id as string, summaryOf(r)); }
  return { overall, byLoc };
}

/** Eight weekly bars in one query (week 0 is the latest). Same rule as speed-intel `weeklyTrend`: judged leads only, a percentage from 5 judged leads. */
export async function weeklyBars(db: Db, s: Scope, weeks = 8) {
  const rows = await db`
    select (ceil(extract(epoch from (${new Date(s.now)}::timestamptz - x.lead_at)) / 604800.0)::int - 1) wk, count(*)::int judged, count(*) filter (where x.status = 'within')::int w_in
    from ${leadSet(db, s)} where x.status is not null and x.lead_at <= ${new Date(s.now)} group by 1`;
  const by = new Map(rows.map((r) => [Number(r.wk), r]));
  const out: Array<{ weekStart: number; leads: number; withinTarget: number; hitRate: number | null }> = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const r = by.get(i); const judged = Number(r?.judged ?? 0), within = Number(r?.w_in ?? 0);
    out.push({ weekStart: s.now - (i + 1) * 7 * DAY, leads: judged, withinTarget: within, hitRate: judged >= 5 ? within / judged : null });
  }
  return out;
}

/** The people waiting right now (the scope is the last 14 days): the counting rule behind Today's number, and the count per client in the same pass. */
export async function waitingNow(db: Db, s: Scope) {
  const rows = await db`
    select x.location_id, grouping(x.location_id)::int g, count(*)::int waiting, count(*) filter (where extract(epoch from (${new Date(s.now)}::timestamptz - x.lead_at)) > 259200)::int never,
      count(*) filter (where x.assigned_to is null)::int no_owner, max(extract(epoch from (${new Date(s.now)}::timestamptz - x.lead_at)) / 60)::float8 oldest
    from ${leadSet(db, s)} where x.status = 'waiting' group by grouping sets ((x.location_id), ())`;
  const byAccount = new Map<string, number>(); let facts = { waiting: 0, never: 0, noOwner: 0, accountsWithWaiting: 0, oldestMinutes: null as number | null };
  for (const r of rows) {
    if (Number(r.g) === 1) facts = { ...facts, waiting: Number(r.waiting), never: Number(r.never), noOwner: Number(r.no_owner), oldestMinutes: r.oldest === null ? null : Math.round(Number(r.oldest)) };
    else byAccount.set(r.location_id as string, Number(r.waiting));
  }
  facts.accountsWithWaiting = byAccount.size;
  return { facts, byAccount };
}

/** The counted open deals of everyone who is waiting, in one aggregate (the same counted-deal rule as every dollar figure). */
export async function waitingDeals(db: Db, s: Scope) {
  const r = await db`
    select count(*)::int deals, count(distinct (o.location_id || ':' || o.contact_id))::int people, coalesce(sum(o.monetary_value), 0)::float8 dollars
    from ${leadSet(db, s)} join cached_opportunities o on o.installation_id = ${s.installationId} and o.location_id = x.location_id and o.contact_id = x.contact_id and o.status = 'open'
    ${dealScopeJoins()} where x.status = 'waiting' and ${countedInScope()}`;
  return { deals: Number(r[0]?.deals ?? 0), peopleWithDeals: Number(r[0]?.people ?? 0), dollars: Math.round(Number(r[0]?.dollars ?? 0)) };
}

/** Per-person first replies in the scope: replies and the typical time, one grouped query (the people table and the "who should reply" suggestion). */
export async function peopleGrouped(db: Db, s: Scope, locs?: string[]) {
  const rows = await db`
    select x.touch_user_id user_id, min(x.location_id) loc, ${locs ? db`x.location_id` : db`''`} per_loc, count(*)::int n, percentile_disc(0.5) within group (order by x.resp_s) med
    from ${leadSet(db, s)} where x.resp_s is not null and x.touch_user_id is not null and x.touch_user_id <> '' ${locs ? db`and x.location_id = any(${locs}::text[])` : db``}
    group by x.touch_user_id ${locs ? db`, x.location_id` : db``}`;
  return rows.map((r) => ({ userId: r.user_id as string, locationId: (locs ? r.per_loc : r.loc) as string, replies: Number(r.n), ranked: Number(r.n) >= MIN_PER_PERSON, medianSeconds: Number(r.n) >= MIN_PER_PERSON ? Number(r.med) : null }));
}

/** For leads nobody owns: the person in each listed account who replies fastest (a display, never an assignment). */
export async function suggestions(db: Db, s: Scope, locs: string[]) {
  const out = new Map<string, { userId: string; medianSeconds: number; replies: number } | null>(locs.map((l) => [l, null]));
  if (locs.length === 0) return out;
  for (const p of (await peopleGrouped(db, s, locs)).filter((p) => p.ranked && p.medianSeconds !== null)) {
    const cur = out.get(p.locationId);
    const better = !cur || (p.medianSeconds as number) < cur.medianSeconds || ((p.medianSeconds as number) === cur.medianSeconds && (p.replies > cur.replies || (p.replies === cur.replies && p.userId < cur.userId)));
    if (better) out.set(p.locationId, { userId: p.userId, medianSeconds: p.medianSeconds as number, replies: p.replies });
  }
  return out;
}

/** The automatic first message against the person's reply (speed-intel `autoVsHuman`), over judged-or-not leads of the scope, in one aggregate. */
export async function autoVsHumanSql(db: Db, s: Scope): Promise<AutoVsHuman> {
  const r = (await db`
    select count(*)::int total, count(*) filter (where x.read_version = 1)::int read,
      count(*) filter (where x.read_version = 1 and x.auto_touch_at is not null)::int auto_sent,
      count(*) filter (where x.read_version = 1 and x.auto_touch_at is not null and x.human_touch_at is not null)::int also_person,
      count(*) filter (where x.read_version = 1 and x.auto_touch_at is not null and x.human_touch_at is null and extract(epoch from (${new Date(s.now)}::timestamptz - x.lead_at)) > x.target_s)::int only_auto,
      count(*) filter (where x.read_version = 1 and x.auto_touch_at is null and x.human_touch_at is not null)::int person_only,
      count(*) filter (where x.read_version = 1 and x.auto_touch_at is not null)::int auto_n,
      percentile_disc(0.5) within group (order by greatest(0, round(extract(epoch from (x.auto_touch_at - x.lead_at))))) filter (where x.read_version = 1 and x.auto_touch_at is not null) auto_med,
      count(*) filter (where x.read_version = 1 and x.human_touch_at is not null)::int person_n,
      percentile_disc(0.5) within group (order by greatest(0, round(extract(epoch from (x.human_touch_at - x.lead_at))))) filter (where x.read_version = 1 and x.human_touch_at is not null) person_med
    from ${leadSet(db, s)}`)[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    read: n("read"), notRead: n("total") - n("read"), autoSent: n("auto_sent"), alsoPerson: n("also_person"), onlyAutoPastTarget: n("only_auto"), personOnly: n("person_only"),
    autoMedianSeconds: n("auto_n") >= MIN_FOR_MEDIAN ? Number(r.auto_med) : null, personMedianSeconds: n("person_n") >= MIN_FOR_MEDIAN ? Number(r.person_med) : null,
  };
}

const BLANK_SOURCE = (db: Db) => db`nullif(btrim(regexp_replace(coalesce(x.source, ''), '\s+', ' ', 'g')), '') is null`;
/** How many judged leads have no source (speed-intel `unknownSource`). */
export async function noSourceSql(db: Db, s: Scope) {
  const r = (await db`select count(*)::int total, count(*) filter (where ${BLANK_SOURCE(db)})::int n from ${leadSet(db, s)} where x.status is not null`)[0] ?? {};
  const total = Number(r.total ?? 0), n = Number(r.n ?? 0), share = total === 0 ? null : n / total;
  return { n, total, share, actionable: share !== null && total >= 5 && share >= 0.34 };
}

// ---------------------------------------------------------------- one page of a list

export type ListFilter = {
  status: LeadStatusFilter; person: string | null; owner: string | null; meId: string | null; q: string; sort: LeadSort; noSource: boolean;
  /** Only leads that arrived after this time (the "right now" lists). */ newerThanMs: number | null;
  /** Only leads that arrived in (startMs, endMs]. */ weekRange: { start: number; end: number } | null; day: string | null; replyDay: string | null;
};

const dayBounds = (d: string) => { const a = Date.parse(`${d}T00:00:00Z`); return [new Date(a), new Date(a + DAY)] as const; };
const norm = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

function whereOf(db: Db, f: ListFilter, withOwner: boolean) {
  const parts: Array<PendingQuery<Row[]>> = [];
  const st = f.status;
  parts.push(st === "waiting" ? db`x.status = 'waiting'` : st === "within" ? db`x.status = 'within'` : st === "late" ? db`x.status = 'late'` : st === "slow" ? db`x.status in ('late', 'waiting')`
    : st === "answered" ? db`x.status in ('within', 'late')` : st === "onlyAuto" ? db`(x.read_version = 1 and x.auto_touch_at is not null and x.human_touch_at is null and x.status = 'waiting')` : db`x.status is not null`);
  if (f.person) parts.push(db`(x.touch_at is not null and x.touch_user_id = ${f.person})`);
  if (f.newerThanMs !== null) parts.push(db`x.lead_at > ${new Date(f.newerThanMs)}`);
  if (f.weekRange) parts.push(db`(x.lead_at > ${new Date(f.weekRange.start)} and x.lead_at <= ${new Date(f.weekRange.end)})`);
  if (f.day) { const [a, b] = dayBounds(f.day); parts.push(db`(x.lead_at >= ${a} and x.lead_at < ${b})`); }
  if (f.replyDay) { const [a, b] = dayBounds(f.replyDay); parts.push(db`(x.touch_at >= ${a} and x.touch_at < ${b})`); }
  if (f.noSource) parts.push(BLANK_SOURCE(db));
  for (const w of norm(f.q).split(/\s+/).filter(Boolean))
    parts.push(db`strpos(lower(coalesce(x.full_name, '') || ' ' || coalesce(x.account_name, '') || ' ' || coalesce(x.source, '') || ' ' || coalesce(x.email, '') || ' ' || coalesce(x.phone, '')), ${w}) > 0`);
  if (withOwner && f.owner) parts.push(f.owner === "none" ? db`x.assigned_to is null` : db`x.assigned_to = ${f.owner}`);
  return parts.reduce((acc, p, i) => (i === 0 ? p : db`${acc} and ${p}`), db`true`);
}

const sortOf = (db: Db, sort: LeadSort) => {
  const rank = db`case x.status when 'waiting' then 0 when 'late' then 1 else 2 end`;
  const tie = db`x.lead_at asc, lower(coalesce(x.full_name, x.email, x.phone, '')) asc, x.location_id || x.contact_id asc`;
  if (sort === "newest") return db`x.lead_at desc, ${tie}`;
  if (sort === "name") return db`lower(coalesce(x.full_name, x.email, x.phone, '')) asc, ${tie}`;
  if (sort === "account") return db`lower(coalesce(x.account_name, '')) asc, ${tie}`;
  return db`${rank}, case when x.status = 'waiting' then x.lead_at end asc, case when x.status <> 'waiting' then x.lead_at end desc, ${tie}`;
};

/** One server-side page: the facet counts, the chosen total and `size` rows, cut in the database. */
export async function listPage(db: Db, s: Scope, f: ListFilter, page: number, size: number) {
  const every = whereOf(db, f, false), chosen = whereOf(db, f, true);
  const c = (await db`
    select count(*)::int everyone, count(*) filter (where x.assigned_to is null)::int no_owner, count(*) filter (where ${f.meId ?? "__nobody__"}::text = x.assigned_to)::int mine,
      count(*) filter (where x.status = 'waiting' and extract(epoch from (${new Date(s.now)}::timestamptz - x.lead_at)) > 259200)::int never, count(*) filter (where ${chosen})::int total
    from ${leadSet(db, s)} where ${every}`)[0] ?? {};
  const total = Number(c.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / size));
  const at = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const rows = total === 0 ? [] : await db`select x.* from ${leadSet(db, s)} where ${chosen} order by ${sortOf(db, f.sort)} limit ${size} offset ${at * size}`;
  return {
    total, page: at, pages, from: total === 0 ? 0 : at * size + 1, to: at * size + rows.length,
    facets: { all: Number(c.everyone ?? 0), noOwner: Number(c.no_owner ?? 0), mine: f.meId ? Number(c.mine ?? 0) : 0, never: Number(c.never ?? 0) },
    rows: rows.map((r) => ({ row: rowOfSql(r, s.targetMinutes), status: r.status as "within" | "late" | "waiting" })),
  };
}

/** The top rows of one status, longest wait first, plus nothing else (the first screen's "reply now" five). */
export async function topWaiting(db: Db, s: Scope, n: number) {
  const rows = await db`select x.* from ${leadSet(db, s)} where x.status = 'waiting' order by x.lead_at asc, lower(coalesce(x.full_name, x.email, x.phone, '')) asc, x.location_id || x.contact_id asc limit ${n}`;
  return rows.map((r) => ({ row: rowOfSql(r, s.targetMinutes), status: "waiting" as const }));
}
