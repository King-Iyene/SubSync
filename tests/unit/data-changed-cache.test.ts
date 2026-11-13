import { beforeAll, describe, expect, it } from "vitest";
import { answerKey, cachedAnswer, cachedRead, forgetAnswers, forgetScope } from "@/lib/read-cache";

beforeAll(() => { process.env.READ_CACHE = "on"; });

// markDataChanged (sync/data-version.ts) drops exactly these two caches for the install; this proves the next read after a change is built from fresh rows, and another install is untouched.
describe("data changed: read-cache invalidation", () => {
  it("after a change, the held reads of that install are rebuilt; other installs keep theirs", async () => {
    let a = 0, b = 0;
    expect(await cachedRead("inst-A", "accounts", async () => ++a)).toBe(1);
    expect(await cachedRead("inst-A", "accounts", async () => ++a)).toBe(1);
    expect(await cachedRead("inst-B", "accounts", async () => ++b)).toBe(1);
    forgetScope("inst-A");
    expect(await cachedRead("inst-A", "accounts", async () => ++a)).toBe(2);
    expect(await cachedRead("inst-B", "accounts", async () => ++b)).toBe(1);
  });
  it("after a change, a stored heavy answer of that install is rebuilt", async () => {
    let n = 0;
    const key = answerKey("inst-C", "agency:", "speed?part=list");
    const make = async () => ({ status: 200, body: JSON.stringify({ rows: ++n }) });
    expect(JSON.parse((await cachedAnswer(key, make)).body).rows).toBe(1);
    expect(JSON.parse((await cachedAnswer(key, make)).body).rows).toBe(1);
    forgetAnswers("inst-C");
    expect(JSON.parse((await cachedAnswer(key, make)).body).rows).toBe(2);
  });
});
