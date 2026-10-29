import { sql } from "../db";
import { generateKey, hashKey } from "./keys";

export type ApiKeyRow = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
export const MAX_KEYS = 5;

export async function listKeys(installationId: string): Promise<ApiKeyRow[]> {
  const rows = await sql()`
    select id, name, key_prefix, created_at, last_used_at from api_keys
    where installation_id = ${installationId} and revoked_at is null order by created_at desc`;
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.key_prefix, createdAt: iso(r.created_at) ?? "", lastUsedAt: iso(r.last_used_at) }));
}

// Creates a key and returns it exactly once; only its hash is stored.
export async function createKey(installationId: string, name: string): Promise<{ key: string; row: ApiKeyRow } | "limit"> {
  const db = sql();
  const [{ n }] = await db`select count(*)::int n from api_keys where installation_id = ${installationId} and revoked_at is null`;
  if (n >= MAX_KEYS) return "limit";
  const { key, prefix, hash } = generateKey();
  const [r] = await db`
    insert into api_keys (installation_id, name, key_prefix, key_hash) values (${installationId}, ${name}, ${prefix}, ${hash})
    returning id, name, key_prefix, created_at, last_used_at`;
  return { key, row: { id: r.id, name: r.name, prefix: r.key_prefix, createdAt: iso(r.created_at) ?? "", lastUsedAt: null } };
}

export async function revokeKey(installationId: string, id: string): Promise<boolean> {
  const rows = await sql()`
    update api_keys set revoked_at = now() where id = ${id} and installation_id = ${installationId} and revoked_at is null returning id`;
  return rows.length === 1;
}

export type KeyOwner = { keyId: string; installationId: string; isDemo: boolean; plan: string };

export async function resolveKey(key: string): Promise<KeyOwner | null> {
  const [r] = await sql()`
    select k.id, k.installation_id, i.is_demo, i.plan
    from api_keys k join installations i on i.id = k.installation_id
    where k.key_hash = ${hashKey(key)} and k.revoked_at is null and i.uninstalled_at is null`;
  if (!r) return null;
  await sql()`update api_keys set last_used_at = now() where id = ${r.id}`;
  return { keyId: r.id, installationId: r.installation_id, isDemo: r.is_demo, plan: r.plan };
}
