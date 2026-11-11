import assert from "node:assert/strict";
import test from "node:test";
import { contactReason, contactSeed } from "../../app/app/views/ap3/contact.ts";
import type { ApRow } from "../../app/app/views/ap3/types.ts";

const row: ApRow = { id: "a1", locationId: "L1", accountName: "Acme", contactId: "c1", contactName: "Sam Lee", startAt: "2026-11-01T10:00:00Z", calendarName: "Sales", status: "booked", ownerId: null, ownerName: null, bookerId: null, bookerName: null, source: null, dealValueCents: null, dealStatus: "none", hoursPast: null, flags: [], phone: "+15550100" };

test("the contact panel opens with the ids from the row and starts on the conversation", () => {
  const s = contactSeed(row);
  assert.ok(s);
  assert.equal(s.contactId, "c1");
  assert.equal(s.locationId, "L1");
  assert.equal(s.tab, "conversation");
  assert.equal(s.unassigned, true);
  assert.equal(s.dnd, false);
  assert.equal(contactReason(row), null);
});

test("no contact on file: no panel, and a plain reason", () => {
  assert.equal(contactSeed({ ...row, contactId: "" }), null);
  assert.match(contactReason({ ...row, contactId: "" }) ?? "", /No contact is linked/);
});

test("do not disturb is carried to the panel and explained in one line", () => {
  assert.equal(contactSeed({ ...row, dnd: true })?.dnd, true);
  assert.match(contactReason({ ...row, dnd: true }) ?? "", /Asked not to be contacted/);
});
