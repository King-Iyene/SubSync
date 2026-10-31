import assert from "node:assert/strict";
import { test } from "node:test";
import { paceOf } from "../analytics/people-intel.ts";

test("a typical reply time needs three replies and a show rate needs five recorded outcomes", () => {
  assert.equal(paceOf({ replies: 2, medianSeconds: 60, held: 0, noShow: 0 }).medianReplySeconds, null);
  assert.equal(paceOf({ replies: 3, medianSeconds: 60, held: 0, noShow: 0 }).medianReplySeconds, 60);
  assert.equal(paceOf({ replies: 0, medianSeconds: null, held: 3, noShow: 1 }).showRate, null, "four outcomes is not enough");
  assert.equal(paceOf({ replies: 0, medianSeconds: null, held: 4, noShow: 1 }).showRate, 0.8);
  assert.equal(paceOf({ replies: 0, medianSeconds: null, held: 0, noShow: 5 }).showRate, 0);
});

test("a person is idle after 24 hours without a reply, and no replies means no idle flag", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  const base = { replies: 5, medianSeconds: 60, held: 0, noShow: 0 };
  assert.equal(paceOf({ ...base, lastReplyAt: now - 3 * 3_600_000 }, now).idle, false);
  assert.equal(paceOf({ ...base, lastReplyAt: now - 30 * 3_600_000 }, now).idle, true);
  assert.equal(paceOf({ ...base, lastReplyAt: now - 30 * 3_600_000 }, now).lastReplyHoursAgo, 30);
  assert.equal(paceOf({ ...base, lastReplyAt: null }, now).idle, false);
});
