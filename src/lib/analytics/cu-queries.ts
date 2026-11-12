import { sql, type Sql } from "../db";
import {
  CONTACT_KINDS, CONTACT_PREDICATE, COUNT_CAP, DEAL_KINDS, EMPTY_COUNTS, KINDS, PAGE, RULES_VERSION, STALE_DAYS, encodeCursor, healthOf, isDealKind, protectedReason,
  type ContactKind, type Counts, type Cursor, type DealKind, type Kind, type ProtectReason,
} from "../cleanup/cu-core";

// Clean-up (stage CU): every read and write of the fix lists, the daily record and the bulk-run log. Read the contact and deal copies SubSync already holds; nothing here talks to the CRM.
// Every query filters by the installation AND by the accounts the caller may see (`allowed`, null = all of that installation's). The predicates come from constants in cu-core.ts: nothing
// a person typed is ever put into SQL text. Counts are exact only from the daily record; a live count stops at COUNT_CAP and says "10,000+", so a first screen never scans a million rows.

type Db = Sql;
const scopeOf = (db: Db, alias: string, allowed: string[] | null) => (allowed ? db`and ${db.unsafe(alias)}.location_id = any(${allowed}::text[])` : db``);
const locOf = (db: Db, alias: string, location: string | null) => (location ? db`and ${db.unsafe(alias)}.location_id = ${location}` : db``);

const STALE_SQL = `coalesce(o.last_stage_change_at, o.synced_at) < now() - interval '${STALE_DAYS} days'`;
const DEAL_PREDICATE: Record<DealKind, string> = {
  stale_deals: STALE_SQL,
  ownerless_deals: "coalesce(o.assigned_to, '') = ''",
  orphan_deals: "(o.contact_id is null or not exists (select 1 from cached_contacts c where c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = o.contact_id))",
};

/** The columns each part of the request narrows by. */
export type Scope = { inst: string; allowed: string[] | null; location: string | null };

// ------------------------------------------------------------------------------------------ counts
export type CountCell = { n: number; capped: boolean };

/** Live counts, each stopping at COUNT_CAP, so the first screen is quick at any size. Only used where no daily record exists yet. */
export async function cappedCounts(s: Scope): Promise<Record<Kind, CountCell>> {
  const db = sql();
  const one = async (k: Kind): Promise<[Kind, CountCell]> => {
    const rows = isDealKind(k)
      ? await db`select count(*)::int n from (select 1 from cached_opportunities o where o.installation_id = ${s.inst} and o.status = 'open' ${scopeOf(db, "o", s.allowed)} ${locOf(db, "o", s.location)} and ${db.unsafe(DEAL_PREDICATE[k])} limit ${COUNT_CAP + 1}) x`
      : await db`select count(*)::int n from (select 1 from cached_contacts c where c.installation_id = ${s.inst} ${scopeOf(db, "c", s.allowed)} ${locOf(db, "c", s.location)} and ${db.unsafe(CONTACT_PREDICATE[k])} limit ${COUNT_CAP + 1}) x`;
    const n = (rows[0]?.n as number) ?? 0;
    return [k, { n: Math.min(n, COUNT_CAP), capped: n > COUNT_CAP }];
  };
  return Object.fromEntries(await Promise.all(KINDS.map(one))) as Record<Kind, CountCell>;
}

// ------------------------------------------------------------------------------------------ lists
export type ListRow = {
  rowId: string; kind: Kind; locationId: string; locationName: string | null; contactId: string | null; dealId: string | null; name: string; email: string | null; phone: string | null;
  owner: string | null; source: string | null; dnd: boolean; value: number | null; stage: string | null; since: string | null;
  protect: ProtectReason | null;
};
export type ListPage = { rows: ListRow[]; next: string | null };

