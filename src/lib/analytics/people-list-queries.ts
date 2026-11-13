import { APP_TZ, windowAtMs } from "../design/zone.ts";
import { properName } from "../people/names.ts";
import { parseChoice, type DialerChoice } from "../people/dial";
import { sql, type Sql } from "../db";
import { fillDays, QUERY_TIMEOUT_MS } from "../people/helpers";
import { MAX_LISTS_PER_PERSON, PAGE_SIZE, parseSmartFilter, type SmartFilter } from "../people/filters";
import { COUNT_CAP, searchTerm } from "../people/queue";
import { ttlCache } from "../ttl-cache";
import { QUIET_AFTER_DAYS, effectiveColdTags } from "./contact-intel";
import { dealScopeJoins, outOfScope } from "./stage-rules-sql";

// The reads behind the People module (stage F10): the filter builder's list of people, the options to filter by, going cold, tags (and when SubSync first
// saw each tag on a contact), and a person's saved lists. Every read takes the account list the caller may see (`allowed`, null for all of them) and is
// limited to it in the query itself; nothing here trusts an id from the browser. Every read runs under a hard time limit (QUERY_TIMEOUT_MS): the database
// stops it and the caller turns that into a friendly message and an error ID instead of a bare 504.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

/** Runs one read with a statement timeout on its own transaction (set local, so it never leaks to another request on the pooled connection). */
export async function timed<T>(fn: (tx: Sql) => Promise<T>, ms = QUERY_TIMEOUT_MS): Promise<T> {
  return (await sql().begin(async (tx) => {
    // The limit is sent in the same breath as the read (pipelined on one connection), so it costs no extra round trip.
    const limit = tx`select set_config('statement_timeout', ${String(ms)}, true)`.execute();
    const out = await fn(tx as unknown as Sql);
    await limit;
    return out;
  })) as T;
}

export function visible(db: Sql, installationId: string, allowed: string[] | null) {
  return db`select location_id, name, timezone from locations where installation_id = ${installationId} and not ignored
    ${allowed ? db`and location_id = any(${allowed}::text[])` : db``}`;
}

export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// ---------------- options to filter by ----------------

export type PeopleOptions = {
  tags: Array<{ tag: string; count: number }>;
  sources: Array<{ source: string; count: number }>;
  owners: Array<{ id: string; count: number }>;
  stages: string[];
  accounts: Array<{ id: string; name: string }>;
};

// The tag list is the same 300 most used tags the Leads figures use to find cold lists, so a cold-list filter and the Leads counts name the same people.
const optionCache = ttlCache<PeopleOptions>(60_000, 100);

export async function peopleOptions(installationId: string, allowed: string[] | null): Promise<PeopleOptions> {
  const key = `${installationId}|${allowed ? [...allowed].sort().join(",") : "*"}`;
  const hit = optionCache.get(key);
  if (hit) return hit;
  const out = await timed(async (db) => {
    const [tags, sources, owners, stages, accounts] = await Promise.all([
      db`with loc as (${visible(db, installationId, allowed)})
         select t.tag, count(*)::int n from cached_contacts c join loc on loc.location_id = c.location_id cross join lateral unnest(c.tags) t(tag)
         where c.installation_id = ${installationId} group by t.tag order by n desc limit 300`,
      db`with loc as (${visible(db, installationId, allowed)})
         select min(btrim(c.source)) source, count(*)::int n from cached_contacts c join loc on loc.location_id = c.location_id
         where c.installation_id = ${installationId} and nullif(btrim(c.source), '') is not null group by lower(btrim(c.source)) order by n desc limit 40`,
      db`with loc as (${visible(db, installationId, allowed)})
         select c.assigned_to id, count(*)::int n from cached_contacts c join loc on loc.location_id = c.location_id
         where c.installation_id = ${installationId} and nullif(c.assigned_to, '') is not null group by 1 order by n desc limit 60`,
      db`select distinct s->>'name' name from pipelines p cross join lateral jsonb_array_elements(coalesce(p.stages, '[]'::jsonb)) s
         where p.installation_id = ${installationId} ${allowed ? db`and p.location_id = any(${allowed}::text[])` : db``} and nullif(s->>'name', '') is not null order by 1 limit 120`,
      db`select location_id id, coalesce(name, 'Unnamed account') name from locations where installation_id = ${installationId} and not ignored
         ${allowed ? db`and location_id = any(${allowed}::text[])` : db``} order by name limit 500`,
    ]);
    return {
      tags: tags.map((r) => ({ tag: r.tag as string, count: r.n as number })),
      sources: sources.map((r) => ({ source: r.source as string, count: r.n as number })),
      owners: owners.map((r) => ({ id: r.id as string, count: r.n as number })),
      stages: stages.map((r) => r.name as string),
      accounts: accounts.map((r) => ({ id: r.id as string, name: r.name as string })),
    } satisfies PeopleOptions;
  });
  optionCache.set(key, out);
  return out;
}

