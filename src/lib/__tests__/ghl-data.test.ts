import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mapContact, mapConversation, mapLocationDetails, mapOpportunity, mapPipeline, toIso,
} from "../sync/ghl-data.ts";

test("toIso handles ms, seconds, numeric strings, ISO and junk", () => {
  assert.equal(toIso(1_700_000_000_000), "2023-11-14T22:13:20.000Z");
  assert.equal(toIso(1_700_000_000), "2023-11-14T22:13:20.000Z");
  assert.equal(toIso("1700000000000"), "2023-11-14T22:13:20.000Z");
  assert.equal(toIso("2026-10-29T10:00:00Z"), "2026-10-29T10:00:00.000Z");
  assert.equal(toIso("not a date"), null);
  assert.equal(toIso(null), null);
  assert.equal(toIso(""), null);
  assert.equal(toIso({}), null);
});

test("mapContact normalises fields and tolerates missing ones", () => {
  const c = mapContact({ id: "c1", firstName: " Ada ", lastName: "Lovelace", email: "ADA@Example.com", phone: "+1 555 010 2030", tags: ["vip", 3, ""], dateAdded: "2026-01-02T00:00:00Z", lastActivity: 1_700_000_000_000 });
  assert.equal(c?.email, "ada@example.com");
  assert.equal(c?.firstName, "Ada");
  assert.deepEqual(c?.tags, ["vip"]);
  assert.equal(c?.lastActivityAt, "2023-11-14T22:13:20.000Z");
  assert.equal(mapContact({ email: "x@y.com" }), null);
  assert.equal(mapContact(null), null);
});

test("mapContact splits a full name when first and last are missing", () => {
  const c = mapContact({ id: "c2", contactName: "Grace Brewster Hopper" });
  assert.deepEqual([c?.firstName, c?.lastName], ["Grace", "Brewster Hopper"]);
  assert.deepEqual(mapContact({ id: "c3" })?.tags, []);
});

test("mapOpportunity reads value, stage and activity dates", () => {
  const o = mapOpportunity({
    id: "o1", name: "Deal", pipelineId: "p1", pipelineStageId: "s1", monetaryValue: "1500.5", status: "OPEN",
    lastStageChangeAt: "2026-10-01T00:00:00Z", lastActionDate: "2026-10-05T00:00:00Z", contact: { id: "c9", name: "Jo" },
  });
  assert.equal(o?.monetaryValue, 1500.5);
  assert.equal(o?.status, "open");
  assert.equal(o?.stageId, "s1");
  assert.equal(o?.contactId, "c9");
  assert.equal(o?.lastActionAt, "2026-10-05T00:00:00.000Z");
  assert.equal(mapOpportunity({ id: "o2", monetaryValue: "abc" })?.monetaryValue, 0);
  assert.equal(mapOpportunity({ name: "no id" }), null);
});

test("mapConversation keeps direction and unread, drops bad values", () => {
  const c = mapConversation({ id: "v1", contactId: "c1", fullName: "Jo", lastMessageDirection: "INBOUND", lastMessageDate: 1_700_000_000_000, unreadCount: 3, lastMessageType: "TYPE_SMS" });
  assert.equal(c?.lastMessageDirection, "inbound");
  assert.equal(c?.unreadCount, 3);
  assert.equal(mapConversation({ id: "v2", lastMessageDirection: "sideways", unreadCount: -2 })?.lastMessageDirection, null);
  assert.equal(mapConversation({ id: "v2", unreadCount: -2 })?.unreadCount, 0);
  assert.equal(mapConversation({}), null);
});

test("mapPipeline keeps stage ids and names", () => {
  const p = mapPipeline({ id: "p1", name: "Sales", stages: [{ id: "s1", name: "New" }, { id: "s2" }, { name: "bad" }] });
  assert.deepEqual(p?.stages, [{ id: "s1", name: "New" }, { id: "s2", name: "Stage" }]);
});

test("mapLocationDetails reads the nested location and builds an address", () => {
  const d = mapLocationDetails({ location: { name: "Acme", email: "Hi@Acme.com", website: "https://acme.com", city: "Austin", state: "TX", country: "US" } });
  assert.equal(d.email, "hi@acme.com");
  assert.equal(d.address, "Austin, TX, US");
  assert.equal(mapLocationDetails({}).name, null);
});
