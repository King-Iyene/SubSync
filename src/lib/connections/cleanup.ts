import { sql } from "../db";
import type { Deps } from "../live-flags";
import { dropProviderSide as dropLegacy } from "./flow";
import { dropProviderSide, type SecretRow } from "./personal";
import { getConnection } from "./queries";

// Leaving cleanly (INTEGRATIONS_SPEC sections 2 and 9, roadmap E0 item 7). A person who is removed from the CRM, and an uninstall, must not leave
// access behind: the provider is told to stop FIRST (SubSync's Fathom subscription is deleted, a Zoom token is revoked), then the tokens and the
// stored meetings go. The provider calls go through the dry-run gate (FATHOM_WEBHOOK_LIVE): with it off they are recorded as "WOULD WRITE" lines and
// nothing is sent, but the rows and tokens are still erased here, so nothing of ours is left. Best effort: a provider that cannot be reached never
// stops the local deletion (the delivery address stops working at once because the row that knew it is gone, so it answers 404).

const secretOf = (r: Record<string, unknown>): SecretRow => ({
  id: r.id as string, installationId: r.installation_id as string, provider: r.provider as SecretRow["provider"], ghlUserId: (r.ghl_user_id as string | null) ?? "",
  webhookId: (r.webhook_id as string | null) ?? null, accessTokenEnc: (r.access_token_enc as string | null) ?? null, refreshTokenEnc: (r.refresh_token_enc as string | null) ?? null,
  tokenExpiresAt: r.token_expires_at instanceof Date ? r.token_expires_at.getTime() : null, homeLocationId: (r.home_location_id as string | null) ?? null, status: (r.status as string | null) ?? "connected",
});

const CAP = 500;
const BATCH = 5;

async function dropAll(rows: SecretRow[], f: typeof fetch, deps: Deps): Promise<{ attempted: number; dryRun: number; done: number; failed: number }> {
  const out = { attempted: rows.length, dryRun: 0, done: 0, failed: 0 };
  for (let i = 0; i < rows.length; i += BATCH) {
    const results = await Promise.allSettled(rows.slice(i, i + BATCH).map((r) => dropProviderSide(r, f, deps)));
    for (const r of results) {
      if (r.status === "rejected") out.failed++;
      else if (r.value === "dry_run") out.dryRun++;
      else if (r.value === "done") out.done++;
      else if (r.value === "failed") out.failed++;
    }
  }
  return out;
}

/** Uninstall: tell every provider to stop for every connection of this installation (personal ones and the older shared ones). Called BEFORE the rows are deleted. */
export async function revokeInstallationSubscriptions(installationId: string, f: typeof fetch = fetch, deps: Deps = {}) {
  const db = sql();
  const personal = await db`select id, installation_id, provider, ghl_user_id, webhook_id, access_token_enc, refresh_token_enc, token_expires_at, home_location_id, status from user_connections where installation_id = ${installationId} limit ${CAP}`;
  // The older shared Fathom and Zoom connections (made before connections became personal) have their provider subscription too.
  const legacy = await db`select id from connections where installation_id = ${installationId} and provider in ('fathom', 'zoom') limit ${CAP}`;
  const result = await dropAll(personal.map(secretOf), f, deps);
  for (const l of legacy) {
    const row = await getConnection(installationId, l.id as string).catch(() => null);
    if (!row) continue;
    result.attempted++;
    await dropLegacy(row, f, deps).then(() => undefined, () => { result.failed++; });
  }
  return result;
}

/** A person who is no longer in the CRM: their subscription is dropped and their connection, choices and stored meetings are deleted. The write log keeps ids and times only. */
export async function removePerson(installationId: string, userId: string, f: typeof fetch = fetch, deps: Deps = {}): Promise<{ removed: boolean }> {
  const db = sql();
  const rows = await db`select id, installation_id, provider, ghl_user_id, webhook_id, access_token_enc, refresh_token_enc, token_expires_at, home_location_id, status from user_connections where installation_id = ${installationId} and ghl_user_id = ${userId}`;
  await dropAll(rows.map(secretOf), f, deps);
  await db.begin(async (tx) => {
    await tx`delete from meetings where installation_id = ${installationId} and owner_ghl_user_id = ${userId}`;
    await tx`delete from meeting_note_settings where installation_id = ${installationId} and ghl_user_id = ${userId}`;
    await tx`delete from user_connections where installation_id = ${installationId} and ghl_user_id = ${userId}`;
    await tx`insert into audit_log (installation_id, actor, action, detail) values (${installationId}, null, 'connections.person_removed', ${tx.json({ reason: "no_longer_in_crm" } as never)})`;
  });
  return { removed: rows.length > 0 };
}

/**
 * Given the current list of people the CRM says exist (never an empty or failed read), removes everyone who has a connection here but is not on it.
 * It refuses to run on an empty list, so a failed or partial read can never wipe everyone out.
 */
export async function removeDeactivatedPeople(installationId: string, activeUserIds: string[], f: typeof fetch = fetch, deps: Deps = {}): Promise<{ removed: number; refused?: "empty_list" }> {
  if (activeUserIds.length === 0) return { removed: 0, refused: "empty_list" };
  const known = await sql()`select distinct ghl_user_id from user_connections where installation_id = ${installationId}`;
  const active = new Set(activeUserIds);
  let removed = 0;
  for (const r of known) {
    const id = r.ghl_user_id as string;
    if (active.has(id)) continue;
    if ((await removePerson(installationId, id, f, deps)).removed) removed++;
  }
  return { removed };
}

/** Removes meetings that waited past their time in a person's inbox (a meeting nobody could be matched to is kept only for the retention period). */
export async function expireInbox(now = Date.now()): Promise<number> {
  const rows = await sql()`delete from meetings where expires_at is not null and expires_at < ${new Date(now)} and status = 'needs_contact' returning id`;
  return rows.length;
}
