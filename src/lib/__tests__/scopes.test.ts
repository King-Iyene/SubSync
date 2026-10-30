import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInstallUrl, GHL_SCOPES } from "../ghl/scopes.ts";

// The list of permissions an install asks for is pinned here on purpose: adding one makes every installed
// agency approve again, and asking for one the listing does not have makes the install fail. Changing the
// list means changing this test too, which makes the change a decision rather than an accident.
test("the permissions requested are exactly the agreed list, all read-only except one", () => {
  assert.deepEqual([...GHL_SCOPES].sort(), [
    "calendars.readonly", "calendars/events.readonly", "contacts.readonly", "conversations.readonly", "locations.readonly",
    "oauth.readonly", "oauth.write", "opportunities.readonly", "users.readonly",
  ]);
  assert.equal(new Set(GHL_SCOPES).size, GHL_SCOPES.length, "no duplicates");
  const writes = GHL_SCOPES.filter((s) => !s.endsWith(".readonly"));
  assert.deepEqual(writes, ["oauth.write"], "the only non-read permission is the one that mints a per-account token");
});

test("the install link carries every permission and the redirect address", () => {
  const url = new URL(buildInstallUrl("client-1", "https://subsync.example.com/api/oauth/callback"));
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.get("redirect_uri"), "https://subsync.example.com/api/oauth/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.deepEqual((url.searchParams.get("scope") ?? "").split(" ").sort(), [...GHL_SCOPES].sort());
});
