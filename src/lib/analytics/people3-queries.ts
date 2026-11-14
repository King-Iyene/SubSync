import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import {
  AUTOMATED_SENTINEL, DAY, decodeCursor, delta, encodeCursor, headlineOf, IDLE_HOURS, idleOf, isAdminRole, loadState, median, MIN_DAYS, MIN_LEADS, MIN_NEXT_SAMPLE, moves, nameStateOf,
  oneThing, rate, risksOf, todayLines, UNKNOWN_SENTINEL, WAIT_HOURS, mondayOf, MAX_ROWS, NAME_PLACEHOLDER, initialsOf, type Clock, type Cursor, type PeriodStats,
} from "./people3-intel";
import { dailyFrom, NO_OWNER, workItems, waitingFrom, waitingOwner, type Frag, type Work } from "./people3-rollup";
import { properCase, safePhotoUrl } from "./people-labels";
import { roleSetCond } from "./people3-roleset";
import type { RoleFilter } from "../people/roles";
import { todaySentence } from "../people/team-empty";
import type {
  Pp3AccessRow, Pp3Access, Pp3AccountRef, Pp3AccountRisk, Pp3Coaching, Pp3Move, Pp3Note, Pp3Options, Pp3Person, Pp3PersonPanel, Pp3Role, Pp3Scorecard, Pp3Scorecards, Pp3Sort, Pp3Target,
  Pp3Today, Pp3Week, Pp3Workload, Pp3WorkloadRow,
} from "./people3-types";

// The reads behind /api/app/people3?part=... Read only. The accounts a caller may see (`allowed`) come from the signed session in the router, never from the request, and a request can only
// NARROW that set (an id passes ownedLocation first). The people a caller may see come from `level`: all (agency owner or admin: everyone), account (an account admin: the people of their
// account), self (everyone else: only their own row, enforced here in SQL, not in the screen). Every query filters by installation_id again.

type Db = ReturnType<typeof sql>;
export type Level = "all" | "account" | "self";
export type Scope = { inst: string; allowed: string[] | null; level: Level; selfId: string | null };
export type Links = { account: (loc: string) => string; contact: (loc: string, contact: string) => string; opportunities: (loc: string) => string };
export type Flags = { idle: boolean; actions: boolean };

export const peopleCache = ttlCache<object>(60_000, 100);
/** Forget this installation's cached answers (the cache key starts with the installation id), so a note, a target or an away mark moves the screens at once. */
export const forgetPeople = (inst: string) => peopleCache.clear(JSON.stringify([inst]).slice(0, -1));

const ID = /^[A-Za-z0-9_-]{1,128}$/;
export const cleanId = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
export const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
export const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
export const dayStr = (d: Date) => d.toISOString().slice(0, 10);
export const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export const pageOf = <T>(rows: T[], total: number, size: number, next: string | null) => ({ rows, total, size, next, truncated: false });

// ---- accounts ----

export type Acct = { id: string; name: string; tz: string | null; targetMinutes: number; clock: Clock; usersAccess: string | null; lastSyncAt: Date | null };

/** The accounts in play (the ONE place a scope becomes ids). */
export async function accountsIn(s: Scope, location?: string | null): Promise<Acct[]> {
  const db = sql();
  if (s.allowed && s.allowed.length === 0) return [];
  const one = cleanId(location);
  const rows = await db`
    select l.location_id, coalesce(nullif(l.name, ''), 'Client account') name, l.timezone, coalesce(l.speed_target_minutes, st.speed_target_minutes, 15) target,
      coalesce(st.speed_business_hours, false) bh, coalesce(st.speed_open_hour, 9) oh, coalesce(st.speed_close_hour, 17) ch, l.users_access, l.last_synced_at
    from locations l left join settings st on st.installation_id = l.installation_id
    where l.installation_id = ${s.inst} and not l.ignored
      ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``}
      ${one ? db`and l.location_id = ${one}` : db``}
    order by lower(l.name) nulls last, l.location_id limit 1000`;
  return rows.map((r) => ({
    id: r.location_id as string, name: r.name as string, tz: (r.timezone as string | null) ?? null, targetMinutes: n(r.target),
    clock: { zone: (r.timezone as string | null) ?? null, businessHours: r.bh === true, openHour: n(r.oh), closeHour: n(r.ch) }, usersAccess: (r.users_access as string | null) ?? null, lastSyncAt: (r.last_synced_at as Date | null) ?? null,
  }));
}
export const refOf = (a: Acct): Pp3AccountRef => ({ locationId: a.id, name: a.name });

// ---- people ----

/** The SQL that says "this member is visible to the caller" (alias m). The router decides `level` from the signed session; nothing here comes from the request. */
export function visibleMember(s: Scope, ids: string[]): Frag {
  const db = sql();
  if (s.level === "self") return s.selfId ? db`m.user_id = ${s.selfId}` : db`false`;
  if (s.level === "account" || s.allowed) {
    return db`(${s.level === "all" ? db`m.all_accounts or` : db``} exists (select 1 from team_member_access x where x.installation_id = m.installation_id and x.user_id = m.user_id and x.location_id = any(${ids}::text[]))
      or exists (select 1 from location_users lu where lu.installation_id = m.installation_id and lu.user_id = m.user_id and lu.location_id = any(${ids}::text[])))`;
  }
  return db`true`;
}

/** A person id from a request is usable only when that person is visible to the caller: a member of THIS installation who shares an allowed account (or is the caller themselves).
 *  Anything else is "not found" and is never echoed. */
export async function ownedUser(s: Scope, ids: string[], v: unknown): Promise<string | null> {
  const id = cleanId(v);
  if (!id) return null;
  if (s.level === "self") return s.selfId && id === s.selfId ? id : null;
  const db = sql();
  try {
    const r = await db`select 1 from team_members m where m.installation_id = ${s.inst} and m.user_id = ${id} and ${visibleMember(s, ids)} limit 1`;
    if (r.length) return id;
  } catch { /* identity table not created yet */ }
  const r2 = await db`select 1 from location_users lu where lu.installation_id = ${s.inst} and lu.user_id = ${id} and lu.location_id = any(${ids}::text[]) limit 1`.catch(() => []);
  return r2.length ? id : null;
}

