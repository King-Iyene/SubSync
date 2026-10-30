import assert from "node:assert/strict";
import { test } from "node:test";
import { compareSetup, describe, type Setup } from "../analytics/setup-intel.ts";

const base: Setup = {
  locationId: "B", name: "Baseline", calendars: 3,
  pipelines: [{ name: "Sales", stages: ["New Lead", "Booked", "Won"] }, { name: "Onboarding", stages: ["Kickoff", "Live"] }],
};
const acct = (o: Partial<Setup>): Setup => ({ locationId: "A", name: "Acme", calendars: 3, pipelines: base.pipelines, ...o });

test("an identical setup matches, ignoring case and spacing", () => {
  const d = compareSetup(base, acct({ pipelines: [{ name: " sales ", stages: ["new lead", "BOOKED", "won"] }, { name: "Onboarding", stages: ["Kickoff", "Live"] }] }));
  assert.equal(d.matches, true);
  assert.deepEqual(describe(d), []);
});

test("missing and extra pipelines are named", () => {
  const d = compareSetup(base, acct({ pipelines: [{ name: "Sales", stages: ["New Lead", "Booked", "Won"] }, { name: "Upsell", stages: ["A"] }] }));
  assert.equal(d.matches, false);
  assert.deepEqual(d.missingPipelines, ["Onboarding"]);
  assert.deepEqual(d.extraPipelines, ["Upsell"]);
});

test("missing and extra stages are found inside a shared pipeline", () => {
  const d = compareSetup(base, acct({ pipelines: [{ name: "Sales", stages: ["New Lead", "Won", "Archived"] }, base.pipelines[1]] }));
  assert.equal(d.matches, false);
  assert.deepEqual(d.stageDiffs[0], { pipeline: "Sales", missing: ["Booked"], extra: ["Archived"], orderDiffers: false });
  assert.match(describe(d)[0], /Sales: missing stage Booked; extra stage Archived/);
});

test("a different stage order is a difference on its own", () => {
  const d = compareSetup(base, acct({ pipelines: [{ name: "Sales", stages: ["Booked", "New Lead", "Won"] }, base.pipelines[1]] }));
  assert.equal(d.matches, false);
  assert.equal(d.stageDiffs[0].orderDiffers, true);
  assert.match(describe(d)[0], /different order/);
});

test("a calendar count difference is reported but is not a mismatch by itself", () => {
  const d = compareSetup(base, acct({ calendars: 1 }));
  assert.equal(d.matches, true);
  assert.equal(d.calendarDelta, -2);
  assert.match(describe(d)[0], /2 fewer calendars/);
  assert.equal(compareSetup(base, acct({ calendars: null })).calendarDelta, null);
});
