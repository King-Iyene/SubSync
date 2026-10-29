import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret } from "../crypto.ts";

const KEY = Buffer.alloc(32, 7).toString("base64");

test("encrypt then decrypt returns the original secret", () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  const stored = encryptSecret("access-token-123");
  assert.notEqual(stored, "access-token-123");
  assert.ok(stored.startsWith("v1."));
  assert.equal(decryptSecret(stored), "access-token-123");
});

test("each encryption uses a fresh IV", () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  assert.notEqual(encryptSecret("same"), encryptSecret("same"));
});

test("tampered ciphertext is rejected", () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  const parts = encryptSecret("secret").split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptSecret(parts.join(".")));
});

test("a different key cannot decrypt", () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  const stored = encryptSecret("secret");
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  assert.throws(() => decryptSecret(stored));
});

test("a key that is not 32 bytes is refused", () => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
  assert.throws(() => encryptSecret("x"), /32 bytes/);
});

test("a missing key is refused", () => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
  assert.throws(() => encryptSecret("x"), /TOKEN_ENCRYPTION_KEY/);
});