/** The tags that are cold lists for this view (the owner's choice, else the ones whose names say so). */
export async function coldTagsFor(installationId: string, allowed: string[] | null, chosen: string[] | null): Promise<string[]> {
  const o = await peopleOptions(installationId, allowed);
  return effectiveColdTags(o.tags.map((t) => t.tag), chosen).map((c) => c.tag);
}

// ---------------- the list of people ----------------

export type PersonRow = {
  contactId: string; locationId: string; locationName: string | null; name: string; email: string | null; phone: string | null; tags: string[];
  source: string | null; owner: string | null; dnd: boolean; timeZone: string | null; dateAdded: string | null; lastActivityAt: string | null;
  /** Calls logged from SubSync's call lists (not the CRM's own call history, which is read one lead at a time in the lead panel). */
  lastCallAt: string | null; calls: number; lastResult: string | null;
};

/** The conditions of a smart filter as one SQL fragment on contacts `c`. Used by the list, the count and by the tag charts, so a number and its list agree. */
export function filterSql(db: Sql, installationId: string, f: SmartFilter, coldTags: string[]) {
  const parts: Array<ReturnType<Sql>> = [];
  const add = (x: ReturnType<Sql>) => parts.push(x);
  if (f.q) {
    // A typed word of 3+ letters is looked for ANYWHERE in a name or email (so "lead101" finds king+lead101@x.com) through the trigram indexes cached_contacts_name_trgm and cached_contacts_email_trgm; shorter words keep the start-of-name rule. Digits only means a phone number (any run of its digits).
    const t = searchTerm(f.q);
    const digits = f.q.replace(/[^0-9]/g, "");
    const word = escapeLike(f.q.toLowerCase());
    if (t.ok && t.kind === "phone" && digits.length >= 3) add(db`c.phone_digits like ${`%${digits}%`}`);
    else if (t.ok && t.kind === "email") add(f.q.startsWith("@") || word.length >= 3 ? db`lower(c.email) like ${`%${word}%`}` : db`lower(c.email) like ${`${word}%`}`);
    // A word that starts any part of the name also counts ("Lead One" finds "Test Lead One"): the second condition is a trigram look-up of " lead one" (index cached_contacts_name_trgm),
    // used from three characters on; shorter words keep the start-of-name rule so they never read every row.
    else add(word.length >= 3
      ? db`(lower(c.full_name) like ${`${word}%`} or lower(c.last_name) like ${`${word}%`} or lower(c.email) like ${`%${word}%`} or c.full_name ilike ${`%${word}%`})`
      : db`(lower(c.full_name) like ${`${word}%`} or lower(c.last_name) like ${`${word}%`} or lower(c.email) like ${`${word}%`})`);
  }
  if (f.tags?.length) add(f.tagMode === "all" ? db`c.tags @> ${f.tags}::text[]` : db`c.tags && ${f.tags}::text[]`);
  if (f.notTag) add(db`not (c.tags @> ${[f.notTag]}::text[])`);
  if ((f.seenFrom || f.seenTo) && f.tags?.length) {
    const from = f.seenFrom ?? "1970-01-01";
    const to = f.seenTo ?? "2999-12-31";
    add(db`exists (select 1 from contact_tag_events e where e.installation_id = c.installation_id and e.location_id = c.location_id and e.contact_id = c.contact_id
      and e.kind = 'added' and e.tag = any(${f.tags}::text[]) and (e.at at time zone ${APP_TZ})::date between ${from}::date and ${to}::date)`);
  }
  if (f.addedFrom && f.addedTo) {
    const w = windowAtMs(f.addedFrom, f.addedTo, f.addedFromTime ?? null, f.addedToTime ?? null);
    if (w) add(db`c.date_added >= ${new Date(w.fromMs)} and c.date_added < ${new Date(w.toMs)}`);
  }
  if (f.owner) add(f.owner === "none" ? db`nullif(c.assigned_to, '') is null` : db`c.assigned_to = ${f.owner}`);
  if (f.source) add(f.source === "none" ? db`nullif(btrim(c.source), '') is null` : db`lower(btrim(c.source)) = ${f.source.toLowerCase()}`);
  if (f.quietDays !== undefined) add(db`coalesce(c.last_activity_at, c.date_added) < now() - make_interval(days => ${f.quietDays}::int)`);
  if (f.lastCall === "never") add(db`not exists (select 1 from call_outcomes o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id)`);
  if (f.lastCall === "7" || f.lastCall === "30") add(db`not exists (select 1 from call_outcomes o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id
      and o.created_at > now() - make_interval(days => ${Number(f.lastCall)}::int))`);
  if (f.stage) add(db`exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'open'
      and o.stage_id in (select s->>'id' from pipelines p cross join lateral jsonb_array_elements(coalesce(p.stages, '[]'::jsonb)) s where p.installation_id = c.installation_id and lower(s->>'name') = ${f.stage.toLowerCase()}))`);
  if (f.location) add(db`c.location_id = ${f.location}`);
  if (f.deal === "open") add(db`exists (select 1 from cached_opportunities o ${dealScopeJoins()} where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'open' and not ${outOfScope()})`);
  if (f.deal === "won") add(db`exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'won')`);
  if (f.deal === "none") add(db`not exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id)`);
  if (f.hasPhone) add(db`nullif(c.phone, '') is not null`);
  if (f.hideDnd) add(db`not c.dnd`);
  if (f.cold === "cold") add(coldTags.length ? db`c.tags && ${coldTags}::text[]` : db`false`);
  if (f.cold === "working" && coldTags.length) add(db`not (c.tags && ${coldTags}::text[])`);
  void installationId;
  return parts.reduce((acc, p) => db`${acc} and ${p}`, db`true`);
}

