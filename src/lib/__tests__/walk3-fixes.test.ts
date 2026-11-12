import assert from "node:assert/strict";
import { test } from "node:test";
import { needsTickText, plainError } from "../design/plain-error.ts";
import { defaultPipelineId } from "../people/deal-view.ts";
import { bestName } from "../people/names.ts";

test("a failed request never shows a bare status code", () => {
  for (const s of [0, 400, 401, 403, 404, 409, 422, 429, 500, 502, 418]) assert.ok(!/\(\d{3}\)|Request failed/.test(plainError(s, {})), String(s));
  assert.match(plainError(403, {}), /switched off|administrator/);
  assert.equal(plainError(403, { message: "Needs permission: reconnect." }), "Needs permission: reconnect.");
  assert.equal(plainError(500, { error: "Nope." }), "Nope.");
});

test("the tick message says why in plain words", () => {
  assert.equal(needsTickText([{ id: "quiet_hours" }]), "Tick the box to confirm you want to send outside 8am-9pm.");
  assert.match(needsTickText([]), /Tick the box/);
});

test("a new deal starts in the person's own pipeline, else the most used, else none", () => {
  const pl = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(defaultPipelineId(pl, [{ pipelineId: "c", status: "won" }, { pipelineId: "b", status: "open" }], { a: 50 }), "b");
  assert.equal(defaultPipelineId(pl, [{ pipelineId: "c", status: "won" }], { a: 50 }), "c");
  assert.equal(defaultPipelineId(pl, [], { a: 2, b: 9 }), "b");
  assert.equal(defaultPipelineId(pl, [{ pipelineId: "zzz", status: "open" }], {}), "");
  assert.equal(defaultPipelineId([], [], undefined), "");
});

test("the panel title keeps the best name after an update", () => {
  assert.equal(bestName("Unnamed contact", "+15550100", "+15550100", "a@b.co"), "+15550100");
  assert.equal(bestName("", null, undefined, "a@b.co"), "a@b.co");
  assert.equal(bestName("Ada", "x"), "Ada");
  assert.equal(bestName("Unnamed contact", "", null, null), "Unnamed contact");
});
