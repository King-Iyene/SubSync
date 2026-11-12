import { sql } from "../db";
import { ttlCache } from "../ttl-cache";
import { accountsCore, accountsIn, clientsCache, list as clientList, receipt as clientReceipt, type Core, type Filters, type Links } from "./clients3-queries";
import { clampSize, STALE_DEAL_DAYS, WAIT_OLD_HOURS } from "./clients3-intel";
import { NOSHOW_WINDOW_DAYS, UNMARKED_WINDOW_DAYS } from "../design/deep-link";
import { changeText, DAY, headlineOf, KIND_SHORT, KIND_TEXT, localDay, MAX_ITEMS, medianOf, MIN_FIX_SAMPLES, MIN_REPLIES, planRecord, proofLines, rankItems, recentWeeks, showRate, validZone, type Prev } from "./today3-intel";
import { countedInScope, dealScopeJoins } from "./stage-rules-sql";
import type {
  Td3Account, Td3Done, Td3Item, Td3Kind, Td3List, Td3ListKind, Td3Mine, Td3Numbers, Td3Options, Td3Proof, Td3ProofRow, Td3Row, Td3Settings, Td3Tile, Td3Today,
} from "./today3-types";
import { TD3_KINDS } from "./today3-types";

// The database side of Today. Read only except the sweep (recordToday, writeReceipts) and the SubSync-only notes (snoozes, settings, opened). EVERY read starts from the accounts of the
// caller's own installation inside the caller's `allowed` set (clients3 accountsIn, the one place a scope becomes ids); ids from a request are checked by the route (ownedLocation) before
// they get here and are never echoed. The counts come from the Clients module (accountsCore), so a number here equals the same number there, and a list opens exactly the accounts
// that have the item (counts equal rows).

type Frag = import("postgres").PendingQuery<import("postgres").Row[]>;
export type Level = "all" | "account" | "self";
export type Scope = { inst: string; allowed: string[] | null; level: Level; selfId: string | null };
export const todayCache = ttlCache<object>(45_000, 100);
export const forgetToday = (inst: string) => {
  boardCache.clear(JSON.stringify([inst]).slice(0, -1)); todayCache.clear(JSON.stringify([inst]).slice(0, -1)); clientsCache.clear(JSON.stringify([inst]).slice(0, -1)); };
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(v as string).toISOString() : null);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Items a team member (own queue) sees from the account: the work, not the management signals. */
const SELF_KINDS: readonly Td3Kind[] = ["waiting_old", "waiting", "unmarked", "noshows", "stale_deals"];

/** The 7 days Today looks at: the current UTC day and the 6 before, ending tomorrow 00:00 (the same window the Clients rollup uses). */
function window7(now: number): Filters {
  const to = new Date(Math.floor(now / DAY) * DAY + DAY);
  return { from: new Date(to.getTime() - 7 * DAY), to, location: null, q: null, industry: null, level: null };
}

type Snooze = { id: string; kind: Td3Kind; location: string; until: Date };
async function snoozesOf(inst: string): Promise<Snooze[]> {
  try {
    const rows = await sql()`select id, kind, location_id, until_at from td_snoozes where installation_id = ${inst} and released_at is null and until_at > now() order by until_at`;
    return rows.map((r) => ({ id: r.id as string, kind: r.kind as Td3Kind, location: r.location_id as string, until: r.until_at as Date }));
  } catch { return []; }
}

async function zoneOf(inst: string, ids: string[]): Promise<string> {
  if (!ids.length) return "UTC";
  try {
    const rows = await sql()`select timezone, count(*)::int c from locations where installation_id = ${inst} and location_id = any(${ids}::text[]) and coalesce(timezone, '') <> '' group by 1 order by 2 desc limit 1`;
    return validZone((rows[0]?.timezone as string | null) ?? "UTC");
  } catch { return "UTC"; }
}

/** The accounts whose item `kind` is on the board right now (after Clients' quiet marks), from the same cores the board uses. */
const hasKind = (c: Core, kind: Td3Kind) => c.reasons.some((r) => r.reason === (kind as string));
const countOf = (c: Core, kind: Td3Kind): number => {
  const r = c.reasons.find((x) => x.reason === (kind as string));
  if (!r) return 0;
  return kind === "leads_down" ? c.newLeads.current : kind === "needs_permission" || kind === "sync_old" ? 1 : r.count;
};

