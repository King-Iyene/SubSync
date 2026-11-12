import assert from "node:assert/strict";
import { test } from "node:test";
import { stepRows, stepTime, verdict, SLOW_AFTER_MS, STUCK_AFTER_MS } from "../sync/run-status.ts";
import { mapContact } from "../sync/ghl-data.ts";
import { canonicalType, actionFor, parseWebhook } from "../ghl/webhook.ts";

const names = new Map<string, string | null>([["L1", "KD Squares Test"]]);
const t = (s: number) => new Date(1_000_000 + s * 1000);

test("each step shows its own state and time", () => {
  const rows = stepRows([
    { type: "structure", location_id: "L1", status: "done", started_at: t(0), finished_at: t(3), error: null },
    { type: "contacts", location_id: "L1", status: "running", started_at: t(1), finished_at: null, error: null },
    { type: "conversations", location_id: "L1", status: "pending", started_at: null, finished_at: null, error: null },
    { type: "appointments", location_id: "L1", status: "failed", started_at: t(0), finished_at: t(90), error: "Took longer than 90 seconds and was stopped." },
  ], names, 1_000_000 + 20_000);
  assert.deepEqual(rows.map((r) => [r.label, r.state, r.ms]), [["Account details", "done", 3000], ["People", "running", 19_000], ["Conversations", "waiting", null], ["Appointments", "failed", 90_000]]);
  assert.equal(rows[0].name, "KD Squares Test");
  assert.equal(stepTime(3000), "3 s");
  assert.equal(stepTime(80_000), "1 min 20 s");
  assert.equal(stepTime(null), "");
});

test("a slow sync says so, and a stuck one stops waiting and names the step holding it up", () => {
  const steps = stepRows([{ type: "contacts", location_id: "L1", status: "running", started_at: t(0), finished_at: null, error: null }], names, 1_000_000 + 50_000);
  assert.equal(verdict(10_000, steps).kind, "working");
  const slow = verdict(SLOW_AFTER_MS, steps);
  assert.equal(slow.kind, "slow");
  assert.match(slow.text, /People for KD Squares Test/);
  const stuck = verdict(STUCK_AFTER_MS, steps);
  assert.equal(stuck.kind, "stuck");
  assert.match(stuck.text, /taking too long/i);
  assert.doesNotMatch(stuck.text, /Syncing\.\.\./);
});

test("a contact event that carries only the account (no company) still becomes a person in the copy", () => {
  // The shape the platform sends for a new contact: ids at the top level, no companyId.
  const body = { type: "ContactCreate", webhookId: "w1", locationId: "ojRd", id: "IhnZ", firstName: "Test", lastName: "Lead One", email: "King@KDSquares.com", phone: "+2348000000000", tags: ["new"], dateAdded: "2026-11-12T16:39:30.000Z" };
  const ev = parseWebhook(body);
  assert.equal(ev.companyId, null);
  assert.equal(ev.locationId, "ojRd");
  assert.deepEqual(actionFor(canonicalType(ev.type)), { kind: "resync", scope: "contacts" });
  const row = mapContact({ ...body, id: "IhnZ" });
  assert.equal(row?.contactId, "IhnZ");
  assert.equal(row?.email, "king@kdsquares.com");
  assert.equal(row?.lastName, "Lead One");
  assert.deepEqual(row?.tags, ["new"]);
});