type Away = Map<string, number>;
/** People marked away by the team lead (PB table user_away, kind 'away', not released, running now). A missing table means nobody is away. `withSnooze` also counts a snoozed idle reminder (used only by the idle rule). */
export async function awayMap(inst: string, withSnooze = false): Promise<Away> {
  try {
    const rows = await sql()`select user_id, max(until) until from user_away where installation_id = ${inst} and released_at is null and starts_at <= now() and until > now() and (kind = 'away' or ${withSnooze}) group by user_id`;
    return new Map(rows.map((r) => [r.user_id as string, (r.until as Date).getTime()]));
  } catch { return new Map(); }
}

/** Identities for a set of user ids (or everyone visible when none are given, capped at 200). */
export async function loadPeople(s: Scope, accts: Acct[], ids?: string[], now = Date.now()): Promise<Map<string, Pp3Person>> {
  const db = sql();
  const out = new Map<string, Pp3Person>();
  const locIds = accts.map((a) => a.id);
  if (ids && ids.length === 0) return out;
  const names = new Map(accts.map((a) => [a.id, a.name]));
  let rows: Array<Record<string, unknown>> = [];
  try {
    rows = await db`
      select m.user_id, coalesce(nullif(tn.name, ''), nullif(m.name, '')) name, m.email, m.role, coalesce(m.photo_url, tn.photo_url) photo, m.all_accounts, m.deleted, m.source, m.first_seen, m.last_seen
      from team_members m left join team_names tn on tn.installation_id = m.installation_id and tn.user_id = m.user_id
      where m.installation_id = ${s.inst} and ${visibleMember(s, locIds)} ${ids ? db`and m.user_id = any(${ids}::text[])` : db``}
      order by lower(coalesce(nullif(tn.name, ''), m.name, '')), m.user_id limit 200`;
  } catch { rows = []; }
  const known = new Set(rows.map((r) => r.user_id as string));
  // People seen only in the numbers (before the first sweep wrote them): named from the names we keep, else unnamed.
  const missing = (ids ?? []).filter((i) => !known.has(i));
  if (missing.length) {
    const tn = await db`select user_id, name, photo_url from team_names where installation_id = ${s.inst} and user_id = any(${missing}::text[])`.catch(() => []);
    const lu = await db`select distinct on (user_id) user_id, name from location_users where installation_id = ${s.inst} and user_id = any(${missing}::text[]) and location_id = any(${locIds}::text[])`.catch(() => []);
    const nm = new Map<string, { name: string | null; photo: string | null }>();
    for (const r of lu) nm.set(r.user_id as string, { name: (r.name as string | null) ?? null, photo: null });
    for (const r of tn) nm.set(r.user_id as string, { name: (r.name as string | null) ?? null, photo: (r.photo_url as string | null) ?? null });
    for (const id of missing) {
      if (s.level === "self" && id !== s.selfId) continue;
      rows.push({ user_id: id, name: nm.get(id)?.name ?? null, email: null, role: "unknown", photo: nm.get(id)?.photo ?? null, all_accounts: false, deleted: false, source: "activity", first_seen: null, last_seen: null });
    }
  }
  const uids = rows.map((r) => r.user_id as string);
  if (!uids.length) return out;
  const [acc, last, away] = await Promise.all([
    db`select user_id, location_id from team_member_access where installation_id = ${s.inst} and user_id = any(${uids}::text[]) and location_id = any(${locIds}::text[])`.catch(() => []),
    db`select p.user_id, (select max(t.at) from touch_events t where t.installation_id = ${s.inst} and t.user_id = p.user_id and t.direction = 'outbound' and not t.automated and t.location_id = any(${locIds}::text[])) at
       from unnest(${uids}::text[]) as p(user_id)`.catch(() => []),
    awayMap(s.inst),
  ]);
  const accBy = new Map<string, string[]>();
  for (const r of acc) accBy.set(r.user_id as string, [...(accBy.get(r.user_id as string) ?? []), r.location_id as string]);
  const lastBy = new Map(last.map((r) => [r.user_id as string, (r.at as Date | null) ?? null]));
  const anyNeeds = accts.some((a) => a.usersAccess === "needs_permission");
  const allOk = accts.length > 0 && accts.every((a) => a.usersAccess === "ok");
  const usersState = anyNeeds ? "needs_permission" as const : allOk ? "ok" as const : "unknown" as const;
  for (const r of rows) {
    const id = r.user_id as string;
    const role = ((r.role as string | null) ?? "unknown") as Pp3Role;
    const deleted = r.deleted === true;
    const rawName = (r.name as string | null) ?? null;
    const state = nameStateOf({ name: rawName, deleted, usersState });
    const label = state === "named" ? properCase(rawName) : state === "former" ? (rawName ? properCase(rawName) : NAME_PLACEHOLDER.former) : state === "needs_permission" ? NAME_PLACEHOLDER.needs_permission : NAME_PLACEHOLDER.unnamed;
    const refs = (accBy.get(id) ?? []).map((l) => ({ locationId: l, name: names.get(l) ?? "Client account" })).sort((a, b) => a.name.localeCompare(b.name));
    const untilMs = away.get(id);
    out.set(id, {
      userId: id, name: label, nameState: state, initials: initialsOf(label), photoUrl: safePhotoUrl(r.photo), role, isAdmin: isAdminRole(role), allAccounts: r.all_accounts === true,
      accountCount: refs.length, accounts: refs.slice(0, 50), email: s.level === "all" ? ((r.email as string | null) ?? null) : null, deleted,
      firstSeen: iso(r.first_seen), lastSeen: iso(r.last_seen), lastActivityAt: iso(lastBy.get(id) ?? null), away: untilMs && untilMs > now ? { until: new Date(untilMs).toISOString() } : null,
      isNew: r.source === "activity" && !deleted,
    });
  }
  return out;
}

export async function historyStarts(inst: string, ids: string[]): Promise<string | null> {
  if (!ids.length) return null;
  try {
    const a = await sql()`select min(day)::text d from user_daily where installation_id = ${inst} and location_id = any(${ids}::text[])`;
    if (a[0]?.d) return a[0].d as string;
  } catch { /* no table yet */ }
  try {
    const r = await sql()`select min(at)::date::text d from touch_events where installation_id = ${inst} and location_id = any(${ids}::text[])`;
    return (r[0]?.d as string | null) ?? null;
  } catch { return null; }
}

// ---- options ----

