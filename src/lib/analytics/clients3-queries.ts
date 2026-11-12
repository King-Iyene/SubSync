import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { featureOn } from "../flags";
import { getSettings } from "./queries";
import { waitingPeopleByAccount, waitingPeoplePage, type ListScope } from "./unanswered-sql";
import { quietedMap } from "./clients-actions-queries";
import { receiptLine } from "./mn2";
import { meetingsOn, weekCountsByAccount } from "./mn2-queries";
import { countedInScope, dealIsStale, dealScopeJoins } from "./stage-rules-sql";
import { byAttention, clampSize, DAY, delta, levelOf, mondayOf, rate, reasonsOf, receiptLines, STALE_DEAL_DAYS, summaryOf, todayOf, applyQuiet, QUIET_DAYS, SYNC_OLD_HOURS, WAIT_OLD_HOURS, type AccountSignals } from "./clients3-intel";
import type {
  Cl3Account, Cl3Attention, Cl3Compare, Cl3Level, Cl3List, Cl3ListRow, Cl3Options, Cl3Overview, Cl3People, Cl3Person, Cl3Reason, Cl3Receipt, Cl3ReceiptList, Cl3Setup, Cl3SetupList, Cl3Side, Cl3Trends, Cl3TrendPoint,
} from "./clients3-types";

// The database side of the Clients module (round 3). Read only. EVERY read starts from `accountsIn`: the accounts of the caller's own installation, inside the caller's `allowed`
// set, narrowed by an optional single account. All later queries use that id list and filter by installation_id again. Ids from the request are validated by the route
// (ownedLocation) before they get here and are never echoed back.

type Db = ReturnType<typeof sql>;
type Frag = import("postgres").PendingQuery<import("postgres").Row[]>;
export type Scope = { inst: string; allowed: string[] | null };
export type Filters = { from: Date; to: Date; location?: string | null; q?: string | null; industry?: string | null; level?: Cl3Level | null };
export type Links = { account: (loc: string) => string; contact: (loc: string, contact: string) => string };

/** The scope the Unanswered screen uses, so "people waiting for a reply" is the same people here (round 4, docs/METRICS.md). */
async function waitScope(s: Scope, ids: string[], now: number): Promise<ListScope> {
  const [st, snooze, hide] = await Promise.all([getSettings(s.inst), featureOn("inbox_snooze"), featureOn("inbox_hide_noise")]);
  return { installationId: s.inst, allowed: ids, slaHours: st.slaHours, targetMinutes: st.speedTargetMinutes, now, meId: null, seePeople: true, hook: { snooze, hide } };
}

export const clientsCache =ttlCache<object>(60_000, 100);
/** Forget this installation's cached answers (the cache key starts with the installation id), so a quiet mark or a new target moves the ranking at once. */
export const forgetClients = (inst: string) => clientsCache.clear(JSON.stringify([inst]).slice(0, -1));
const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const cleanId = (v: unknown): string | null => (typeof v === "string" && ID.test(v) ? v : null);
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
const day = (d: Date) => d.toISOString().slice(0, 10);
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

type Acct = { id: string; name: string; industry: string | null; lastSyncAt: Date | null; appt: string | null; users: string | null };

/** The accounts in play (the ONE place a scope becomes ids). */
export async function accountsIn(s: Scope, f: Pick<Filters, "location" | "q" | "industry">): Promise<Acct[]> {
  const db = sql();
  if (s.allowed && s.allowed.length === 0) return [];
  const one = cleanId(f.location);
  const q = (f.q ?? "").trim().slice(0, 60);
  const rows = await db`
    select l.location_id, coalesce(nullif(l.name, ''), 'Client account') name, ap.industry, l.last_synced_at, l.appointments_access, l.users_access
    from locations l left join account_profiles ap on ap.installation_id = l.installation_id and ap.location_id = l.location_id
    where l.installation_id = ${s.inst} and not l.ignored
      ${s.allowed ? db`and l.location_id = any(${s.allowed}::text[])` : db``}
      ${one ? db`and l.location_id = ${one}` : db``}
      ${q ? db`and l.name ilike ${like(q)}` : db``}
      ${f.industry ? db`and ap.industry = ${f.industry.slice(0, 80)}` : db``}
    order by l.name nulls last, l.location_id limit 1000`;
  return rows.map((r) => ({ id: r.location_id as string, name: r.name as string, industry: (r.industry as string | null) ?? null, lastSyncAt: (r.last_synced_at as Date | null) ?? null, appt: (r.appointments_access as string | null) ?? null, users: (r.users_access as string | null) ?? null }));
}

// ---- the daily rollup (client_daily) and its live twin ----