/** One keyset page of one kind of problem. A page is PAGE rows; "next" is a cursor, never an offset, so page 200 costs the same as page 1. */
export async function listKind(s: Scope, kind: Kind, after: Cursor | null, limit = PAGE): Promise<ListPage> {
  const db = sql();
  const lim = Math.min(Math.max(1, limit), 200);
  if (isDealKind(kind)) {
    const rows = await db`
      select o.location_id, o.opportunity_id, o.contact_id, o.contact_name, o.name, o.monetary_value, o.stage_name, o.assigned_to, o.source, coalesce(o.last_stage_change_at, o.synced_at) since, l.name loc_name,
        c.dnd, c.email, c.phone
      from cached_opportunities o
      join locations l on l.installation_id = o.installation_id and l.location_id = o.location_id and not l.ignored
      left join cached_contacts c on c.installation_id = o.installation_id and c.location_id = o.location_id and c.contact_id = o.contact_id
      where o.installation_id = ${s.inst} and o.status = 'open' ${scopeOf(db, "o", s.allowed)} ${locOf(db, "o", s.location)} and ${db.unsafe(DEAL_PREDICATE[kind])}
        ${after ? db`and (o.location_id, o.opportunity_id) > (${after.loc}, ${after.id})` : db``}
      order by o.location_id, o.opportunity_id limit ${lim + 1}`;
    const page = rows.slice(0, lim);
    const out: ListRow[] = page.map((r) => ({
      rowId: `${r.location_id}:${r.opportunity_id}`, kind, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null, contactId: (r.contact_id as string | null) ?? null, dealId: r.opportunity_id as string,
      name: ((r.name as string | null) || "Untitled deal"), email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null, owner: (r.assigned_to as string | null) ?? null, source: (r.source as string | null) ?? null,
      dnd: r.dnd === true, value: r.monetary_value === null ? null : Number(r.monetary_value), stage: (r.stage_name as string | null) ?? null, since: r.since ? new Date(r.since as string).toISOString() : null,
      protect: null,
    }));
    const last = page[page.length - 1];
    return { rows: out, next: rows.length > lim && last ? encodeCursor({ loc: last.location_id as string, id: last.opportunity_id as string }) : null };
  }
  const rows = await db`
    select c.location_id, c.contact_id, c.full_name, c.email, c.phone, c.assigned_to, c.source, c.dnd, c.date_added, l.name loc_name,
      exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'open') open_deal,
      exists (select 1 from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id and a.start_at > now()
        and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'noshow', 'no_show', 'invalid')) upcoming
    from cached_contacts c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    where c.installation_id = ${s.inst} ${scopeOf(db, "c", s.allowed)} ${locOf(db, "c", s.location)} and ${db.unsafe(CONTACT_PREDICATE[kind as ContactKind])}
      ${after ? db`and (c.location_id, c.contact_id) > (${after.loc}, ${after.id})` : db``}
    order by c.location_id, c.contact_id limit ${lim + 1}`;
  const page = rows.slice(0, lim);
  const out: ListRow[] = page.map((r) => ({
    rowId: `${r.location_id}:${r.contact_id}`, kind, locationId: r.location_id as string, locationName: (r.loc_name as string | null) ?? null, contactId: r.contact_id as string, dealId: null,
    name: ((r.full_name as string | null) || (r.email as string | null) || "Unnamed contact"), email: (r.email as string | null) ?? null, phone: (r.phone as string | null) ?? null,
    owner: (r.assigned_to as string | null) ?? null, source: (r.source as string | null) ?? null, dnd: r.dnd === true, value: null, stage: null, since: r.date_added ? new Date(r.date_added as string).toISOString() : null,
    protect: protectedReason({ dnd: r.dnd === true, openDeals: r.open_deal === true ? 1 : 0, upcomingAppointments: r.upcoming === true ? 1 : 0 }),
  }));
  const last = page[page.length - 1];
  return { rows: out, next: rows.length > lim && last ? encodeCursor({ loc: last.location_id as string, id: last.contact_id as string }) : null };
}

