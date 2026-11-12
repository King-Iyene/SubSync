import { COUNT_CAP } from "../people/queue";
import { FIND_PAGE, encodeCursor, type Cursor } from "../people/find";
import type { SmartFilter } from "../people/filters";
import { filterSql, timed, visible, type PersonRow } from "./people-list-queries";

// Find a lead, the read behind "Load more" and the export (docs/features/FINDLEAD_BRIEF.md). It is the same filter as the People search (filterSql, so a number and its list agree), but
// the next page is found with a KEYSET: "everything after the last person you saw", compared on (match rank, last activity, added, account, contact). The cost of page 5,000 is the
// cost of page 2; an offset would have to read and drop 250,000 rows first. Every read takes the accounts the caller may see (`allowed`) and limits itself to them in the query.
// The count is run only for the first page (exact up to 10,000, then "10,000+"), beside the page, never again while paging.

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);

export type FoundPage = { total: number | null; capped: boolean; rows: PersonRow[]; next: string | null; plan?: string };

// The order is "newest activity first": (last activity, added, account, contact), all descending, with a missing date counting as the oldest. The index cached_contacts_recent_idx holds
// exactly these four expressions (after the company), so the database walks the index backwards and stops after one page; no sort of the whole table, whatever the table size. The
// "after" test is a ROW comparison on the same four expressions, which the same index answers by jumping straight to the place. A typed word looks at the START of a name, last name or
// email (or inside the phone digits) through prefix indexes, never at the middle of a word with a pattern that would read every row.
export async function findPeople(installationId: string, allowed: string[] | null, f: SmartFilter, after: Cursor | null, coldTags: string[], size = FIND_PAGE, explain = false): Promise<FoundPage> {
  return timed(async (db) => {
    const q = f.q?.trim() ?? "";
    const ra = db`coalesce(c.last_activity_at, '-infinity'::timestamptz)`;
    const rd = db`coalesce(c.date_added, '-infinity'::timestamptz)`;
    const past = after ? db`and (${ra}, ${rd}, c.location_id, c.contact_id) < (${after.ra}::text::timestamptz, ${after.rd}::text::timestamptz, ${after.loc}::text, ${after.id}::text)` : db``;
    const mine = db`c.location_id = any(array(select v.location_id from loc v))`;
    const counting = after ? null : db`with loc as (${visible(db, installationId, allowed)})
      select count(*)::int n from (select 1 from cached_contacts c
        where c.installation_id = ${installationId} and ${mine} and ${filterSql(db, installationId, f, coldTags)} limit ${COUNT_CAP + 1}) x`;
    const select = (where: ReturnType<typeof db>, limit: number) => db`
      with loc as (${visible(db, installationId, allowed)}),
      pg as (
        select c.contact_id, c.location_id, coalesce(nullif(c.full_name, ''), nullif(c.email, ''), 'Unnamed contact') name, c.email, c.phone, c.tags,
          c.source, nullif(c.assigned_to, '') owner, c.dnd, c.date_added, c.last_activity_at, ${ra}::text ra_t, ${rd}::text rd_t
        from cached_contacts c
        where c.installation_id = ${installationId} and ${mine} and ${where}
        order by ${ra} desc, ${rd} desc, c.location_id desc, c.contact_id desc
        limit ${limit})
      select pg.*, loc.name location_name, loc.timezone, lc.last_call_at, coalesce(lc.calls, 0) calls, lc.last_result
      from pg join loc on loc.location_id = pg.location_id left join lateral (
        select max(o.created_at) last_call_at, count(*)::int calls, (array_agg(o.outcome order by o.created_at desc))[1] last_result
        from call_outcomes o where o.installation_id = ${installationId} and o.location_id = pg.location_id and o.contact_id = pg.contact_id) lc on true
      order by pg.ra_t::timestamptz desc, pg.rd_t::timestamptz desc, pg.location_id desc, pg.contact_id desc`;
    const main = select(db`${filterSql(db, installationId, f, coldTags)} ${past}`, size + 1);
    let plan: string | undefined;
    if (explain) plan = (await db`explain (analyze, buffers) ${main}`).map((r) => r["QUERY PLAN"]).join("\n");
    // The person typed an exact email or full name: they come first on the first page (a short, indexed look-up), then the newest-first page carries on.
    const exact = !after && q && !explain ? select(db`(lower(c.email) = ${q.toLowerCase()} or lower(c.full_name) = ${q.toLowerCase()}) and ${filterSql(db, installationId, f, coldTags)}`, 5) : null;
    const [rows, firsts, counted] = await Promise.all([explain ? Promise.resolve([] as never[]) : main, exact ?? Promise.resolve([] as never[]), counting ?? Promise.resolve(null)]);
    const seen = new Set<string>();
    const all = [...firsts, ...rows].filter((r) => { const k = `${r.location_id}|${r.contact_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const more = rows.length > size;
    const pageRows = more ? rows.slice(0, size) : rows;
    const last = pageRows[pageRows.length - 1];
    const page = all.slice(0, size + firsts.length);
    const n = Number((counted as { n?: number }[] | null)?.[0]?.n ?? 0);
    return {
      total: counting ? Math.min(n, COUNT_CAP) : null, capped: counting ? n > COUNT_CAP : false, plan,
      next: more && last ? encodeCursor({ rk: 0, ra: last.ra_t as string, rd: last.rd_t as string, loc: last.location_id as string, id: last.contact_id as string }) : null,
      rows: page.map((r) => ({
        contactId: r.contact_id, locationId: r.location_id, locationName: r.location_name, name: r.name, email: r.email, phone: r.phone, tags: r.tags ?? [], source: r.source,
        owner: r.owner, dnd: r.dnd === true, timeZone: r.timezone ?? null, dateAdded: iso(r.date_added), lastActivityAt: iso(r.last_activity_at),
        lastCallAt: iso(r.last_call_at), calls: r.calls, lastResult: r.last_result ?? null,
      })),
    };
  });
}