/** One row per account per day, counted straight from the synced records. The hourly sweep writes exactly this into client_daily; screens use it live when the table is stale. */
function dailySource(inst: string, ids: string[], since: Date): Frag {
  const db = sql();
  const s = day(since);
  return db`
    select location_id, d as day, sum(new_leads)::int new_leads, sum(booked)::int booked, sum(showed)::int showed, sum(noshow)::int noshow, sum(deals_started)::int deals_started,
      sum(won)::int won, sum(won_value)::float8 won_value, sum(lost)::int lost, sum(lost_value)::float8 lost_value, sum(staff_messages)::int staff_messages
    from (
      select location_id, (date_added at time zone 'UTC')::date d, 1 new_leads, 0 booked, 0 showed, 0 noshow, 0 deals_started, 0 won, 0::float8 won_value, 0 lost, 0::float8 lost_value, 0 staff_messages
        from cached_contacts where installation_id = ${inst} and location_id = any(${ids}::text[]) and date_added >= ${s}::date
      union all
      select location_id, (created_remote_at at time zone 'UTC')::date, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0
        from cached_appointments where installation_id = ${inst} and location_id = any(${ids}::text[]) and created_remote_at >= ${s}::date and status is distinct from 'invalid'
      union all
      select location_id, (start_at at time zone 'UTC')::date, 0, 0, (status = 'showed')::int, (status = 'noshow')::int, 0, 0, 0, 0, 0, 0
        from cached_appointments where installation_id = ${inst} and location_id = any(${ids}::text[]) and start_at >= ${s}::date and start_at < now() and status in ('showed', 'noshow')
      union all
      select location_id, (created_remote_at at time zone 'UTC')::date, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0
        from cached_opportunities where installation_id = ${inst} and location_id = any(${ids}::text[]) and created_remote_at >= ${s}::date
      union all
      select location_id, (last_status_change_at at time zone 'UTC')::date, 0, 0, 0, 0, 0, 1, coalesce(monetary_value, 0)::float8, 0, 0, 0
        from cached_opportunities where installation_id = ${inst} and location_id = any(${ids}::text[]) and status = 'won' and last_status_change_at >= ${s}::date and coalesce(monetary_value, 0) > 0 and assigned_to is not null
      union all
      select location_id, (last_status_change_at at time zone 'UTC')::date, 0, 0, 0, 0, 0, 0, 0, 1, coalesce(monetary_value, 0)::float8, 0
        from cached_opportunities where installation_id = ${inst} and location_id = any(${ids}::text[]) and status = 'lost' and last_status_change_at >= ${s}::date and coalesce(monetary_value, 0) > 0 and assigned_to is not null
      union all
      select location_id, (at at time zone 'UTC')::date, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1
        from touch_events where installation_id = ${inst} and location_id = any(${ids}::text[]) and at >= ${s}::date and direction = 'outbound' and kind = 'message' and not automated and user_id is not null
    ) u where d is not null group by location_id, d`;
}

/** The sweep: upsert the last 120 days of every account's daily row, plus the contact totals. Safe to run twice. Returns rows written. */
export async function refreshClientRollup(inst: string, now = Date.now()): Promise<number> {
  const db = sql();
  const accts = await db`select location_id from locations where installation_id = ${inst} and not ignored`;
  const ids = accts.map((r) => r.location_id as string);
  if (!ids.length) return 0;
  const since = new Date(now - 120 * DAY);
  const wrote = await db`
    insert into client_daily (installation_id, location_id, day, new_leads, booked, showed, noshow, deals_started, won, won_value, lost, lost_value, staff_messages, refreshed_at)
    select ${inst}::uuid, s.location_id, s.day, s.new_leads, s.booked, s.showed, s.noshow, s.deals_started, s.won, s.won_value, s.lost, s.lost_value, s.staff_messages, now() from (${dailySource(inst, ids, since)}) s
    on conflict (installation_id, location_id, day) do update set new_leads = excluded.new_leads, booked = excluded.booked, showed = excluded.showed, noshow = excluded.noshow, deals_started = excluded.deals_started,
      won = excluded.won, won_value = excluded.won_value, lost = excluded.lost, lost_value = excluded.lost_value, staff_messages = excluded.staff_messages, refreshed_at = now()
    returning 1`;
  await db`
    insert into client_rollup_state (installation_id, location_id, refreshed_at, first_day, contacts, no_owner, no_phone)
    select ${inst}::uuid, l.location_id, now(), (select min(d.day) from client_daily d where d.installation_id = ${inst} and d.location_id = l.location_id),
      coalesce(c.total, 0), coalesce(c.no_owner, 0), coalesce(c.no_phone, 0)
    from locations l left join (
      select location_id, count(*)::int total, count(*) filter (where assigned_to is null)::int no_owner, count(*) filter (where coalesce(phone_digits, '') = '')::int no_phone
      from cached_contacts where installation_id = ${inst} group by 1) c on c.location_id = l.location_id
    where l.installation_id = ${inst} and not l.ignored
    on conflict (installation_id, location_id) do update set refreshed_at = now(), first_day = excluded.first_day, contacts = excluded.contacts, no_owner = excluded.no_owner, no_phone = excluded.no_phone`;
  return wrote.length;
}

/** The daily rows as a fragment: the table when every account's rollup is under two hours old, else the live scan (same columns). */
async function dailyFrom(inst: string, ids: string[], since: Date): Promise<{ f: Frag }> {
  const db = sql();
  try {
    const r = await db`select count(*)::int c from client_rollup_state where installation_id = ${inst} and location_id = any(${ids}::text[]) and refreshed_at > now() - interval '2 hours'`;
    if (ids.length && n(r[0]?.c) === ids.length) {
      return { f: db`select location_id, day, new_leads, booked, showed, noshow, deals_started, won, won_value, lost, lost_value, staff_messages from client_daily where installation_id = ${inst} and location_id = any(${ids}::text[]) and day >= ${day(since)}::date` };
    }
  } catch { /* table not created yet: use the live scan */ }
  return { f: dailySource(inst, ids, since) };
}

async function historyStarts(inst: string, ids: string[]): Promise<string | null> {
  try {
    const r = await sql()`select min(at)::date::text d from touch_events where installation_id = ${inst} and location_id = any(${ids}::text[])`;
    return (r[0]?.d as string | null) ?? null;
  } catch { return null; }
}

// ---- the per-account core ----

export type Core = Cl3Account & { showed: number; noshowN: number; lost: number; won: number };

