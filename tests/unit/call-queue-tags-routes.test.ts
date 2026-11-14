import { beforeEach, describe, expect, it, vi } from "vitest";

// Two companies, several accounts each. The database layer is replaced by an in-memory fixture that behaves like the real one (every row is keyed by installation AND account), so these
// tests prove what the ROUTE does with the session: it only ever passes the session's own installation, and an account id from another company is "not found".
const A = "inst-A", B = "inst-B";
const accounts: Record<string, string[]> = { [A]: ["locA1", "locA2"], [B]: ["locB1"] };
const tagRows = new Map<string, Record<string, string>>();
const writes: string[] = [];

vi.mock("../../src/lib/api/tenant-guard", () => ({
  ownedLocation: async (inst: string, allowed: string[] | null, v: unknown) => (typeof v === "string" && (!allowed || allowed.includes(v)) && accounts[inst]?.includes(v) ? v : null),
}));
vi.mock("../../src/lib/call-queue-tags/store", async () => {
  const tags = await import("../../src/lib/call-queue-tags/tags");
  return {
    getQueueTags: async (inst: string, loc: string) => tags.resolveTags(tagRows.get(`${inst}:${loc}`)),
    saveQueueTags: async (inst: string, loc: string, wanted: Record<string, string>) => { writes.push(`${inst}:${loc}`); tagRows.set(`${inst}:${loc}`, { ...(tagRows.get(`${inst}:${loc}`) ?? {}), ...wanted }); return { ok: true, tags: tags.resolveTags(tagRows.get(`${inst}:${loc}`)) }; },
    cachedChecks: async () => [], companySnapshotOn: async () => true, setCompanySnapshot: async () => true,
  };
});
vi.mock("../../src/lib/call-queue-tags/run", () => ({ runCheck: async () => ({ state: "ok", lines: [], summary: "Everything is in place." }) }));
vi.mock("../../src/lib/db", () => ({ sql: () => { const f = (() => []) as unknown as Record<string, unknown>; return new Proxy(f, { apply: () => [] }); } }));

import { handleCqt } from "../../src/lib/api/cqt-routes";

type Kind = "agency" | "business" | "client";
function ctx(kind: Kind, inst: string, over: Record<string, unknown> = {}, method = "GET", path = "tags", query = "", body?: unknown) {
  const limitTo = kind === "agency" ? null : accounts[inst][0];
  const personRole = kind === "agency" ? "agency_owner" : kind === "business" ? "account_admin" : "account_user";
  return {
    session: { personRole, userId: "u1", userName: "Pat" }, installationId: inst, plan: "pro", demo: false, kind, limitTo, entitlements: { features: { cq_snapshot: true } },
    request: new Request(`http://x/api/app/cqt/${path}${query}`, { method, body: body ? JSON.stringify(body) : undefined }), url: new URL(`http://x/api/app/cqt/${path}${query}`), segments: ["cqt", path], ...over,
  } as never;
}
const allowedFor = (c: { kind: Kind; installationId: string; limitTo: string | null }) => async () => (c.limitTo ? [c.limitTo] : null);
const call = (c: ReturnType<typeof ctx>) => handleCqt(c, { allowed: allowedFor(c as never) });

beforeEach(() => { tagRows.clear(); writes.length = 0; process.env.SNAPSHOT_SHARE_URL = "https://example.test/setup-link"; });

describe("cross-tenant", () => {
  it("company A cannot read company B's account tags", async () => {
    const r = await call(ctx("agency", A, {}, "GET", "tags", "?locationId=locB1"));
    expect(r.status).toBe(404);
  });
  it("company A cannot write company B's account tags, and nothing is written", async () => {
    const r = await call(ctx("agency", A, {}, "PUT", "tags", "", { locationId: "locB1", tags: { call_now: "stolen" } }));
    expect(r.status).toBe(404);
    expect(writes).toEqual([]);
    expect(tagRows.size).toBe(0);
  });
  it("company A cannot run the check on company B's account", async () => {
    expect((await call(ctx("agency", A, {}, "POST", "check", "", { locationId: "locB1" }))).status).toBe(404);
  });
  it("the account list holds only the caller's own accounts", async () => {
    // accounts come from allowed(); an account session is limited to its one account
    const r = await call(ctx("business", B, {}, "GET", "tags", "?locationId=locA1"));
    expect(r.status).toBe(404);
  });
  it("a business session cannot open another account of its own company", async () => {
    expect((await call(ctx("business", A, {}, "GET", "tags", "?locationId=locA2"))).status).toBe(404);
  });
  it("one company's saved tag is invisible to the other", async () => {
    await call(ctx("agency", A, {}, "PUT", "tags", "", { locationId: "locA1", tags: { call_now: "a-only" } }));
    const mine = await (await call(ctx("agency", A, {}, "GET", "tags", "?locationId=locA1"))).json();
    expect(mine.tags.call_now).toBe("a-only");
    const theirs = await (await call(ctx("agency", B, {}, "GET", "tags", "?locationId=locB1"))).json();
    expect(theirs.tags.call_now).toBe("call-now");
  });
});

describe("who sees the one-click card and the address", () => {
  it("an agency session sees the tag settings and the card (no address in the tags answer)", async () => {
    const j = await (await call(ctx("agency", A, {}, "GET", "tags", "?locationId=locA1"))).json();
    expect(j.queues).toHaveLength(4);
    expect(j.snapshot.show).toBe(true);
    expect(JSON.stringify(j)).not.toContain("example.test");
  });
  it("an agency session can fetch the address", async () => {
    const r = await call(ctx("agency", A, {}, "GET", "snapshot"));
    expect(r.status).toBe(200);
    expect((await r.json()).url).toBe("https://example.test/setup-link");
  });
  for (const kind of ["business", "client"] as const) {
    it(`an account session (${kind}) sees the tag settings but not the card, and the address route says not found`, async () => {
      const j = await (await call(ctx(kind, A, {}, "GET", "tags", "?locationId=locA1"))).json();
      expect(j.queues).toHaveLength(4);
      expect(j.snapshot).toEqual({ show: false });
      expect(JSON.stringify(j)).not.toContain("example.test");
      const r = await call(ctx(kind, A, {}, "GET", "snapshot"));
      expect(r.status).toBe(404);
      expect(await r.text()).not.toContain("example.test");
    });
  }
  it("the card and the address disappear when the flag is off or the address is not set", async () => {
    const off = await (await call(ctx("agency", A, { entitlements: { features: { cq_snapshot: false } } }, "GET", "tags", "?locationId=locA1"))).json();
    expect(off.snapshot.show).toBe(false);
    expect((await call(ctx("agency", A, { entitlements: { features: { cq_snapshot: false } } }, "GET", "snapshot"))).status).toBe(404);
    delete process.env.SNAPSHOT_SHARE_URL;
    expect((await call(ctx("agency", A, {}, "GET", "snapshot"))).status).toBe(404);
  });
  it("only the platform owner can switch a company's card on", async () => {
    expect((await call(ctx("agency", A, {}, "PUT", "switch", "", { on: true }))).status).toBe(404);
  });
});

describe("who can change tags", () => {
  it("an account administrator can; a client's staff cannot", async () => {
    expect((await call(ctx("business", A, {}, "PUT", "tags", "", { locationId: "locA1", tags: { no_show: "missed" } }))).status).toBe(200);
    expect((await call(ctx("client", A, {}, "PUT", "tags", "", { locationId: "locA1", tags: { no_show: "x" } }))).status).toBe(403);
  });
});
