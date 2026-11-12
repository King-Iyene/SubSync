import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { cachedRead, cachedSwr, forgetAllReads, SHARED_RUN_MAX_MS } from "@/lib/read-cache";
import { MAX_RETRIES, retryView } from "@/lib/design/slow-retry";

beforeAll(() => { process.env.READ_CACHE = "on"; });

describe("read cache (round 5)", () => {
  it("a load that hangs does not trap the next caller", async () => {
    forgetAllReads();
    let t = 0;
    const never = new Promise<number>(() => undefined);
    void cachedSwr("s", "hang", () => never, { now: () => t });
    t = SHARED_RUN_MAX_MS + 1;
    await expect(cachedSwr("s", "hang", async () => 7, { now: () => t })).resolves.toBe(7);
  });
  it("shares a young run and serves a stale answer at once while refreshing", async () => {
    forgetAllReads();
    let t = 0, calls = 0;
    const load = async () => ++calls;
    const [a, b] = await Promise.all([cachedSwr("s", "k", load, { now: () => t }), cachedSwr("s", "k", load, { now: () => t })]);
    expect([a, b, calls]).toEqual([1, 1, 1]);
    t = 20_000; // older than fresh (15 s), younger than stale (90 s)
    expect(await cachedSwr("s", "k", load, { now: () => t })).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    t = 21_000;
    expect(await cachedSwr("s", "k", load, { now: () => t })).toBe(2); // the background refresh landed
  });
  it("forgetting a scope drops the held answer; a failed load is never kept", async () => {
    forgetAllReads();
    let calls = 0;
    await cachedSwr("inst", "k", async () => ++calls);
    forgetAllReads();
    await cachedSwr("inst", "k", async () => ++calls);
    expect(calls).toBe(2);
    await expect(cachedSwr("inst", "bad", async () => { throw new Error("x"); })).rejects.toThrow("x");
    await expect(cachedSwr("inst", "bad", async () => 5)).resolves.toBe(5);
  });
  it("cachedRead also stops sharing a run that has hung", async () => {
    forgetAllReads();
    const realNow = Date.now; let offset = 0;
    Date.now = () => realNow() + offset;
    try {
      void cachedRead("s", "h", () => new Promise<number>(() => undefined));
      offset = SHARED_RUN_MAX_MS + 1;
      await expect(cachedRead("s", "h", async () => 3)).resolves.toBe(3);
    } finally { Date.now = realNow; }
  });
});

describe("Try again (round 5)", () => {
  it("asks, shows progress, then stops after the cap with a clear message", () => {
    expect(retryView(0, false)).toMatchObject({ kind: "ask", button: "Try again" });
    expect(retryView(1, true)).toMatchObject({ kind: "progress", button: null });
    expect(retryView(1, false).kind).toBe("ask");
    const last = retryView(MAX_RETRIES, false);
    expect(last).toMatchObject({ kind: "giveup", button: null });
    expect(last.body).toMatch(/Nothing was lost/);
  });
  it("reload always sends a fresh request and the screen only trusts the newest one", () => {
    const s = readFileSync("src/app/app/session.tsx", "utf8");
    expect(s).toMatch(/get: <T>\(path: string, opts\?: \{ fresh\?: boolean \}\)/);
    expect(s).toMatch(/const load = useCallback\(\(\) => run\(true\), \[run\]\)/);
    expect(s).toMatch(/mine === seq\.current/);
  });
  it("both slow blocks use the same retry component", () => {
    expect(readFileSync("src/app/app/views/today.tsx", "utf8")).toMatch(/<SlowRetry compact reload=\{today\.reload\}/);
    expect(readFileSync("src/app/app/views/td3/module.tsx", "utf8")).toMatch(/<SlowRetry reload=\{r\.reload\}/);
  });
});

describe("booking funnel clicks and links (round 5)", () => {
  const ladder = readFileSync("src/app/app/views/bf/bf-ladder.tsx", "utf8");
  it("steps, basins and ribbons each open their leads; dots never take a click", () => {
    expect(ladder).toMatch(/bf-ribbon/);
    expect(ladder).toMatch(/\$\{testId\}-step-/);
    expect(ladder).toMatch(/\$\{testId\}-basin-/);
    expect(readFileSync("src/app/app/views/bf/bf.css", "utf8")).toMatch(/\.bf-dot \{ fill: var\(--foreground\); pointer-events: none; \}/);
  });
  it("the Today mini funnel passes a pick handler (it used to show a pointer and do nothing)", () => {
    expect(readFileSync("src/app/app/views/bf/bf-mini.tsx", "utf8")).toMatch(/onPick=\{pick\}/);
  });
  it("action links share one pill look", () => {
    const css = readFileSync("src/app/app/ds/pill-link.css", "utf8");
    expect(css).toMatch(/border-radius: 999px/);
    expect(css).toMatch(/\.bf-link/);
    expect(css).toMatch(/\.apx-formula summary/);
    expect(readFileSync("src/app/app/ds/index.ts", "utf8")).toMatch(/pill-link\.css/);
  });
});
