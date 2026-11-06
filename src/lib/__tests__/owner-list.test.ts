import test from "node:test";
import assert from "node:assert/strict";
import { buildOwnerOptions, displayName, UNKNOWN_USER } from "../ghl/owner-list.ts";
import { mapUser } from "../sync/ghl-data.ts";

test("display name: first + last, else email local part, never an id", () => {
  assert.equal(displayName({ firstName: "Ada", lastName: "Lovelace" }), "Ada Lovelace");
  assert.equal(displayName({ email: "sam.t@x.test" }), "sam.t");
  assert.equal(displayName({}), null);
  assert.equal(mapUser({ id: "abcZWol", email: "kim@x.test" })?.name, "kim");
});

test("owner options: only members, sorted, unresolved members are never listed", () => {
  const o = buildOwnerOptions([{ id: "u2", name: "Zed" }, { id: "u1", name: "Ada" }, { id: "u3", name: null }, { id: "u4", name: " " }], null, new Map());
  assert.deepEqual(o.map((x) => x.name), ["Ada", "Zed"]);
});

test("owner options: a current owner outside the team stays visible, named if known else Unknown user", () => {
  assert.deepEqual(buildOwnerOptions([{ id: "u1", name: "Ada" }], "gone", new Map())[0], { id: "gone", name: UNKNOWN_USER });
  assert.equal(buildOwnerOptions([], "gone", new Map([["gone", "Old Hand"]]))[0].name, "Old Hand");
  assert.equal(buildOwnerOptions([{ id: "u1", name: "Ada" }], "u1", new Map()).length, 1);
});