// ------------------------------------------------------------------------------------------ the daily record (the history, our moat)
export type ScanRow = { locationId: string; name: string | null; day: string; counts: Counts; score: number | null; protectedContacts: number };

/** Counts for ONE account, one pass. The duplicate numbers come from blocking keys (the exact email, the last nine phone digits), never from pairs. */
export async function scanAccount(inst: string, loc: string): Promise<Counts & { protectedContacts: number; dupGroups: number }> {
  const db = sql();
  const [c] = await db`
    select count(*)::int contacts,
      count(*) filter (where ${db.unsafe(CONTACT_PREDICATE.junk)})::int junk,
      count(*) filter (where ${db.unsafe(CONTACT_PREDICATE.no_owner)})::int no_owner,
      count(*) filter (where ${db.unsafe(CONTACT_PREDICATE.no_phone)})::int no_phone,
      count(*) filter (where ${db.unsafe(CONTACT_PREDICATE.no_email)})::int no_email,
      count(*) filter (where ${db.unsafe(CONTACT_PREDICATE.no_source)})::int no_source,
      count(*) filter (where ${db.unsafe(CONTACT_PREDICATE.bad_phone)})::int bad_phone,
      count(*) filter (where ${db.unsafe(CONTACT_PREDICATE.bad_email)})::int bad_email,
      count(*) filter (where c.dnd)::int dnd
    from cached_contacts c where c.installation_id = ${inst} and c.location_id = ${loc}`;
  const [d] = await db`
    select count(*)::int deals_open,
      count(*) filter (where ${db.unsafe(STALE_SQL)})::int stale_deals,
      count(*) filter (where coalesce(o.assigned_to, '') = '')::int ownerless_deals
    from cached_opportunities o where o.installation_id = ${inst} and o.location_id = ${loc} and o.status = 'open'`;
  const [orph] = await db`select count(*)::int n from cached_opportunities o where o.installation_id = ${inst} and o.location_id = ${loc} and o.status = 'open' and ${db.unsafe(DEAL_PREDICATE.orphan_deals)}`;
  const [dup] = await db`
    with e as (select lower(email) k, count(*) n from cached_contacts where installation_id = ${inst} and location_id = ${loc} and coalesce(email, '') <> '' group by 1 having count(*) > 1),
         p as (select right(phone_digits, 9) k, count(*) n from cached_contacts where installation_id = ${inst} and location_id = ${loc} and length(phone_digits) >= 9 group by 1 having count(*) > 1)
    select (select count(*) from e)::int + (select count(*) from p)::int groups, coalesce((select sum(n - 1) from e), 0)::int + coalesce((select sum(n - 1) from p), 0)::int extra`;
  return {
    ...EMPTY_COUNTS, contacts: c.contacts as number, dealsOpen: d.deals_open as number, dupExtra: Math.min(dup.extra as number, c.contacts as number),
    junk: c.junk as number, no_owner: c.no_owner as number, no_phone: c.no_phone as number, no_email: c.no_email as number, no_source: c.no_source as number, bad_phone: c.bad_phone as number, bad_email: c.bad_email as number,
    stale_deals: d.stale_deals as number, ownerless_deals: d.ownerless_deals as number, orphan_deals: orph.n as number, protectedContacts: c.dnd as number, dupGroups: dup.groups as number,
  };
}

