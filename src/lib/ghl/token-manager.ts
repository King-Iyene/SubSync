// Keeps an agency's access token fresh without breaking the refresh-token chain.
//
// GHL rotates the refresh token on every refresh and the old one stops working, so two
// workers refreshing at once would break the chain. The store swaps tokens with a
// compare-and-swap on the stored refresh token: only one worker's write wins, and a worker
// whose refresh fails or loses the race re-reads the row and uses the winner's tokens.
// Pure logic, no database or network imports, so it can be unit tested.

export type StoredTokens = {
  id: string;
  accessToken: string;
  refreshToken: string;
  /** The stored (encrypted) refresh token value, used as the compare-and-swap key. */
  refreshTokenKey: string;
  expiresAt: Date;
};

export type NewTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
};

export interface TokenStore {
  load(companyId: string): Promise<StoredTokens | null>;
  /** Write new tokens only if the stored refresh token still equals `expectedKey`. */
  swap(id: string, expectedKey: string, next: NewTokens): Promise<boolean>;
}

export type RefreshFn = (refreshToken: string) => Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}>;

export class NotInstalledError extends Error {
  constructor() {
    super("No installation found for this company");
  }
}

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export async function getFreshAccessToken(
  store: TokenStore,
  refresh: RefreshFn,
  companyId: string,
  now: () => number = Date.now,
): Promise<string> {
  const current = await store.load(companyId);
  if (!current) throw new NotInstalledError();
  if (current.expiresAt.getTime() - now() > REFRESH_SKEW_MS) return current.accessToken;

  // Someone else may have refreshed already; prefer their tokens over spending ours.
  const rotatedByOther = async () => {
    const latest = await store.load(companyId);
    return latest && latest.refreshTokenKey !== current.refreshTokenKey ? latest : null;
  };

  let response;
  try {
    response = await refresh(current.refreshToken);
  } catch (error) {
    const other = await rotatedByOther();
    if (other) return other.accessToken;
    throw error;
  }

  const next: NewTokens = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: new Date(now() + response.expires_in * 1000),
  };
  if (await store.swap(current.id, current.refreshTokenKey, next)) return next.accessToken;

  const other = await rotatedByOther();
  if (other) return other.accessToken;
  throw new Error("Token refresh conflict");
}