type Staff = { userId: string; name: string; locationId: string; msgs: number; touched: number; lastAt: Date | null };
async function staffRows(inst: string, ids: string[], from: Date, to: Date, now: number): Promise<Staff[]> {
  if (!ids.length) return [];
  try {
    const rows = await sql()`
      select u.location_id, u.user_id, u.name, count(t.*) filter (where t.at >= ${from} and t.at < ${to})::int msgs, count(distinct t.contact_id) filter (where t.at >= ${from} and t.at < ${to})::int touched, max(t.at) last_at
      from location_users u
      left join touch_events t on t.installation_id = u.installation_id and t.location_id = u.location_id and t.user_id = u.user_id and t.direction = 'outbound' and t.kind = 'message' and not t.automated
        and t.at >= ${new Date(now - 90 * DAY)}
      where u.installation_id = ${inst} and u.location_id = any(${ids}::text[])
      group by u.location_id, u.user_id, u.name`;
    return rows.map((r) => ({ userId: r.user_id as string, name: r.name as string, locationId: r.location_id as string, msgs: n(r.msgs), touched: n(r.touched), lastAt: (r.last_at as Date | null) ?? null }));
  } catch { return []; }
}

async function quality(inst: string, ids: string[]): Promise<Map<string, { contacts: number; noOwner: number; noPhone: number; firstDay: string | null }>> {
  const out = new Map<string, { contacts: number; noOwner: number; noPhone: number; firstDay: string | null }>();
  if (!ids.length) return out;
  const db = sql();
  try {
    const st = await db`select location_id, contacts, no_owner, no_phone, first_day::text first_day from client_rollup_state where installation_id = ${inst} and location_id = any(${ids}::text[])`;
    for (const r of st) out.set(r.location_id as string, { contacts: n(r.contacts), noOwner: n(r.no_owner), noPhone: n(r.no_phone), firstDay: (r.first_day as string | null) ?? null });
  } catch { /* no table yet */ }
  const missing = ids.filter((i) => !out.has(i));
  if (missing.length) {
    const rows = await db`select location_id, count(*)::int total, count(*) filter (where assigned_to is null)::int no_owner, count(*) filter (where coalesce(phone_digits, '') = '')::int no_phone
      from cached_contacts where installation_id = ${inst} and location_id = any(${missing}::text[]) group by 1`;
    for (const r of rows) out.set(r.location_id as string, { contacts: n(r.total), noOwner: n(r.no_owner), noPhone: n(r.no_phone), firstDay: null });
  }
  return out;
}

