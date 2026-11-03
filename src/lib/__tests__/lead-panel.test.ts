import assert from "node:assert/strict";
import test from "node:test";
import { diffTagEvents } from "../sync/tag-events.ts";
import { nextActions, NOT_AVAILABLE, sortTags, tagDateLabel } from "../people/lead-panel.ts";

test("a recorded tag shows its date", () => {
  assert.deepEqual(tagDateLabel({ addedAt: "2026-11-03T10:00:00Z", firstSeenAt: "2026-10-01T00:00:00Z" }), { known: true, text: "Added 3 Nov 2026" });
});
test("an unknown tag date says so and names the day SubSync first saw the lead", () => {
  const r = tagDateLabel({ addedAt: null, firstSeenAt: "2026-10-01T09:00:00Z" });
  assert.equal(r.known, false);
  assert.equal(r.text, "Before SubSync started watching (first seen 1 Oct 2026)");
  assert.equal(tagDateLabel({ addedAt: null, firstSeenAt: null }).text, "Before SubSync started watching");
});
test("tags sort newest first and undated last", () => {
  const s = sortTags([{ t: "a", addedAt: null }, { t: "b", addedAt: "2026-11-01T00:00:00Z" }, { t: "c", addedAt: "2026-11-02T00:00:00Z" }]);
  assert.deepEqual(s.map((x) => x.t), ["c", "b", "a"]);
});
test("the first read of an account records nothing, later reads record every contact's change", () => {
  const incoming = [{ contactId: "1", tags: ["vip"] }, { contactId: "2", tags: ["web", "vip"] }];
  assert.deepEqual(diffTagEvents(incoming, new Map(), false), []);
  const known = new Map<string, string[]>([["1", ["vip"]], ["2", ["web"]]]);
  assert.deepEqual(diffTagEvents(incoming, known, true), [{ contactId: "2", tag: "vip", kind: "added" }]);
});
test("next actions: do-not-contact wins, at most two, plain words", () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  assert.deepEqual(nextActions({ unread: 3, owner: null, dnd: true, appointments: [] }), ["This person asked not to be contacted. Do not call or message."]);
  const a = nextActions({ unread: 2, owner: null, dnd: false, appointments: [{ at: past, status: null }] });
  assert.equal(a.length, 2);
  assert.match(a[0], /^Reply\./);
  assert.match(a[1], /Mark what happened/);
  assert.deepEqual(nextActions({ unread: 0, owner: "Sam", dnd: false, appointments: [{ at: past, status: "showed" }] }), []);
  assert.deepEqual(nextActions({ unread: 0, owner: null, unassigned: true, dnd: false, appointments: [] }), ["Give this lead an owner."]);
  for (const s of a) assert.doesNotMatch(s, /[–—]/);
});
test("what the CRM does not give is listed by name", () => {
  assert.deepEqual(NOT_AVAILABLE.map((n) => n.id), ["notes", "tasks", "message_text"]);
});