/**
 * One page of people for the filter. The count is exact up to COUNT_CAP (10,000) and then stops ("capped"): counting two million matches of two letters would cost more than
 * the page itself, and nobody reads past the first pages. The count is a second read of the same filter, run beside the page, so the number and the list agree.
 */
export async function searchPeople(installationId: string, allowed: string[] | null, f: SmartFilter, page: number, coldTags: string[]): Promise<{ total: number; capped: boolean; page: number; pageSize: number; rows: PersonRow[] }> {
  const size = PAGE_SIZE;
  const offset = (Math.max(1, Math.floor(page)) - 1) * size;
  return timed(async (db) => {
    const counting = db`with loc as (${visible(db, installationId, allowed)})
      select count(*)::int n from (select 1 from cached_contacts c join loc on loc.location_id = c.location_id
        where c.installation_id = ${installationId} and ${filterSql(db, installationId, f, coldTags)} limit ${COUNT_CAP + 1}) x`;
    const rows = await db`
      with loc as (${visible(db, installationId, allowed)}),
      pg as (
        select c.contact_id, c.location_id, loc.name location_name, loc.timezone, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name, c.email, c.phone, c.tags,
          c.source, nullif(c.assigned_to, '') owner, c.dnd, c.date_added, c.last_activity_at
        from cached_contacts c join loc on loc.location_id = c.location_id
        where c.installation_id = ${installationId} and ${filterSql(db, installationId, f, coldTags)}
        order by ${f.q ? db`(lower(c.email) = ${f.q.toLowerCase()}) desc, (c.full_name ilike ${escapeLike(f.q) + "%"}) desc,` : db``} c.last_activity_at desc nulls last, c.date_added desc nulls last, c.contact_id
        limit ${size} offset ${offset})
      select pg.*, lc.last_call_at, coalesce(lc.calls, 0) calls, lc.last_result
      from pg left join lateral (
        select max(o.created_at) last_call_at, count(*)::int calls, (array_agg(o.outcome order by o.created_at desc))[1] last_result
        from call_outcomes o where o.installation_id = ${installationId} and o.location_id = pg.location_id and o.contact_id = pg.contact_id) lc on true
      order by pg.last_activity_at desc nulls last, pg.date_added desc nulls last, pg.contact_id`;
    const [counted] = await counting;
    const n = Number(counted?.n ?? 0);
    return {
      total: Math.min(n, COUNT_CAP), capped: n > COUNT_CAP, page: Math.max(1, Math.floor(page)), pageSize: size,
      rows: rows.map((r) => ({
        contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name, name: properName(r.name as string), email: r.email, phone: r.phone, tags: r.tags ?? [], source: r.source,
        owner: r.owner, dnd: r.dnd === true, timeZone: r.timezone ?? null, dateAdded: iso(r.date_added), lastActivityAt: iso(r.last_activity_at),
        lastCallAt: iso(r.last_call_at), calls: r.calls, lastResult: r.last_result ?? null,
      })),
    };
  });
}