/** Every account's numbers for the period and the one before. One small set of grouped queries, whatever the number of leads. */
export async function accountsCore(s: Scope, f: Filters, now = Date.now()): Promise<Core[]> {
  const db = sql();
  const accts = await accountsIn(s, f);
  const ids = accts.map((a) => a.id);
  if (!ids.length) return [];
  const span = f.to.getTime() - f.from.getTime();
  const prevFrom = new Date(f.from.getTime() - span);
  const spark0 = new Date(Math.floor(now / DAY) * DAY + DAY - 56 * DAY);
  const since = new Date(Math.min(prevFrom.getTime(), spark0.getTime()));
  const daily = await dailyFrom(s.inst, ids, since);
  const wk = (k: number) => day(new Date(spark0.getTime() + k * 7 * DAY));
  const weekCols = [...Array(8)].map((_, k) => `coalesce(sum(new_leads) filter (where day >= '${wk(k)}'::date and day < '${wk(k + 1)}'::date), 0)::int w${k}`).join(", ");
  const cur = (c: string) => `coalesce(sum(${c}) filter (where day >= '${day(f.from)}'::date and day < '${day(f.to)}'::date), 0)`;
  const prv = (c: string) => `coalesce(sum(${c}) filter (where day >= '${day(prevFrom)}'::date and day < '${day(f.from)}'::date), 0)`;
  const sums = ["new_leads", "booked", "won_value", "staff_messages", "showed", "noshow", "won", "lost"].map((c) => `${cur(c)}::float8 c_${c}, ${prv(c)}::float8 p_${c}`).join(", ");

  const [dRows, waitRows, apptRows, dealRows, staff, qual, speed, hist, quietBy] = await Promise.all([
    db`select d.location_id, ${db.unsafe(sums) as unknown as Frag}, ${db.unsafe(weekCols) as unknown as Frag} from (${daily.f}) d group by d.location_id`,
    // Round 4: the people the Unanswered screen lists (one definition, docs/METRICS.md), not raw conversations.
    waitScope(s, ids, now).then(waitingPeopleByAccount).then((m) => [...m].map(([location_id, v]) => ({ location_id, waiting: v.waiting, old: v.old }))),
    db`select location_id, count(*)::int unmarked from cached_appointments where installation_id = ${s.inst} and location_id = any(${ids}::text[])
       and status not in ('showed', 'noshow', 'cancelled', 'invalid') and start_at < now() - interval '3 hours' and start_at > now() - interval '90 days' group by 1`,
    db`select o.location_id, count(*)::int open_n, count(*) filter (where ${dealIsStale()})::int stale, coalesce(sum(o.monetary_value), 0)::float8 open_value
       from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()} group by 1`,
    staffRows(s.inst, ids, f.from, f.to, now),
    quality(s.inst, ids),
    db`select location_id, percentile_cont(0.5) within group (order by median_seconds)::float8 m from speed_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[])
       and day >= ${day(f.from)}::date and day < ${day(f.to)}::date and answered > 0 and median_seconds is not null group by 1`.catch(() => []),
    historyStarts(s.inst, ids),
    quietedMap(s.inst, ids, now).catch(() => new Map<string, string[]>()),
  ]);
  const by = <T extends Record<string, unknown>>(rows: T[]) => new Map(rows.map((r) => [r.location_id as string, r]));
  const D = by(dRows), W = by(waitRows), A = by(apptRows), O = by(dealRows), S = by(speed as Record<string, unknown>[]);
  const staffBy = new Map<string, Staff[]>();
  for (const x of staff) staffBy.set(x.locationId, [...(staffBy.get(x.locationId) ?? []), x]);

  return accts.map((a): Core => {
    const d = (D.get(a.id) ?? {}) as Record<string, unknown>;
    const q = qual.get(a.id) ?? { contacts: 0, noOwner: 0, noPhone: 0, firstDay: null };
    const st = staffBy.get(a.id) ?? [];
    const waiting = n(W.get(a.id)?.waiting), waitingOld = n(W.get(a.id)?.old), unmarked = n(A.get(a.id)?.unmarked);
    const openN = n(O.get(a.id)?.open_n), stale = n(O.get(a.id)?.stale);
    const quiet = st.filter((x) => !x.lastAt || x.lastAt.getTime() < now - QUIET_DAYS * DAY).length;
    const needsPermission = [a.appt === "needs_permission" ? "calendar" : null, a.users === "needs_permission" ? "users" : null].filter((x): x is string => !!x);
    const syncAge = a.lastSyncAt ? (now - a.lastSyncAt.getTime()) / 3_600_000 : null;
    const newLeads = delta(n(d.c_new_leads), n(d.p_new_leads));
    const noshowsN = n(d.c_noshow);
    const sig: AccountSignals = {
      newLeads, waiting, waitingOld, unmarked, noshows: noshowsN, staleDeals: stale, openDeals: openN, noOwner: rate(q.noOwner, q.contacts), noPhone: rate(q.noPhone, q.contacts),
      staffQuiet: quiet, syncAgeHours: syncAge, needsPermission, hasAnyData: q.contacts > 0 || n(d.c_new_leads) + n(d.p_new_leads) > 0,
    };
    // Quiet marks (Reports and Needs attention): a muted kind leaves the ranking; the real counts below stay.
    const muted = quietBy.get(a.id) ?? [];
    const shown = applyQuiet(sig, muted);
    const reasons = reasonsOf(shown);
    const level = levelOf(shown, reasons);
    const median = S.get(a.id)?.m;
    return {
      locationId: a.id, name: a.name, industry: a.industry, level, summary: level === "ok" || level === "unknown" ? null : summaryOf(reasons), reasons,
      newLeads, booked: delta(n(d.c_booked), n(d.p_booked)), wonValue: delta(n(d.c_won_value), n(d.p_won_value), 1),
      waiting, waitingOld, medianReplyMinutes: median === undefined || median === null ? null : Math.round((Number(median) / 60) * 10) / 10, unmarked, noshows: noshowsN,
      staleDealsPct: rate(stale, openN, 5), openValue: n(O.get(a.id)?.open_value),
      staffMessages: delta(n(d.c_staff_messages), n(d.p_staff_messages)), staffActive: st.filter((x) => x.msgs > 0).length, staffIdle: quiet,
      noOwnerPct: sig.noOwner, noPhonePct: sig.noPhone,
      lastSyncAt: iso(a.lastSyncAt), syncOld: syncAge === null || syncAge > SYNC_OLD_HOURS, needsPermission,
      sparkLeads: [...Array(8)].map((_, k) => n(d[`w${k}`])), historyStarts: hist ?? q.firstDay, enough: sig.hasAnyData, url: null, quieted: muted,
      showed: n(d.c_showed), noshowN: noshowsN, lost: n(d.c_lost), won: n(d.c_won),
    };
  });
}

const pub = (c: Core, links: Links): Cl3Account => {
  const { showed: _s, noshowN: _n, lost: _l, won: _w, ...rest } = c;
  void _s; void _n; void _l; void _w;
  return { ...rest, url: links.account(c.locationId) };
};

// ---- parts ----

export async function overview(s: Scope, f: Filters, days: number, links: Links, now = Date.now()): Promise<Cl3Overview> {
  const cores = (await accountsCore(s, f, now)).filter((a) => !f.level || a.level === f.level);
  const sum = (pick: (a: Core) => number) => cores.reduce((t, a) => t + pick(a), 0);
  const prevMin = (pick: (a: Core) => number) => sum(pick);
  const top = new Map<Cl3Reason, { reason: Cl3Reason; count: number; label: string; why: string; accounts: number }>();
  for (const a of cores) for (const r of a.reasons) { const e = top.get(r.reason); top.set(r.reason, e ? { ...e, count: e.count + r.count, accounts: e.accounts + 1 } : { ...r, accounts: 1 }); }
  const sorted = [...cores].sort(byAttention);
  const cnt = (l: Cl3Level) => cores.filter((a) => a.level === l).length;
  return {
    period: { from: f.from.toISOString(), to: f.to.toISOString(), days },
    today: todayOf(sorted), accounts: cores.length, ok: cnt("ok"), watch: cnt("watch"), act: cnt("act"), unknown: cnt("unknown"),
    totals: {
      newLeads: delta(sum((a) => a.newLeads.current), prevMin((a) => a.newLeads.previous)), booked: delta(sum((a) => a.booked.current), prevMin((a) => a.booked.previous)),
      wonValue: delta(sum((a) => a.wonValue.current), prevMin((a) => a.wonValue.previous), 1), waiting: sum((a) => a.waiting), unmarked: sum((a) => a.unmarked),
    },
    topReasons: [...top.values()].sort((a, b) => b.accounts - a.accounts || b.count - a.count).slice(0, 6).map(({ accounts: _a, ...r }) => { void _a; return r; }),
    worst: sorted.filter((a) => a.level === "act" || a.level === "watch").slice(0, 5).map((c) => pub(c, links)),
    historyStarts: cores.map((c) => c.historyStarts).filter((x): x is string => !!x).sort()[0] ?? null,
  };
}

