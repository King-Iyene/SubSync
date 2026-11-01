import assert from "node:assert/strict";
import { test } from "node:test";
import { actionFor, canonicalType } from "../ghl/webhook.ts";

// The event types the live webhook log really recorded (INSTALL, UNINSTALL, UPDATE, ContactCreate, ContactUpdate) and the documented ones.
test("the install and uninstall events are understood under the names the platform really sends", () => {
  assert.equal(canonicalType("INSTALL"), "AppInstall");
  assert.equal(canonicalType("UNINSTALL"), "AppUninstall");
  assert.equal(canonicalType("AppInstall"), "AppInstall");
  assert.equal(canonicalType("ContactCreate"), "ContactCreate");
  assert.equal(canonicalType(null), null);
  assert.deepEqual(actionFor(canonicalType("INSTALL")), { kind: "install" });
  assert.deepEqual(actionFor(canonicalType("UNINSTALL")), { kind: "uninstall" });
  assert.deepEqual(actionFor("UPDATE"), { kind: "ignore" }, "an app version update changes nothing in the cache");
});

test("every event that changes data we copy queues a refresh of the right area", () => {
  const scope = (t: string) => { const a = actionFor(t); return a.kind === "resync" ? a.scope : a.kind; };
  for (const t of ["ContactCreate", "ContactUpdate", "ContactDelete", "ContactTagUpdate", "ContactDndUpdate"]) assert.equal(scope(t), "contacts", t);
  for (const t of ["OpportunityCreate", "OpportunityUpdate", "OpportunityDelete", "OpportunityStageUpdate", "OpportunityStatusUpdate", "OpportunityAssignedToUpdate", "OpportunityMonetaryValueUpdate"]) assert.equal(scope(t), "opportunities", t);
  for (const t of ["InboundMessage", "OutboundMessage", "ConversationUnreadWebhook", "ConversationUpdate"]) assert.equal(scope(t), "conversations", t);
  for (const t of ["AppointmentCreate", "AppointmentUpdate", "AppointmentDelete"]) assert.equal(scope(t), "appointments", t);
  assert.equal(scope("LocationUpdate"), "structure");
  assert.equal(scope("SomethingElse"), "ignore");
});
