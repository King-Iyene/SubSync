import assert from "node:assert/strict";
import { test } from "node:test";
import { redirectUri } from "../ghl/client.ts";

test("the redirect address comes from the site address, and an explicit one wins", () => {
  const saved = { a: process.env.NEXT_PUBLIC_APP_URL, r: process.env.GHL_REDIRECT_URI };
  try {
    delete process.env.GHL_REDIRECT_URI;
    process.env.NEXT_PUBLIC_APP_URL = "https://example.test/";
    assert.equal(redirectUri(), "https://example.test/api/oauth/callback");
    process.env.GHL_REDIRECT_URI = "https://other.test/cb";
    assert.equal(redirectUri(), "https://other.test/cb");
    delete process.env.GHL_REDIRECT_URI;
    delete process.env.NEXT_PUBLIC_APP_URL;
    assert.throws(() => redirectUri());
  } finally {
    for (const [k, v] of [["NEXT_PUBLIC_APP_URL", saved.a], ["GHL_REDIRECT_URI", saved.r]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
