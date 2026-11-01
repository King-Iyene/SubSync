import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { createLimiter } from "../rate-limit.ts";
import { buildSharePayload, scrub } from "../analytics/share-intel.ts";

test("the limiter lets a burst through, then refuses until the window passes", () => {
  const l = createLimiter(3, 1000);
  const t = 10_000;
  assert.deepEqual([0, 1, 2, 3].map((i) => l.allow("ip", t + i)), [true, true, true, false]);
  assert.equal(l.allow("other", t + 4), true, "another address is counted separately");
  assert.equal(l.allow("ip", t + 999), false, "still inside the window");
  assert.equal(l.allow("ip", t + 1001), true, "the first hit has aged out");
});

test("the limiter does not grow without bound", () => {
  const l = createLimiter(1, 1000, 50);
  for (let i = 0; i < 500; i++) l.allow(`ip-${i}`, 1_000_000 + i * 2000); // each key's window has passed before the next arrives
  assert.ok(l.size() <= 51, `size ${l.size()}`);
  const fresh = createLimiter(1, 60_000, 20);
  for (let i = 0; i < 200; i++) fresh.allow(`ip-${i}`, 5_000 + i);
  assert.ok(fresh.size() <= 21, "even when no window has passed, the oldest key is dropped");
});

test("a share token carries at least 128 bits and two are never equal", () => {
  const ids = new Set(Array.from({ length: 200 }, () => randomBytes(24).toString("base64url")));
  assert.equal(ids.size, 200);
  for (const id of ids) { assert.ok(id.length >= 32, id); assert.match(id, /^[A-Za-z0-9_-]{20,64}$/); }
  assert.ok(24 * 8 >= 128, "24 random bytes is 192 bits");
});

test("the shared snapshot has no account names, in the headline, the findings or the fix steps", () => {
  const names = ["Blue Door Realty", "Sunrise Roofing Co"];
  const p = buildSharePayload(
    { headline: "Blue Door Realty has $9,000 stale", accountsScanned: 2, staleDollars: 9000, estimatedDollars: null,
      findings: [{ severity: "critical", title: "12 leads waiting at sunrise roofing co", count: 12, dollars: null, kind: "fact", fix: "Call the leads at Blue Door Realty first." }] },
    "Acme", names, new Date("2026-10-31T10:00:00Z"));
  const text = JSON.stringify(p).toLowerCase();
  for (const n of names) assert.ok(!text.includes(n.toLowerCase()), n);
  assert.equal(scrub("Call Blue Door Realty", names), "Call an account");
  assert.match(p.findings[0].fix ?? "", /Call the leads at an account first/);
});
