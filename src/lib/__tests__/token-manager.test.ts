import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getFreshAccessToken,
  NotInstalledError,
  type NewTokens,
  type StoredTokens,
  type TokenStore,
} from "../ghl/token-manager.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const HOUR = 3_600_000;

function stored(overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    id: "inst-1",
    accessToken: "access-old",
    refreshToken: "refresh-old",
    refreshTokenKey: "key-old",
    expiresAt: new Date(NOW + HOUR),
    ...overrides,
  };
}

function fakeStore(initial: StoredTokens | null) {
  let row = initial;
  const calls = { loads: 0, swaps: 0 };
  const store: TokenStore = {
    async load() {
      calls.loads++;
      return row;
    },
    async swap(_id: string, expectedKey: string, next: NewTokens) {
      calls.swaps++;
      if (!row || row.refreshTokenKey !== expectedKey) return false;
      row = {
        ...row,
        accessToken: next.accessToken,
        refreshToken: next.refreshToken,
        refreshTokenKey: `key-${next.refreshToken}`,
        expiresAt: next.expiresAt,
      };
      return true;
    },
  };
  return { store, calls, setRow: (r: StoredTokens | null) => (row = r), getRow: () => row };
}

const refreshOk = async (refreshToken: string) => ({
  access_token: `access-from-${refreshToken}`,
  refresh_token: `refresh-from-${refreshToken}`,
  expires_in: 86_400,
});

test("returns the stored token without refreshing while it is still fresh", async () => {
  const { store } = fakeStore(stored());
  let refreshed = 0;
  const token = await getFreshAccessToken(
    store,
    async (t) => {
      refreshed++;
      return refreshOk(t);
    },
    "co",
    () => NOW,
  );
  assert.equal(token, "access-old");
  assert.equal(refreshed, 0);
});

test("refreshes an expiring token and saves the rotated refresh token", async () => {
  const { store, getRow } = fakeStore(stored({ expiresAt: new Date(NOW + 60_000) }));
  const token = await getFreshAccessToken(store, refreshOk, "co", () => NOW);
  assert.equal(token, "access-from-refresh-old");
  assert.equal(getRow()?.refreshToken, "refresh-from-refresh-old");
  assert.equal(getRow()?.expiresAt.getTime(), NOW + 86_400_000);
});

test("refreshes a token that is already expired", async () => {
  const { store } = fakeStore(stored({ expiresAt: new Date(NOW - HOUR) }));
  assert.equal(await getFreshAccessToken(store, refreshOk, "co", () => NOW), "access-from-refresh-old");
});

test("uses the other worker's tokens when the swap loses the race", async () => {
  const { store, setRow } = fakeStore(stored({ expiresAt: new Date(NOW - 1) }));
  const token = await getFreshAccessToken(
    store,
    async (t) => {
      // Another worker rotates the tokens while ours is in flight.
      setRow(stored({ accessToken: "access-winner", refreshToken: "refresh-winner", refreshTokenKey: "key-winner" }));
      return refreshOk(t);
    },
    "co",
    () => NOW,
  );
  assert.equal(token, "access-winner");
});

test("a failed refresh falls back to tokens another worker already rotated", async () => {
  const { store, setRow } = fakeStore(stored({ expiresAt: new Date(NOW - 1) }));
  const token = await getFreshAccessToken(
    store,
    async () => {
      setRow(stored({ accessToken: "access-winner", refreshTokenKey: "key-winner" }));
      throw new Error("refresh token already used");
    },
    "co",
    () => NOW,
  );
  assert.equal(token, "access-winner");
});

test("a failed refresh with no other writer surfaces the error", async () => {
  const { store } = fakeStore(stored({ expiresAt: new Date(NOW - 1) }));
  await assert.rejects(
    getFreshAccessToken(
      store,
      async () => {
        throw new Error("invalid_grant");
      },
      "co",
      () => NOW,
    ),
    /invalid_grant/,
  );
});

test("an agency with no installation is reported as not installed", async () => {
  const { store } = fakeStore(null);
  await assert.rejects(getFreshAccessToken(store, refreshOk, "co", () => NOW), NotInstalledError);
});