async function oldestAndMoney(inst: string, byKind: Map<Td3Kind, string[]>, now: number): Promise<Map<Td3Kind, { oldestHours: number | null; money: number | null }>> {
  const db = sql();
  const out = new Map<Td3Kind, { oldestHours: number | null; money: number | null }>();
  const hours = (d: unknown) => (d ? Math.max(0, (now - new Date(d as string).getTime()) / 3_600_000) : null);
  const tasks: Array<Promise<void>> = [];
  const waitingIds = new Set([...(byKind.get("waiting_old") ?? []), ...(byKind.get("waiting") ?? [])]);
  const moneyFor = async (ids: string[], old: boolean) => ids.length ? n((await db`
    select coalesce(sum(o.monetary_value), 0)::float8 v from cached_opportunities o ${dealScopeJoins()}
    where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()} and coalesce(o.monetary_value, 0) > 0
      and exists (select 1 from cached_conversations c where c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = o.contact_id and c.last_message_direction = 'inbound'
        and c.last_message_at > now() - interval '30 days' ${old ? db`and c.last_message_at < now() - ${`${WAIT_OLD_HOURS} hours`}::interval` : db``})`)[0]?.v) : 0;
  for (const kind of ["waiting_old", "waiting"] as const) {
    const ids = byKind.get(kind) ?? [];
    if (!ids.length) continue;
    tasks.push((async () => {
      const [m, o] = await Promise.all([
        moneyFor(ids, kind === "waiting_old").catch(() => 0),
        db`select min(last_message_at) d from cached_conversations where installation_id = ${inst} and location_id = any(${ids}::text[]) and last_message_direction = 'inbound' and last_message_at > now() - interval '30 days'
           ${kind === "waiting_old" ? db`and last_message_at < now() - ${`${WAIT_OLD_HOURS} hours`}::interval` : db``}`.catch(() => []),
      ]);
      out.set(kind, { oldestHours: hours(o[0]?.d), money: m > 0 ? Math.round(m) : null });
    })());
  }
  void waitingIds;
  const un = byKind.get("unmarked") ?? [];
  if (un.length) tasks.push((async () => {
    const o = await db`select min(start_at) d from cached_appointments where installation_id = ${inst} and location_id = any(${un}::text[]) and status not in ('showed', 'noshow', 'cancelled', 'invalid') and start_at < now() - interval '3 hours' and start_at > now() - interval '90 days'`.catch(() => []);
    out.set("unmarked", { oldestHours: hours(o[0]?.d), money: null });
  })());
  const ns = byKind.get("noshows") ?? [];
  if (ns.length) tasks.push((async () => {
    const o = await db`select min(start_at) d from cached_appointments where installation_id = ${inst} and location_id = any(${ns}::text[]) and status = 'noshow' and start_at > now() - interval '7 days'`.catch(() => []);
    out.set("noshows", { oldestHours: hours(o[0]?.d), money: null });
  })());
  const st = byKind.get("stale_deals") ?? [];
  if (st.length) tasks.push((async () => {
    const o = await db`
      select coalesce(sum(o.monetary_value), 0)::float8 v, min(coalesce(o.last_stage_change_at, o.created_remote_at)) d
      from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${inst} and o.location_id = any(${st}::text[]) and o.status = 'open' and ${countedInScope()}
        and coalesce(o.last_stage_change_at, o.created_remote_at) < now() - ${`${STALE_DEAL_DAYS} days`}::interval`.catch(() => []);
    out.set("stale_deals", { oldestHours: hours(o[0]?.d), money: n(o[0]?.v) > 0 ? Math.round(n(o[0]?.v)) : null });
  })());
  await Promise.all(tasks);
  return out;
}

/** My queue (a team member): waiting people whose contact is mine, my appointments with no outcome, my quiet deals. One condition builder serves the count and the rows. */
function mineCond(kind: "mine_waiting" | "mine_unmarked" | "mine_stale", inst: string, ids: string[], me: string): Frag {
  const db = sql();
  if (kind === "mine_waiting") return db`from cached_conversations v join cached_contacts c on c.installation_id = v.installation_id and c.location_id = v.location_id and c.contact_id = v.contact_id
    where v.installation_id = ${inst} and v.location_id = any(${ids}::text[]) and c.assigned_to = ${me} and v.last_message_direction = 'inbound' and v.last_message_at > now() - interval '30 days'`;
  if (kind === "mine_unmarked") return db`from cached_appointments a left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id
    where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and a.assigned_to = ${me} and a.status not in ('showed', 'noshow', 'cancelled', 'invalid') and a.start_at < now() - interval '3 hours' and a.start_at > now() - interval '90 days'`;
  return db`from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${inst} and o.location_id = any(${ids}::text[]) and o.assigned_to = ${me} and o.status = 'open' and ${countedInScope()}
    and coalesce(o.last_stage_change_at, o.created_remote_at) < now() - ${`${STALE_DEAL_DAYS} days`}::interval`;
}
async function mineOf(s: Scope, ids: string[]): Promise<Td3Mine | null> {
  if (s.level !== "self" || !s.selfId || !ids.length) return null;
  const db = sql(), me = s.selfId;
  const c = async (k: "mine_waiting" | "mine_unmarked" | "mine_stale") => n((await db`select count(*)::int c ${mineCond(k, s.inst, ids, me)}`.catch(() => [{ c: 0 }]))[0]?.c);
  const [waiting, unmarked, stale] = await Promise.all([c("mine_waiting"), c("mine_unmarked"), c("mine_stale")]);
  const total = waiting + unmarked + stale;
  const top: Array<[Td3ListKind, number, string]> = [["mine_waiting", waiting, `Reply to your ${waiting} ${waiting === 1 ? "person" : "people"}`], ["mine_unmarked", unmarked, `Mark your ${unmarked} appointment${unmarked === 1 ? "" : "s"}`], ["mine_stale", stale, `Wake up your ${stale} deal${stale === 1 ? "" : "s"}`]];
  const first = top.find((t) => t[1] > 0);
  return { waiting, unmarked, stale, total, button: first ? { label: first[2], list: first[0], count: first[1] } : null };
}

export type Board = { cores: Core[]; f: Filters };
// The per-account counts are the heaviest read; the ranked list and the list a tap opens share them for 30 seconds (same caller, same account choice, same day).
const boardCache = ttlCache<Board>(30_000, 50);
export async function board(s: Scope, one: string | null, now: number): Promise<Board> {
  const f = { ...window7(now), location: one };
  const key = JSON.stringify([s.inst, s.allowed, one, Math.floor(now / DAY)]);
  const hit = boardCache.get(key);
  if (hit) return hit;
  const b = { cores: await accountsCore({ inst: s.inst, allowed: s.allowed }, f, now), f };
  boardCache.set(key, b);
  return b;
}