export async function options(s: Scope, canRankAll: boolean): Promise<Pp3Options> {
  const accts = await accountsIn(s);
  const anyNeeds = accts.some((a) => a.usersAccess === "needs_permission");
  const allOk = accts.length > 0 && accts.every((a) => a.usersAccess === "ok");
  return {
    viewer: { level: s.level, userId: s.selfId, canSeeEmail: s.level === "all", canRankAll },
    accounts: accts.map(refOf), minLeads: MIN_LEADS, minDays: MIN_DAYS, idleHours: IDLE_HOURS, usersState: anyNeeds ? "needs_permission" : allOk ? "ok" : "unknown",
  };
}

// ---- scorecards ----

type SortSpec = { expr: string; text: boolean };
const SORTS: Record<Pp3Sort, SortSpec> = {
  name: { expr: "lower(nm)", text: true },
  answered: { expr: "coalesce(a.c_first_replies, 0)::float8", text: false },
  reply: { expr: "coalesce(a.c_med, 999999999)::float8", text: false },
  in_time: { expr: "coalesce(a.c_in_time::float8 / nullif(a.c_first_replies, 0), -1)", text: false },
  appts: { expr: "coalesce(a.c_appts_set, 0)::float8", text: false },
  showed: { expr: "coalesce(a.c_held::float8 / nullif(a.c_held + a.c_no_show, 0), -1)", text: false },
  won: { expr: "coalesce(a.c_won_value, 0)::float8", text: false },
  waiting: { expr: "coalesce(w.w, 0)::float8", text: false },
};
const DEFAULT_DIR: Record<Pp3Sort, "asc" | "desc"> = { name: "asc", answered: "desc", reply: "asc", in_time: "desc", appts: "desc", showed: "desc", won: "desc", waiting: "desc" };

export type CardFilters = { from: Date; to: Date; location?: string | null; q?: string | null; role?: "setter" | "closer" | null; only?: string | null; /** Only people the agency labelled this way (Setters, Closers, Managers...). */ roleset?: RoleFilter | null };

/** The per-person aggregate: current and previous period sums from the daily rows (rollup, or the live twin), grouped by person. Sentinel rows ('~') are not people. */
function aggFrom(daily: Frag, f: CardFilters, prevFrom: Date): Frag {
  const db = sql();
  const F = dayStr(f.from), T = dayStr(f.to), P = dayStr(prevFrom);
  const c = `d.day >= '${F}'::date and d.day < '${T}'::date`, p = `d.day >= '${P}'::date and d.day < '${F}'::date`;
  const sum = (col: string, w: string) => `coalesce(sum(d.${col}) filter (where ${w}), 0)`;
  const cols = ["first_replies", "in_time", "appts_set", "appts_set_est", "set_showed", "set_noshow", "held", "no_show", "deals_won", "deals_lost", "touches_sms", "touches_email", "touches_call", "touches_other"];
  const sums = [
    ...cols.map((k) => `${sum(k, c)}::int c_${k}`), `${sum("won_value", c)}::float8 c_won_value`, `${sum("lost_value", c)}::float8 c_lost_value`,
    `${sum("first_replies", p)}::int p_first_replies`, `${sum("appts_set", p)}::int p_appts_set`, `${sum("won_value", p)}::float8 p_won_value`,
    `(percentile_cont(0.5) within group (order by d.median_seconds) filter (where d.median_seconds is not null and d.first_replies > 0 and ${c}))::float8 c_med`,
    `(percentile_cont(0.5) within group (order by d.median_seconds) filter (where d.median_seconds is not null and d.first_replies > 0 and ${p}))::float8 p_med`,
    `(count(distinct d.location_id) filter (where ${c} and d.first_replies + d.touches_sms + d.touches_email + d.touches_call + d.touches_other > 0))::int accts`,
    `min(d.day)::text first_day`,
  ].join(", ");
  return db`select d.user_id uid, ${db.unsafe(sums) as unknown as Frag} from (${daily}) d where d.user_id not like '~%' ${f.only ? db`and d.user_id = ${f.only}` : db``} group by d.user_id`;
}

function cardBase(s: Scope, ids: string[], agg: Frag, f: CardFilters, sort: Pp3Sort): Frag {
  const db = sql();
  const q = (f.q ?? "").trim().slice(0, 60);
  return db`
    with a as (${agg}),
    w as (select ${waitingOwner()} uid, count(*)::int w ${waitingFrom(s.inst, ids)} group by 1),
    ppl as (
      select uid user_id from a
      union select x.user_id from team_member_access x where x.installation_id = ${s.inst} and x.location_id = any(${ids}::text[]) ${f.only ? db`and x.user_id = ${f.only}` : db``}
    )
    select p.user_id, ${db.unsafe(SORTS[sort].expr) as unknown as Frag} sortv, coalesce(nullif(tn.name, ''), nullif(m.name, ''), '') nm, a.*, coalesce(w.w, 0) waiting_now
    from ppl p left join a on a.uid = p.user_id
    left join w on w.uid = p.user_id
    left join team_members m on m.installation_id = ${s.inst} and m.user_id = p.user_id
    left join team_names tn on tn.installation_id = ${s.inst} and tn.user_id = p.user_id
    where ${s.level === "self" ? (s.selfId ? db`p.user_id = ${s.selfId}` : db`false`) : db`true`}
      and (m.deleted is not true or a.uid is not null)
      and p.user_id not like '~%'
      ${f.role === "setter" ? db`and coalesce(a.c_first_replies, 0) > 0` : f.role === "closer" ? db`and coalesce(a.c_held + a.c_no_show + a.c_deals_won + a.c_deals_lost, 0) > 0` : db``}
      ${f.roleset ? db`and ${roleSetCond(s.inst, cleanId(f.location), f.roleset, db`p.user_id`)}` : db``}
      ${q ? db`and coalesce(nullif(tn.name, ''), nullif(m.name, ''), '') ilike ${like(q)}` : db``}`;
}

const cursorWhere = (sortv: Cursor | null, dir: "asc" | "desc", text: boolean): Frag => {
  const db = sql();
  if (!sortv) return db`true`;
  const v = sortv.v;
  const cmp = dir === "asc" ? db`>` : db`<`;
  return text ? db`(b.sortv, b.user_id) ${cmp} (${String(v ?? "")}::text, ${sortv.id}::text)` : db`(b.sortv, b.user_id) ${cmp} (${Number(v ?? 0)}::float8, ${sortv.id}::text)`;
};