// ---------------- going cold ----------------

export type ColdBucket = "recent" | "quiet" | "none";

/**
 * The working leads (not on a cold list) in one of the three groups the Leads engagement figure counts (F1, docs/METRICS.md "Engaged, then quiet"):
 * seen in the last QUIET_AFTER_DAYS, seen and then nothing since, or nothing seen at all. The signal is the same: the customer wrote last in a
 * conversation, an appointment, a deal in play. The bucket's count and its list are one query, so the number and the list agree.
 */
export async function goingCold(installationId: string, allowed: string[] | null, bucket: ColdBucket, coldTags: string[], page: number): Promise<{ total: number; page: number; pageSize: number; rows: Array<PersonRow & { lastSignalAt: string | null }> }> {
  const size = PAGE_SIZE;
  const offset = (Math.max(1, Math.floor(page)) - 1) * size;
  return timed(async (db) => {
    const rows = await db`
      with loc as (${visible(db, installationId, allowed)}),
      sig as (
        select location_id, contact_id, max(t) last_signal from (
          select location_id, contact_id, last_message_at t from cached_conversations where installation_id = ${installationId} and contact_id is not null and last_message_direction = 'inbound'
          union all
          select location_id, contact_id, start_at from cached_appointments where installation_id = ${installationId} and contact_id is not null and status <> 'invalid'
          union all
          select o.location_id, o.contact_id, coalesce(greatest(o.last_stage_change_at, o.last_action_at, o.updated_remote_at), o.created_remote_at)
            from cached_opportunities o ${dealScopeJoins()} where o.installation_id = ${installationId} and o.contact_id is not null and not (o.status = 'open' and ${outOfScope()})
        ) s group by location_id, contact_id),
      pg as (
        select c.contact_id, c.location_id, loc.name location_name, loc.timezone, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name, c.email, c.phone, c.tags,
          c.source, nullif(c.assigned_to, '') owner, c.dnd, c.date_added, c.last_activity_at, sig.last_signal, count(*) over() total
        from cached_contacts c join loc on loc.location_id = c.location_id
        left join sig on sig.location_id = c.location_id and sig.contact_id = c.contact_id
        where c.installation_id = ${installationId}
          ${coldTags.length ? db`and not (c.tags && ${coldTags}::text[])` : db``}
          and ${bucket === "none" ? db`sig.last_signal is null`
            : bucket === "recent" ? db`sig.last_signal >= now() - make_interval(days => ${QUIET_AFTER_DAYS}::int)`
            : db`sig.last_signal < now() - make_interval(days => ${QUIET_AFTER_DAYS}::int)`}
        order by sig.last_signal desc nulls last, c.date_added desc nulls last, c.contact_id
        limit ${size} offset ${offset})
      select pg.*, lc.last_call_at, coalesce(lc.calls, 0) calls, lc.last_result
      from pg left join lateral (
        select max(o.created_at) last_call_at, count(*)::int calls, (array_agg(o.outcome order by o.created_at desc))[1] last_result
        from call_outcomes o where o.installation_id = ${installationId} and o.location_id = pg.location_id and o.contact_id = pg.contact_id) lc on true
      order by pg.last_signal desc nulls last, pg.date_added desc nulls last, pg.contact_id`;
    return {
      total: Number(rows[0]?.total ?? 0), page: Math.max(1, Math.floor(page)), pageSize: size,
      rows: rows.map((r) => ({
        contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name, name: properName(r.name as string), email: r.email, phone: r.phone, tags: r.tags ?? [], source: r.source,
        owner: r.owner, dnd: r.dnd === true, timeZone: r.timezone ?? null, dateAdded: iso(r.date_added), lastActivityAt: iso(r.last_activity_at), lastSignalAt: iso(r.last_signal),
        lastCallAt: iso(r.last_call_at), calls: r.calls, lastResult: r.last_result ?? null,
      })),
    };
  });
}