/** The ranked list for today. Cached for 45 seconds per caller. */
export async function today(s: Scope, one: string | null, now = Date.now()): Promise<Td3Today> {
  const [{ cores, f }, snoozes] = await Promise.all([board(s, one, now), snoozesOf(s.inst)]);
  // "Needs permission" is one notice at the top of the screen (not a ranked item), so it is not shown twice.
  const kinds = s.level === "self" ? SELF_KINDS : TD3_KINDS.filter((k) => k !== "needs_permission");
  const snoozed: Td3Today["snoozed"] = [];
  const raw: Array<Omit<Td3Item, "rankWhy" | "module" | "label" | "why"> & { labelOverride?: string }> = [];
  const byKindIds = new Map<Td3Kind, string[]>();
  for (const kind of kinds) {
    const all = cores.filter((c) => hasKind(c, kind));
    if (!all.length) continue;
    const sn = (c: Core) => snoozes.find((z) => z.kind === kind && (z.location === "*" || z.location === c.locationId));
    const live = all.filter((c) => !sn(c)), hidden = all.filter((c) => sn(c));
    for (const z of snoozes.filter((x) => x.kind === kind)) {
      const cs = hidden.filter((c) => z.location === "*" || z.location === c.locationId);
      if (cs.length) snoozed.push({ id: z.id, kind, label: KIND_TEXT[kind].label(cs.reduce((t, c) => t + countOf(c, kind), 0)), count: cs.reduce((t, c) => t + countOf(c, kind), 0), until: z.until.toISOString(), locationId: z.location === "*" ? null : z.location });
    }
    if (!live.length) continue;
    byKindIds.set(kind, live.map((c) => c.locationId));
    const count = live.reduce((t, c) => t + countOf(c, kind), 0);
    const top: Td3Account[] = live.map((c) => ({ locationId: c.locationId, name: c.name, count: countOf(c, kind) })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 3);
    const prevLeads = live.reduce((t, c) => t + c.newLeads.previous, 0);
    raw.push({ kind, count, accounts: live.length, money: null, oldestHours: null, top, ...(kind === "leads_down" ? { labelOverride: `New leads are down: ${count} this week, ${prevLeads} the week before` } : {}) });
  }
  const ids = cores.map((c) => c.locationId);
  const [extra, tz, ledger, mine, hist] = await Promise.all([oldestAndMoney(s.inst, byKindIds, now), zoneOf(s.inst, ids), doneToday(s.inst, ids, now), mineOf(s, ids), historyStartsOf(s.inst, ids)]);
  const ranked = rankItems(raw.map((r) => ({ ...r, ...(extra.get(r.kind) ?? {}) }))).map((it) => { const o = raw.find((r) => r.kind === it.kind)?.labelOverride; return o ? { ...it, label: o } : it; });
  const items = ranked.slice(0, MAX_ITEMS);
  const { headline, button } = headlineOf(items, cores.length);
  const counts = await apptCounts(s.inst, ids);
  const needsPermission = cores.filter((c) => c.needsPermission.length > 0).length;
  void f;
  const scope = one ? (cores[0]?.name ?? "This client account") : cores.length === 1 ? cores[0].name : `All ${cores.length} client accounts`;
  return {
    headline: mine && mine.total > 0 && s.level === "self" ? `You have ${mine.total} ${mine.total === 1 ? "thing" : "things"} waiting on you today.` : headline,
    button: mine && mine.button && s.level === "self" ? null : button,
    items, counts, snoozed,
    done: ledger.done,
    allClear: items.length === 0 && cores.length > 0 ? { fixedSinceYesterday: ledger.sinceYesterday, lastFixedAt: ledger.lastAt } : null,
    accounts: cores.length, scope, mine, needsPermission, historyStarts: hist, timezone: tz,
  };
}

export async function historyStartsOf(inst: string, ids: string[]): Promise<string | null> {
  if (!ids.length) return null;
  try {
    const r = await sql()`select min(day)::text as d from td_daily_items where installation_id = ${inst} and location_id = any(${ids}::text[]) and baseline`;
    return (r[0]?.d as string | null) ?? null;
  } catch { return null; }
}

/** Cleared today (each account's own day) and since yesterday, from the ledger. Empty until the sweep has written a day. */
async function doneToday(inst: string, ids: string[], now: number): Promise<{ done: Td3Done[]; sinceYesterday: number; lastAt: string | null }> {
  const none = { done: [] as Td3Done[], sinceYesterday: 0, lastAt: null as string | null };
  if (!ids.length) return none;
  try {
    const rows = await sql()`
      select d.kind, sum(d.cleared) filter (where d.day = (${new Date(now)}::timestamptz at time zone coalesce(nullif(l.timezone, ''), 'UTC'))::date)::int today_n,
        sum(d.cleared) filter (where d.day >= (${new Date(now)}::timestamptz at time zone coalesce(nullif(l.timezone, ''), 'UTC'))::date - 1)::int since_n, max(d.last_cleared_at) last_at
      from td_daily_items d join locations l on l.installation_id = d.installation_id and l.location_id = d.location_id
      where d.installation_id = ${inst} and d.location_id = any(${ids}::text[]) and d.day >= (${new Date(now)}::timestamptz at time zone 'UTC')::date - 2 group by d.kind`;
    const done = rows.filter((r) => n(r.today_n) > 0 && (TD3_KINDS as readonly string[]).includes(r.kind as string))
      .map((r): Td3Done => ({ kind: r.kind as Td3Kind, label: KIND_SHORT[r.kind as Td3Kind], cleared: n(r.today_n), lastAt: iso(r.last_at) }));
    const last = rows.map((r) => r.last_at as Date | null).filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return { done, sinceYesterday: rows.reduce((t, r) => t + n(r.since_n), 0), lastAt: iso(last) };
  } catch { return none; }
}

// ---- the two appointment cards: one rule, shared with Appointments (Needs outcome, No-show recovery) ----

/** Past appointments nobody marked: 3 hours after the start, not showed, no-show, cancelled or invalid, from the first day of the last 90 days (UTC, like the Appointments dates), not deleted.
 *  No-shows: the last 7 days, not booked again, not snoozed. Same conditions as appointments3-queries `base()` (unmarked, rebooked, snoozed_until), so the card and the list agree. */
