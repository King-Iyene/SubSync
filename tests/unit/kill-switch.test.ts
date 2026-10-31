import { afterEach, describe, expect, it, vi } from "vitest";

// With APP_MODE=maintenance these paths must answer without touching the database: the database import is
// replaced by a version that fails the test if anything uses it.
vi.mock("@/lib/db", () => ({
  sql: () => { throw new Error("The database must not be used during maintenance"); },
  closeDb: async () => undefined,
}));

afterEach(() => { vi.unstubAllEnvs(); });

describe("APP_MODE=maintenance", () => {
  it("the sign-in route answers 503 with a maintenance flag, before any other work", async () => {
    vi.stubEnv("APP_MODE", "maintenance");
    const { POST } = await import("@/app/api/sso/route");
    const res = await POST(new Request("http://x.test/api/sso", { method: "POST", body: JSON.stringify({ payload: "x" }) }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ maintenance: true });
  });

  it("the sync cron skips everything", async () => {
    vi.stubEnv("APP_MODE", "maintenance");
    vi.stubEnv("CRON_SECRET", "s");
    const { GET } = await import("@/app/api/cron/sync/route");
    const res = await GET(new Request("http://x.test/api/cron/sync", { headers: { authorization: "Bearer s" } }));
    expect(await res.json()).toMatchObject({ skipped: "maintenance" });
  });

  it("the daily and weekly crons skip too", async () => {
    vi.stubEnv("APP_MODE", "maintenance");
    vi.stubEnv("CRON_SECRET", "s");
    const h = { headers: { authorization: "Bearer s" } };
    const daily = await import("@/app/api/cron/daily/route");
    const weekly = await import("@/app/api/cron/weekly/route");
    expect(await (await daily.GET(new Request("http://x.test/a", h))).json()).toMatchObject({ skipped: "maintenance" });
    expect(await (await weekly.GET(new Request("http://x.test/a", h))).json()).toMatchObject({ skipped: "maintenance" });
  });

  it("queuing a job does nothing, and the worker runs nothing", async () => {
    vi.stubEnv("APP_MODE", "maintenance");
    const engine = await import("@/lib/sync/engine");
    expect(await engine.enqueueJobs("i", ["L"], ["contacts"])).toBe(0);
    expect(await engine.runSlice(1000)).toEqual({ jobs: 0, failed: 0, moreWork: false });
  });

  it("the data API refuses with 503 and a maintenance flag", async () => {
    vi.stubEnv("APP_MODE", "maintenance");
    const { authenticate } = await import("@/lib/api/auth");
    const res = await authenticate(new Request("http://x.test/api/app/overview", { headers: { authorization: "Bearer x" } }), ["overview"]);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(503);
    expect(await (res as Response).json()).toMatchObject({ maintenance: true });
  });
});