type CardRow = Record<string, unknown>;
function cardOf(r: CardRow, person: Pp3Person, spark: number[], hist: string | null): Pp3Scorecard {
  const c = (k: string) => n(r[`c_${k}`]);
  const fr = c("first_replies");
  const showedN = c("held") + c("no_show"), setN = c("set_showed") + c("set_noshow");
  const inTime = rate(c("in_time"), fr);
  const showed = rate(c("held"), showedN, 10), setShowed = rate(c("set_showed"), setN, 10);
  return {
    person, answeredFirst: delta(fr, n(r.p_first_replies)), typicalReplySeconds: r.c_med === null || r.c_med === undefined ? null : Math.round(Number(r.c_med)),
    typicalReplyPrev: r.p_med === null || r.p_med === undefined ? null : Math.round(Number(r.p_med)),
    inTime, apptsSet: delta(c("appts_set"), n(r.p_appts_set), 5), apptsSetEstimated: c("appts_set_est"), showed, setShowed,
    wonCount: c("deals_won"), wonValue: delta(n(r.c_won_value), n(r.p_won_value), 1), lostCount: c("deals_lost"),
    touches: { sms: c("touches_sms"), email: c("touches_email"), call: c("touches_call"), other: c("touches_other") },
    waiting: n(r.waiting_now), accounts: n(r.accts), enough: inTime.enough || showed.enough || setShowed.enough, historyStarts: hist ?? (r.first_day as string | null) ?? null, spark,
  };
}

async function weekly(s: Scope, ids: string[], users: string[], now: number): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!users.length || !ids.length) return out;
  const start = mondayOf(now) - 7 * 7 * DAY;
  const daily = await dailyFrom(s.inst, ids, new Date(start), now);
  const rows = await sql()`select d.user_id, ((d.day - ${dayStr(new Date(start))}::date) / 7)::int wk, sum(d.first_replies)::int fr from (${daily.f}) d where d.user_id = any(${users}::text[]) and d.day >= ${dayStr(new Date(start))}::date group by 1, 2`;
  for (const u of users) out.set(u, Array(8).fill(0));
  for (const r of rows) { const a = out.get(r.user_id as string); const k = n(r.wk); if (a && k >= 0 && k < 8) a[k] = n(r.fr); }
  return out;
}

export async function scorecards(s: Scope, f: CardFilters, o: { sort: Pp3Sort; dir?: "asc" | "desc" | null; after?: string | null; size: number }, days: number, now = Date.now()): Promise<Pp3Scorecards> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const ids = accts.map((a) => a.id);
  const empty: Pp3Scorecards = { ...pageOf<Pp3Scorecard>([], 0, o.size, null), period: { from: f.from.toISOString(), to: f.to.toISOString(), days }, unattributed: { automated: 0, unknown: 0 }, people: 0 };
  if (!ids.length) return empty;
  const span = f.to.getTime() - f.from.getTime(), prevFrom = new Date(f.from.getTime() - span);
  const daily = await dailyFrom(s.inst, ids, prevFrom, now);
  const agg = aggFrom(daily.f, f, prevFrom);
  const base = cardBase(s, ids, agg, f, o.sort);
  const dir = o.dir ?? DEFAULT_DIR[o.sort];
  const spec = SORTS[o.sort];
  const cur = decodeCursor(o.after);
  const ord = dir === "asc" ? db`asc` : db`desc`;
  const [rows, tot, un, hist] = await Promise.all([
    db`select * from (${base}) b where ${cursorWhere(cur, dir, spec.text)} order by b.sortv ${ord}, b.user_id ${ord} limit ${o.size + 1}`,
    db`select count(*)::int c from (${base}) b`,
    db`select coalesce(sum(touches_sms + touches_email + touches_call + touches_other) filter (where user_id = ${AUTOMATED_SENTINEL}), 0)::int automated,
        coalesce(sum(touches_sms + touches_email + touches_call + touches_other) filter (where user_id = ${UNKNOWN_SENTINEL}), 0)::int unknown
       from (${daily.f}) d where d.day >= ${dayStr(f.from)}::date and d.day < ${dayStr(f.to)}::date`,
    historyStarts(s.inst, ids),
  ]);
  const page = rows.slice(0, o.size);
  const users = page.map((r) => r.user_id as string);
  const [people, spark] = await Promise.all([loadPeople(s, accts, users, now), weekly(s, ids, users, now)]);
  const cards = page.flatMap((r) => { const p = people.get(r.user_id as string); return p ? [cardOf(r, p, spark.get(r.user_id as string) ?? Array(8).fill(0), hist)] : []; });
  const last = page[page.length - 1];
  const next = rows.length > o.size && last ? encodeCursor({ v: spec.text ? String(last.sortv ?? "") : Number(last.sortv ?? 0), id: last.user_id as string }) : null;
  return { ...pageOf(cards, n(tot[0]?.c), o.size, next), period: empty.period, unattributed: { automated: n(un[0]?.automated), unknown: n(un[0]?.unknown) }, people: n(tot[0]?.c) };
}

// ---- workload ----

export type WorkloadCtx = { accts: Acct[]; people: Map<string, Pp3Person>; work: Map<string, Work>; away: Away; idleOn: boolean };

