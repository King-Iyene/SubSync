import assert from "node:assert/strict";
import { test } from "node:test";
import { cadenceSummary, touchRow } from "../dial/touch.ts";

const cad = { maxAttempts: 6, redialAfterHours: 4, nextDay: false };
const H = 3600_000;
test("touch counter and next try come from the plan", () => {
  const now = 1_000_000_000_000;
  const r = touchRow("a:1", { attempts: 1, lastAt: now - H, reached: false }, cad, now, null);
  assert.equal(r.touch, 2); assert.equal(r.of, 6); assert.equal(r.state, "waiting"); assert.equal(r.nextAt, now + 3 * H);
  assert.equal(touchRow("a:2", undefined, cad, now, null).state, "fresh");
  assert.equal(touchRow("a:3", { attempts: 6, lastAt: now, reached: false }, cad, now, null).state, "text_fallback");
});
test("summary counts waiting, due and text leads and picks the soonest example", () => {
  const now = 1_000_000_000_000;
  const rows = [
    touchRow("a", { attempts: 1, lastAt: now - H, reached: false }, cad, now, null),
    touchRow("b", { attempts: 2, lastAt: now - 3 * H, reached: false }, cad, now, null),
    touchRow("c", { attempts: 1, lastAt: now - 9 * H, reached: false }, cad, now, null),
    touchRow("d", { attempts: 6, lastAt: now, reached: false }, cad, now, null),
  ];
  const s = cadenceSummary(rows);
  assert.deepEqual(s.waiting, ["a", "b"]); assert.deepEqual(s.due, ["c"]); assert.deepEqual(s.textNow, ["d"]); assert.equal(s.example?.key, "b");
});