/** Writes today's row for one account. Idempotent per (account, day): a second run the same day replaces the first. Counts only. */
export async function recordScan(inst: string, loc: string, s: Awaited<ReturnType<typeof scanAccount>>): Promise<void> {
  const db = sql();
  const h = healthOf(s);
  await db`
    insert into cu_scans (installation_id, location_id, day, contacts, deals_open, dup_groups, dup_extra, junk, no_owner, no_phone, no_email, no_source, bad_phone, bad_email, stale_deals, ownerless_deals, orphan_deals, protected_contacts, score, rules_version)
    values (${inst}, ${loc}, current_date, ${s.contacts}, ${s.dealsOpen}, ${s.dupGroups}, ${s.dupExtra}, ${s.junk}, ${s.no_owner}, ${s.no_phone}, ${s.no_email}, ${s.no_source}, ${s.bad_phone}, ${s.bad_email}, ${s.stale_deals}, ${s.ownerless_deals}, ${s.orphan_deals}, ${s.protectedContacts}, ${h.score}, ${RULES_VERSION})
    on conflict (installation_id, location_id, day) do update set contacts = excluded.contacts, deals_open = excluded.deals_open, dup_groups = excluded.dup_groups, dup_extra = excluded.dup_extra, junk = excluded.junk,
      no_owner = excluded.no_owner, no_phone = excluded.no_phone, no_email = excluded.no_email, no_source = excluded.no_source, bad_phone = excluded.bad_phone, bad_email = excluded.bad_email,
      stale_deals = excluded.stale_deals, ownerless_deals = excluded.ownerless_deals, orphan_deals = excluded.orphan_deals, protected_contacts = excluded.protected_contacts, score = excluded.score,
      rules_version = excluded.rules_version, taken_at = now()`;
}

/** The scheduled sweep: every account without a row for today, within a time budget (a big agency finishes over a few runs). Never throws. */
export async function sweep(inst: string, budgetMs = 20_000, only: string[] | null = null): Promise<{ scanned: number; pending: number }> {
  const db = sql();
  const rows = await db`
    select l.location_id from locations l
    where l.installation_id = ${inst} and not l.ignored ${only ? db`and l.location_id = any(${only}::text[])` : db``}
      and not exists (select 1 from cu_scans s where s.installation_id = l.installation_id and s.location_id = l.location_id and s.day = current_date)
    order by l.name`;
  const deadline = Date.now() + budgetMs;
  let scanned = 0;
  for (const r of rows) {
    if (Date.now() >= deadline) break;
    try { await recordScan(inst, r.location_id as string, await scanAccount(inst, r.location_id as string)); scanned++; } catch { /* the next run tries again */ }
  }
  return { scanned, pending: rows.length - scanned };
}

const toCounts = (r: Record<string, unknown>): Counts => ({
  contacts: r.contacts as number, dealsOpen: r.deals_open as number, dupExtra: r.dup_extra as number, junk: r.junk as number, no_owner: r.no_owner as number, no_phone: r.no_phone as number, no_email: r.no_email as number,
  no_source: r.no_source as number, bad_phone: r.bad_phone as number, bad_email: r.bad_email as number, stale_deals: r.stale_deals as number, ownerless_deals: r.ownerless_deals as number, orphan_deals: r.orphan_deals as number,
});

/** The newest row per account (from the last 7 days), worst score first. Paged by offset on a small list (one row per account), which is safe at hundreds of accounts. */
export async function latestPerAccount(s: Scope, search: string | null, limit: number, offset: number): Promise<{ rows: ScanRow[]; total: number }> {
  const db = sql();
  const q = search ? `%${search.replace(/[\\%_]/g, "\\$&").toLowerCase()}%` : null;
  const base = db`
    from (select distinct on (x.location_id) x.* from cu_scans x where x.installation_id = ${s.inst} and x.day >= current_date - 7 ${scopeOf(db, "x", s.allowed)} ${locOf(db, "x", s.location)} order by x.location_id, x.day desc) c
    join locations l on l.installation_id = c.installation_id and l.location_id = c.location_id and not l.ignored
    ${q ? db`where lower(l.name) like ${q}` : db``}`;
  const [t] = await db`select count(*)::int n ${base}`;
  const rows = await db`select c.*, l.name loc_name ${base} order by c.score asc nulls last, c.contacts desc, l.name limit ${limit} offset ${offset}`;
  return {
    total: t.n as number,
    rows: rows.map((r) => ({ locationId: r.location_id as string, name: (r.loc_name as string | null) ?? null, day: new Date(r.day as string).toISOString().slice(0, 10), counts: toCounts(r), score: (r.score as number | null) ?? null, protectedContacts: r.protected_contacts as number })),
  };
}

