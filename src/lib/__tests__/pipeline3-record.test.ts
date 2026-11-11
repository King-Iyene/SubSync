import assert from "node:assert/strict";
import { test } from "node:test";
import { diffDeal, isBackward, type DealSnap } from "../analytics/pipeline3-diff.ts";

const T = Date.parse("2026-11-10T12:00:00Z");
const snap = (o: Partial<DealSnap> = {}): DealSnap => ({
  stageId: "s1", pipelineId: "p1", status: "open", value: 1000, ownerId: "u1", source: "ads", lostReasonId: null, contactId: "c1", lastStageChangeAt: T - 86_400_000, lastStatusChangeAt: null, createdAt: T - 10 * 86_400_000, ...o,
});

test("first sight records created at the platform's time; an unmoved deal knows its first stage", () => {
  const ev = diffDeal("o1", null, snap({ lastStageChangeAt: null }), { at: T });
  assert.deepEqual(ev.map((e) => e.kind), ["created", "owner", "source"]);
  assert.equal(ev[0].to, "s1");
  assert.equal(ev[0].at, T - 10 * 86_400_000);
  assert.equal(ev[0].key, "created|o1");
});

test("first sight of an older deal that moved records the entry into the CURRENT stage, not a guessed first stage", () => {
  const ev = diffDeal("o1", null, snap(), { at: T });
  assert.equal(ev[0].kind, "created");
  assert.equal(ev[0].to, null);
  const st = ev.find((e) => e.kind === "stage");
  assert.equal(st?.to, "s1");
  assert.equal(st?.from, null);
  assert.equal(st?.at, T - 86_400_000);
});

test("a stage change diffs against the stored row; the same change from a webhook and a sync page has the same key", () => {
  const prev = snap();
  const next = snap({ stageId: "s2", lastStageChangeAt: T - 60_000 });
  const a = diffDeal("o1", prev, next, { at: T, actorId: "u9" });
  const b = diffDeal("o1", prev, next, { at: T + 25_000 });
  assert.equal(a.length, 1);
  assert.equal(a[0].key, b[0].key, "keyed by the platform's change time, so a replay writes nothing new");
  assert.equal(a[0].from, "s1");
  assert.equal(a[0].to, "s2");
  assert.equal(a[0].actorKind, "person");
  assert.equal(b[0].actorKind, "unknown");
  assert.equal(a[0].dwellSeconds, 86_340, "time spent in the stage it left");
});

test("status, value, owner, lost reason and source changes are each one event; no change is no event", () => {
  const prev = snap();
  assert.equal(diffDeal("o1", prev, snap(), { at: T }).length, 0);
  const ev = diffDeal("o1", prev, snap({ status: "lost", lastStatusChangeAt: T - 1000, value: 1500, ownerId: "u2", lostReasonId: "r1", source: "referral" }), { at: T });
  assert.deepEqual(ev.map((e) => e.kind).sort(), ["lost_reason", "owner", "source", "status", "value"]);
  assert.equal(ev.find((e) => e.kind === "status")?.from, "open");
  assert.equal(ev.find((e) => e.kind === "status")?.to, "lost");
  assert.equal(ev.find((e) => e.kind === "status")?.at, T - 1000);
  assert.equal(ev.find((e) => e.kind === "value")?.from, "1000");
});

test("our own recent write is marked 'subsync' so it never counts as team activity", () => {
  const prev = snap();
  const next = snap({ stageId: "s2", lastStageChangeAt: T - 1000 });
  const ev = diffDeal("o1", prev, next, { at: T, actorId: "u1", own: [{ kind: "stage", to: "s2", at: T - 120_000 }] });
  assert.equal(ev[0].actorKind, "subsync");
  assert.equal(ev[0].actorId, null);
  const old = diffDeal("o1", prev, next, { at: T, actorId: "u1", own: [{ kind: "stage", to: "s2", at: T - 3_600_000 }] });
  assert.equal(old[0].actorKind, "person", "an hour old is not an echo");
});

test("a stage move to an earlier stage is backward", () => {
  assert.equal(isBackward(3, 1), true);
  assert.equal(isBackward(1, 3), false);
  assert.equal(isBackward(null, 1), false);
});
