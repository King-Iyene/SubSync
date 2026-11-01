import type { Tokens } from "./oauth.ts";

// One token refresh at a time per connection (INTEGRATIONS_SPEC 11.1 item 6). Fathom's and Zoom's refresh tokens are single use: if two requests
// refresh at once, the second one spends an already-spent token and the connection looks broken. So the refresh runs while holding an exclusive
// lock on that connection's row (in Postgres, `select ... for update` inside a transaction). A caller that waited re-reads the row after the lock
// is free and, finding fresh tokens already saved by the first, uses them instead of refreshing again.
// The lock and the storage are passed in (`LockedRow`), so the logic is tested without a database and the real one is tested against the live one.

export type Stored = { accessToken: string; refreshToken: string; expiresAt: number };

/** The row while the lock is held. `read` is always fresh: it is read AFTER the lock was granted. */
export type LockedRow = {
  read: () => Promise<Stored | null>;
  save: (next: Tokens) => Promise<void>;
  markNeedsReconnect: (code: string) => Promise<void>;
};

export type RefreshStore = { withLock: <T>(id: string, fn: (row: LockedRow) => Promise<T>) => Promise<T> };

export type Refreshed = { ok: true; accessToken: string; refreshed: boolean } | { ok: false; reason: "no_tokens" | "refused" };

export const FRESH_MS = 60_000;

/**
 * A usable access token for the connection. Refreshes only when the stored one is about to expire, and only once however many callers ask at
 * the same moment. `refresh` calls the provider with the refresh token. A refusal marks the connection "needs reconnect" instead of retrying forever.
 */
export async function refreshLocked(
  store: RefreshStore, id: string, refresh: (refreshToken: string) => Promise<{ ok: true; tokens: Tokens } | { ok: false }>, now: () => number = Date.now,
): Promise<Refreshed> {
  return store.withLock(id, async (row) => {
    const current = await row.read();
    if (!current) return { ok: false, reason: "no_tokens" } as const;
    if (current.expiresAt - now() > FRESH_MS) return { ok: true, accessToken: current.accessToken, refreshed: false } as const;
    const result = await refresh(current.refreshToken);
    if (!result.ok) {
      await row.markNeedsReconnect("P-AUTH");
      return { ok: false, reason: "refused" } as const;
    }
    await row.save(result.tokens);
    return { ok: true, accessToken: result.tokens.accessToken, refreshed: true } as const;
  });
}