/** Everyone's open items right now, across the accounts in view. Bounded: accounts x people, capped at 5,000 pairs. */
export async function workloadRows(s: Scope, accts: Acct[], flags: Flags, now = Date.now()): Promise<{ rows: Pp3WorkloadRow[]; medianBy: Map<string, number | null>; people: Map<string, Pp3Person> }> {
  const db = sql();
  const ids = accts.map((a) => a.id);
  if (!ids.length) return { rows: [], medianBy: new Map(), people: new Map() };
  const access = await db`select x.location_id, x.user_id from team_member_access x join team_members m on m.installation_id = x.installation_id and m.user_id = x.user_id
      where x.installation_id = ${s.inst} and x.location_id = any(${ids}::text[]) and not m.deleted ${s.level === "self" && s.selfId ? db`and x.user_id = ${s.selfId}` : db``} limit 5000`.catch(() => []);
  const pairs = access.map((r) => [r.location_id as string, r.user_id as string] as [string, string]);
  const work = await workItems(s.inst, ids, pairs);
  const userIds = [...new Set([...work.values()].filter((w) => w.userId !== NO_OWNER && (s.level !== "self" || w.userId === s.selfId)).map((w) => w.userId))].slice(0, 400);
  const people = await loadPeople(s, accts, userIds, now);
  const byAcct = new Map(accts.map((a) => [a.id, a]));
  const items = (w: Work) => w.waiting + w.openDeals + w.upcoming;
  // The team's own normal: non-admin, current people of the account.
  const teamOf = new Map<string, number[]>();
  for (const w of work.values()) {
    const p = people.get(w.userId);
    if (!p || p.deleted || p.isAdmin) continue;
    teamOf.set(w.locationId, [...(teamOf.get(w.locationId) ?? []), items(w)]);
  }
  const medianBy = new Map([...teamOf].map(([l, xs]) => [l, median(xs)]));
  const away = await awayMap(s.inst, true);
  const rows: Pp3WorkloadRow[] = [];
  for (const w of work.values()) {
    const p = people.get(w.userId), a = byAcct.get(w.locationId);
    if (!p || !a || p.deleted) continue;
    const ls = loadState(items(w), teamOf.get(w.locationId) ?? []);
    const idle = flags.idle ? idleOf({ lastTouchMs: w.lastTouchAt?.getTime() ?? null, now, clock: a.clock, waitingLeads: w.waiting, awayUntilMs: away.get(w.userId) ?? null, deleted: p.deleted }) : null;
    rows.push({
      person: p, location: refOf(a), waiting: w.waiting, waitingOld: w.waitingOld, openDeals: w.openDeals, openValue: w.openValue, staleDeals: w.staleDeals, staleValue: w.staleValue,
      upcoming: w.upcoming, needsOutcome: w.needsOutcome, load: p.isAdmin ? "unknown" : ls.state, loadWhy: p.isAdmin ? null : ls.why, lastTouchAt: iso(w.lastTouchAt), idle,
    });
  }
  return { rows, medianBy, people };
}

export async function workload(s: Scope, f: { location?: string | null; q?: string | null; user?: string | null }, o: { size: number; after?: string | null }, flags: Flags, now = Date.now()): Promise<Pp3Workload> {
  const accts = await accountsIn(s, f.location);
  const all = await workloadRows(s, accts, flags, now);
  const q = (f.q ?? "").trim().toLowerCase().slice(0, 60);
  let rows = all.rows.filter((r) => (!f.user || r.person.userId === f.user) && (!q || r.person.name.toLowerCase().includes(q)));
  rows = rows.sort((a, b) => b.waitingOld - a.waitingOld || b.waiting - a.waiting || a.person.name.localeCompare(b.person.name) || a.location.name.localeCompare(b.location.name) || a.person.userId.localeCompare(b.person.userId));
  const key = (r: Pp3WorkloadRow) => `${r.person.userId}|${r.location.locationId}`;
  const cur = decodeCursor(o.after);
  const start = cur ? Math.max(0, rows.findIndex((r) => key(r) === cur.id) + 1) : 0;
  const page = rows.slice(start, start + o.size);
  const last = page[page.length - 1];
  const hist = await historyStarts(s.inst, accts.map((a) => a.id));
  return {
    ...pageOf(page, rows.length, o.size, last && start + o.size < rows.length ? encodeCursor({ v: last.waitingOld, id: key(last) }) : null),
    medianOpen: median([...all.medianBy.values()].filter((x): x is number => x !== null)), over: rows.filter((r) => r.load === "over").length, under: rows.filter((r) => r.load === "under").length,
    idleCount: rows.filter((r) => r.idle).length, idleHours: IDLE_HOURS, historyStarts: hist,
  };
}

// ---- access ----

export async function access(s: Scope, f: { location?: string | null; q?: string | null }, o: { size: number; after?: string | null }, now = Date.now()): Promise<Pp3Access> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const ids = accts.map((a) => a.id);
  const empty: Pp3Access = { ...pageOf<Pp3AccessRow>([], 0, o.size, null), risks: [], needsPermission: [], newPeople: 0, deletedPeople: 0, accounts: [] };
  if (!ids.length) return empty;
  const q = (f.q ?? "").trim().slice(0, 60);
  const cur = decodeCursor(o.after);
  const base = db`
    select m.user_id, lower(coalesce(nullif(tn.name, ''), m.name, '')) sortv, m.deleted, m.source, m.all_accounts,
      exists (select 1 from team_member_access x where x.installation_id = m.installation_id and x.user_id = m.user_id) has_access,
      exists (select 1 from location_users lu where lu.installation_id = m.installation_id and lu.user_id = m.user_id and lu.role is not null) verified
    from team_members m left join team_names tn on tn.installation_id = m.installation_id and tn.user_id = m.user_id
    where m.installation_id = ${s.inst} and ${visibleMember(s, ids)}
      ${q ? db`and coalesce(nullif(tn.name, ''), m.name, '') ilike ${like(q)}` : db``}`;
  let rows: Array<Record<string, unknown>> = [], total = 0, counts: Array<Record<string, unknown>> = [];
  try {
    [rows, total, counts] = await Promise.all([
      db`select * from (${base}) b where ${cur ? db`(b.sortv, b.user_id) > (${String(cur.v ?? "")}::text, ${cur.id}::text)` : db`true`} order by b.sortv, b.user_id limit ${o.size + 1}`,
      db`select count(*)::int c from (${base}) b`.then((r) => n(r[0]?.c)),
      db`select x.location_id, count(*)::int c from team_member_access x join team_members m on m.installation_id = x.installation_id and m.user_id = x.user_id
         where x.installation_id = ${s.inst} and x.location_id = any(${ids}::text[]) and not m.deleted and ${visibleMember(s, ids)} group by 1`,
    ]);
  } catch { return empty; }
  const page = rows.slice(0, o.size);
  const people = await loadPeople(s, accts, page.map((r) => r.user_id as string), now);
  const out: Pp3AccessRow[] = page.flatMap((r) => {
    const p = people.get(r.user_id as string);
    if (!p) return [];
    const flags: Pp3AccessRow["flags"] = [];
    if (!r.has_access && p.role === "agency_staff") flags.push("no_account");
    if (p.deleted) flags.push("deleted");
    if (p.nameState === "unnamed") flags.push("unnamed");
    if (p.isNew) flags.push("new");
    return [{ person: p, verified: p.role === "agency_staff" || p.role === "agency_admin" ? null : r.verified === true, flags }];
  });
  const [cnt] = await Promise.all([db`select count(*) filter (where source = 'activity' and not deleted)::int new_n, count(*) filter (where deleted)::int del_n from team_members m where m.installation_id = ${s.inst} and ${visibleMember(s, ids)}`.catch(() => [])]);
  const risks = s.level === "self" ? [] : await accountRisks(s, accts, now);
  const last = page[page.length - 1];
  const cnts = new Map(counts.map((r) => [r.location_id as string, n(r.c)]));
  return {
    ...pageOf(out, total, o.size, rows.length > o.size && last ? encodeCursor({ v: String(last.sortv ?? ""), id: last.user_id as string }) : null),
    risks, needsPermission: accts.filter((a) => a.usersAccess === "needs_permission").map(refOf), newPeople: n(cnt[0]?.new_n), deletedPeople: n(cnt[0]?.del_n),
    accounts: accts.map((a) => ({ ...refOf(a), people: cnts.get(a.id) ?? 0 })),
  };
}

