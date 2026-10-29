import assert from "node:assert/strict";
import { test } from "node:test";
import { listAllInstalledLocations } from "../sync/installed-locations.ts";

const make = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ _id: `loc-${from + i}` }));

test("pages until a short page and returns everything", async () => {
  const seen: Array<{ skip: number; limit: number }> = [];
  const all = await listAllInstalledLocations(
    async (page) => {
      seen.push(page);
      const rest = Math.max(0, 250 - page.skip);
      return { locations: make(Math.min(page.limit, rest), page.skip), count: 250 };
    },
    100,
  );
  assert.equal(all.length, 250);
  assert.deepEqual(seen.map((p) => p.skip), [0, 100, 200]);
  assert.equal(all[249]._id, "loc-249");
});

test("one short page needs one request", async () => {
  let calls = 0;
  const all = await listAllInstalledLocations(async () => {
    calls++;
    return { locations: make(3), count: 3 };
  });
  assert.equal(all.length, 3);
  assert.equal(calls, 1);
});

test("an empty agency returns an empty list", async () => {
  const all = await listAllInstalledLocations(async () => ({ locations: [], count: 0 }));
  assert.deepEqual(all, []);
});

test("stops once the reported count is reached even on a full page", async () => {
  let calls = 0;
  const all = await listAllInstalledLocations(async (page) => {
    calls++;
    return { locations: make(page.limit, page.skip), count: 100 };
  }, 100);
  assert.equal(all.length, 100);
  assert.equal(calls, 1);
});

test("never loops forever", async () => {
  let calls = 0;
  await listAllInstalledLocations(
    async (page) => {
      calls++;
      return { locations: make(page.limit, page.skip), count: Number.MAX_SAFE_INTEGER };
    },
    10,
    5,
  );
  assert.equal(calls, 5);
});
