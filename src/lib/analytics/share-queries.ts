import { sql } from "../db";
import type { SharePayload } from "./share-intel";

// The two database reads of a shared audit link, in one place so a test can hold them to the rules: a link opens only while it has not expired and has not been
// switched off, an id that does not match exactly opens nothing, and only the installation that made a link can switch it off. The id is the only thing a visitor holds.

export const SHARE_ID = /^[A-Za-z0-9_-]{20,64}$/;

/** The snapshot behind an id, or null when the id is malformed, unknown, expired or switched off. Counts the view. */
export async function findShared(id: string): Promise<{ payload: SharePayload; expiresAt: Date } | null> {
  if (!SHARE_ID.test(id)) return null;
  const [row] = await sql()`select payload, expires_at from shared_audits where id = ${id} and expires_at > now() and revoked_at is null`;
  if (!row) return null;
  await sql()`update shared_audits set views = views + 1, last_viewed_at = now() where id = ${id} and expires_at > now() and revoked_at is null`.catch(() => undefined);
  return { payload: row.payload as SharePayload, expiresAt: row.expires_at as Date };
}

/** Switches a link off. Only the installation that made it can: the id alone is not enough. Returns whether a link was switched off. */
export async function revokeShared(installationId: string, id: string): Promise<boolean> {
  if (!SHARE_ID.test(id)) return false;
  const done = await sql()`update shared_audits set revoked_at = now() where id = ${id} and installation_id = ${installationId} and revoked_at is null returning id`;
  return done.length > 0;
}
