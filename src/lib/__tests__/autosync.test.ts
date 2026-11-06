import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DISPOSITIONS } from "../dial/dial6.ts";
import { DEFAULT_RULES, detectionKey, firstTime, inferDetected, inferFromCall, joinOutcome, pollDue, rulesFrom, skipOwnNote, splitOutcome, toastText, type Signals } from "../dial/autosync.ts";

const none: Signals = { call: null, tags: [], stageMoved: false, appointment: false, dnd: false };

test("call record: over 30 s is Spoke, no-answer/busy/failed is No answer, voicemail is Left voicemail", () => {
  assert.deepEqual([inferFromCall({ status: "completed", durationSec: 240, at: 1 })?.base, inferFromCall({ status: "completed", durationSec: 240, at: 1 })?.confidence], ["spoke", "sure"]);
  for (const s of ["no-answer", "busy", "failed", "canceled"]) assert.equal(inferFromCall({ status: s, durationSec: 0, at: 1 })?.base, "no_answer");
  assert.equal(inferFromCall({ status: "voicemail", durationSec: 20, at: 1 })?.base, "voicemail");
  assert.equal(inferFromCall({ status: "weird", durationSec: 5, at: 1 }), null);
});
test("ambiguous: a short or unmeasured answered call asks, with a likely chip preselected", () => {
  const short = inferFromCall({ status: "completed", durationSec: 12, at: 1 });
  assert.deepEqual([short?.base, short?.confidence], ["voicemail", "ambiguous"]);
  const unknown = inferFromCall({ status: "answered", durationSec: null, at: 1 });
  assert.deepEqual([unknown?.base, unknown?.confidence], ["spoke", "ambiguous"]);
});
test("CRM actions win over the call record: appointment or booked tag = Booked, dnd = Do not call, wrong-number tag = Wrong number", () => {
  const call = { status: "completed", durationSec: 200, at: 5 };
  assert.equal(inferDetected({ ...none, call, appointment: true }, DEFAULT_RULES)?.base, "booked");
  assert.equal(inferDetected({ ...none, call, tags: [{ tag: "Booked", kind: "added", at: 6 }] }, DEFAULT_RULES)?.base, "booked");
  assert.equal(inferDetected({ ...none, call, dnd: true }, DEFAULT_RULES)?.base, "dnc");
  assert.equal(inferDetected({ ...none, call: { status: "no-answer", durationSec: 0, at: 5 }, tags: [{ tag: "wrong-number", kind: "added", at: 6 }] }, DEFAULT_RULES)?.base, "wrong_number");
  assert.equal(inferDetected({ ...none, tags: [{ tag: "booked", kind: "removed", at: 6 }] }, DEFAULT_RULES), null);
  assert.equal(inferDetected({ ...none, call }, DEFAULT_RULES)?.durationSec, 200);
});
test("per-account rules: a custom disposition tag maps to its base outcome", () => {
  const d = DEFAULT_DISPOSITIONS.map((x) => (x.base === "booked" ? { ...x, tag: "demo-set" } : x));
  const r = rulesFrom(d);
  assert.equal(inferDetected({ ...none, tags: [{ tag: "demo-set", kind: "added", at: 1 }] }, r)?.base, "booked");
  assert.ok(r.bookedTags.includes("subsync-booked"));
});
test("de-duplication: the same detection is acted on once, and our own note is skipped when the CRM holds the call record", () => {
  const seen = new Set<string>();
  const inf = inferFromCall({ status: "completed", durationSec: 90, at: 77 })!;
  const k = detectionKey("L:c", { ...none, call: { status: "completed", durationSec: 90, at: 77 } }, inf);
  assert.equal(firstTime(seen, k), true); assert.equal(firstTime(seen, k), false);
  assert.equal(skipOwnNote(true, true), true); assert.equal(skipOwnNote(true, false), false); assert.equal(skipOwnNote(false, true), false);
});
test("stored word, toast and the 2 minute poll window", () => {
  assert.deepEqual(splitOutcome("completed:134"), { status: "completed", durationSec: 134 });
  assert.deepEqual(splitOutcome("no-answer"), { status: "no-answer", durationSec: null });
  assert.equal(joinOutcome("completed", 134), "completed:134"); assert.equal(joinOutcome("busy", null), "busy");
  assert.equal(toastText("Ben Ito", inferFromCall({ status: "completed", durationSec: 240, at: 1 })!), "Spoke with Ben, 4 min");
  assert.equal(pollDue(0, 119_000), true); assert.equal(pollDue(0, 121_000), false);
});
