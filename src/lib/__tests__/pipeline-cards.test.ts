import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCursor } from "../analytics/pipeline3-intel.ts";

test("the keyset cursor accepts only its own shape", () => {
  assert.deepEqual(parseCursor("1234.5|locA|pl_1"), { v: 1234.5, loc: "locA", pid: "pl_1" });
  assert.deepEqual(parseCursor("0|a|b"), { v: 0, loc: "a", pid: "b" });
  for (const bad of ["", null, undefined, "x|a|b", "1|a", "1|a|b|c", "1|a b|c", "-5|a|b", "1';drop|a|b"]) assert.equal(parseCursor(bad as string), null);
});

import { parseDealCursor } from "../analytics/pipeline3-intel.ts";
test("the deal-list keyset cursor accepts only value|id", () => {
  assert.deepEqual(parseDealCursor("1500.25|abc_1"), { v: 1500.25, id: "abc_1" });
  for (const bad of ["", null, "x|y", "1|", "|a", "1|a b", "1e+21|a", "1|a|b"]) assert.equal(parseDealCursor(bad as string), null);
});
