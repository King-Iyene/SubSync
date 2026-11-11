import type { PendingQuery, Row } from "postgres";
import type { Sql } from "../db";

// The one place the list asks "is this person snoozed or hidden?". Snooze and hide are written by the actions slice (B); this slice only READS them for the Snoozed and Hidden
// filters. Until that table exists the hook says "not available" and the filters are not offered, so nothing here depends on a table that may not be applied yet.
// To wire it: return `{ available: true, snoozed: <sql fragment true for a snoozed person>, hidden: <sql fragment true for a hidden person> }` written for the alias `p`
// (people: p.location_id, p.contact_id, p.pkey, p.conversation_id) and bound to the installation.

type Db = Sql;
type Fragment = PendingQuery<Row[]>;
export type SnoozeHook = { available: false } | { available: true; snoozed: Fragment; hidden: Fragment };

export async function snoozeHook(_db: Db, _installationId: string): Promise<SnoozeHook> {
  return { available: false };
}
