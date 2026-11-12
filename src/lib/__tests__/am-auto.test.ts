import assert from "node:assert/strict";
import { test } from "node:test";
import { oneLine, shortNoteText, toShortNote, addedText } from "../connections/auto-note.ts";
import { autoSubscriptions, mayPost, routeTo, DEFAULT_PREFS, clientChannel, type Dest } from "../connections/slack-auto.ts";

const long = "**Summary**\n\n- [0:01:12](https://fathom.video/x?timestamp=72) Alex wants a quote for the kitchen job and can decide by Friday. More text here.\n- Action: send quote\n".repeat(40);

test("one summary line: no markdown, no links, no timestamps, one sentence", () => {
  const s = oneLine(long);
  assert.ok(!/[*\[\]]|https?:|\d:\d\d/.test(s));
  assert.ok(s.length <= 200);
  assert.equal(oneLine(null), "");
});

test("the short note holds only title, date, meeting link, recording link and one line, never a transcript or action items", () => {
  const t = shortNoteText({ title: "Quote call", startedAt: "2026-11-02T15:00:00Z", summary: long, recordingUrl: "https://fathom.video/share/r", transcriptUrl: "https://fathom.video/calls/1", tool: "Fathom" });
  assert.match(t, /Meeting: Quote call \(Nov 2, 2026\)/);
  assert.match(t, /Meeting link: https:\/\/fathom.video\/calls\/1/);
  assert.match(t, /Recording: https:\/\/fathom.video\/share\/r/);
  assert.ok(t.length < 600);
  assert.ok(!/Part \d of/.test(t) && !/Action/.test(t));
  const none = shortNoteText({ title: null, startedAt: null, summary: null, recordingUrl: "http://insecure", transcriptUrl: null, tool: "Fathom" });
  assert.ok(!/http:/.test(none));
});

test("toShortNote turns many parts into one note, drops comments, keeps fields", () => {
  const c = toShortNote({ messages: [{ kind: "note", partNo: 1, text: "a", what: "meeting" }, { kind: "note", partNo: 2, text: "b", what: "meeting" }, { kind: "comment", partNo: 1, text: "c", what: "meeting" }], fieldItems: ["rep"], remarks: [] }, { title: "T", startedAt: null, durationMinutes: null, attendeeNames: [], rep: null, tool: "Fathom", summary: null, actionItems: [], recordingUrl: null });
  assert.equal(c.messages.length, 1);
  assert.equal(c.messages[0].partNo, 1);
  assert.deepEqual(c.fieldItems, ["rep"]);
  assert.equal(addedText("Alex"), "Meeting with Alex was added to their contact.");
});

const d = (id: string, locationId: string | null, ownerUserId: string | null = null): Dest => ({ id, label: id, locationId, status: "connected", pendingSince: null, ownerUserId });

test("slack routing: a client never gets another client's data, agency messages only reach the company channel, meeting notices only the person", () => {
  const all = [d("agency", null), d("c1", "L1"), d("c2", "L2"), d("me", null, "U1"), d("you", null, "U2")];
  assert.deepEqual(routeTo(all, { scope: "agency", locationId: null }).map((x) => x.id), ["agency"]);
  assert.deepEqual(routeTo(all, { scope: "account", locationId: "L1" }).map((x) => x.id), ["agency", "c1"]);
  assert.deepEqual(routeTo(all, { scope: "person", locationId: null, ownerUserId: "U1" }).map((x) => x.id), ["me"]);
  assert.deepEqual(routeTo(all, { scope: "person", locationId: null, ownerUserId: null }), []);
  assert.deepEqual(routeTo(all, { scope: "account", locationId: null }), []);
});

test("pause all, mutes and quiet hours stop a post; critical may pass quiet hours", () => {
  assert.equal(mayPost({ scope: "agency", locationId: null }, { ...DEFAULT_PREFS, pauseAll: true }, 12).why, "paused");
  assert.equal(mayPost({ scope: "account", locationId: "L1" }, { ...DEFAULT_PREFS, mutedLocations: ["L1"] }, 12).why, "muted");
  assert.equal(mayPost({ scope: "agency", locationId: null }, DEFAULT_PREFS, 23).why, "quiet");
  assert.equal(mayPost({ scope: "agency", locationId: null, critical: true }, DEFAULT_PREFS, 23).send, true);
  assert.equal(mayPost({ scope: "agency", locationId: null }, DEFAULT_PREFS, 12).send, true);
  assert.ok(autoSubscriptions({ locationId: null, ownerUserId: null }).includes("daily_brief"));
  assert.deepEqual(autoSubscriptions({ locationId: null, ownerUserId: "U" }), ["meeting_added", "meeting_needs_matching"]);
  assert.equal(clientChannel("Sample Dental!"), "subsync-sample-dental");
});
