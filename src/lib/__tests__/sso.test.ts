import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSsoPayload, parseSsoUser } from "../ghl/sso.ts";

// Produced with CryptoJS.AES.encrypt(JSON.stringify(user), "test-shared-secret").toString(),
// the same call GHL uses, so this proves we decrypt what GHL actually sends.
const SECRET = "test-shared-secret";
const PAYLOAD =
  "U2FsdGVkX1/cI28qRWkCqM05xj91ZqafJJWQIVrfvfuRcFMr+lG014SBcyBivAFdvx2e/NrNqYV6fQ2dw6mOIxWsLtqLSQa2z6bXJMFsK/SimwsLcSF8NPfG9Oddd1/eVK+O6CJdKweLphfVCvTi8f/TP5curoEW1RKDfVWpJdg=";

test("decrypts a CryptoJS passphrase payload", () => {
  const data = decryptSsoPayload(PAYLOAD, SECRET) as Record<string, string>;
  assert.equal(data.companyId, "c1");
  assert.equal(data.userName, "Test User");
  assert.equal(data.type, "agency");
});

test("the wrong shared secret fails", () => {
  assert.throws(() => decryptSsoPayload(PAYLOAD, "wrong-secret"));
});

test("a payload that is not in the expected format is rejected", () => {
  assert.throws(() => decryptSsoPayload("bm90IGVuY3J5cHRlZA==", SECRET), /format/);
});

test("parseSsoUser keeps only the fields we use", () => {
  const user = parseSsoUser(decryptSsoPayload(PAYLOAD, SECRET));
  assert.deepEqual(user, {
    whitelabelDomain: null,
    userId: "u1",
    companyId: "c1",
    role: "admin",
    type: "agency",
    userName: "Test User",
    activeLocation: null,
  });
  assert.equal("email" in user, false);
});

test("parseSsoUser tolerates junk", () => {
  assert.equal(parseSsoUser(null).companyId, null);
  assert.equal(parseSsoUser("nope").userId, null);
});
