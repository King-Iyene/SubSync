import { sql } from "../db";
import { resolveTags, validateTag, duplicateTags, isQueueKey, QUEUES, type QueueKey, type QueueTags } from "./tags";
import type { CheckResult } from "./check";

// The database side of call queue tags. Every function takes the installation id (from the verified session) AND the account id, and every query filters by both, so one company
// can never read or write another's tags. The caller has already passed the account id through ownedLocation. Until the migration has run, the defaults apply and nothing is written.
const missingTable = (e: unknown) => ["42P01", "42703"].includes((e as { code?: string })?.code ?? "");

export async function ownTags(installationId: string, locationId: string): Promise<Partial<Record<QueueKey, string>>> {
  try {
    const rows = await sql()`select queue_key, tag from account_queue_tags where installation_id = ${installationId} and location_id = ${locationId}`;
    const out: Partial<Record<QueueKey, string>> = {};
    for (const r of rows) if (isQueueKey(r.queue_key)) out[r.queue_key] = r.tag as string;
    return out;
  } catch (e) { if (missingTable(e)) return {}; throw e; }
}

/** The tag each queue uses in this account: its own choice, else (call now only) the tag saved earlier in the call queue settings, else the default. */
export async function getQueueTags(installationId: string, locationId: string): Promise<QueueTags> {
  const own = await ownTags(installationId, locationId);
  let legacy: string | null = null;
  if (!own.call_now) {
    try { const [r] = await sql()`select tag from call_queue_settings where installation_id = ${installationId} and location_id = ${locationId}`; legacy = (r?.tag as string | undefined) ?? null; } catch { legacy = null; }
  }
  return resolveTags(own, legacy);
}

export type SaveResult = { ok: true; tags: QueueTags } | { ok: false; message: string; errors?: Partial<Record<QueueKey, string>> };

/** Saves the tags that were sent. A tag equal to its default removes the account's own row (so "reset" and "type the default" are the same thing). */
export async function saveQueueTags(installationId: string, locationId: string, wanted: Partial<Record<QueueKey, unknown>>, actor: string | null): Promise<SaveResult> {
  const errors: Partial<Record<QueueKey, string>> = {};
  const clean: Partial<Record<QueueKey, string>> = {};
  for (const [k, v] of Object.entries(wanted)) {
    if (!isQueueKey(k)) continue;
    const r = validateTag(v);
    if (r.ok) clean[k] = r.tag; else errors[k] = r.message;
  }
  if (Object.keys(errors).length) return { ok: false, message: "Check the tag names marked below.", errors };
  if (!Object.keys(clean).length) return { ok: false, message: "Nothing to save." };
  const current = await getQueueTags(installationId, locationId);
  const next = { ...current, ...clean } as QueueTags;
  const clash = duplicateTags(next);
  if (clash.length) return { ok: false, message: "Two queues cannot use the same tag. Give each queue its own name.", errors: Object.fromEntries(clash.map((k) => [k, "Already used by another queue."])) };
  const db = sql();
  try {
    for (const q of QUEUES) {
      const t = clean[q.key];
      if (t === undefined) continue;
      if (t.toLowerCase() === q.defaultTag.toLowerCase()) {
        await db`delete from account_queue_tags where installation_id = ${installationId} and location_id = ${locationId} and queue_key = ${q.key}`;
      } else {
        await db`insert into account_queue_tags (installation_id, location_id, queue_key, tag, updated_by, updated_at) values (${installationId}, ${locationId}, ${q.key}, ${t}, ${actor}, now())
          on conflict (installation_id, location_id, queue_key) do update set tag = excluded.tag, updated_by = excluded.updated_by, updated_at = now()`;
      }
    }
    // A changed tag means the earlier check no longer says anything about this account.
    await db`delete from call_queue_checks where installation_id = ${installationId} and location_id = ${locationId}`;
  } catch (e) {
    if (missingTable(e)) return { ok: false, message: "Saving this needs the latest database update, which has not run yet." };
    throw e;
  }
  return { ok: true, tags: await getQueueTags(installationId, locationId) };
}

export async function saveCheck(installationId: string, locationId: string, r: Pick<CheckResult, "state" | "lines">): Promise<void> {
  if (r.state === "unchecked") return;
  try {
    await sql()`insert into call_queue_checks (installation_id, location_id, state, lines, checked_at) values (${installationId}, ${locationId}, ${r.state}, ${JSON.stringify(r.lines)}::jsonb, now())
      on conflict (installation_id, location_id) do update set state = excluded.state, lines = excluded.lines, checked_at = now()`;
  } catch (e) { if (!missingTable(e)) throw e; }
}

/** The cached answers for the accounts given (never a CRM call). An account with no row has not been checked. */
export async function cachedChecks(installationId: string, locationIds: readonly string[] | null): Promise<{ locationId: string; state: CheckResult["state"]; checkedAt: string }[]> {
  try {
    const db = sql();
    const rows = await db`select location_id, state, checked_at from call_queue_checks where installation_id = ${installationId} ${locationIds ? db`and location_id = any(${locationIds as string[]}::text[])` : db``} limit 500`;
    return rows.map((r) => ({ locationId: r.location_id as string, state: r.state as CheckResult["state"], checkedAt: new Date(r.checked_at as string).toISOString() }));
  } catch (e) { if (missingTable(e)) return []; throw e; }
}

export async function companySnapshotOn(installationId: string): Promise<boolean> {
  try { const [r] = await sql()`select snapshot_on from cq_company_switch where installation_id = ${installationId}`; return r?.snapshot_on === true; } catch { return false; }
}
export async function setCompanySnapshot(installationId: string, on: boolean): Promise<boolean> {
  try {
    await sql()`insert into cq_company_switch (installation_id, snapshot_on, updated_at) values (${installationId}, ${on}, now()) on conflict (installation_id) do update set snapshot_on = excluded.snapshot_on, updated_at = now()`;
    return true;
  } catch (e) { if (missingTable(e)) return false; throw e; }
}
