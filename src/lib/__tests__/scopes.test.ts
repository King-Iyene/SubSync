import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInstallUrl, GHL_SCOPES } from "../ghl/scopes.ts";

// The list of permissions an install asks for is pinned here on purpose: adding one makes every installed
// agency approve again, and asking for one the listing does not have makes the install fail. Changing the
// list means changing this test too, which makes the change a decision rather than an accident.
test("the permissions requested are exactly the agreed list", () => {
  assert.deepEqual([...GHL_SCOPES].sort(), [
    "calendars.readonly", "calendars/events.readonly", "calendars/events.write", "calendars/groups.readonly", "calendars/resources.readonly", "conversations/message.write",
    "contacts.readonly", "contacts.write", "conversations.readonly", "conversations/message.readonly",
    "locations.readonly", "locations/customFields.readonly", "locations/tags.readonly",
    "oauth.readonly", "oauth.write", "opportunities.readonly", "opportunities.write", "users.readonly",
    "workflows.readonly", "workflows.logs", "workflows.write", "workflows.publish", "workflows.delete", "campaigns.readonly", "emails/campaigns.readonly", "emails/stats.readonly", "saas/location.read",
    "payments/transactions.readonly", "payments/subscriptions.readonly", "invoices.readonly", "wallet.readonly", "marketplace-installer-details.readonly",
    "forms.readonly", "surveys.readonly", "funnels/funnel.readonly",
  ].sort());
  assert.equal(new Set(GHL_SCOPES).size, GHL_SCOPES.length, "no duplicates");
  assert.equal(GHL_SCOPES.length, 35);
});

test("change access is limited to the agreed few, and nothing can send a message or manage people", () => {
  const writes = GHL_SCOPES.filter((s) => !s.endsWith(".readonly")).sort();
  assert.deepEqual(writes.filter((w) => !w.startsWith("saas/")), ["calendars/events.write", "contacts.write", "conversations/message.write", "oauth.write", "opportunities.write", "workflows.delete", "workflows.logs", "workflows.publish", "workflows.write"]);
  assert.ok(!GHL_SCOPES.some((s) => /users\.write|conversations\.write|invoices\.write/.test(s)), "no deleting conversations, no invoices, no editing users");
});

test("the install link carries every permission and the redirect address", () => {
  const url = new URL(buildInstallUrl("client-1", "https://subsync.example.com/api/oauth/callback"));
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.get("redirect_uri"), "https://subsync.example.com/api/oauth/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.deepEqual((url.searchParams.get("scope") ?? "").split(" ").sort(), [...GHL_SCOPES].sort());
});

test("the install link uses the branded host by default and the standard host only when asked", () => {
  assert.equal(new URL(buildInstallUrl("c", "https://x.test/cb")).hostname, "marketplace.leadconnectorhq.com");
  assert.equal(new URL(buildInstallUrl("c", "https://x.test/cb")).pathname, "/oauth/chooselocation");
  assert.equal(new URL(buildInstallUrl("c", "https://x.test/cb", "marketplace.gohighlevel.com")).hostname, "marketplace.gohighlevel.com");
});