const SORTS: Record<string, (a: Core, b: Core) => number> = {
  name: (a, b) => a.name.localeCompare(b.name), leads: (a, b) => b.newLeads.current - a.newLeads.current, waiting: (a, b) => b.waiting - a.waiting, won: (a, b) => b.wonValue.current - a.wonValue.current,
  unmarked: (a, b) => b.unmarked - a.unmarked, change: (a, b) => (a.newLeads.change ?? 9) - (b.newLeads.change ?? 9),
};
function pageOf<T>(all: T[], page: number, size: number) {
  const pages = Math.max(1, Math.ceil(all.length / size)), p = Math.min(Math.max(0, page), pages - 1);
  return { rows: all.slice(p * size, p * size + size), total: all.length, page: p, size, pages, truncated: all.length >= 1000 };
}

export async function attention(s: Scope, f: Filters, o: { page: number; size: number; sort: string | null; dir: string | null }, links: Links, now = Date.now()): Promise<Cl3Attention> {
  const all = await accountsCore(s, { ...f, level: null }, now);
  const levels = { act: 0, watch: 0, ok: 0, unknown: 0 };
  for (const a of all) levels[a.level]++;
  let rows = all.filter((a) => !f.level || a.level === f.level);
  const cmp = o.sort && SORTS[o.sort] ? SORTS[o.sort] : byAttention;
  rows = [...rows].sort(o.dir === "asc" && o.sort ? (a, b) => -cmp(a, b) : cmp);
  const p = pageOf(rows, o.page, clampSize(o.size));
  return { ...p, rows: p.rows.map((c) => pub(c, links)), levels };
}

export async function trends(s: Scope, f: Filters, grain: "week" | "month", o: { page: number; size: number }, now = Date.now()): Promise<Cl3Trends> {
  const db = sql();
  const accts = await accountsIn(s, f);
  const ids = accts.map((a) => a.id);
  const end = Math.floor(now / DAY) * DAY + DAY;
  const len = grain === "week" ? 7 * DAY : 30 * DAY;
  const currentFrom = new Date(end - len), previousFrom = new Date(end - 2 * len);
  const buckets = 12;
  const since = new Date(end - buckets * len);
  let points: Cl3TrendPoint[] = [];
  if (ids.length) {
    const daily = await dailyFrom(s.inst, ids, since);
    const rows = await db`select floor(((${day(new Date(end))}::date - d.day - 1)::float8) / ${len / DAY})::int b, sum(new_leads)::int new_leads, sum(booked)::int booked, sum(showed)::int showed, sum(noshow)::int noshow, sum(won)::int won,
      coalesce(sum(won_value), 0)::float8 won_value, sum(staff_messages)::int staff_messages from (${daily.f}) d where d.day >= ${day(since)}::date and d.day < ${day(new Date(end))}::date group by 1`;
    const m = new Map(rows.map((r) => [n(r.b), r]));
    points = [...Array(buckets)].map((_, i) => {
      const b = buckets - 1 - i, r = m.get(b) ?? {};
      return { start: day(new Date(end - (b + 1) * len)), newLeads: n(r.new_leads), booked: n(r.booked), showed: n(r.showed), noshow: n(r.noshow), won: n(r.won), wonValue: n(r.won_value), staffMessages: n(r.staff_messages), waitingEnd: null };
    });
  }
  const win = { ...f, from: currentFrom, to: new Date(end) };
  const cores = await accountsCore(s, win, now);
  const table = [...cores].sort((a, b) => (a.newLeads.change ?? 9) - (b.newLeads.change ?? 9) || a.name.localeCompare(b.name));
  const p = pageOf(table, o.page, clampSize(o.size));
  void previousFrom;
  return {
    grain, currentFrom: day(currentFrom), previousFrom: day(previousFrom), points,
    rows: { ...p, rows: p.rows.map((c) => ({ locationId: c.locationId, name: c.name, newLeads: c.newLeads, booked: c.booked, wonValue: c.wonValue, staffMessages: c.staffMessages, spark: c.sparkLeads })) },
    historyStarts: await historyStarts(s.inst, ids),
  };
}

/** `ids` are already checked by the route (ownedLocation) and are used only to pick among the accounts this scope may read. */
export async function compare(s: Scope, f: Filters, ids: string[], now = Date.now()): Promise<Cl3Compare> {
  const want = new Set(ids.map(cleanId).filter((x): x is string => !!x).slice(0, 2));
  const cores = (await accountsCore(s, { ...f, location: null, q: null }, now)).filter((c) => want.has(c.locationId));
  const sides: Cl3Side[] = cores.map((c) => ({
    locationId: c.locationId, name: c.name, industry: c.industry, level: c.level, newLeads: c.newLeads.current, booked: c.booked.current, showRate: rate(c.showed, c.showed + c.noshowN, 5),
    waiting: c.waiting, medianReplyMinutes: c.medianReplyMinutes, wonValue: c.wonValue.current, openValue: c.openValue, staleDealsPct: c.staleDealsPct, staffMessages: c.staffMessages.current, noOwnerPct: c.noOwnerPct, spark: c.sparkLeads,
  }));
  return { sides, period: { from: f.from.toISOString(), to: f.to.toISOString() } };
}

