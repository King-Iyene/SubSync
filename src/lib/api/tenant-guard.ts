import { sql } from "../db";

// The one shared check for any account (location) id that arrives in a request. An id is usable only when it belongs to the CALLER'S installation
// (from the verified session) and, when the caller is limited (client, segment, plan cap), is inside `allowed`. Anything else is treated as not there.
// Call this BEFORE any query that uses the id. Every query must also filter by installation_id (defence in depth).
const SHAPE = /^[A-Za-z0-9_-]{3,128}$/;

export async function ownedLocation(inst: string, allowed: string[] | null, v: unknown): Promise<string | null> {
  if (typeof v !== "string" || !SHAPE.test(v)) return null;
  if (allowed && !allowed.includes(v)) return null;
  const r = await sql()`select 1 from locations where installation_id = ${inst} and location_id = ${v} limit 1`;
  return r.length ? v : null;
}
