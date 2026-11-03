import { createHash, timingSafeEqual } from "node:crypto";

// Constant-time check of an "Authorization: Bearer <secret>" header against the server secret (cron and admin routes).
// Both sides are hashed first so the comparison always sees equal lengths and the length of the secret does not leak.
export function bearerMatches(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