/** Every account's newest counts added up (the portfolio), and the scan age. Null when nothing has been scanned yet. */
export async function portfolioCounts(s: Scope): Promise<{ counts: Counts; accounts: number; day: string; protectedContacts: number } | null> {
  const db = sql();
  const [r] = await db`
    select count(*)::int accounts, max(day) day, coalesce(sum(contacts), 0)::int contacts, coalesce(sum(deals_open), 0)::int deals_open, coalesce(sum(dup_extra), 0)::int dup_extra, coalesce(sum(junk), 0)::int junk,
      coalesce(sum(no_owner), 0)::int no_owner, coalesce(sum(no_phone), 0)::int no_phone, coalesce(sum(no_email), 0)::int no_email, coalesce(sum(no_source), 0)::int no_source, coalesce(sum(bad_phone), 0)::int bad_phone,
      coalesce(sum(bad_email), 0)::int bad_email, coalesce(sum(stale_deals), 0)::int stale_deals, coalesce(sum(ownerless_deals), 0)::int ownerless_deals, coalesce(sum(orphan_deals), 0)::int orphan_deals,
      coalesce(sum(protected_contacts), 0)::int protected_contacts
    from (select distinct on (x.location_id) x.* from cu_scans x join locations l on l.installation_id = x.installation_id and l.location_id = x.location_id and not l.ignored
          where x.installation_id = ${s.inst} and x.day >= current_date - 7 ${scopeOf(db, "x", s.allowed)} ${locOf(db, "x", s.location)} order by x.location_id, x.day desc) c`;
  if (!r || (r.accounts as number) === 0) return null;
  return { counts: toCounts(r), accounts: r.accounts as number, day: new Date(r.day as string).toISOString().slice(0, 10), protectedContacts: r.protected_contacts as number };
}

export type TrendPoint = { day: string; score: number | null; contacts: number; problems: number };
/** The trend: one point per day from our own record, the portfolio's score computed from the summed counts of that day (each account counted once per day). */
export async function trend(s: Scope, days = 90): Promise<TrendPoint[]> {
  const db = sql();
  const rows = await db`
    select x.day, sum(x.contacts)::int contacts, sum(x.deals_open)::int deals_open, sum(x.dup_extra)::int dup_extra, sum(x.junk)::int junk, sum(x.no_owner)::int no_owner, sum(x.no_phone)::int no_phone,
      sum(x.no_email)::int no_email, sum(x.no_source)::int no_source, sum(x.bad_phone)::int bad_phone, sum(x.bad_email)::int bad_email, sum(x.stale_deals)::int stale_deals,
      sum(x.ownerless_deals)::int ownerless_deals, sum(x.orphan_deals)::int orphan_deals
    from cu_scans x join locations l on l.installation_id = x.installation_id and l.location_id = x.location_id and not l.ignored
    where x.installation_id = ${s.inst} and x.day >= current_date - ${Math.min(365, Math.max(7, days))}::int ${scopeOf(db, "x", s.allowed)} ${locOf(db, "x", s.location)}
    group by x.day order by x.day`;
  return rows.map((r) => {
    const c = toCounts(r);
    return { day: new Date(r.day as string).toISOString().slice(0, 10), score: healthOf(c).score, contacts: c.contacts, problems: c.junk + c.bad_phone + c.bad_email + c.no_phone + c.no_email + c.no_owner + c.no_source + c.stale_deals + c.ownerless_deals + c.orphan_deals + c.dupExtra };
  });
}

// ------------------------------------------------------------------------------------------ protected check at action time
export type Target = { locationId: string; contactId: string };
export type Live = { locationId: string; contactId: string; name: string; protect: ProtectReason | null; junk: boolean };

