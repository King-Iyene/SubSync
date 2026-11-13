import { sql } from "../db";
import { forgetAnswers, forgetScope } from "../read-cache";

// The "data changed" signal, server side. Whenever rows change for an account (a sync read that found changes, or a real-time event), `markDataChanged` stamps sync_watermarks and drops
// the read caches held for that install, so the next read is built from the new rows. The version is the newest change time in the database (milliseconds), so every server instance
// agrees on it. The browser asks `sync/auto`, sees the version move and re-reads the open screen (src/app/app/data-changed.ts).
export async function markDataChanged(installationId: string, locationId: string, kind: string): Promise<void> {
  forgetScope(installationId); forgetAnswers(installationId);
  await sql()`
    insert into sync_watermarks (installation_id, location_id, kind, last_changed_at) values (${installationId}, ${locationId}, ${kind}, now())
    on conflict (installation_id, location_id, kind) do update set last_changed_at = now()`;
}

/** Newest change time (ms) over the accounts asked for (null = every account of the install); 0 when nothing was ever recorded. */
export async function readDataVersion(installationId: string, locationIds: string[] | null): Promise<number> {
  const [r] = await sql()`select max(last_changed_at) t from sync_watermarks where installation_id = ${installationId} and (${locationIds}::text[] is null or location_id = any(${locationIds}::text[]))`;
  return r?.t instanceof Date ? r.t.getTime() : 0;
}
