import type { PendingQuery, Row } from "postgres";
import { sql, type Sql } from "../db";
import { loadLookups } from "./speed-queries";
import { properCase, resolveUser } from "./people-labels";
import { channelLabel, WAITING_WINDOW_DAYS } from "./waiting";
import { channelKeys, searchTerms, type ListParams } from "./unanswered-params";
import { snoozeHook, type SnoozeFlags, type SnoozeHook } from "./unanswered-snooze-hook";

// The lists of the Unanswered screen, all on the database: the people are grouped, filtered, sorted and counted by SQL and only one page (20, 50 or 100) is ever read, so a million
// conversations cost the same as ten. The count of a list is the database's count of exactly those people (count(*) over ()), and every chip's number is the same query with that one
// choice changed, so a number and the list behind it cannot disagree. Read only; no message text exists to read (SubSync keeps who wrote, when and through which channel).
// "Waiting for us": the customer wrote last and the reply target has passed (the rule of waiting.ts, with each account's own target). "Waiting on them": we wrote last and the person
// has gone quiet for the chosen time (an automatic message also counts as "we wrote": the platform does not say which it was).

type Frag = PendingQuery<Row[]>;
const DAY = 86_400_000;

export type ListScope = { installationId: string; allowed: string[] | null; slaHours: number; targetMinutes: number; now: number; meId: string | null; seePeople: boolean; hook?: SnoozeFlags };

export type SqlRow = {
  key: string; locationId: string; locationName: string; contactId: string | null; conversationId: string; name: string; channel: string; call: boolean;
  hours: number; conversations: number; unreadMessages: number; owner: { id: string; label: string; state: string } | null; unassigned: boolean;
  phone: string | null; email: string | null; dnd: boolean; timeZone: string | null; newLead: boolean; dealValue: number | null; lastAt: number;
};

const and = (db: Sql, parts: Frag[]): Frag => parts.reduce<Frag | null>((acc, p) => (acc ? db`${acc} and ${p}` : p), null) ?? db`true`;

/** The conversations in play and the one row per person (the conversation that has waited longest names the wait). Written once; every list, count and chip uses it. */
function peopleCte(db: Sql, s: ListScope, p: Pick<ListParams, "tab" | "quiet">): Frag {
  const nowDate = new Date(s.now);
  const window = new Date(s.now - WAITING_WINDOW_DAYS * DAY);
  const sla = db`(case when l.speed_target_minutes is not null and l.speed_target_minutes > 0 then (l.speed_target_minutes + 59) / 60 else ${s.slaHours}::int end)`;
  const side = p.tab === "us"
    ? db`c.last_message_direction = 'inbound' and c.last_message_at > ${window} and c.last_message_at < ${nowDate}::timestamptz - ${sla} * interval '1 hour'`
    : db`c.last_message_direction = 'outbound' and c.last_message_at > ${window} and c.last_message_at < ${nowDate}::timestamptz - ${p.quiet}::int * interval '1 hour' and coalesce(c.last_message_type, '') !~* 'internal[ _-]?comment'`;
  return db`
    with conv as (
      select c.location_id, c.conversation_id, c.contact_id, c.last_message_type, c.last_message_at, c.unread_count,
        c.location_id || ':' || coalesce(nullif(c.contact_id, ''), 'conversation-' || c.conversation_id) pkey,
        coalesce(nullif(btrim(c.contact_name), ''), nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), '')) name,
        nullif(ct.assigned_to, '') assigned_to, nullif(ct.phone, '') phone, nullif(ct.email, '') email, coalesce(ct.dnd, false) dnd, l.timezone tz, coalesce(l.name, '') loc_name
      from cached_conversations c
      join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
      left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
      where c.installation_id = ${s.installationId} and ${side}
        ${s.allowed ? db`and c.location_id = any(${s.allowed}::text[])` : db``}
    ), people as (
      select distinct on (pkey) pkey, location_id, conversation_id, nullif(contact_id, '') contact_id, last_message_type, last_message_at, name, assigned_to, phone, email, dnd, tz, loc_name,
        lower(regexp_replace(coalesce(last_message_type, ''), '^TYPE_', '', 'i')) ckey,
        count(*) over (partition by pkey) convs, sum(unread_count) over (partition by pkey)::int unread,
        floor(extract(epoch from (${nowDate}::timestamptz - last_message_at)) / 3600)::int hrs,
        lower(coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || loc_name) hay, regexp_replace(coalesce(phone, ''), '\\D', '', 'g') digits
      from conv order by pkey, last_message_at asc, conversation_id
    )`;
}

type Omit = "bucket" | "owner" | "channel" | null;