function apptFrom(inst: string, ids: string[], kind: "unmarked" | "noshows") {
  const db = sql();
  const cond = kind === "unmarked"
    ? db`a.status not in ('showed', 'noshow', 'cancelled', 'invalid') and a.start_at < now() - interval '3 hours' and a.start_at >= (date_trunc('day', now() at time zone 'UTC') - ${`${UNMARKED_WINDOW_DAYS} days`}::interval) at time zone 'UTC'`
    : db`a.status = 'noshow' and a.start_at >= now() - ${`${NOSHOW_WINDOW_DAYS} days`}::interval and a.start_at < now() and (fa.snoozed_until is null or fa.snoozed_until < now())
        and not exists (select 1 from cached_appointments b where b.installation_id = a.installation_id and b.location_id = a.location_id and b.contact_id = a.contact_id and a.contact_id is not null and b.start_at > a.start_at and b.appointment_id <> a.appointment_id and b.status not in ('cancelled', 'invalid'))`;
  return db`from cached_appointments a left join appointment_facts fa on fa.installation_id = a.installation_id and fa.location_id = a.location_id and fa.appointment_id = a.appointment_id
    left join cached_contacts c on c.installation_id = a.installation_id and c.location_id = a.location_id and c.contact_id = a.contact_id and a.contact_id is not null
    where a.installation_id = ${inst} and a.location_id = any(${ids}::text[]) and fa.deleted_at is null and ${cond}`;
}
async function apptCounts(inst: string, ids: string[]): Promise<{ unmarked: number; noshows: number }> {
  if (!ids.length) return { unmarked: 0, noshows: 0 };
  const db = sql();
  const [u, ns] = await Promise.all([
    db`select count(*)::int c ${apptFrom(inst, ids, "unmarked")}`.catch(() => [{ c: 0 }]),
    db`select count(*)::int c ${apptFrom(inst, ids, "noshows")}`.catch(() => [{ c: 0 }]),
  ]);
  return { unmarked: n(u[0]?.c), noshows: n(ns[0]?.c) };
}

// ---- the rows behind a count ----

const pageOf = <T,>(rows: T[], total: number, page: number, size: number) => ({ rows, total, page, size, pages: Math.max(1, Math.ceil(total / size)), truncated: total > 500 * size });

export async function listRows(s: Scope, one: string | null, kind: Td3ListKind, o: { page: number; size: number }, links: Links, now = Date.now()): Promise<Td3List> {
  const size = clampSize(o.size), page = Math.min(Math.max(0, o.page), 500), off = page * size;
  const db = sql();
  const empty = { ...pageOf<Td3Row>([], 0, page, size), kind, label: String(kind).replace(/_/g, " ") };
  const { cores, f } = await board(s, one, now);
  const ids = cores.map((c) => c.locationId);
  if (!ids.length) return empty;
  const row = (r: Record<string, unknown>, detail: string | null, at: unknown, value: number | null = null): Td3Row => ({
    locationId: r.location_id as string, accountName: cores.find((c) => c.locationId === r.location_id)?.name ?? "Client account", contactId: (r.contact_id as string | null) ?? null,
    contactName: ((r.contact_name as string | null) ?? "").trim() || "Unknown contact", detail, at: at ? iso(at) : null, value,
    url: r.contact_id ? links.contact(r.location_id as string, r.contact_id as string) : links.account(r.location_id as string),
  });
  const mineKind = kind === "mine_waiting" || kind === "mine_unmarked" || kind === "mine_stale";
  if (mineKind) {
    if (s.level !== "self" || !s.selfId) return empty;
    const base = mineCond(kind, s.inst, ids, s.selfId);
    const total = n((await db`select count(*)::int c ${base}`)[0]?.c);
    const rows = kind === "mine_waiting" ? await db`select v.location_id, v.contact_id, v.contact_name, v.last_message_at at ${base} order by v.last_message_at asc, v.conversation_id limit ${size} offset ${off}`
      : kind === "mine_unmarked" ? await db`select a.location_id, a.contact_id, c.full_name contact_name, a.start_at at, a.calendar_name det ${base} order by a.start_at desc, a.appointment_id limit ${size} offset ${off}`
      : await db`select o.location_id, o.contact_id, coalesce(o.contact_name, o.name) contact_name, o.stage_name det, o.monetary_value::float8 v, coalesce(o.last_stage_change_at, o.created_remote_at) at ${base} order by v desc nulls last, o.opportunity_id limit ${size} offset ${off}`;
    return { ...pageOf(rows.map((r) => row(r, kind === "mine_waiting" ? `Waiting ${Math.max(0, Math.round((now - new Date(r.at as Date).getTime()) / 3_600_000))} hours` : ((r.det as string | null) ?? null), r.at, kind === "mine_stale" ? n(r.v) : null)), total, page, size), kind, label: kind === "mine_waiting" ? "Waiting on you" : kind === "mine_unmarked" ? "Your appointments with no outcome" : "Your quiet deals" };
  }
  if (kind === "all_unmarked" || kind === "open_noshows") {
    const k = kind === "all_unmarked" ? "unmarked" : "noshows", base = apptFrom(s.inst, ids, k);
    const total = n((await db`select count(*)::int c ${base}`)[0]?.c);
    const rows = await db`select a.location_id, a.contact_id, c.full_name contact_name, a.start_at, a.calendar_name ${base} order by a.start_at desc, a.appointment_id limit ${size} offset ${off}`;
    return { ...pageOf(rows.map((r) => row(r, (r.calendar_name as string | null) ?? null, r.start_at)), total, page, size), kind, label: k === "unmarked" ? "Appointments with no outcome marked" : "No-shows not booked again" };
  }
  if (kind === "open_deals") {
    const base = db`from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()} and coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null`;
    const total = n((await db`select count(*)::int c ${base}`)[0]?.c);
    const rows = await db`select o.location_id, o.contact_id, coalesce(o.contact_name, o.name) contact_name, o.stage_name, o.monetary_value::float8 v, coalesce(o.last_stage_change_at, o.created_remote_at) at ${base} order by v desc, o.opportunity_id limit ${size} offset ${off}`;
    return { ...pageOf(rows.map((r) => row(r, (r.stage_name as string | null) ?? "Open", r.at, n(r.v))), total, page, size), kind, label: "Open deals" };
  }
  // The Clients lists, over exactly the accounts that carry the item (so the total equals the count).
  const map: Record<string, { reason: string; pick: (c: Core) => boolean }> = {
    all_waiting: { reason: "waiting", pick: (c) => c.waiting > 0 }, all_noshows: { reason: "noshows", pick: (c) => c.noshowN > 0 }, all_stale: { reason: "stale_deals", pick: (c) => c.staleDealsPct.n > 0 },
  };
  const m = map[kind as string];
  const sel = m ? cores.filter(m.pick).map((c) => c.locationId) : cores.filter((c) => hasKind(c, kind as Td3Kind)).map((c) => c.locationId);
  if (!sel.length) return empty;
  if (s.level === "self" && !m && !SELF_KINDS.includes(kind as Td3Kind)) return empty;
  const r = await clientList({ inst: s.inst, allowed: sel }, f, (m ? m.reason : kind) as never, { page, size }, links, now);
  return { ...r, kind, label: KIND_TEXT[kind as Td3Kind]?.label(r.total) ?? r.label } as Td3List;
}