// ---------------- tags ----------------

/** The first time SubSync recorded any tag change for this view's accounts: everything before it is unknown ("since SubSync started watching"). */
export async function watchingSince(installationId: string, allowed: string[] | null): Promise<string | null> {
  const [r] = await sql()`select min(at) at from contact_tag_events where installation_id = ${installationId} ${allowed ? sql()`and location_id = any(${allowed}::text[])` : sql()``}`;
  return iso(r?.at);
}

export const TAG_DAY_MEMBER_CAP = 60;

export type TagDay = { day: string; count: number; members: Array<{ contactId: string; locationId: string; locationName: string | null; name: string; phone: string | null; owner: string | null; dnd: boolean; timeZone: string | null }> };

/**
 * One tag: how many contacts carry it, and for each of the last `days` days how many were tagged that day (the day SubSync saw the tag added) and still carry it,
 * with the first TAG_DAY_MEMBER_CAP of them. The bar's number is the count of its own members query, so it cannot differ from the list; the full list of a day
 * is the Search and filters tab with the same tag and day (the same predicate, filterSql).
 */
export async function tagDetail(installationId: string, allowed: string[] | null, tag: string, fromDay: string, toDay: string) {
  return timed(async (db) => {
    const [[tot], members, removed, since] = await Promise.all([
      db`with loc as (${visible(db, installationId, allowed)}) select count(*)::int n from cached_contacts c join loc on loc.location_id = c.location_id where c.installation_id = ${installationId} and c.tags @> ${[tag]}::text[]`,
      db`with loc as (${visible(db, installationId, allowed)}),
         first_seen as (
           select e.location_id, e.contact_id, min(e.at) at from contact_tag_events e join loc on loc.location_id = e.location_id
           where e.installation_id = ${installationId} and e.kind = 'added' and e.tag = ${tag} and (e.at at time zone 'UTC')::date between ${fromDay}::date and ${toDay}::date group by 1, 2),
         ranked as (
           select to_char(f.at at time zone 'UTC', 'YYYY-MM-DD') as day, c.contact_id, c.location_id, loc.name location_name, loc.timezone,
             coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') as name, c.phone, nullif(c.assigned_to, '') as owner, c.dnd,
             row_number() over (partition by to_char(f.at at time zone 'UTC', 'YYYY-MM-DD') order by f.at, c.contact_id) as rn,
             count(*) over (partition by to_char(f.at at time zone 'UTC', 'YYYY-MM-DD')) as n
           from first_seen f join cached_contacts c on c.installation_id = ${installationId} and c.location_id = f.location_id and c.contact_id = f.contact_id and c.tags @> ${[tag]}::text[]
           join loc on loc.location_id = c.location_id)
         select * from ranked where rn <= ${TAG_DAY_MEMBER_CAP} order by day, rn`,
      db`select count(*)::int n from contact_tag_events e where e.installation_id = ${installationId} and e.kind = 'removed' and e.tag = ${tag} and (e.at at time zone 'UTC')::date between ${fromDay}::date and ${toDay}::date
         ${allowed ? db`and e.location_id = any(${allowed}::text[])` : db``}`,
      watchingSince(installationId, allowed),
    ]);
    const by = new Map<string, TagDay>();
    for (const r of members) {
      const d = by.get(r.day as string) ?? { day: r.day as string, count: Number(r.n), members: [] };
      d.members.push({ contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name, name: properName(r.name as string), phone: r.phone, owner: r.owner, dnd: r.dnd === true, timeZone: r.timezone ?? null });
      by.set(d.day, d);
    }
    const filled = fillDays([...by.values()].map((d) => ({ day: d.day, n: d.count })), fromDay, toDay);
    const days = filled.map((d) => by.get(d.day) ?? { day: d.day, count: 0, members: [] });
    return {
      tag, carrying: tot?.n ?? 0, since, removedInWindow: removed[0]?.n ?? 0, from: fromDay, to: toDay,
      tagged: days.reduce((s, d) => s + d.count, 0), days,
    };
  });
}