/** Every choice as a condition on `people p`. `omit` leaves one choice out, which is how a chip's number is "the list with that one choice changed". */
function filters(db: Sql, s: ListScope, p: ListParams, hook: SnoozeHook, omit: Omit = null): Frag {
  const parts: Frag[] = [];
  if (p.account) parts.push(db`p.location_id = ${p.account}`);
  if (omit !== "owner" && p.owner) {
    const o = p.owner;
    if (o === "none") parts.push(db`p.assigned_to is null`);
    else if (o === "me") parts.push(s.meId ? db`p.assigned_to = ${s.meId}` : db`false`);
    else if (o === "mine_free") parts.push(s.meId ? db`(p.assigned_to is null or p.assigned_to = ${s.meId})` : db`p.assigned_to is null`);
    else parts.push(db`p.assigned_to = ${o}`);
  }
  if (omit !== "channel" && p.channel) parts.push(db`p.ckey = any(${channelKeys(p.channel)}::text[])`);
  if (omit !== "bucket" && p.bucket) {
    parts.push(p.bucket === "h1" ? db`p.hrs < 4` : p.bucket === "h4" ? db`(p.hrs >= 4 and p.hrs < 24)` : p.bucket === "h24" ? db`(p.hrs >= 24 and p.hrs < 48)` : db`p.hrs >= 48`);
  }
  for (const t of searchTerms(p.q)) {
    parts.push(t.digits
      ? db`(p.hay like ${t.like} escape '\\' or p.digits like ${`%${t.digits}%`})`
      : db`p.hay like ${t.like} escape '\\'`);
  }
  if (p.minValue > 0) {
    parts.push(db`exists (select 1 from cached_opportunities o where o.installation_id = ${s.installationId} and o.location_id = p.location_id and o.contact_id = p.contact_id and o.status = 'open' and o.monetary_value >= ${p.minValue})`);
  }
  if (hook.available) {
    if (p.state === "snoozed") parts.push(db`(${hook.snoozed})`);
    else if (p.state === "hidden") parts.push(db`(${hook.hidden})`);
    else parts.push(db`not (${hook.snoozed}) and not (${hook.hidden})`);
  }
  return and(db, parts);
}

const ownerOf = (id: string | null, lk: Awaited<ReturnType<typeof loadLookups>>["lk"], locationId: string) => {
  if (!id) return null;
  const l = resolveUser(id, lk.team, lk.usersAccess.get(locationId));
  return { id, label: l.label, state: l.state as string };
};

export type SqlList = {
  total: number; page: number; pages: number; from: number; to: number; rows: SqlRow[];
  facets: {
    buckets: Record<"all" | "h1" | "h4" | "h24" | "h48", number>; owner: { all: number; none: number; mine: number; mineFree: number };
    channels: Array<{ key: string; label: string; count: number }>; snooze: boolean;
  };
};