// ---- the sweep: record what was found and cleared ----

/** Writes today's ledger (account-local day) for every account and kind from the same counts the board shows. Idempotent: the same counts twice change nothing. Returns rows written. */
export async function recordToday(inst: string, now = Date.now()): Promise<number> {
  const db = sql();
  const f = window7(now);
  const cores = await accountsCore({ inst, allowed: null }, f, now);
  if (!cores.length) return 0;
  const ids = cores.map((c) => c.locationId);
  const zones = new Map((await db`select location_id, timezone from locations where installation_id = ${inst} and location_id = any(${ids}::text[])`).map((r) => [r.location_id as string, validZone(r.timezone as string | null)]));
  const prevRows = await db`
    select distinct on (location_id, kind) location_id, kind, day::text as day, last_count, peak_count, found, cleared, opened, baseline, open_since, last_cleared_at, resolved_at, fix_minutes
    from td_daily_items where installation_id = ${inst} and location_id = any(${ids}::text[]) and kind = any(${[...TD3_KINDS]}::text[]) order by location_id, kind, day desc`;
  const prev = new Map(prevRows.map((r) => [`${r.location_id}|${r.kind}`, r]));
  const cols: { loc: string[]; day: string[]; kind: string[]; last: number[]; peak: number[]; found: number[]; cleared: number[]; opened: number[]; base: number[]; since: (string | null)[]; lastClr: (string | null)[]; resolved: (string | null)[]; fix: string[] } =
    { loc: [], day: [], kind: [], last: [], peak: [], found: [], cleared: [], opened: [], base: [], since: [], lastClr: [], resolved: [], fix: [] };
  for (const c of cores) {
    const day = localDay(now, zones.get(c.locationId) ?? "UTC");
    for (const kind of TD3_KINDS) {
      const p = prev.get(`${c.locationId}|${kind}`);
      const pv: Prev = p ? { day: p.day as string, lastCount: n(p.last_count), openSince: p.open_since ? (p.open_since as Date).getTime() : null, found: n(p.found), cleared: n(p.cleared), opened: n(p.opened), peakCount: n(p.peak_count), baseline: p.baseline === true, lastClearedAt: p.last_cleared_at ? (p.last_cleared_at as Date).getTime() : null, resolvedAt: p.resolved_at ? (p.resolved_at as Date).getTime() : null, fixMinutes: (p.fix_minutes as number[]) ?? [] } : null;
      const cur = hasKind(c, kind) ? countOf(c, kind) : 0;
      const l = planRecord(pv, cur, now, day);
      cols.loc.push(c.locationId); cols.day.push(l.day); cols.kind.push(kind); cols.last.push(l.lastCount); cols.peak.push(l.peakCount); cols.found.push(l.found); cols.cleared.push(l.cleared); cols.opened.push(l.opened); cols.base.push(l.baseline ? 1 : 0);
      cols.since.push(l.openSince ? new Date(l.openSince).toISOString() : null); cols.lastClr.push(l.lastClearedAt ? new Date(l.lastClearedAt).toISOString() : null); cols.resolved.push(l.resolvedAt ? new Date(l.resolvedAt).toISOString() : null); cols.fix.push(JSON.stringify(l.fixMinutes));
    }
  }
  let wrote = 0;
  for (let i = 0; i < cols.loc.length; i += 2000) {
    const r = (k: keyof typeof cols) => cols[k].slice(i, i + 2000);
    const res = await db`
      insert into td_daily_items (installation_id, location_id, day, kind, last_count, peak_count, found, cleared, opened, baseline, open_since, last_cleared_at, resolved_at, fix_minutes, last_seen_at)
      select ${inst}::uuid, t.loc, t.day::date, t.kind, t.last, t.peak, t.found, t.cleared, t.opened, (t.base = 1), t.since, t.lastclr, t.resolved, (select coalesce(array_agg(x::int), '{}') from jsonb_array_elements_text(t.fix::jsonb) x), now()
      from unnest(${r("loc")}::text[], ${r("day")}::text[], ${r("kind")}::text[], ${r("last")}::int[], ${r("peak")}::int[], ${r("found")}::int[], ${r("cleared")}::int[], ${r("opened")}::int[], ${r("base")}::int[], ${r("since")}::timestamptz[], ${r("lastClr")}::timestamptz[], ${r("resolved")}::timestamptz[], ${r("fix")}::text[])
        as t(loc, day, kind, last, peak, found, cleared, opened, base, since, lastclr, resolved, fix)
      on conflict (installation_id, location_id, day, kind) do update set last_count = excluded.last_count, peak_count = excluded.peak_count, found = excluded.found, cleared = excluded.cleared,
        open_since = excluded.open_since, last_cleared_at = excluded.last_cleared_at, resolved_at = excluded.resolved_at, fix_minutes = excluded.fix_minutes, last_seen_at = now()
      returning 1`;
    wrote += res.length;
  }
  await writeReceipts(inst, ids, now).catch(() => undefined);
  return wrote;
}

// ---- proof ----

