import { COUNT_CAP } from "../people/queue";
import { FIND_PAGE, encodeCursor, type Cursor } from "../people/find";
import type { SmartFilter } from "../people/filters";
import { escapeLike, filterSql, timed, visible, type PersonRow } from "./people-list-queries";

// Find a lead, the read behind "Load more" and the export (docs/features/FINDLEAD_BRIEF.md). It is the same filter as the People search (filterSql, so a number and its list agree), but
// the next page is found with a KEYSET: "everything after the last person you saw", compared on (match rank, last activity, added, account, contact). The cost of page 5,000 is the
// cost of page 2; an offset would have to read and drop 250,000 rows first. Every read takes the accounts the caller may see (`allowed`) and limits itself to them in the query.
// The count is run only for the first page (exact up to 10,000, then "10,000+"), beside the page, never again while paging.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export type FoundPage = { total: number | null; capped: boolean; rows: PersonRow[]; next: string | null };

export async function findPeople(installationId: string, allowed: string[] | null, f: SmartFilter, after: Cursor | null, coldTags: string[], size = FIND_PAGE): Promise<FoundPage> {
  return timed(async (db) => {
    const q = f.q?.trim() ?? "";
    const rk = q ? db`((lower(c.email) = ${q.toLowerCase()})::int * 2 + (c.full_name ilike ${`${escapeLike(q)}%`})::int)` : db`0::int`;
    const ra = db`coalesce(c.last_activity_at, '-infinity'::timestamptz)`;
    const rd = db`coalesce(c.date_added, '-infinity'::timestamptz)`;
    const past = after ? db`and (${rk}, ${ra}, ${rd}, c.location_id, c.contact_id) < (${after.rk}::int, ${after.ra}::text::timestamptz, ${after.rd}::text::timestamptz, ${after.loc}::text, ${after.id}::text)` : db``;
    const counting = after ? null : db`with loc as (${visible(db, installationId, allowed)})
      select count(*)::int n from (select 1 from cached_contacts c join loc on loc.location_id = c.location_id
        where c.installation_id = ${installationId} and ${filterSql(db, installationId, f, coldTags)} limit ${COUNT_CAP + 1}) x`;
    const rows = await db`
      with loc as (${visible(db, installationId, allowed)}),
      pg as (
        select c.contact_id, c.location_id, loc.name location_name, loc.timezone, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name, c.email, c.phone, c.tags,
          c.source, nullif(c.assigned_to, '') owner, c.dnd, c.date_added, c.last_activity_at, ${rk} rk, ${ra}::text ra_t, ${rd}::text rd_t
        from cached_contacts c join loc on loc.location_id = c.location_id
        where c.installation_id = ${installationId} and ${filterSql(db, installationId, f, coldTags)} ${past}
        order by ${rk} desc, ${ra} desc, ${rd} desc, c.location_id desc, c.contact_id desc
        limit ${size + 1})
      select pg.*, lc.last_call_at, coalesce(lc.calls, 0) calls, lc.last_result
      from pg left join lateral (
        select max(o.created_at) last_call_at, count(*)::int calls, (array_agg(o.outcome order by o.created_at desc))[1] last_result
        from call_outcomes o where o.installation_id = ${installationId} and o.location_id = pg.location_id and o.contact_id = pg.contact_id) lc on true
      order by pg.rk desc, pg.ra_t::timestamptz desc, pg.rd_t::timestamptz desc, pg.location_id desc, pg.contact_id desc`;
    const counted = counting ? (await counting)[0] : null;
    const more = rows.length > size;
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    const n = Number(counted?.n ?? 0);
    return {
      total: counting ? Math.min(n, COUNT_CAP) : null, capped: counting ? n > COUNT_CAP : false,
      next: more && last ? encodeCursor({ rk: Number(last.rk), ra: last.ra_t as string, rd: last.rd_t as string, loc: last.location_id as string, id: last.contact_id as string }) : null,
      rows: page.map((r) => ({
        contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name, name: r.name, email: r.email, phone: r.phone, tags: r.tags ?? [], source: r.source,
        owner: r.owner, dnd: r.dnd === true, timeZone: r.timezone ?? null, dateAdded: iso(r.date_added), lastActivityAt: iso(r.last_activity_at),
        lastCallAt: iso(r.last_call_at), calls: r.calls, lastResult: r.last_result ?? null,
      })),
    };
  });
}