/** One page of the people behind a number, with exact totals and the chips' numbers. */
export async function sqlList(s: ListScope, p: ListParams): Promise<SqlList> {
  const db = sql();
  if (s.allowed && s.allowed.length === 0) return emptyList();
  const [{ lk }, hook] = await Promise.all([loadLookups(db, s.installationId, s.allowed, s.targetMinutes, s.now), snoozeHook(db, s.installationId, s.hook)]);
  const cte = peopleCte(db, s, p);
  const where = filters(db, s, p, hook);
  const order = p.sort === "newest" ? db`p.last_message_at desc, p.pkey`
    : p.sort === "name" ? db`lower(coalesce(p.name, 'zzz')), p.last_message_at, p.pkey`
    : p.sort === "account" ? db`lower(p.loc_name), p.last_message_at, p.pkey`
    : p.sort === "value" ? db`dv.v desc nulls last, p.last_message_at, p.pkey`
    : p.tab === "them" ? db`p.last_message_at desc, p.pkey` : db`p.last_message_at, p.name, p.pkey`;
  const valueJoin = p.sort === "value"
    ? db`left join lateral (select sum(o.monetary_value) v from cached_opportunities o where o.installation_id = ${s.installationId} and o.location_id = p.location_id and o.contact_id = p.contact_id and o.status = 'open') dv on true`
    : db``;
  const page = (n: number) => db`
    ${cte}
    select p.*, count(*) over ()::int total from people p ${valueJoin} where ${where} order by ${order} limit ${p.size} offset ${n * p.size}`;
  let at = p.page;
  let rows = await page(at);
  if (rows.length === 0 && at > 0) {
    const [c] = await db`${cte} select count(*)::int n from people p where ${where}`;
    at = Math.max(0, Math.ceil(Number(c?.n ?? 0) / p.size) - 1);
    rows = await page(at);
  }
  const total = rows.length ? Number(rows[0].total) : 0;

  const [b, o, ch] = await Promise.all([
    db`${cte} select case when p.hrs < 4 then 'h1' when p.hrs < 24 then 'h4' when p.hrs < 48 then 'h24' else 'h48' end k, count(*)::int n from people p where ${filters(db, s, p, hook, "bucket")} group by 1`,
    db`${cte} select count(*)::int a, count(*) filter (where p.assigned_to is null)::int n, count(*) filter (where ${s.meId ? db`p.assigned_to = ${s.meId}` : db`false`})::int m,
        count(*) filter (where p.assigned_to is null or ${s.meId ? db`p.assigned_to = ${s.meId}` : db`false`})::int mf from people p where ${filters(db, s, p, hook, "owner")}`,
    db`${cte} select p.ckey k, count(*)::int n from people p where ${filters(db, s, p, hook, "channel")} group by 1`,
  ]);
  const buckets = { all: 0, h1: 0, h4: 0, h24: 0, h48: 0 };
  for (const r of b) { buckets[r.k as "h1"] = Number(r.n); buckets.all += Number(r.n); }
  const byLabel = new Map<string, number>();
  for (const r of ch) byLabel.set(channelLabel(r.k as string), (byLabel.get(channelLabel(r.k as string)) ?? 0) + Number(r.n));
  const channels = [...byLabel].map(([key, count]) => ({ key, label: key, count })).sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));

  const money = await dealValues(db, s.installationId, rows.map((r) => [r.location_id as string, r.contact_id as string | null]));
  const out: SqlRow[] = rows.map((r) => {
    const call = channelLabel(r.last_message_type as string | null) === "Call";
    const owner = ownerOf((r.assigned_to as string | null) ?? null, lk, r.location_id as string);
    const lastAt = (r.last_message_at as Date).getTime();
    return {
      key: r.pkey as string, locationId: r.location_id as string, locationName: lk.locationNames.get(r.location_id as string) ?? "Client account", contactId: (r.contact_id as string | null) ?? null,
      conversationId: r.conversation_id as string, name: r.name ? properCase(r.name as string) : "Unnamed contact", channel: channelLabel(r.last_message_type as string | null), call,
      hours: Math.max(0, Number(r.hrs)), conversations: Number(r.convs), unreadMessages: Number(r.unread ?? 0), owner, unassigned: owner === null,
      phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null, dnd: r.dnd === true, timeZone: (r.tz as string | null) || null, newLead: false,
      dealValue: r.contact_id ? money.get(`${r.location_id}:${r.contact_id}`) ?? null : null, lastAt,
    };
  });
  const pages = Math.max(1, Math.ceil(total / p.size));
  return {
    total, page: at, pages, from: total === 0 ? 0 : at * p.size + 1, to: Math.min(total, at * p.size + out.length), rows: out,
    facets: { buckets, owner: { all: Number(o[0]?.a ?? 0), none: Number(o[0]?.n ?? 0), mine: Number(o[0]?.m ?? 0), mineFree: Number(o[0]?.mf ?? 0) }, channels, snooze: hook.available },
  };
}

function emptyList(): SqlList {
  return { total: 0, page: 0, pages: 1, from: 0, to: 0, rows: [], facets: { buckets: { all: 0, h1: 0, h4: 0, h24: 0, h48: 0 }, owner: { all: 0, none: 0, mine: 0, mineFree: 0 }, channels: [], snooze: false } };
}

/** The open deal value of the people on one page (counted: more than zero). One small read for at most 100 people. */
async function dealValues(db: Sql, installationId: string, people: Array<[string, string | null]>): Promise<Map<string, number>> {
  const withContact = people.filter((x): x is [string, string] => Boolean(x[1]));
  if (withContact.length === 0) return new Map();
  try {
    const rows = await db`
      select o.location_id, o.contact_id, sum(o.monetary_value)::float8 v
      from cached_opportunities o join unnest(${withContact.map((x) => x[0])}::text[], ${withContact.map((x) => x[1])}::text[]) k(l, c) on k.l = o.location_id and k.c = o.contact_id
      where o.installation_id = ${installationId} and o.status = 'open' and coalesce(o.monetary_value, 0) > 0 group by 1, 2`;
    return new Map(rows.map((r) => [`${r.location_id}:${r.contact_id}`, Number(r.v)]));
  } catch { return new Map(); }
}

// ---------- the one search box across every account ----------

export type FindRow = {
  key: string; locationId: string; locationName: string; contactId: string | null; conversationId: string; name: string; phone: string | null; email: string | null;
  channel: string; state: "waiting" | "new" | "we_replied" | "quiet"; hours: number; owner: { id: string; label: string; state: string } | null; dnd: boolean; timeZone: string | null;
};

