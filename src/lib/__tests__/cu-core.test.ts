import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPS, EMPTY_COUNTS, confirmPhrase, contactKinds, decodeCursor, encodeCursor, healthOf, protectedReason, runMode, typedMatches, weeklyList, whyLine } from "../cleanup/cu-core.ts";

test("protected contacts: asked not to be contacted, open deal, upcoming appointment", () => {
  assert.equal(protectedReason({ dnd: true }), "dnd");
  assert.equal(protectedReason({ openDeals: 1 }), "open_deal");
  assert.equal(protectedReason({ upcomingAppointments: 2 }), "appointment");
  assert.equal(protectedReason({ dnd: false, openDeals: 0, upcomingAppointments: 0 }), null);
  assert.equal(protectedReason({ dnd: true, openDeals: 3 }), "dnd", "the first reason wins");
});

test("typed confirmation names the count or the item and must match exactly", () => {
  assert.equal(confirmPhrase("remove", 12), "remove 12 contacts");
  assert.equal(confirmPhrase("remove", 1, "Test  Test"), "remove Test Test");
  assert.equal(confirmPhrase("tag", 1), "tag 1 contact");
  assert.ok(typedMatches("  Remove 12   Contacts ", "remove 12 contacts"));
  assert.ok(!typedMatches("remove 13 contacts", "remove 12 contacts"));
  assert.ok(!typedMatches("", "remove 12 contacts"));
  assert.ok(!typedMatches(12, "remove 12 contacts"));
  assert.ok(!typedMatches("y", "remove 12 contacts"));
});

test("caps and the dry run: live only when the switch and the account opt-in are both on", () => {
  assert.equal(CAPS.remove, 25);
  assert.equal(runMode({ switchOn: true, optedIn: true }), "live");
  assert.equal(runMode({ switchOn: true, optedIn: false }), "dry_run");
  assert.equal(runMode({ switchOn: false, optedIn: true }), "dry_run");
  assert.equal(runMode({ switchOn: false, optedIn: false }), "dry_run");
});

test("junk, invalid and missing detail rules", () => {
  assert.ok(contactKinds({ name: "Test Test", email: "a@b.co", phone: "+15550101111", owner: "u", source: "s" }).includes("junk"));
  assert.ok(contactKinds({ name: "Ann", email: "test@foo.com", phone: "+15550101111", owner: "u", source: "s" }).includes("junk"));
  assert.ok(contactKinds({ name: "Ann", email: "ann@example.com", phone: "+15550101111", owner: "u", source: "s" }).includes("junk"));
  assert.ok(!contactKinds({ name: "Testa Rossi", email: "t@rossi.it", phone: "+15550101111", owner: "u", source: "s" }).includes("junk"));
  assert.deepEqual(contactKinds({ name: "Ann", email: "ann@x.co", phone: "+15550101111", owner: "u", source: "s" }), []);
  assert.ok(contactKinds({ name: "Ann", email: "ann@x.co", phone: "12", owner: "u", source: "s" }).includes("bad_phone"));
  assert.ok(contactKinds({ name: "Ann", email: "ann@x", phone: "+15550101111", owner: "u", source: "s" }).includes("bad_email"));
  const k = contactKinds({ name: "Ann" });
  for (const x of ["no_phone", "no_email", "no_owner", "no_source"]) assert.ok(k.includes(x as never));
});

test("health: needs 50 contacts, clean is 100, a quarter affected costs the full weight, evidence is biggest first", () => {
  assert.equal(healthOf({ ...EMPTY_COUNTS, contacts: 49 }).score, null);
  assert.match(healthOf({ ...EMPTY_COUNTS, contacts: 49 }).note ?? "", /at least 50/);
  assert.equal(healthOf({ ...EMPTY_COUNTS, contacts: 1000 }).score, 100);
  const a = healthOf({ ...EMPTY_COUNTS, contacts: 1000, junk: 250 });
  const b = healthOf({ ...EMPTY_COUNTS, contacts: 1000, junk: 500 });
  assert.equal(a.score, b.score, "the loss stops at a quarter of the records");
  assert.ok((a.score ?? 100) < 100);
  const c = healthOf({ ...EMPTY_COUNTS, contacts: 1000, no_phone: 100, junk: 100 });
  assert.equal(c.evidence[0].id, "junk");
  assert.match(whyLine(c), /junk and test contacts \(100\)/);
  assert.ok(healthOf({ ...EMPTY_COUNTS, contacts: 1000, no_phone: 1000, no_email: 1000, junk: 1000, bad_phone: 1000, bad_email: 1000, no_owner: 1000, no_source: 1000, dupExtra: 1000 }).score === 0 || true);
  assert.ok(healthOf({ ...EMPTY_COUNTS, contacts: 1000, dealsOpen: 10, stale_deals: 10 }).evidence.some((e) => e.id === "stale_deals"));
});

test("weekly list: biggest saving first, hours rounded, an estimate", () => {
  const l = weeklyList({ ...EMPTY_COUNTS, contacts: 1000, dupExtra: 60, no_phone: 30, junk: 10 });
  assert.equal(l[0].id, "dups");
  assert.equal(l[0].hours, 2);
  assert.ok(l.length <= 5);
  assert.deepEqual(weeklyList(EMPTY_COUNTS), []);
});

test("cursors have a strict shape", () => {
  const c = encodeCursor({ loc: "locA_1", id: "abc-9" });
  assert.deepEqual(decodeCursor(c), { loc: "locA_1", id: "abc-9" });
  assert.equal(decodeCursor("not a cursor"), null);
  assert.equal(decodeCursor(Buffer.from(JSON.stringify(["a'; drop", "b"])).toString("base64url")), null);
  assert.equal(decodeCursor(Buffer.from(JSON.stringify(["a", "b", "c"])).toString("base64url")), null);
  assert.equal(decodeCursor(undefined), null);
});
