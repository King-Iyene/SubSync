import { createHash, randomBytes } from "node:crypto";

// API keys for the AI connector. Format: sk_subsync_<43 url-safe chars>. Only the hash is stored.

export const KEY_PREFIX = "sk_subsync_";

export function generateKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 6), hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function looksLikeKey(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(KEY_PREFIX) && value.length >= KEY_PREFIX.length + 40 && value.length <= 120;
}