/** Accounts where nobody has replied for 14 days (after some history) and accounts where one person sends 80% or more of the replies. */
export async function accountRisks(s: Scope, accts: Acct[], now = Date.now()): Promise<Pp3AccountRisk[]> {
  const ids = accts.map((a) => a.id);
  if (!ids.length) return [];
  const db = sql();
  const daily = await dailyFrom(s.inst, ids, new Date(now - 60 * DAY), now);
  const cut14 = dayStr(new Date(now - 14 * DAY)), cut30 = dayStr(new Date(now - 30 * DAY));
  const rows = await db`
    select d.location_id, d.user_id, sum(d.touches_sms + d.touches_email + d.touches_call + d.touches_other)::int total,
      coalesce(sum(d.touches_sms + d.touches_email + d.touches_call + d.touches_other) filter (where d.day >= ${cut30}::date), 0)::int r30,
      coalesce(sum(d.touches_sms + d.touches_email + d.touches_call + d.touches_other) filter (where d.day >= ${cut14}::date), 0)::int r14
    from (${daily.f}) d where d.user_id not like '~%' group by 1, 2`;
  const people = await db`select x.location_id, count(*)::int c from team_member_access x join team_members m on m.installation_id = x.installation_id and m.user_id = x.user_id
    where x.installation_id = ${s.inst} and x.location_id = any(${ids}::text[]) and not m.deleted and m.role <> 'agency_admin' group by 1`.catch(() => []);
  const peopleBy = new Map(people.map((r) => [r.location_id as string, n(r.c)]));
  const names = await db`select user_id, coalesce(nullif(tn.name, ''), 'A team member') name from team_members m left join team_names tn using (installation_id, user_id) where m.installation_id = ${s.inst}`.catch(() => []);
  const nameBy = new Map(names.map((r) => [r.user_id as string, properCase(r.name as string)]));
  const out: Pp3AccountRisk[] = [];
  for (const a of accts) {
    const mine = rows.filter((r) => r.location_id === a.id);
    const total60 = mine.reduce((t, r) => t + n(r.total), 0);
    if (!total60) continue; // no history in this account: nothing to judge
    out.push(...risksOf({
      location: refOf(a), people: peopleBy.get(a.id) ?? mine.length, activePeople: mine.filter((r) => n(r.r14) > 0).length,
      replies30: mine.filter((r) => n(r.r30) > 0).map((r) => ({ userId: r.user_id as string, name: nameBy.get(r.user_id as string) ?? NAME_PLACEHOLDER.unnamed, n: n(r.r30) })),
    }));
  }
  return out;
}

// ---- today ----

export async function today(s: Scope, f: { location?: string | null }, flags: Flags, now = Date.now()): Promise<Pp3Today> {
  const accts = await accountsIn(s, f.location);
  const { rows, people } = await workloadRows(s, accts, flags, now);
  const mine = s.level === "self" ? rows.filter((r) => r.person.userId === s.selfId) : rows.filter((r) => !r.person.isAdmin || r.waitingOld > 0);
  const risks = s.level === "self" ? [] : await accountRisks(s, accts, now);
  const newPeople = s.level === "all" ? [...people.values()].filter((p) => p.isNew).length : 0;
  const lines = todayLines({
    waitingOld: mine.filter((r) => r.waitingOld >= 3).map((r) => ({ userId: r.person.userId, name: r.person.name, locationId: r.location.locationId, locationName: r.location.name, count: r.waitingOld })),
    idle: mine.filter((r) => r.idle).map((r) => ({ userId: r.person.userId, name: r.person.name, locationId: r.location.locationId, locationName: r.location.name, hours: r.idle!.hours, waiting: r.idle!.waitingLeads })),
    over: mine.filter((r) => r.load === "over").map((r) => ({ userId: r.person.userId, name: r.person.name, locationId: r.location.locationId, locationName: r.location.name, items: r.waiting + r.openDeals + r.upcoming, why: r.loadWhy ?? "" })),
    risks, newPeople, selfId: s.level === "self" ? s.selfId : null,
  });
  const top = lines[0] ?? null;
  const waitingOld = mine.reduce((t, r) => t + r.waitingOld, 0);
  const hist = await historyStarts(s.inst, accts.map((a) => a.id));
  return {
    lines, button: top ? { label: top.kind === "waiting" ? "See who is waiting" : top.kind === "idle" ? "See the leads waiting" : top.kind === "new_person" ? "Name them" : "Take a look", userId: top.userId, locationId: top.locationId, reason: top.reason, count: top.count } : null,
    people: new Set(rows.map((r) => r.person.userId)).size, accounts: accts.length, waitingOld, idleCount: mine.filter((r) => r.idle).length, overCount: mine.filter((r) => r.load === "over").length,
    headline: todaySentence({ things: lines.length, people: new Set(rows.map((r) => r.person.userId)).size, accounts: accts.length, self: s.level === "self" }).text, historyStarts: hist,
    usersState: accts.some((a) => a.usersAccess === "needs_permission") ? "needs_permission" : accts.length > 0 && accts.every((a) => a.usersAccess === "ok") ? "ok" : "unknown",
  };
}

// ---- the person panel ----

