import assert from "node:assert/strict";
import { test } from "node:test";
import { FEATURES } from "../entitlements.ts";
import { DEFAULT_OFF, resolveFeatures } from "../flags-core.ts";
import { diffAppointmentEvents } from "../sync/appointment-events.ts";

test("every built feature is on by default except the two King switched off on 1 Nov; a row in the database can still switch one off", () => {
  const f = resolveFeatures(FEATURES, {});
  assert.equal(f.ai, true);
  assert.equal(resolveFeatures(FEATURES, { ai: false }).ai, false, "a database row still switches it off without a deploy");
  for (const on of ["overview", "search", "inbox", "appointments", "calls", "alerts", "pipelines", "stale", "onboarding", "settings", "health", "connections", "reports", "cleanup", "setup_compare", "playbooks", "builder", "duplicates", "clients", "team", "activity"] as const) assert.equal(f[on], true, on);
  // Stage S0.2b (King, 1 Nov 2026): the Meeting notes page waits for stage E2a, and Zoom and Google Meet are hidden everywhere.
  assert.deepEqual([...DEFAULT_OFF].sort(), ["meetings", "zoom_meet"]);
  assert.equal(f.meetings, false);
  assert.equal(f.zoom_meet, false);
  assert.ok([...DEFAULT_OFF].every((x) => (FEATURES as readonly string[]).includes(x)), "every switched-off name is a real feature");
});

test("a database row beats the default in both directions, and FLAGS_ALL_ON only changes defaults", () => {
  const on = resolveFeatures(FEATURES, { meetings: true, inbox: false });
  assert.equal(on.meetings, true, "a row can switch a deferred feature on");
  assert.equal(on.zoom_meet, false, "and only that one");
  assert.equal(on.inbox, false, "or a normal one off");
  const all = resolveFeatures(FEATURES, { inbox: false }, true);
  assert.equal(all.cleanup, true, "all-on turns the deferred ones on");
  assert.equal(all.inbox, false, "but a row still wins");
  assert.equal(resolveFeatures(FEATURES, { notAFeature: false }).overview, true, "an unknown key changes nothing");
});

test("appointment history: first sight, status changes and moves are recorded; the first sync records nothing", () => {
  const known = new Map([
    ["a1", { status: "confirmed", startAt: Date.parse("2026-11-02T10:00:00Z") }],
    ["a2", { status: "confirmed", startAt: Date.parse("2026-11-02T11:00:00Z") }],
    ["a3", { status: null, startAt: Date.parse("2026-11-02T12:00:00Z") }],
  ]);
  const incoming = [
    { id: "a1", status: "showed", startAt: Date.parse("2026-11-02T10:00:00Z") },
    { id: "a2", status: "confirmed", startAt: Date.parse("2026-11-03T11:00:00Z") },
    { id: "a3", status: null, startAt: Date.parse("2026-11-02T12:00:20Z") },
    { id: "a4", status: "new", startAt: Date.parse("2026-11-04T09:00:00Z") },
  ];
  const events = diffAppointmentEvents(incoming, known, true);
  assert.deepEqual(events.map((e) => `${e.id}:${e.kind}`), ["a1:status", "a2:time", "a4:created"]);
  assert.deepEqual(events[0], { id: "a1", kind: "status", from: "confirmed", to: "showed", startAt: Date.parse("2026-11-02T10:00:00Z") });
  assert.equal(events[1].from, "2026-11-02T11:00:00.000Z");
  assert.equal(events[1].to, "2026-11-03T11:00:00.000Z");
  assert.deepEqual(diffAppointmentEvents(incoming, new Map(), false), [], "the first read of an account says nothing about when anything was booked");
  assert.deepEqual(diffAppointmentEvents(incoming, known, true), diffAppointmentEvents(incoming, known, true), "same input, same output");
  assert.deepEqual(diffAppointmentEvents(incoming.slice(0, 1).map((a) => ({ ...a, status: "confirmed" })), known, true), [], "no change, no event");
});