type Agg = { found: number; cleared: number; stillOpen: number; median: number | null; fixes: number };
async function weekAgg(inst: string, ids: string[], weekStart: string): Promise<{ total: Agg; byKind: Map<Td3Kind, { found: number; cleared: number }>; rows: Map<string, Agg> }> {
  const db = sql();
  const end = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 7 * DAY).toISOString().slice(0, 10);
  const [sums, open, fix] = await Promise.all([
    db`select location_id, kind, sum(found)::int found, sum(cleared)::int cleared from td_daily_items where installation_id = ${inst} and location_id = any(${ids}::text[]) and day >= ${weekStart}::date and day < ${end}::date and kind = any(${[...TD3_KINDS]}::text[]) group by 1, 2`,
    db`select location_id, sum(last_count)::int as open from (select distinct on (location_id, kind) location_id, kind, last_count from td_daily_items where installation_id = ${inst} and location_id = any(${ids}::text[]) and day < ${end}::date and kind = any(${[...TD3_KINDS]}::text[]) order by location_id, kind, day desc) x group by 1`,
    db`select location_id, x::int m from td_daily_items d, jsonb_array_elements_text(to_jsonb(d.fix_minutes)) x where d.installation_id = ${inst} and d.location_id = any(${ids}::text[]) and d.day >= ${weekStart}::date and d.day < ${end}::date`,
  ]);
  const rows = new Map<string, Agg>(), byKind = new Map<Td3Kind, { found: number; cleared: number }>(), allFix: number[] = [], fixBy = new Map<string, number[]>();
  const get = (l: string) => rows.get(l) ?? (rows.set(l, { found: 0, cleared: 0, stillOpen: 0, median: null, fixes: 0 }), rows.get(l) as Agg);
  for (const r of sums) { const a = get(r.location_id as string); a.found += n(r.found); a.cleared += n(r.cleared); const k = byKind.get(r.kind as Td3Kind) ?? { found: 0, cleared: 0 }; k.found += n(r.found); k.cleared += n(r.cleared); byKind.set(r.kind as Td3Kind, k); }
  for (const r of open) get(r.location_id as string).stillOpen = n(r.open);
  for (const r of fix) { allFix.push(n(r.m)); fixBy.set(r.location_id as string, [...(fixBy.get(r.location_id as string) ?? []), n(r.m)]); }
  for (const [l, a] of rows) { const v = fixBy.get(l) ?? []; a.fixes = v.length; a.median = v.length >= MIN_FIX_SAMPLES ? medianOf(v) : null; }
  const total: Agg = { found: 0, cleared: 0, stillOpen: 0, median: allFix.length >= MIN_FIX_SAMPLES ? medianOf(allFix) : null, fixes: allFix.length };
  for (const a of rows.values()) { total.found += a.found; total.cleared += a.cleared; total.stillOpen += a.stillOpen; }
  return { total, byKind, rows };
}

/** Keeps the durable weekly receipt (td_receipts) for the last four weeks: per account and for the whole business ('*'). Idempotent upsert. */
export async function writeReceipts(inst: string, ids: string[], now: number): Promise<void> {
  const db = sql();
  const hist = await historyStartsOf(inst, ids);
  for (const week of recentWeeks(now, 4)) {
    const { total, rows } = await weekAgg(inst, ids, week);
    const all: Array<[string, Agg]> = [["*", total], ...rows.entries()];
    for (const [loc, a] of all) {
      await db`insert into td_receipts (installation_id, location_id, week_start, found, cleared, still_open, median_fix_minutes, fixes, history_starts, updated_at)
        values (${inst}, ${loc}, ${week}::date, ${a.found}, ${a.cleared}, ${a.stillOpen}, ${a.median}, ${a.fixes}, ${hist}, now())
        on conflict (installation_id, location_id, week_start) do update set found = excluded.found, cleared = excluded.cleared, still_open = excluded.still_open, median_fix_minutes = excluded.median_fix_minutes, fixes = excluded.fixes, history_starts = excluded.history_starts, updated_at = now()`;
    }
  }
}

export async function proof(s: Scope, one: string | null, weekParam: string | null, o: { page: number; size: number }, now = Date.now()): Promise<Td3Proof> {
  const accts = await accountsIn({ inst: s.inst, allowed: s.allowed }, { location: one });
  const ids = accts.map((a) => a.id);
  const weeks = recentWeeks(now, 8);
  const week = weekParam && weeks.includes(weekParam) ? weekParam : weeks[0];
  const weekEnd = new Date(Date.parse(`${week}T00:00:00Z`) + 6 * DAY).toISOString().slice(0, 10);
  const size = clampSize(o.size);
  const empty: Td3Proof = { weekStart: week, weekEnd, weeks, total: { found: 0, cleared: 0, stillOpen: 0, medianFixMinutes: null, fixes: 0, enough: false }, byKind: [], rows: { ...pageOf<Td3ProofRow>([], 0, 0, size) }, lines: [], clientLines: [], historyStarts: null, accountName: one ? accts[0]?.name ?? null : null };
  if (!ids.length) return empty;
  const [agg, hist, days] = await Promise.all([
    weekAgg(s.inst, ids, week).catch(() => null),
    historyStartsOf(s.inst, ids),
    sql()`select count(distinct day)::int d from td_daily_items where installation_id = ${s.inst} and location_id = any(${ids}::text[])`.catch(() => [{ d: 0 }]),
  ]);
  if (!agg) return { ...empty, lines: proofLines({ found: 0, cleared: 0, stillOpen: 0, medianFixMinutes: null, enough: false }, null, null) };
  const enough = n(days[0]?.d) >= 2 && hist !== null && hist < new Date(Date.parse(`${week}T00:00:00Z`) + 7 * DAY).toISOString().slice(0, 10);
  const total = { found: agg.total.found, cleared: agg.total.cleared, stillOpen: agg.total.stillOpen, medianFixMinutes: agg.total.median, fixes: agg.total.fixes, enough };
  const names = new Map(accts.map((a) => [a.id, a.name]));
  const all = [...names.entries()].map(([id, name]): Td3ProofRow => { const a = agg.rows.get(id); return { locationId: id, name, found: a?.found ?? 0, cleared: a?.cleared ?? 0, stillOpen: a?.stillOpen ?? 0, medianFixMinutes: a?.median ?? null, fixes: a?.fixes ?? 0 }; })
    .sort((a, b) => b.found - a.found || b.stillOpen - a.stillOpen || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(all.length / size)), p = Math.min(Math.max(0, o.page), pages - 1);
  const byKind = [...agg.byKind.entries()].filter(([, v]) => v.found + v.cleared > 0).map(([kind, v]) => ({ kind, label: KIND_TEXT[kind].label(v.found).replace(/^\d+ /, ""), ...v })).sort((a, b) => b.found - a.found);
  let clientLines: string[] = [];
  if (one) {
    try { const r = await clientReceipt({ inst: s.inst, allowed: s.allowed }, {}, one, week, now); clientLines = r && "lines" in r ? r.lines : []; } catch { clientLines = []; }
  }
  const lines = proofLines(total, one ? accts[0]?.name ?? null : null, hist);
  if (enough) for (const k of byKind.slice(0, 3)) lines.push(`${k.found} ${k.label}: ${k.cleared} fixed.`);
  return { weekStart: week, weekEnd, weeks, total, byKind, rows: { rows: all.slice(p * size, p * size + size), total: all.length, page: p, size, pages, truncated: false }, lines, clientLines, historyStarts: hist, accountName: one ? accts[0]?.name ?? null : null };
}