function periodStats(rows: Array<Record<string, unknown>>, from: Date, to: Date, weeks: number): PeriodStats {
  const sel = rows.filter((r) => { const t = new Date(r.day as string).getTime(); return t >= from.getTime() && t < to.getTime(); });
  const sum = (k: string) => sel.reduce((t, r) => t + n(r[k]), 0);
  const meds = sel.filter((r) => r.median_seconds !== null && n(r.first_replies) > 0).map((r) => n(r.median_seconds));
  return { firstReplies: sum("first_replies"), typicalReplySec: median(meds), inTime: sum("in_time"), apptsSet: sum("appts_set"), held: sum("held"), noShow: sum("no_show"), weeks };
}

export async function personPanel(s: Scope, userId: string, f: { from: Date; to: Date; location?: string | null }, o: { sort: Pp3Sort; dir?: "asc" | "desc" | null }, links: Links, days: number, now = Date.now()): Promise<Pp3PersonPanel | null> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const ids = accts.map((a) => a.id);
  if (!ids.length) return null;
  const people = await loadPeople(s, accts, [userId], now);
  const person = people.get(userId);
  if (!person) return null;
  const start = mondayOf(now) - 7 * 7 * DAY;
  const daily = await dailyFrom(s.inst, ids, new Date(Math.min(start, f.from.getTime() - (f.to.getTime() - f.from.getTime()))), now);
  const dailyRows = await db`select d.day::text as day, d.first_replies, d.in_time, d.median_seconds, d.appts_set, d.held, d.no_show, d.won_value from (${daily.f}) d where d.user_id = ${userId}`;
  const weeks: Pp3Week[] = [...Array(8)].map((_, k) => {
    const a = start + k * 7 * DAY, b = a + 7 * DAY;
    const sel = dailyRows.filter((r) => { const t = new Date(r.day as string).getTime(); return t >= a && t < b; });
    const fr = sel.reduce((t, r) => t + n(r.first_replies), 0), it = sel.reduce((t, r) => t + n(r.in_time), 0), held = sel.reduce((t, r) => t + n(r.held), 0), ns = sel.reduce((t, r) => t + n(r.no_show), 0);
    const meds = sel.filter((r) => r.median_seconds !== null && n(r.first_replies) > 0).map((r) => n(r.median_seconds));
    const m = median(meds);
    return { start: dayStr(new Date(a)), answeredFirst: fr, typicalReplySeconds: m === null ? null : Math.round(m), inTimePct: fr >= 5 ? Math.round((it / fr) * 100) : null, apptsSet: sel.reduce((t, r) => t + n(r.appts_set), 0), showedPct: held + ns >= 5 ? Math.round((held / (held + ns)) * 100) : null, wonValue: sel.reduce((t, r) => t + n(r.won_value), 0) };
  });
  const card = (await scorecards({ ...s, level: s.level }, { from: f.from, to: f.to, location: f.location, only: userId }, { sort: o.sort, dir: o.dir, size: 25 }, days, now)).rows[0] ?? null;
  const pairs = person.accounts.filter((a) => ids.includes(a.locationId)).map((a) => [a.locationId, userId] as [string, string]);
  const work = await workItems(s.inst, ids, pairs);
  const mine = [...work.values()].filter((w) => w.userId === userId);
  const { rows: wl } = await workloadRows(s, accts, { idle: false, actions: false }, now);
  const loadBy = new Map(wl.filter((r) => r.person.userId === userId).map((r) => [r.location.locationId, r.load]));
  const byId = new Map(accts.map((a) => [a.id, a]));
  const trend = await db`select day::text as day, sum(waiting + open_deals + upcoming)::int open from user_workload_daily where installation_id = ${s.inst} and user_id = ${userId} and location_id = any(${ids}::text[]) and day > (now() at time zone 'UTC')::date - 56 group by 1 order by 1`.catch(() => []);
  const away = person.away !== null;
  const ov = (await nextOverall(s, ids, [userId]))[0];
  const cur = periodStats(dailyRows, f.from, f.to, Math.max(1, days / 7));
  const waitingTotal = mine.reduce((t, w) => t + w.waiting, 0);
  const { prev, next } = await neighbours(s, ids, accts, userId, f, o, days, now);
  const only = accts.length === 1 ? accts[0].id : person.accounts.length === 1 ? person.accounts[0].locationId : null;
  return {
    person,
    headline: headlineOf({ name: person.name, answered: cur.firstReplies, typicalReplySec: cur.typicalReplySec, inTimePct: cur.firstReplies >= MIN_LEADS ? cur.inTime / cur.firstReplies : null, apptsSet: cur.apptsSet, waiting: waitingTotal, enough: cur.firstReplies >= 5, days }),
    weeks, scorecard: card,
    accounts: mine.filter((w) => byId.has(w.locationId)).map((w) => ({
      location: refOf(byId.get(w.locationId)!), role: person.role, waiting: w.waiting, waitingOld: w.waitingOld, openDeals: w.openDeals, openValue: w.openValue, staleDeals: w.staleDeals, upcoming: w.upcoming, needsOutcome: w.needsOutcome,
      lastTouchAt: iso(w.lastTouchAt), load: loadBy.get(w.locationId) ?? "unknown" as const,
    })).sort((a, b) => b.waiting - a.waiting || a.location.name.localeCompare(b.location.name)),
    workloadTrend: trend.length >= 2 ? trend.map((r) => ({ day: r.day as string, open: n(r.open) })) : [],
    nextLeadEligible: !away && !person.deleted && !person.isAdmin && n(ov?.n) >= MIN_NEXT_SAMPLE,
    openInCrmUrl: only ? links.account(only) : null, prev, next, historyStarts: card?.historyStarts ?? null,
  };
}

/** Per person: answered leads and the middle reply time over the last 90 days (the next-lead estimate and "eligible"). */
export async function nextOverall(s: Scope, ids: string[], users: string[]): Promise<Array<{ user_id: string; n: number; med: number | null }>> {
  if (!users.length) return [];
  const rows = await sql()`
    select lt.touch_user_id user_id, count(*)::int n, (percentile_cont(0.5) within group (order by greatest(0, extract(epoch from (lt.touch_at - coalesce(lt.clock_start, lt.lead_at))))))::float8 med
    from lead_touches lt where lt.installation_id = ${s.inst} and lt.location_id = any(${ids}::text[]) and lt.touch_user_id = any(${users}::text[]) and lt.excluded is null and lt.touch_at is not null and lt.lead_at > now() - interval '90 days'
    group by 1`;
  return rows.map((r) => ({ user_id: r.user_id as string, n: n(r.n), med: r.med === null ? null : Number(r.med) }));
}

