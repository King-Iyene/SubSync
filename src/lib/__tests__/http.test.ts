import assert from "node:assert/strict";
import { test } from "node:test";
import { ghlFetch, readRateLimit } from "../ghl/http.ts";

function scripted(responses: Response[]) {
  const calls: number[] = [];
  const fetchImpl = (async () => {
    calls.push(1);
    const next = responses.shift();
    if (!next) throw new Error("no more scripted responses");
    return next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

test("returns immediately on success", async () => {
  const { fetchImpl, calls } = scripted([res(200)]);
  const response = await ghlFetch("https://x", {}, { fetchImpl, sleep: async () => {} });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test("retries 429 and honours Retry-After", async () => {
  const { fetchImpl, calls } = scripted([res(429, { "Retry-After": "2" }), res(200)]);
  const delays: number[] = [];
  const response = await ghlFetch("https://x", {}, {
    fetchImpl,
    sleep: async (ms) => void delays.push(ms),
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [2000]);
});

test("backs off exponentially on 5xx when there is no Retry-After", async () => {
  const { fetchImpl } = scripted([res(503), res(502), res(200)]);
  const delays: number[] = [];
  await ghlFetch("https://x", {}, {
    fetchImpl,
    sleep: async (ms) => void delays.push(ms),
    random: () => 0,
    baseDelayMs: 100,
  });
  assert.deepEqual(delays, [100, 200]);
});

test("gives up after maxRetries and returns the last response", async () => {
  const { fetchImpl, calls } = scripted([res(429), res(429), res(429)]);
  const response = await ghlFetch("https://x", {}, {
    fetchImpl,
    sleep: async () => {},
    maxRetries: 2,
  });
  assert.equal(response.status, 429);
  assert.equal(calls.length, 3);
});

test("does not retry client errors", async () => {
  const { fetchImpl, calls } = scripted([res(401)]);
  const response = await ghlFetch("https://x", {}, { fetchImpl, sleep: async () => {} });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
});

test("reads the rate limit headers", () => {
  const info = readRateLimit(
    new Headers({
      "X-RateLimit-Daily-Remaining": "199000",
      "X-RateLimit-Remaining": "12",
      "X-RateLimit-Interval-Milliseconds": "10000",
    }),
  );
  assert.deepEqual(info, { dailyRemaining: 199000, burstRemaining: 12, burstIntervalMs: 10000 });
  assert.deepEqual(readRateLimit(new Headers()), {
    dailyRemaining: null,
    burstRemaining: null,
    burstIntervalMs: null,
  });
});
