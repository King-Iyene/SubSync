import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDeleteOwn, buildNote, buildTags, buildTask, writeToCrm } from "../ghl/crm-writes.ts";
import { candidateIds } from "../connections/echo.ts";
import { cleanTag, capReached, idemKey, isOurNote, isOurTag, noteBody, outcomeNoteBody, saveMessage, tagFor, tagPrefix, CAP_PER_HOUR, MARKER } from "../people/writeback.ts";

const NOW = Date.parse("2026-11-05T10:00:30Z");

test("idempotency: same contact + outcome in the same minute is one key; another minute, outcome or contact is another", () => {
  const k = (o: Partial<Parameters<typeof idemKey>[0]> = {}) => idemKey({ contactId: "c1", kind: "outcome", outcome: "voicemail", now: NOW, ...o });
  assert.equal(k(), k({ now: NOW + 10_000 }));
  assert.notEqual(k(), k({ now: NOW + 60_000 }));
  assert.notEqual(k(), k({ outcome: "answered" }));
  assert.notEqual(k(), k({ contactId: "c2" }));
  assert.equal(idemKey({ contactId: "c1", kind: "note", text: " hi ", now: NOW }), idemKey({ contactId: "c1", kind: "note", text: "hi", now: NOW }));
});

test("cap: 200 per company per hour", () => {
  assert.equal(capReached(CAP_PER_HOUR - 1), false);
  assert.equal(capReached(CAP_PER_HOUR), true);
});

test("marker: every note and tag we write is recognizable, a customer's note is not", () => {
  const n = noteBody("Called, call back Friday", { who: "Ada", now: new Date(NOW) });
  assert.ok(n.startsWith(MARKER) && isOurNote(n));
  const o = outcomeNoteBody("voicemail", { who: "Ada", now: new Date(NOW) });
  assert.equal(o, "[SubSync] Call outcome: Voicemail, logged in SubSync by Ada, 5 Nov 2026");
  assert.equal(isOurNote("Spoke to Ada about the quote"), false);
  assert.equal(tagFor("not_interested"), "subsync-call-not-interested");
  assert.ok(isOurTag("subsync-call-voicemail") && !isOurTag("hot lead"));
  assert.equal(tagPrefix({ SUBSYNC_TAG_PREFIX: "ss-" }), "ss-");
  assert.equal(tagPrefix({ SUBSYNC_TAG_PREFIX: "BAD PREFIX!" }), "subsync-call-");
});

test("requests: note, tag, task and undo use the contact endpoints with the contacts.write permission", () => {
  assert.equal(buildNote({ contactId: "c1", body: "x" }).path, "/contacts/c1/notes");
  const t = buildTags({ contactId: "c1", tags: ["a"] });
  assert.deepEqual([t.method, t.path, t.scope], ["POST", "/contacts/c1/tags", "contacts.write"]);
  assert.equal(buildTags({ contactId: "c1", tags: ["a"], remove: true }).method, "DELETE");
  const k = buildTask({ contactId: "c1", title: "T", dueDate: new Date(NOW) });
  assert.deepEqual([k.path, k.body.completed], ["/contacts/c1/tasks", false]);
  assert.equal(buildDeleteOwn({ contactId: "c1", kind: "notes", id: "n9" }).path, "/contacts/c1/notes/n9");
});

test("switch off: nothing is sent, a dry run is recorded with ids only; on: the call is sent and the id comes back", async () => {
  const rows: Array<Record<string, unknown>> = [];
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response(JSON.stringify({ note: { id: "note123456" } }), { status: 201 }); }) as typeof fetch;
  const args = { installationId: "i1", locationId: "L1", contactId: "c1", request: buildNote({ contactId: "c1", body: "secret words" }), token: async () => "t", fetchImpl };
  const off = await writeToCrm(args, { env: {}, log: () => undefined, audit: async (r) => { rows.push(r.detail); } });
  assert.equal(off.outcome, "dry_run");
  assert.equal(calls, 0);
  assert.ok(!JSON.stringify(rows).includes("secret words"));
  const on = await writeToCrm(args, { env: { WRITE_GHL_LIVE: "true" } });
  assert.deepEqual(on, { outcome: "written", id: "note123456" });
  assert.equal(calls, 1);
  const denied = await writeToCrm({ ...args, fetchImpl: (async () => new Response("{}", { status: 403 })) as typeof fetch }, { env: { WRITE_GHL_LIVE: "true" } });
  assert.equal(denied.outcome, "needs_permission");
});

test("the plain sentences for every state", () => {
  assert.match(saveMessage("saved", "note"), /^Saved to the contact in your CRM/);
  assert.match(saveMessage("dry_run", "note"), /switched off for now/);
  assert.match(saveMessage("needs_permission", "note"), /^Needs permission: reconnect/);
  assert.match(saveMessage("failed", "note", 422), /error 422/);
  assert.doesNotMatch(Object.values({ a: saveMessage("saved", "outcome"), b: saveMessage("dry_run", "outcome"), c: saveMessage("failed", "outcome") }).join(" "), /gohighlevel|highlevel|\bghl\b/i);
});

test("echo: the id of a note we made is found in the webhook body", () => {
  assert.deepEqual(candidateIds({ type: "NoteCreate", id: "note123456" }), ["note123456"]);
});

test("tags: a clean name is kept exactly as typed (no date or marker added); empty, long or comma names are refused", () => {
  assert.equal(cleanTag("  qualified  "), "qualified");
  assert.equal(cleanTag("web   lead"), "web lead");
  assert.equal(cleanTag(""), null);
  assert.equal(cleanTag("a,b"), null);
  assert.equal(cleanTag("x".repeat(61)), null);
  assert.equal(cleanTag(5), null);
  const t = buildTags({ contactId: "c1", tags: ["qualified"], remove: true });
  assert.deepEqual([t.method, t.body.tags], ["DELETE", ["qualified"]]);
});
