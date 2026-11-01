import { sql } from "../db";
import { MAX_SAVED_VIEWS, sanitizeQueue, type QueueFilter } from "./waiting-view";

// The reads and writes behind the Unanswered messages page that are not the waiting list itself (that is `inbox` in queries.ts).

/** Who each contact is assigned to, for the conversations on the page. Keyed "account:contact". A contact with nobody assigned maps to null. */
export async function contactOwners(installationId: string, pairs: Array<{ locationId: string; contactId: string | null }>): Promise<Map<string, string | null>> {
  const ids = [...new Set(pairs.map((p) => p.contactId).filter((x): x is string => Boolean(x)))];
  const locs = [...new Set(pairs.map((p) => p.locationId))];
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  const rows = await sql()`
    select location_id, contact_id, nullif(assigned_to, '') assigned_to from cached_contacts
    where installation_id = ${installationId} and location_id = any(${locs}::text[]) and contact_id = any(${ids}::text[])`;
  for (const r of rows) out.set(`${r.location_id}:${r.contact_id}`, (r.assigned_to as string | null) ?? null);
  return out;
}

/** The names of the team members: from the platform when the team permission was granted, otherwise as typed on the Team page. */
export async function teamNames(installationId: string): Promise<Map<string, string>> {
  const rows = await sql()`select user_id, name from team_names where installation_id = ${installationId}`;
  return new Map(rows.map((r) => [r.user_id as string, r.name as string]));
}

// ---------------- saved views (per person) ----------------

export type SavedView = { id: string; name: string; filters: QueueFilter };

export async function listViews(installationId: string, owner: string, page = "inbox"): Promise<SavedView[]> {
  const rows = await sql()`select id, name, filters from saved_views where installation_id = ${installationId} and owner = ${owner} and page = ${page} order by created_at`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, filters: sanitizeQueue(r.filters) }));
}

/** Saves a view under a name; the same name again replaces it. "full" when the person already has the most views allowed. */
export async function saveView(installationId: string, owner: string, name: string, filters: QueueFilter, page = "inbox"): Promise<"saved" | "full"> {
  const db = sql();
  const [have] = await db`select count(*)::int n, bool_or(name = ${name}) same from saved_views where installation_id = ${installationId} and owner = ${owner} and page = ${page}`;
  if ((have?.n ?? 0) >= MAX_SAVED_VIEWS && !have?.same) return "full";
  await db`
    insert into saved_views (installation_id, owner, page, name, filters) values (${installationId}, ${owner}, ${page}, ${name}, ${db.json(sanitizeQueue(filters) as never)})
    on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`;
  return "saved";
}

/** Removes one of the person's own views. False when it is not theirs or does not exist. */
export async function removeView(installationId: string, owner: string, id: string): Promise<boolean> {
  const gone = await sql()`delete from saved_views where installation_id = ${installationId} and owner = ${owner} and id = ${id} returning 1`;
  return gone.length > 0;
}