async function receiptsFor(s: Scope, ids: string[], accts: Acct[], week: Date, now: number): Promise<Cl3Receipt[]> {
  if (!ids.length) return [];
  const db = sql();
  const start = week, end = new Date(week.getTime() + 7 * DAY), prev = new Date(week.getTime() - 7 * DAY);
  const daily = await dailyFrom(s.inst, ids, prev);
  const cur = (c: string) => `coalesce(sum(${c}) filter (where day >= '${day(start)}'::date and day < '${day(end)}'::date), 0)`;
  const prv = (c: string) => `coalesce(sum(${c}) filter (where day >= '${day(prev)}'::date and day < '${day(start)}'::date), 0)`;
  const cols = ["new_leads", "booked", "showed", "noshow", "deals_started", "won", "won_value", "lost_value"].map((c) => `${cur(c)}::float8 c_${c}`).join(", ") + `, ${prv("new_leads")}::float8 p_new_leads`;
  const [dRows, spd, wait, unm, hist] = await Promise.all([
    db`select d.location_id, ${db.unsafe(cols) as unknown as Frag} from (${daily.f}) d where d.day >= ${day(prev)}::date and d.day < ${day(end)}::date group by 1`,
    db`select location_id, coalesce(sum(answered), 0)::int answered, coalesce(sum(within_target), 0)::int fast, percentile_cont(0.5) within group (order by median_seconds) filter (where median_seconds is not null and answered > 0)::float8 m
       from speed_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${day(start)}::date and day < ${day(end)}::date group by 1`.catch(() => []),
    db`select location_id, count(*)::int c from cached_conversations where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and last_message_direction = 'inbound' and last_message_at >= ${start} and last_message_at < ${end} group by 1`,
    db`select location_id, count(*)::int c from cached_appointments where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and start_at >= ${start} and start_at < ${end}
       and status not in ('showed', 'noshow', 'cancelled', 'invalid') and start_at < ${new Date(now - 3 * 3_600_000)} group by 1`,
    historyStarts(s.inst, ids),
  ]);
  const by = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [r.location_id as string, r]));
  const D = by(dRows), P = by(spd as Record<string, unknown>[]), W = by(wait), U = by(unm);
  // Recorded calls matched to each client this week (Meeting notes): one counts-only line, and only while the Meetings list is on.
  const calls = (await meetingsOn(s.inst)) ? await weekCountsByAccount(s.inst, ids, start, end) : new Map<string, { held: number; logged: number; noNextStep: number }>();
  return accts.map((a) => {
    const d = D.get(a.id) ?? {}, sp = P.get(a.id) ?? {};
    const r = {
      cameIn: n(d.c_new_leads), cameInPrev: n(d.p_new_leads), answered: n(sp.answered), stillWaiting: n(W.get(a.id)?.c),
      medianReplyMinutes: sp.m === undefined || sp.m === null ? null : Math.round((Number(sp.m) / 60) * 10) / 10,
      booked: n(d.c_booked), showed: n(d.c_showed), noshow: n(d.c_noshow), won: n(d.c_won), wonValue: n(d.c_won_value),
    };
    return {
      locationId: a.id, name: a.name, weekStart: day(start), weekEnd: day(new Date(end.getTime() - DAY)), enough: r.cameIn + r.booked + r.won > 0,
      ...r, answeredFast: n(sp.fast), unmarked: n(U.get(a.id)?.c), dealsStarted: n(d.c_deals_started), lostValue: n(d.c_lost_value), lines: [...receiptLines(r), ...(receiptLine(calls.get(a.id) ?? { held: 0, logged: 0, noNextStep: 0 }) ? [receiptLine(calls.get(a.id) as { held: number; logged: number; noNextStep: number }) as string] : [])], historyStarts: hist,
    };
  });
}

/** The week's proof receipt: one account (`one`) or every account the caller may read. Week = a Monday (UTC), default last week. */
export async function receipt(s: Scope, f: Pick<Filters, "q" | "industry">, one: string | null, weekParam: string | null, now = Date.now()): Promise<Cl3Receipt | Cl3ReceiptList | null> {
  const mon = /^\d{4}-\d{2}-\d{2}$/.test(weekParam ?? "") && Number.isFinite(Date.parse(weekParam as string)) ? mondayOf(Date.parse(weekParam as string)) : mondayOf(now) - 7 * DAY;
  const week = new Date(mon);
  const accts = await accountsIn(s, { location: one, q: f.q, industry: f.industry });
  const rows = await receiptsFor(s, accts.map((a) => a.id), accts, week, now);
  if (one) return rows[0] ?? null;
  return { weekStart: day(week), rows, total: rows.length };
}