/** Re-reads each contact from OUR copy at the moment of the action: its protection and whether it is still junk. An id that is not the caller's is simply not returned. */
export async function readTargets(inst: string, allowed: string[] | null, targets: readonly Target[]): Promise<Live[]> {
  if (targets.length === 0) return [];
  const db = sql();
  const rows = await db`
    select c.location_id, c.contact_id, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name, c.dnd, ${db.unsafe(CONTACT_PREDICATE.junk)} is_junk,
      exists (select 1 from cached_opportunities o where o.installation_id = c.installation_id and o.location_id = c.location_id and o.contact_id = c.contact_id and o.status = 'open') open_deal,
      exists (select 1 from cached_appointments a where a.installation_id = c.installation_id and a.location_id = c.location_id and a.contact_id = c.contact_id and a.start_at > now()
        and lower(coalesce(a.status, '')) not in ('cancelled', 'canceled', 'noshow', 'no_show', 'invalid')) upcoming
    from cached_contacts c join unnest(${targets.map((t) => t.locationId)}::text[], ${targets.map((t) => t.contactId)}::text[]) as w(l, i) on w.l = c.location_id and w.i = c.contact_id
    where c.installation_id = ${inst} ${scopeOf(db, "c", allowed)}`;
  return rows.map((r) => ({ locationId: r.location_id as string, contactId: r.contact_id as string, name: r.name as string, junk: r.is_junk === true, protect: protectedReason({ dnd: r.dnd === true, openDeals: r.open_deal === true ? 1 : 0, upcomingAppointments: r.upcoming === true ? 1 : 0 }) }));
}

/** The next `limit` contacts of one kind in one account (the selection a "tag all" or "remove all" run acts on), re-read now. */
export async function selectionFor(s: Scope & { location: string }, kind: ContactKind, limit: number): Promise<Live[]> {
  const page = await listKind(s, kind, null, Math.min(200, limit * 4));
  const live: Live[] = [];
  for (const r of page.rows) if (r.contactId) live.push({ locationId: r.locationId, contactId: r.contactId, name: r.name, junk: kind === "junk", protect: r.protect });
  return live;
}

export async function logAction(a: { inst: string; location: string; kind: string; action: string; mode: string; requested: number; protectedSkipped: number; done: number; failed: number; typedOk: boolean; actor: string | null; note?: string }): Promise<void> {
  const db = sql();
  await db`insert into cu_actions (installation_id, location_id, kind, action, mode, requested, protected_skipped, done, failed, typed_ok, actor, note) values (${a.inst}, ${a.location}, ${a.kind}, ${a.action}, ${a.mode}, ${a.requested}, ${a.protectedSkipped}, ${a.done}, ${a.failed}, ${a.typedOk}, ${a.actor}, ${a.note ?? null})`;
}
export async function recentActions(inst: string, allowed: string[] | null, limit = 20): Promise<Array<{ at: string; location: string | null; kind: string; action: string; mode: string; requested: number; protectedSkipped: number; done: number; failed: number }>> {
  const db = sql();
  const rows = await db`select a.created_at, a.kind, a.action, a.mode, a.requested, a.protected_skipped, a.done, a.failed, l.name from cu_actions a left join locations l on l.installation_id = a.installation_id and l.location_id = a.location_id
    where a.installation_id = ${inst} ${scopeOf(db, "a", allowed)} order by a.created_at desc, a.id desc limit ${limit}`;
  return rows.map((r) => ({ at: new Date(r.created_at as string).toISOString(), location: (r.name as string | null) ?? null, kind: r.kind as string, action: r.action as string, mode: r.mode as string, requested: r.requested as number, protectedSkipped: r.protected_skipped as number, done: r.done as number, failed: r.failed as number }));
}

export { CONTACT_KINDS, DEAL_KINDS };