export async function exportProof(s: Scope, one: string | null, weekParam: string | null, now = Date.now()): Promise<string> {
  const p = await proof(s, one, weekParam, { page: 0, size: 100 }, now);
  const esc = (v: unknown) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows: Td3ProofRow[] = [...p.rows.rows];
  for (let pg = 1; pg < Math.min(p.rows.pages, 50); pg++) rows.push(...(await proof(s, one, weekParam, { page: pg, size: 100 }, now)).rows.rows);
  const lines = [["Week starting", "Account", "Problems found", "Fixed", "Still open", "Usual minutes to fix", "Record starts"].join(",")];
  for (const r of rows) lines.push([p.weekStart, r.name, r.found, r.cleared, r.stillOpen, r.medianFixMinutes ?? "Not enough data", p.historyStarts ?? ""].map(esc).join(","));
  return lines.join("\n");
}

// ---- numbers (replaces Overview) ----
const day0 = (d: Date) => d.toISOString().slice(0, 10);

/** `win` is the dates of the date bar (whole UTC days: `to` is the start of the day AFTER the last day), or a number of days counted back from today (the old way, kept for callers that have no dates). */
export async function numbers(s: Scope, one: string | null, win: number | { from: Date; to: Date }, now = Date.now()): Promise<Td3Numbers> {
  const to = typeof win === "number" ? new Date(Math.floor(now / DAY) * DAY + DAY) : win.to, from = typeof win === "number" ? new Date(to.getTime() - win * DAY) : win.from;
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY)), pFrom = new Date(from.getTime() - days * DAY);
  const range = `${day0(from)} to ${day0(new Date(to.getTime() - DAY))}`;
  const f: Filters = { from, to, location: one, q: null, industry: null, level: null };
  const cores = await accountsCore({ inst: s.inst, allowed: s.allowed }, f, now);
  const ids = cores.map((c) => c.locationId);
  const db = sql();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const [speedNow, speedPrev, outPrev, deals] = ids.length ? await Promise.all([
    db`select percentile_cont(0.5) within group (order by median_seconds)::float8 m, coalesce(sum(answered), 0)::int a from speed_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${day(from)}::date and day < ${day(to)}::date and answered > 0 and median_seconds is not null`.catch(() => [{ m: null, a: 0 }]),
    db`select percentile_cont(0.5) within group (order by median_seconds)::float8 m, coalesce(sum(answered), 0)::int a from speed_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${day(pFrom)}::date and day < ${day(from)}::date and answered > 0 and median_seconds is not null`.catch(() => [{ m: null, a: 0 }]),
    db`select coalesce(sum(showed), 0)::int s, coalesce(sum(noshow), 0)::int x from client_daily where installation_id = ${s.inst} and location_id = any(${ids}::text[]) and day >= ${day(pFrom)}::date and day < ${day(from)}::date`.catch(() => [{ s: 0, x: 0 }]),
    // Dollar tiles leave out deals with no value and deals with no owner (usually test or junk deals), and say how many were left out.
    db`select count(*) filter (where coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null)::int n, coalesce(sum(o.monetary_value) filter (where coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null), 0)::float8 v,
        count(*) filter (where not (coalesce(o.monetary_value, 0) > 0 and o.assigned_to is not null))::int skipped
       from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${s.inst} and o.location_id = any(${ids}::text[]) and o.status = 'open' and ${countedInScope()}`.catch(() => [{ n: 0, v: 0, skipped: 0 }]),
  ]) : [[{ m: null, a: 0 }], [{ m: null, a: 0 }], [{ s: 0, x: 0 }], [{ n: 0, v: 0, skipped: 0 }]];
  const sum = (pick: (c: Core) => number) => cores.reduce((t, c) => t + pick(c), 0);
  const waiting = sum((c) => c.waiting), stale = sum((c) => c.staleDealsPct.n), needAttn = cores.filter((c) => c.level === "act" || c.level === "watch").length;
  const showed = sum((c) => c.showed), noshow = sum((c) => c.noshowN);
  const sr = showRate(showed, noshow), prevOut = n(outPrev[0]?.s) + n(outPrev[0]?.x);
  const prevRate = prevOut >= 20 ? Math.round((n(outPrev[0]?.s) / prevOut) * 100) : null;
  const median = speedNow[0]?.m === null || speedNow[0]?.m === undefined ? null : Math.round((Number(speedNow[0].m) / 60) * 10) / 10;
  const medianPrev = speedPrev[0]?.m === null || speedPrev[0]?.m === undefined ? null : Math.round((Number(speedPrev[0].m) / 60) * 10) / 10;
  const enoughReply = n(speedNow[0]?.a) >= MIN_REPLIES && median !== null;
  const mins = (m: number) => (m < 1 ? "Under a minute" : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${Math.round(m / 6) / 10} h` : `${Math.round(m / 144) / 10} d`);
  const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
  const tiles: Td3Tile[] = [
    { id: "reply", label: "Typical first reply", value: enoughReply ? mins(median as number) : "-", caption: enoughReply ? null : `Needs ${MIN_REPLIES} answered leads (${n(speedNow[0]?.a)} so far)`, enough: enoughReply, formula: `The middle first-reply time of the leads answered from ${range} (${days} ${days === 1 ? "day" : "days"}), across ${ids.length} ${ids.length === 1 ? "account" : "accounts"}. Needs ${MIN_REPLIES} answered leads.`,
      change: enoughReply && n(speedPrev[0]?.a) >= MIN_REPLIES ? changeText(median, medianPrev, 0.1) : null, estimate: false, opens: { module: "speed" }, count: n(speedNow[0]?.a) },
    { id: "waiting", label: "Waiting for a reply", value: String(waiting), caption: null, enough: true, formula: "People whose last message is from the customer and nobody has answered, right now (conversations active in the last 30 days). The dates do not change this one.", change: null, estimate: false, opens: { list: "all_waiting" }, count: waiting },
    { id: "showrate", label: "Show rate", value: sr.value, caption: sr.caption, enough: sr.enough, formula: `People who came as a share of appointments marked came or no-show from ${range}. Needs ${20} marked outcomes; unmarked appointments are not counted.`,
      change: sr.enough && prevRate !== null ? changeText(sr.rate, prevRate, 1) : null, estimate: false, opens: { list: "all_noshows" }, count: noshow },
    { id: "open_deals", label: "Open deals", value: n(deals[0]?.n) ? `${n(deals[0]?.n).toLocaleString("en-US")} worth ${money(n(deals[0]?.v))}` : "None", caption: null, enough: true, formula: "Open deals counted by Pipeline's rule, leaving out deals with no value and deals with no owner (usually test or junk). The dollar figure is the deals' own value, not a forecast.", change: null, estimate: true, opens: { list: "open_deals" }, count: n(deals[0]?.n) },
    { id: "stale", label: "Deals gone quiet", value: String(stale), caption: null, enough: true, formula: `Open deals with no movement for ${STALE_DEAL_DAYS} days, by Pipeline's counted-deal rule.`, change: null, estimate: false, opens: { list: "all_stale" }, count: stale },
    { id: "attention", label: "Accounts needing a look", value: `${needAttn} of ${cores.length}`, caption: null, enough: true, formula: "Client accounts Clients marks Act now or Keep an eye.", change: null, estimate: false, opens: { module: "clients" }, count: needAttn },
  ];
  return { tiles, days, from: day0(from), to: day0(new Date(to.getTime() - DAY)), historyStarts: await historyStartsOf(s.inst, ids), testDealsLeftOut: n(deals[0]?.skipped) };
}

