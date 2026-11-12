import { sql } from "../db";
import { settingsKey, toStored, type StoredRow } from "./account-rollup";
import type { AccountRow, AccountSettings } from "./derive";
import type { AccountHistory } from "./queries";

type KeyInput = AccountSettings & { dealRulesRevision?: number };

export async function readRollup(installationId: string): Promise<{ stored: StoredRow[]; locationCount: number } | null> {
  const r = await sql()`
    select r.location_id, r.settings_key, r.dirty, extract(epoch from r.computed_at) * 1000 computed_ms, r.row_json, r.history_json,
      (select count(*) from locations l where l.installation_id = ${installationId})::int n
    from account_rollup r where r.installation_id = ${installationId}`;
  if (r.length === 0) return null;
  return {
    locationCount: Number(r[0].n),
    stored: r.map((x) => {
      const j = x.row_json as { ord: number; r: AccountRow };
      return { locationId: x.location_id as string, ord: j.ord, key: x.settings_key as string, computedAt: Number(x.computed_ms), dirty: x.dirty as boolean, row: j.r, history: x.history_json as AccountHistory };
    }),
  };
}

export async function writeRollup(installationId: string, s: KeyInput, rows: AccountRow[], history: Map<string, AccountHistory>): Promise<void> {
  const db = sql();
  const key = settingsKey(s);
  if (rows.length === 0) return;
  const payload = toStored(rows, history, s, 0).map((x) => ({ location_id: x.locationId, row_json: { ord: x.ord, r: x.row }, history_json: x.history }));
  await db`
    insert into account_rollup (installation_id, location_id, settings_key, computed_at, dirty, row_json, history_json)
    select ${installationId}::uuid, p.location_id, ${key}, now(), false, p.row_json, p.history_json
    from jsonb_to_recordset(${db.json(payload as never)}::jsonb) as p(location_id text, row_json jsonb, history_json jsonb)
    on conflict (installation_id, location_id) do update set settings_key = excluded.settings_key, computed_at = excluded.computed_at, dirty = false,
      row_json = excluded.row_json, history_json = excluded.history_json`;
  // Rows of accounts that no longer exist are removed so the count check keeps working.
  await db`delete from account_rollup where installation_id = ${installationId} and location_id <> all(${rows.map((r) => r.locationId)}::text[])`;
}

/** A change was made through SubSync: the stored numbers may no longer be true, so the next read recomputes them. */
export async function markRollupDirty(installationId: string): Promise<void> {
  await Promise.all([
    sql()`update account_rollup set dirty = true where installation_id = ${installationId} and dirty = false`,
    sql()`update read_answers set dirty = true where installation_id = ${installationId} and dirty = false`,
  ]);
}

