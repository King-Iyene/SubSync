import assert from "node:assert/strict";
import { test } from "node:test";
import { humanWait, initialsOf } from "../design/wait.ts";
test("waits read as people say them", () => {
  assert.equal(humanWait(45), "45 min"); assert.equal(humanWait(799), "13 h 19 min"); assert.equal(humanWait(120), "2 h"); assert.equal(humanWait(3000), "2 d 2 h"); assert.equal(humanWait(1440), "1 d");
});
test("initials", () => { assert.equal(initialsOf("Ben Wealth"), "BW"); assert.equal(initialsOf("  "), "?"); assert.equal(initialsOf("Cher"), "C"); });
