import assert from "node:assert/strict";
import { test } from "node:test";
import { diffDealEvents } from "../sync/deal-events.ts";
import { mapContact, mapOpportunity, toDateOnly } from "../sync/ghl-data.ts";

const known = new Map([["d1", { stageId: "s1", status: "open" }], ["d2", { stageId: "s2", status: "open" }]]);

test("a stage move and a status change are both recorded", () => {
  const events = diffDealEvents(
    [{ id: "d1", stageId: "s2", status: "open", value: 100 }, { id: "d2", stageId: "s2", status: "won", value: 500 }],
    known, true,
  );
  assert.deepEqual(events.map((e) => [e.id, e.kind, e.from, e.to]), [["d1", "stage", "s1", "s2"], ["d2", "status", "open", "won"]]);
});

test("nothing is recorded when nothing changed", () => {
  assert.deepEqual(diffDealEvents([{ id: "d1", stageId: "s1", status: "open", value: 1 }], known, true), []);
});

test("new deals are logged only after the first sync has finished", () => {
  const incoming = [{ id: "n1", stageId: "s1", status: "open", value: 10 }];
  assert.deepEqual(diffDealEvents(incoming, known, false), []);
  assert.equal(diffDealEvents(incoming, known, true)[0].kind, "created");
});

test("the new contact and deal fields are read defensively", () => {
  const c = mapContact({ id: "c1", source: " Facebook Ads ", dnd: true, dateOfBirth: "1990-04-02T00:00:00.000Z", assignedTo: "u1" });
  assert.equal(c?.source, "Facebook Ads");
  assert.equal(c?.dnd, true);
  assert.equal(c?.birthDate, "1990-04-02");
  assert.equal(c?.assignedTo, "u1");
  const blank = mapContact({ id: "c2", dnd: "yes", dateOfBirth: "not a date" });
  assert.equal(blank?.dnd, false);
  assert.equal(blank?.birthDate, null);
  assert.equal(blank?.source, null);
  const o = mapOpportunity({ id: "o1", assignedTo: "u2", source: "Referral" });
  assert.equal(o?.assignedTo, "u2");
  assert.equal(o?.source, "Referral");
  assert.equal(toDateOnly(undefined), null);
});