export async function people(s: Scope, f: Filters, o: { page: number; size: number }, now = Date.now()): Promise<Cl3People> {
  const accts = await accountsIn(s, f);
  const ids = accts.map((a) => a.id);
  const names = new Map(accts.map((a) => [a.id, a.name]));
  const staff = await staffRows(s.inst, ids, f.from, f.to, now);
  const rows: Cl3Person[] = staff.map((x) => {
    const idleDays = x.lastAt ? Math.floor((now - x.lastAt.getTime()) / DAY) : null;
    return { userId: x.userId, name: x.name, locationId: x.locationId, accountName: names.get(x.locationId) ?? "Client account", messagesSent: x.msgs, leadsTouched: x.touched, lastActiveAt: iso(x.lastAt), idleDays, idle: !x.lastAt || idleDays! >= QUIET_DAYS };
  }).sort((a, b) => Number(b.idle) - Number(a.idle) || (b.idleDays ?? 999) - (a.idleDays ?? 999) || a.name.localeCompare(b.name));
  const withStaff = new Set(staff.map((x) => x.locationId));
  return { ...pageOf(rows, o.page, clampSize(o.size)), idleCount: rows.filter((r) => r.idle).length, accountsWithoutStaff: accts.filter((a) => !withStaff.has(a.id)).length };
}

export async function setup(s: Scope, f: Filters, o: { page: number; size: number }, now = Date.now()): Promise<Cl3SetupList> {
  const db = sql();
  const accts = await accountsIn(s, f);
  const ids = accts.map((a) => a.id);
  if (!ids.length) return { ...pageOf<Cl3Setup>([], 0, 20), needAction: 0 };
  const cnt = async (t: string) => by(await db`select location_id, count(*)::int c from ${db(t)} where installation_id = ${s.inst} and location_id = any(${ids}::text[]) group by 1`);
  const by = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [r.location_id as string, n(r.c)]));
  const [conv, appt, deals, qual, ch, us] = await Promise.all([cnt("cached_conversations"), cnt("cached_appointments"), cnt("cached_opportunities"), quality(s.inst, ids),
    db`select location_id, array_agg(distinct channel) chans from touch_events where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and at > now() - interval '30 days' and kind = 'message' group by 1`.catch(() => []),
    db`select location_id, count(*)::int c from location_users where installation_id = ${s.inst} and location_id = any(${ids}::text[]) group by 1`.catch(() => [])]);
  const chans = new Map((ch as Record<string, unknown>[]).map((r) => [r.location_id as string, (r.chans as string[]) ?? []]));
  const usersBy = new Map((us as Record<string, unknown>[]).map((r) => [r.location_id as string, n(r.c)]));
  const state = (v: string | null): "ok" | "needs_permission" | "unknown" => (v === "ok" ? "ok" : v === "needs_permission" ? "needs_permission" : "unknown");
  const rows: Cl3Setup[] = accts.map((a) => {
    const old = !a.lastSyncAt || now - a.lastSyncAt.getTime() > SYNC_OLD_HOURS * 3_600_000;
    const missing = [a.appt === "needs_permission" ? "calendar" : null, a.users === "needs_permission" ? "users" : null].filter(Boolean);
    return {
      locationId: a.id, name: a.name, connected: !!a.lastSyncAt, lastSyncAt: iso(a.lastSyncAt), syncOld: old, scopes: { calendar: state(a.appt), users: state(a.users) },
      message: missing.length ? "Needs permission: reconnect" : old ? (a.lastSyncAt ? "Not available from the platform yet: data is out of date" : "Waiting for the first sync") : null,
      contacts: qual.get(a.id)?.contacts ?? 0, conversations: conv.get(a.id) ?? 0, appointments: appt.get(a.id) ?? 0, deals: deals.get(a.id) ?? 0,
      channelsSeen: (chans.get(a.id) ?? []).sort(), users: usersBy.get(a.id) ?? 0, usersState: state(a.users),
      needsHelp: [
        ...(missing.length ? ["Reconnect to grant permission"] : []), ...(old ? ["Data is out of date"] : []),
        ...(state(a.users) === "ok" && !(usersBy.get(a.id) ?? 0) ? ["No team members found"] : []), ...((chans.get(a.id) ?? []).length === 0 && (conv.get(a.id) ?? 0) > 0 ? ["No messages sent or received in 30 days"] : []),
      ],
    };
  }).sort((a, b) => b.needsHelp.length - a.needsHelp.length || a.name.localeCompare(b.name));
  return { ...pageOf(rows, o.page, clampSize(o.size)), needAction: rows.filter((r) => r.needsHelp.length).length };
}

export async function options(s: Scope): Promise<Cl3Options> {
  const a = await accountsIn(s, {});
  return { accounts: a.map((x) => ({ locationId: x.id, name: x.name })), industries: [...new Set(a.map((x) => x.industry).filter((x): x is string => !!x))].sort() };
}

