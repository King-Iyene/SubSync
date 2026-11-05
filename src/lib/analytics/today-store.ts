import { sql } from "../db";
import type { Action, ActionEvent } from "./today-state";
import { nextVisit, type VisitRecord } from "./today-smart";
import type { Kind } from "./today-queue";

// The only place Today touches its own tables. Two stores, both SubSync's own (nothing here is ever sent to the CRM):
//   today_actions  the append-only log of Done, Snooze, Assign and Undo presses (additive migration 20261104090000_today_actions.sql)
//   saved_views    one row per person (page "today_visit") that remembers when they last had Today open, so "since your last visit" has something to count from
// If the migration has not been applied yet, every read answers "nothing set aside" and every press answers with the plain words below, never an error page.

export const NEEDS_UPDATE = "Needs the latest database update. Ask the person who manages SubSync to apply it, then try again.";

/** Postgres says 42P01 when a table does not exist yet. */
export function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  // 42P01 = missing table, 42703 = missing column: both mean "the database update has not been applied", never a crash.
  return ["42P01", "42703"].some((c) => e?.code === c || e?.cause?.code === c);
}

const DAY = 86_400_000;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : 0);

/** Events of the last 14 days in the lanes the person reads. `available` is false when the table is not there yet. */
export async function loadActions(installationId: string, lanes: string[], now: number): Promise<{ events: ActionEvent[]; available: boolean }> {
  try {
    const rows = await sql()`
      select id::int, row_key, location_id, kind, action, lane, actor_key, actor_name, until_at, undoes::int, item_ids, created_at
      from today_actions where installation_id = ${installationId} and lane = any(${lanes}::text[]) and created_at > ${new Date(now - 14 * DAY)}
      order by created_at asc, id asc limit 5000`;
    return {
      available: true,
      events: rows.map((r) => ({
        id: r.id as number, rowKey: r.row_key as string, locationId: r.location_id as string, kind: r.kind as Kind, action: r.action as Action, lane: r.lane as string,
        actorKey: r.actor_key as string, actorName: (r.actor_name as string | null) ?? null, until: r.until_at ? ms(r.until_at) : null, undoes: (r.undoes as number | null) ?? null,
        itemIds: (r.item_ids as string[]) ?? [], at: ms(r.created_at),
      })),
    };
  } catch (error) {
    if (isMissingTable(error)) return { events: [], available: false };
    throw error;
  }
}

export type NewAction = {
  installationId: string; locationId: string; rowKey: string; kind: Kind; action: Action; lane: string;
  actorKey: string; actorName: string | null; actorRole: string | null; until: number | null; undoes: number | null; itemIds: string[];
};
/** Appends one event and returns it. Throws NEEDS_UPDATE's error when the table is missing. */
export async function appendAction(a: NewAction): Promise<{ id: number; at: number }> {
  try {
    const [r] = await sql()`
      insert into today_actions (installation_id, location_id, row_key, kind, action, lane, actor_key, actor_name, actor_role, until_at, undoes, item_ids)
      values (${a.installationId}, ${a.locationId}, ${a.rowKey}, ${a.kind}, ${a.action}, ${a.lane}, ${a.actorKey}, ${a.actorName}, ${a.actorRole}, ${a.until ? new Date(a.until) : null}, ${a.undoes}, ${a.itemIds}::text[])
      returning id::int, created_at`;
    return { id: r.id as number, at: ms(r.created_at) };
  } catch (error) {
    if (isMissingTable(error)) throw new NeedsUpdate();
    throw error;
  }
}
export class NeedsUpdate extends Error { constructor() { super(NEEDS_UPDATE); } }

/** One event by id, only if it is in one of the lanes the person reads (so a forged id of someone else's event finds nothing). */
export async function findAction(installationId: string, lanes: string[], id: number): Promise<ActionEvent | null> {
  const { events } = await loadActions(installationId, lanes, Date.now());
  return events.find((e) => e.id === id) ?? null;
}

// ---------- since your last visit ----------

const VISIT_PAGE = "today_visit", VISIT_NAME = "last";

/** Reads the person's visit record, moves it forward (a new visit starts after a 30 minute gap) and returns where "since your last visit" counts from. */
export async function touchVisit(installationId: string, owner: string, now: number): Promise<number | null> {
  try {
    const [row] = await sql()`select filters from saved_views where installation_id = ${installationId} and owner = ${owner} and page = ${VISIT_PAGE} and name = ${VISIT_NAME}`;
    const f = (row?.filters ?? null) as { seen?: unknown; since?: unknown } | null;
    const prev: VisitRecord | null = f && typeof f.seen === "number" ? { seen: f.seen, since: typeof f.since === "number" ? f.since : null } : null;
    const next = nextVisit(prev, now);
    await sql()`
      insert into saved_views (installation_id, owner, page, name, filters) values (${installationId}, ${owner}, ${VISIT_PAGE}, ${VISIT_NAME}, ${sql().json(next as never)})
      on conflict (installation_id, owner, page, name) do update set filters = excluded.filters`;
    return next.since;
  } catch (error) {
    // The visit memory is an extra: if it cannot be read or written, Today simply has no "since your last visit" strip.
    console.error("Today visit memory failed", error instanceof Error ? error.message : "unknown");
    return null;
  }
}
