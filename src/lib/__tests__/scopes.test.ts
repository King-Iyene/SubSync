import assert from "node:assert/strict";
import { test } from "node:test";
import { buildInstallUrl, GHL_SCOPES } from "../ghl/scopes.ts";

// The list of permissions an install asks for is pinned here on purpose: adding one makes every installed
// agency approve again, and asking for one the listing does not have makes the install fail. Changing the
// list means changing this test too, which makes the change a decision rather than an accident.
test("the permissions requested are exactly the agreed list (the 80 saved in the portal draft: 7 required, 73 optional)", () => {
  const required = [
    "locations.readonly",
    "oauth.readonly",
    "oauth.write",
    "contacts.readonly",
    "opportunities.readonly",
    "conversations.readonly",
    "calendars.readonly",
  ];
  const optional = [
    "calendars/events.readonly",
    "calendars/events.write",
    "calendars/groups.readonly",
    "calendars/resources.readonly",
    "campaigns.readonly",
    "contacts.write",
    "conversations.write",
    "conversations/message.readonly",
    "conversations/message.write",
    "conversations/reports.readonly",
    "conversations/livechat.write",
    "locations/customFields.readonly",
    "emails/builder.readonly",
    "emails/schedule.readonly",
    "emails/templates.readonly",
    "emails/campaigns.readonly",
    "emails/stats.readonly",
    "files.readonly",
    "forms.readonly",
    "funnels/redirect.readonly",
    "funnels/page.readonly",
    "funnels/funnel.readonly",
    "funnels/pagecount.readonly",
    "invoices.readonly",
    "invoices.write",
    "invoices/schedule.readonly",
    "invoices/schedule.write",
    "invoices/template.readonly",
    "invoices/template.write",
    "invoices/estimate.readonly",
    "invoices/estimate.write",
    "lc-email.readonly",
    "links.readonly",
    "locations/customValues.readonly",
    "locations/customValues.write",
    "locations/tasks.readonly",
    "locations/tasks.write",
    "recurring-tasks.readonly",
    "recurring-tasks.write",
    "locations/tags.readonly",
    "locations/tags.write",
    "locations/templates.readonly",
    "locations.features.read",
    "charges.readonly",
    "marketplace-installer-details.readonly",
    "notes.readonly",
    "notes.write",
    "objects/schema.readonly",
    "objects/record.readonly",
    "opportunities.write",
    "payments/orders.readonly",
    "payments/integration.readonly",
    "payments/transactions.readonly",
    "payments/subscriptions.readonly",
    "payments/coupons.readonly",
    "payments/custom-provider.readonly",
    "phonenumbers.read",
    "numberpools.read",
    "pipelines.readonly",
    "pipelines.write",
    "pipelines.create",
    "products.readonly",
    "products/prices.readonly",
    "products/collection.readonly",
    "saas/location.read",
    "surveys.readonly",
    "users.readonly",
    "wallet.readonly",
    "workflows.readonly",
    "workflows.write",
    "workflows.delete",
    "workflows.publish",
    "workflows.logs",
  ];
  assert.deepEqual([...GHL_SCOPES].sort(), [...required, ...optional].sort());
  assert.equal(new Set(GHL_SCOPES).size, GHL_SCOPES.length, "no duplicates");
  assert.equal(GHL_SCOPES.length, 80);
  assert.equal(required.length, 7);
  assert.equal(optional.length, 73);
});

test("change access is limited to the agreed list, and nothing can manage people", () => {
  const writes = GHL_SCOPES.filter((s) => /.(write|publish|delete|create)$/.test(s)).sort();
  assert.deepEqual(writes, [
    "calendars/events.write", "contacts.write", "conversations.write", "conversations/livechat.write", "conversations/message.write",
    "invoices.write", "invoices/estimate.write", "invoices/schedule.write", "invoices/template.write",
    "locations/customValues.write", "locations/tags.write", "locations/tasks.write", "notes.write", "oauth.write", "opportunities.write",
    "pipelines.create", "pipelines.write", "recurring-tasks.write",
    "workflows.delete", "workflows.publish", "workflows.write",
  ].sort());
  assert.ok(!GHL_SCOPES.some((s) => /users.write/.test(s)), "no editing users");
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