async function neighbours(s: Scope, ids: string[], accts: Acct[], userId: string, f: { from: Date; to: Date; location?: string | null }, o: { sort: Pp3Sort; dir?: "asc" | "desc" | null }, days: number, now: number): Promise<{ prev: string | null; next: string | null }> {
  if (s.level === "self") return { prev: null, next: null };
  void accts; void days;
  const db = sql();
  const span = f.to.getTime() - f.from.getTime(), prevFrom = new Date(f.from.getTime() - span);
  const daily = await dailyFrom(s.inst, ids, prevFrom, now);
  const base = cardBase(s, ids, aggFrom(daily.f, { from: f.from, to: f.to }, prevFrom), { from: f.from, to: f.to }, o.sort);
  const dir = o.dir ?? DEFAULT_DIR[o.sort];
  const text = SORTS[o.sort].text;
  const me = await db`select b.sortv from (${base}) b where b.user_id = ${userId}`;
  if (!me.length) return { prev: null, next: null };
  const v = text ? String(me[0].sortv ?? "") : Number(me[0].sortv ?? 0);
  const after = dir === "asc" ? "asc" : "desc", before = dir === "asc" ? "desc" : "asc";
  const pick = async (where: "<" | ">", order: "asc" | "desc") => {
    const w = text ? db`(b.sortv, b.user_id) ${db.unsafe(where) as unknown as Frag} (${v as string}::text, ${userId}::text)` : db`(b.sortv, b.user_id) ${db.unsafe(where) as unknown as Frag} (${v as number}::float8, ${userId}::text)`;
    const r = await db`select b.user_id from (${base}) b where ${w} order by b.sortv ${db.unsafe(order) as unknown as Frag}, b.user_id ${db.unsafe(order) as unknown as Frag} limit 1`;
    return (r[0]?.user_id as string | undefined) ?? null;
  };
  const nextWhere = dir === "asc" ? ">" : "<", prevWhere = dir === "asc" ? "<" : ">";
  void after; void before;
  const [nx, pv] = await Promise.all([pick(nextWhere, dir), pick(prevWhere, dir === "asc" ? "desc" : "asc")]);
  return { prev: pv, next: nx };
}

// ---- coaching (reads PB's tables defensively) ----

export async function coaching(s: Scope, userId: string | null, f: { from: Date; to: Date; location?: string | null }, days: number, now = Date.now()): Promise<Pp3Coaching> {
  const db = sql();
  const accts = await accountsIn(s, f.location);
  const ids = accts.map((a) => a.id);
  const empty: Pp3Coaching = { person: null, oneThing: null, moves: [], notes: [], targets: [], people: [], historyStarts: null };
  if (!ids.length) return empty;
  const hist = await historyStarts(s.inst, ids);
  if (!userId) {
    if (s.level !== "all") return { ...empty, historyStarts: hist };
    const people = await loadPeople(s, accts, undefined, now);
    const notes = await db`select subject_user_id user_id, max(created_at) last_at from coaching_notes where installation_id = ${s.inst} and removed_at is null group by 1`.catch(() => []);
    const lastBy = new Map(notes.map((r) => [r.user_id as string, r.last_at as Date]));
    return { ...empty, historyStarts: hist, people: [...people.values()].filter((p) => !p.deleted && !p.isAdmin).map((p) => ({ person: p, lastNoteAt: iso(lastBy.get(p.userId) ?? null) })).sort((a, b) => (a.lastNoteAt ?? "").localeCompare(b.lastNoteAt ?? "")).slice(0, 100) };
  }
  const people = await loadPeople(s, accts, [userId], now);
  const person = people.get(userId) ?? null;
  if (!person) return { ...empty, historyStarts: hist };
  const end = new Date(Math.floor(now / DAY) * DAY + DAY), mid = new Date(end.getTime() - 28 * DAY), begin = new Date(mid.getTime() - 28 * DAY);
  const daily = await dailyFrom(s.inst, ids, begin, now);
  const rows = await db`select d.day::text as day, d.first_replies, d.in_time, d.median_seconds, d.appts_set, d.held, d.no_show from (${daily.f}) d where d.user_id = ${userId}`;
  const ms: Pp3Move[] = moves(periodStats(rows, mid, end, 4), periodStats(rows, begin, mid, 4));
  const viewerAll = s.level === "all";
  const notes = await db`select id::text id, subject_user_id, location_id, author_user_id, author_name, title, body, shared_with_subject shared, created_at from coaching_notes
    where installation_id = ${s.inst} and subject_user_id = ${userId} and removed_at is null
      ${viewerAll ? db`` : db`and (author_user_id = ${s.selfId ?? ""} or (shared_with_subject and subject_user_id = ${s.selfId ?? ""}))`} order by created_at desc limit 50`.catch(() => []);
  const targets = await db`select user_id, location_id, metric, target value from user_targets where installation_id = ${s.inst} and user_id = ${userId}`.catch(() => []);
  const LABEL: Record<string, string> = { reply_minutes: "Reply within (minutes)", in_time_share: "Answered in time (%)", appointments_week: "Appointments set per week", show_share: "Showed share (%)", won_value_month: "Won value per month" };
  return {
    person, oneThing: oneThing(ms), moves: ms, historyStarts: hist, people: [],
    notes: notes.map((r): Pp3Note => ({ id: r.id as string, userId: r.subject_user_id as string, locationId: (r.location_id as string | null) ?? null, title: (r.title as string) ?? "", authorName: (r.author_name as string | null) ?? "A team member", body: r.body as string, shared: r.shared === true, createdAt: iso(r.created_at) as string, canDelete: viewerAll || r.author_user_id === s.selfId })),
    targets: targets.map((r): Pp3Target => ({ userId: r.user_id as string, locationId: (r.location_id as string) || null, metric: r.metric as Pp3Target["metric"], value: n(r.value), label: LABEL[r.metric as string] ?? String(r.metric) })),
  };
}

export { WAIT_HOURS, MAX_ROWS, mondayOf };
export type { Db, Work };