// ---- SubSync-only notes: snooze, opened, settings ----

export async function snooze(inst: string, actor: string | null, kind: string, location: string | null, days: number): Promise<{ id: string } | null> {
  if (!(TD3_KINDS as readonly string[]).includes(kind)) return null;
  const d = Math.min(Math.max(1, Math.floor(days)), 30);
  const [r] = await sql()`insert into td_snoozes (installation_id, location_id, kind, until_at, created_by) values (${inst}, ${location ?? "*"}, ${kind}, now() + ${`${d} days`}::interval, ${actor}) returning id`;
  forgetToday(inst);
  return r ? { id: r.id as string } : null;
}
export async function unsnooze(inst: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const r = await sql()`update td_snoozes set released_at = now() where installation_id = ${inst} and id = ${id}::uuid and released_at is null returning 1`;
  forgetToday(inst);
  return r.length > 0;
}
export async function markOpened(inst: string, location: string | null, kind: string): Promise<void> {
  if (!(TD3_KINDS as readonly string[]).includes(kind)) return;
  const loc = location ?? "*";
  if (loc !== "*" && !ID.test(loc)) return;
  await sql()`insert into td_daily_items (installation_id, location_id, day, kind, opened, baseline) values (${inst}, ${loc}, (now() at time zone 'UTC')::date, ${kind}, 1, false)
    on conflict (installation_id, location_id, day, kind) do update set opened = td_daily_items.opened + 1`.catch(() => undefined);
}

const EMAIL = /^[^\s@,;<>"]{1,64}@[^\s@,;<>"]{1,190}\.[A-Za-z]{2,}$/;
export async function getSettings(inst: string, ids: string[], canEdit: boolean): Promise<Td3Settings> {
  const tz = await zoneOf(inst, ids);
  try {
    const [r] = await sql()`select email_on, email_hour, quiet_days, recipients from td_prefs where installation_id = ${inst}`;
    return { emailOn: r?.email_on === true, emailHour: r ? n(r.email_hour) : 7, quietDays: ((r?.quiet_days as number[] | undefined) ?? []).map(Number), recipients: canEdit ? ((r?.recipients as string[] | undefined) ?? []) : [], timezone: tz, canEdit, sendingNote: null };
  } catch { return { emailOn: false, emailHour: 7, quietDays: [], recipients: [], timezone: tz, canEdit, sendingNote: null }; }
}
export async function saveSettings(inst: string, actor: string | null, raw: { emailOn?: unknown; emailHour?: unknown; quietDays?: unknown; recipients?: unknown }): Promise<{ ok: true } | { ok: false; error: string }> {
  const hour = Math.min(23, Math.max(0, Math.floor(Number(raw.emailHour ?? 7)) || 0));
  const quiet = Array.isArray(raw.quietDays) ? [...new Set(raw.quietDays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  const list = (Array.isArray(raw.recipients) ? raw.recipients : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (list.length > 10) return { ok: false, error: "At most 10 addresses." };
  if (list.some((x) => !EMAIL.test(x))) return { ok: false, error: "One of the email addresses does not look right." };
  const on = raw.emailOn === true;
  if (on && list.length === 0) return { ok: false, error: "Add at least one email address first." };
  await sql()`insert into td_prefs (installation_id, email_on, email_hour, quiet_days, recipients, updated_by, updated_at) values (${inst}, ${on}, ${hour}, ${quiet}::int[], ${[...new Set(list)]}::text[], ${actor}, now())
    on conflict (installation_id) do update set email_on = excluded.email_on, email_hour = excluded.email_hour, quiet_days = excluded.quiet_days, recipients = excluded.recipients, updated_by = excluded.updated_by, updated_at = now()`;
  return { ok: true };
}

export async function options(s: Scope): Promise<Td3Options> {
  const accts = await accountsIn({ inst: s.inst, allowed: s.allowed }, {});
  return { accounts: accts.map((a) => ({ locationId: a.id, name: a.name })) };
}
export const zoneForMeta = zoneOf;