/** The exact rows behind one reason (what the count opens). Same rules as the counts in accountsCore. Offset paging, at most 100 per page. */
export async function list(s: Scope, f: Filters, reason: Cl3Reason, o: { page: number; size: number }, links: Links, now = Date.now()): Promise<Cl3List> {
  const db = sql();
  const accts = await accountsIn(s, f);
  const ids = accts.map((a) => a.id);
  const names = new Map(accts.map((a) => [a.id, a.name]));
  const size = clampSize(o.size), off = Math.min(Math.max(0, o.page), 500) * size;
  const label = reason.replace(/_/g, " ");
  const empty: Cl3List = { ...pageOf<Cl3ListRow>([], 0, size), reason, label };
  if (!ids.length) return empty;
  const row = (r: Record<string, unknown>, detail: string | null, at: unknown, value: number | null = null): Cl3ListRow => ({
    locationId: r.location_id as string, accountName: names.get(r.location_id as string) ?? "Client account", contactId: (r.contact_id as string | null) ?? null,
    contactName: ((r.contact_name as string | null) ?? "").trim() || "Unknown contact", detail, at: at ? iso(at) : null, value,
    url: r.contact_id ? links.contact(r.location_id as string, r.contact_id as string) : links.account(r.location_id as string),
  });
  let total = 0, rows: Cl3ListRow[] = [];
  const done = () => ({ ...pageOf(rows, 0, size), rows, total, page: Math.floor(off / size), pages: Math.max(1, Math.ceil(total / size)), reason, label, truncated: total > 500 * size });
  switch (reason) {
    case "waiting": case "waiting_old": {
      const old = reason === "waiting_old";
      const pg = await waitingPeoplePage(await waitScope(s, ids, now), { old, size, offset: off });
      total = pg.total;
      rows = pg.rows.map((r) => row({ location_id: r.locationId, contact_id: r.contactId, contact_name: r.name }, `Waiting ${r.hours} hours`, r.lastAt));
      break;
    }
    case "unmarked": case "noshows": {
      const cond = reason === "unmarked"
        ? db`a.status not in ('showed', 'noshow', 'cancelled', 'invalid') and a.start_at < now() - interval '3 hours' and a.start_at > now() - interval '90 days'`
        : db`a.status = 'noshow' and a.start_at >= ${f.from} and a.start_at < ${f.to}`;
      const base = db`from cached_appointments a left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id
        where a.installation_id = ${s.inst} and a.location_id = any(${ids}::text[]) and ${cond}`;
      total = n((await db`select count(*)::int c ${base}`)[0]?.c);
      rows = (await db`select a.location_id, a.contact_id, c.full_name contact_name, a.start_at, a.calendar_name ${base} order by a.start_at desc, a.appointment_id limit ${size} offset ${off}`).map((r) => row(r, (r.calendar_name as string | null) ?? null, r.start_at));
      break;
    }
    case "stale_deals": {
      const base = db`from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()}
        and ${dealIsStale()}`;
      total = n((await db`select count(*)::int c ${base}`)[0]?.c);
      rows = (await db`select o.location_id, o.contact_id, coalesce(o.contact_name, o.name) contact_name, o.stage_name, o.monetary_value::float8 v, coalesce(o.last_stage_change_at, o.created_remote_at) at ${base} order by v desc, o.opportunity_id limit ${size} offset ${off}`)
        .map((r) => row(r, `${(r.stage_name as string | null) ?? "Open"}, no movement since ${String(iso(r.at) ?? "").slice(0, 10)}`, r.at, n(r.v)));
      break;
    }
    case "leads_down": {
      const base = db`from cached_contacts where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and date_added >= ${f.from} and date_added < ${f.to}`;
      total = n((await db`select count(*)::int c ${base}`)[0]?.c);
      rows = (await db`select location_id, contact_id, full_name contact_name, date_added ${base} order by date_added desc, contact_id limit ${size} offset ${off}`).map((r) => row(r, "New lead", r.date_added));
      break;
    }
    case "no_owner": case "no_phone": {
      const cond = reason === "no_owner" ? db`assigned_to is null` : db`coalesce(phone_digits, '') = ''`;
      const base = db`from cached_contacts where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and ${cond}`;
      total = n((await db`select count(*)::int c ${base}`)[0]?.c);
      rows = (await db`select location_id, contact_id, full_name contact_name, date_added ${base} order by date_added desc nulls last, contact_id limit ${size} offset ${off}`).map((r) => row(r, reason === "no_owner" ? "No owner" : "No phone number", r.date_added));
      break;
    }
    case "staff_quiet": {
      const all = (await staffRows(s.inst, ids, f.from, f.to, now)).filter((x) => !x.lastAt || x.lastAt.getTime() < now - QUIET_DAYS * DAY);
      total = all.length;
      rows = all.slice(off, off + size).map((x) => ({ locationId: x.locationId, accountName: names.get(x.locationId) ?? "Client account", contactId: null, contactName: x.name, detail: x.lastAt ? `Last message ${iso(x.lastAt)?.slice(0, 10)}` : "No messages in 90 days", at: iso(x.lastAt), value: null, url: links.account(x.locationId) }));
      break;
    }
    case "sync_old": case "needs_permission": {
      const all = accts.filter((a) => (reason === "sync_old" ? !a.lastSyncAt || now - a.lastSyncAt.getTime() > SYNC_OLD_HOURS * 3_600_000 : a.appt === "needs_permission" || a.users === "needs_permission"));
      total = all.length;
      rows = all.slice(off, off + size).map((a) => ({ locationId: a.id, accountName: a.name, contactId: null, contactName: a.name, detail: reason === "needs_permission" ? "Needs permission: reconnect" : a.lastSyncAt ? `Last refreshed ${iso(a.lastSyncAt)?.slice(0, 16).replace("T", " ")}` : "Not synced yet", at: iso(a.lastSyncAt), value: null, url: links.account(a.id) }));
      break;
    }
  }
  return done();
}

export async function exportCsv(s: Scope, f: Filters, links: Links, now = Date.now()): Promise<string> {
  const cores = (await accountsCore(s, f, now)).sort(byAttention);
  const esc = (v: unknown) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ["Account", "Status", "Why", "New leads", "Previous period", "Appointments booked", "Replies waiting", "Waiting over a day", "Bookings with no outcome", "No-shows", "Won value", "Open deal value", "Link"];
  const lines = [head.join(",")];
  for (const a of cores) lines.push([a.name, a.level, a.summary ?? "", a.newLeads.current, a.newLeads.previous, a.booked.current, a.waiting, a.waitingOld, a.unmarked, a.noshows, Math.round(a.wonValue.current), Math.round(a.openValue), links.account(a.locationId)].map(esc).join(","));
  return lines.join("\n");
}
