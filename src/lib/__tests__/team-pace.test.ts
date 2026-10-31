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
