import test from "node:test";
import assert from "node:assert/strict";
import { bearerMatches } from "../secret-compare.ts";

test("bearer secret check", () => {
  assert.equal(bearerMatches("Bearer s3cret", "s3cret"), true);
  assert.equal(bearerMatches("Bearer s3cre", "s3cret"), false);
  assert.equal(bearerMatches("s3cret", "s3cret"), false, "the scheme is required");
  assert.equal(bearerMatches(null, "s3cret"), false);
  assert.equal(bearerMatches("Bearer ", ""), false, "an unset secret never matches");
  assert.equal(bearerMatches("Bearer undefined", undefined), false);
});
