import { sql } from "../db";
import { isMissingTable } from "../analytics/today-store";
import type { ClientEvent } from "../analytics/clients-flow";
import { json, type AuthContext } from "./auth";
import type { GrowthDeps } from "./growth-api";

// The "Clients coming and going" tab of Today. For a company that looks after several clients only: a client's staff and a business owner get a plain refusal.
// Arrivals: when SubSync first saw each client. Departures: recorded from the day the `client_departures` table exists (see supabase/migrations/20261107100000_client_departures.sql).
// A person who may read only some clients (an agency user with limited access) sees only those clients' events.

type Ctx = AuthContext & { request: Request };

export async function clientsFlowRead(ctx: Ctx, deps: GrowthDeps): Promise<Response> {
  if (ctx.kind !== "agency") return json({ error: "Not available in your view", forbidden: true }, 403);
  const permits = await deps.permits(ctx);
  const rows = await sql()`select location_id, name, coalesce(installed_at, created_at) as at from locations where installation_id = ${ctx.installationId} and not ignored`;
  const events: ClientEvent[] = [];
  let current = 0;
  for (const r of rows) {
    if (!permits(r.location_id as string)) continue;
    current++;
    if (r.at instanceof Date) events.push({ locationId: r.location_id as string, name: (r.name as string | null) ?? "Client", kind: "added", at: r.at.getTime() });
  }
  let departuresReady = true;
  try {
    const gone = await sql()`select location_id, name, added_at, removed_at from client_departures where installation_id = ${ctx.installationId} order by removed_at desc limit 500`;
    for (const r of gone) {
      if (!permits(r.location_id as string)) continue;
      if (r.added_at instanceof Date) events.push({ locationId: r.location_id as string, name: (r.name as string | null) ?? "A client", kind: "added", at: r.added_at.getTime() });
      events.push({ locationId: r.location_id as string, name: (r.name as string | null) ?? "A client", kind: "removed", at: (r.removed_at as Date).getTime() });
    }
  } catch (e) { if (!isMissingTable(e)) throw e; departuresReady = false; }
  events.sort((a, b) => b.at - a.at);
  const firstSeen = events.reduce<number | null>((m, e) => (e.kind === "added" && (m === null || e.at < m) ? e.at : m), null);
  return json({ now: Date.now(), current, firstSeen, events: events.slice(0, 1500), departuresReady });
}