/** The days a contact's tags were first seen, for the lead panel ("tagged on" where known). */
export async function tagDatesFor(installationId: string, locationId: string, contactId: string): Promise<Record<string, string>> {
  const rows = await sql()`select e.tag, max(e.at) at from contact_tag_events e where e.installation_id = ${installationId} and e.location_id = ${locationId} and e.contact_id = ${contactId} and e.kind = 'added' group by 1`;
  return Object.fromEntries(rows.map((r) => [r.tag as string, iso(r.at) as string]));
}

// ---------------- a person's saved lists (kept in saved_views) ----------------
// A list is stored as a saved view: page 'people' for a person's own, page 'people-team' for the lists a company (or a business) shares with everyone who signs
// in to it. The owner key is made on the server from the verified session. Only the choices are stored, never a contact.

export type SavedList = { id: string; name: string; filter: SmartFilter; shared: boolean };

const PAGE_OWN = "people";
const PAGE_TEAM = "people-team";

export async function listSavedLists(installationId: string, owner: string, teamOwner: string | null): Promise<SavedList[]> {
  const rows = await sql()`select id, name, filters, page from saved_views where installation_id = ${installationId}
    and ((page = ${PAGE_OWN} and owner = ${owner}) ${teamOwner ? sql()`or (page = ${PAGE_TEAM} and owner = ${teamOwner})` : sql()``}) order by page, created_at`;
  return rows.map((r) => {
    const p = parseSmartFilter(r.filters);
    return { id: r.id as string, name: r.name as string, filter: p.ok ? p.filter : {}, shared: r.page === PAGE_TEAM };
  });
}

export async function saveList(installationId: string, owner: string, teamOwner: string | null, shared: boolean, name: string, filter: SmartFilter): Promise<"saved" | "full" | "no_team"> {
  if (shared && !teamOwner) return "no_team";
  const db = sql();
  const page = shared ? PAGE_TEAM : PAGE_OWN;
  const who = shared ? (teamOwner as string) : owner;
  const [have] = await db`select count(*)::int n, bool_or(name = ${name}) same from saved_views where installation_id = ${installationId} and owner = ${who} and page = ${page}`;
  if ((have?.n ?? 0) >= MAX_LISTS_PER_PERSON && !have?.same) return "full";
  await db`insert into saved_views (installation_id, owner, page, name, filters) values (${installationId}, ${who}, ${page}, ${name}, ${db.json(filter as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`;
  return "saved";
}

/** Removes one of the person's own lists, or a shared one when the caller may manage the team's. False when it is not theirs or does not exist. */
export async function removeList(installationId: string, owner: string, teamOwner: string | null, id: string): Promise<boolean> {
  const gone = await sql()`delete from saved_views where installation_id = ${installationId} and id = ${id}
    and ((page = ${PAGE_OWN} and owner = ${owner}) ${teamOwner ? sql()`or (page = ${PAGE_TEAM} and owner = ${teamOwner})` : sql()``}) returning 1`;
  return gone.length > 0;
}

// ---------------- the dialer setting (kept in saved_views, page 'people-prefs') ----------------

export async function getDialer(installationId: string, owner: string): Promise<DialerChoice> {
  const [r] = await sql()`select filters from saved_views where installation_id = ${installationId} and owner = ${owner} and page = 'people-prefs' and name = 'dialer'`;
  return parseChoice(r?.filters);
}

/** Has this person ever chosen (or skipped) the dialer question? Until then the first Call press asks. */
export async function hasDialerChoice(installationId: string, owner: string): Promise<boolean> {
  const [r] = await sql()`select 1 x from saved_views where installation_id = ${installationId} and owner = ${owner} and page = 'people-prefs' and name = 'dialer'`;
  return Boolean(r);
}

/** Stores only the choice (and, for a connected dialer, its name and link template). No token, no vendor key. */
export async function setDialer(installationId: string, owner: string, choice: DialerChoice): Promise<void> {
  const db = sql();
  await db`insert into saved_views (installation_id, owner, page, name, filters) values (${installationId}, ${owner}, 'people-prefs', 'dialer', ${db.json(choice as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`;
}
