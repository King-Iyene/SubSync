import assert from "node:assert/strict";
import { test } from "node:test";
import { matchContact, noteText, parseMeeting } from "../analytics/meeting-intel.ts";

test("a Fathom style payload is read: summary, action items, invitees, transcript, link", () => {
  const m = parseMeeting({
    title: "Kitchen consult", scheduled_start_time: "2026-10-29T14:00:00Z", share_url: "https://fathom.video/share/abc",
    calendar_invitees: [{ name: "Sarah Johnson", email: "Sarah@Example.com" }, { name: "Dana", email: "dana@agency.com" }],
    recorded_by: { name: "Dana", email: "dana@agency.com" },
    default_summary: { markdown_formatted: "Wants a new kitchen by March." },
    action_items: [{ description: "Send a quote" }, { description: "Book a site visit" }],
    transcript: [{ speaker: { display_name: "Sarah" }, text: "Hello" }, { speaker: { display_name: "Dana" }, text: "Hi there" }],
  });
  assert.ok(m);
  assert.equal(m.source, "fathom");
  assert.equal(m.summary, "Wants a new kitchen by March.");
  assert.deepEqual(m.actionItems, ["Send a quote", "Book a site visit"]);
  assert.deepEqual(m.attendees.map((a) => a.email), ["sarah@example.com", "dana@agency.com"], "one entry per email, lower cased");
  assert.equal(m.transcript, "Sarah: Hello\nDana: Hi there");
  assert.equal(m.startedAt, "2026-10-29T14:00:00.000Z");
});

test("a Zoom recording sent through an automation is read", () => {
  const m = parseMeeting({ topic: "Discovery call", start_time: "2026-10-28T10:00:00Z", participants: ["lead@client.com", "Dana Brooks"], transcript: "WEBVTT\n\n00:01 Hello", share_url: "https://us02web.zoom.us/rec/share/xyz" });
  assert.equal(m?.source, "zoom");
  assert.deepEqual(m?.attendees, [{ name: null, email: "lead@client.com" }, { name: "Dana Brooks", email: null }]);
});

test("a plain form payload works, action items can be a bulleted string", () => {
  const m = parseMeeting({ title: "Check-in", summary: "All good.", action_items: "- Call back Friday\n- Send invoice", attendees: "a@b.co, c@d.co" });
  assert.equal(m?.source, "other");
  assert.deepEqual(m?.actionItems, ["Call back Friday", "Send invoice"]);
  assert.equal(m?.attendees.length, 2);
});

test("junk, unsafe links and empty bodies are handled", () => {
  assert.equal(parseMeeting(null), null);
  assert.equal(parseMeeting({ nothing: true }), null);
  assert.equal(parseMeeting("text"), null);
  assert.equal(parseMeeting({ title: "x", recording_url: "http://insecure.example/a" })?.recordingUrl, null, "only https links are kept");
  assert.equal(parseMeeting({ title: "x", url: "javascript:alert(1)" })?.recordingUrl, null);
  const m = parseMeeting({ title: "a\u0000b", summary: "x".repeat(9_000) });
  assert.equal(m?.title, "ab");
  assert.equal(m?.summary?.length, 6_000);
});

test("the meeting is matched to a contact by attendee email", () => {
  const contacts = [{ id: "c1", email: "someone@else.com" }, { id: "c2", email: "Sarah@Example.com" }];
  const hit = matchContact([{ name: "Dana", email: "dana@agency.com" }, { name: "Sarah", email: "sarah@example.com" }], contacts);
  assert.equal(hit?.id, "c2");
  assert.equal(matchContact([{ name: "Nobody", email: null }], contacts), null);
});

// N93: a meeting is put on a contact only when an exact email says so. Never a name, never a guess between two records.
test("only an exact email matches: never a name, and never one of two records that share an email", () => {
  const contacts = [{ id: "c1", email: "sarah@example.com", name: "Sarah Jones" }, { id: "c2", email: "twin@example.com", name: "Twin" }, { id: "c3", email: "twin@example.com", name: "Twin" }, { id: "c4", email: null, name: "Dana Lee" }];
  assert.equal(matchContact([{ name: "Dana Lee", email: null }], contacts), null, "the same name is not a match");
  assert.equal(matchContact([{ name: "Sarah Jones", email: "other@example.com" }], contacts), null, "a matching name with a different email is not a match");
  assert.equal(matchContact([{ name: "Twin", email: "twin@example.com" }], contacts), null, "two records with this email: not certain, so neither gets it");
  assert.equal(matchContact([{ name: "Twin", email: "twin@example.com" }, { name: "Sarah", email: "SARAH@example.com" }], contacts)?.id, "c1", "a certain match later in the list still counts");
  assert.equal(matchContact([], contacts), null);
  assert.equal(matchContact([{ name: "x", email: "sarah@example.com" }], []), null);
});

test("the pasteable note has summary and action items but never the transcript", () => {
  const m = parseMeeting({ title: "Kitchen consult", started_at: "2026-10-29T14:00:00Z", summary: "Wants a new kitchen.", action_items: ["Send a quote"], transcript: "SECRET WORDS", attendees: ["s@e.com"], share_url: "https://fathom.video/x" })!;
  const text = noteText(m);
  assert.match(text, /Meeting: Kitchen consult/);
  assert.match(text, /Summary\nWants a new kitchen\./);
  assert.match(text, /- Send a quote/);
  assert.match(text, /Recording: https:\/\/fathom\.video\/x/);
  assert.ok(!text.includes("SECRET WORDS"));
});