/** People with a conversation, found by name, phone, email or client account, across every account the caller may read, one page at a time. At least two characters. */
export async function sqlFind(s: ListScope, i: { q: string; page: number; size: number }) {
  const db = sql();
  const terms = searchTerms(i.q);
  if (i.q.trim().length < 2 || terms.length === 0 || (s.allowed && s.allowed.length === 0)) return { total: 0, page: 0, pages: 1, from: 0, to: 0, rows: [] as FindRow[] };
  const { lk } = await loadLookups(db, s.installationId, s.allowed, s.targetMinutes, s.now);
  const nowDate = new Date(s.now);
  const match = and(db, terms.map((t) => t.digits
    ? db`(hay like ${t.like} escape '\\' or digits like ${`%${t.digits}%`})`
    : db`hay like ${t.like} escape '\\'`));
  const base = db`
    with conv as (
      select c.location_id, c.conversation_id, nullif(c.contact_id, '') contact_id, c.last_message_type, c.last_message_direction dir, c.last_message_at,
        c.location_id || ':' || coalesce(nullif(c.contact_id, ''), 'conversation-' || c.conversation_id) pkey,
        coalesce(nullif(btrim(c.contact_name), ''), nullif(btrim(ct.full_name), ''), nullif(btrim(ct.email), ''), nullif(btrim(ct.phone), '')) name,
        nullif(ct.assigned_to, '') assigned_to, nullif(ct.phone, '') phone, nullif(ct.email, '') email, coalesce(ct.dnd, false) dnd, l.timezone tz,
        (case when l.speed_target_minutes is not null and l.speed_target_minutes > 0 then (l.speed_target_minutes + 59) / 60 else ${s.slaHours}::int end) sla,
        lower(coalesce(nullif(btrim(c.contact_name), ''), ct.full_name, '') || ' ' || coalesce(ct.email, '') || ' ' || coalesce(l.name, '')) hay,
        regexp_replace(coalesce(ct.phone, ''), '\\D', '', 'g') digits
      from cached_conversations c
      join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
      left join cached_contacts ct on ct.installation_id = c.installation_id and ct.location_id = c.location_id and ct.contact_id = c.contact_id
      where c.installation_id = ${s.installationId} and c.last_message_at is not null ${s.allowed ? db`and c.location_id = any(${s.allowed}::text[])` : db``}
    ), hit as (select * from conv where ${match}),
    latest as (select distinct on (pkey) * from hit order by pkey, last_message_at desc, conversation_id)`;
  const rows = await db`${base} select *, count(*) over ()::int total, floor(extract(epoch from (${nowDate}::timestamptz - last_message_at)) / 3600)::int hrs
    from latest order by last_message_at desc, pkey limit ${i.size} offset ${i.page * i.size}`;
  const total = rows.length ? Number(rows[0].total) : 0;
  const out: FindRow[] = rows.map((r) => {
    const hrs = Math.max(0, Number(r.hrs));
    const state: FindRow["state"] = r.dir === "inbound" ? (hrs >= Number(r.sla) ? "waiting" : "new") : hrs >= 24 ? "quiet" : "we_replied";
    const id = (r.assigned_to as string | null) ?? null;
    const l = id ? resolveUser(id, lk.team, lk.usersAccess.get(r.location_id as string)) : null;
    return {
      key: r.pkey as string, locationId: r.location_id as string, locationName: lk.locationNames.get(r.location_id as string) ?? "Client account", contactId: (r.contact_id as string | null) ?? null,
      conversationId: r.conversation_id as string, name: r.name ? properCase(r.name as string) : "Unnamed contact", phone: (r.phone as string | null) ?? null, email: (r.email as string | null) ?? null,
      channel: channelLabel(r.last_message_type as string | null), state, hours: hrs, owner: id && l ? { id, label: l.label, state: l.state as string } : null, dnd: r.dnd === true, timeZone: (r.tz as string | null) || null,
    };
  });
  const pages = Math.max(1, Math.ceil(total / i.size));
  return { total, page: i.page, pages, from: total === 0 ? 0 : i.page * i.size + 1, to: Math.min(total, i.page * i.size + out.length), rows: out };
}

/** The counts that tell the two tabs apart, cheap: how many people wait for us and how many have gone quiet on us. */
export async function sqlTabCounts(s: ListScope, quiet: ListParams["quiet"]): Promise<{ us: number; them: number }> {
  if (s.allowed && s.allowed.length === 0) return { us: 0, them: 0 };
  const db = sql();
  const count = async (tab: "us" | "them") => {
    const [r] = await db`${peopleCte(db, s, { tab, quiet })} select count(*)::int n from people`;
    return Number(r?.n ?? 0);
  };
  const [us, them] = await Promise.all([count("us"), count("them")]);
  return { us, them };
}
