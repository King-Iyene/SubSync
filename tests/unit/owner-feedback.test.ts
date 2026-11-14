import { beforeEach, describe, expect, it, vi } from "vitest";

// The owner-only Feedback inbox routes, with the database replaced by a recorder: a non-owner gets 404 and nothing is read or changed; the owner can read, change a status and change the alert settings.
const calls: string[] = [];
vi.mock("@/lib/db", () => ({ sql: () => { throw new Error("no database in this test"); }, closeDb: async () => undefined }));
vi.mock("@/lib/feedback-owner-queries", () => ({
  inbox: async () => { calls.push("inbox"); return { items: [], total: 0, newCount: 2, hasMore: false }; },
  lastAlertRecords: async () => [], voteCounts: async () => [], newCount: async () => { calls.push("count"); return 3; },
  ownerSettings: async () => ({ digestOn: null, instantLevel: "stuck" }),
  parseInboxFilters: () => ({ kind: null, severity: null, status: null, q: null, page: 0 }),
  saveOwnerSettings: async (v: unknown) => { calls.push(`settings:${JSON.stringify(v)}`); return { digestOn: true, instantLevel: "stuck" }; },
  setStatus: async (k: string, id: string, s: string) => { calls.push(`status:${k}:${id}:${s}`); return true; },
}));

const owner = { companyId: "co_king", userId: "u1", role: "admin", userName: "King", demo: false, kind: "agency", platformOwner: true, exp: 9e9 };
const ctxOf = (session: Record<string, unknown>) => ({ session, installationId: "i1", plan: "pro", demo: false, entitlements: {}, kind: (session.kind as string) ?? "agency", limitTo: null }) as never;
const req = (method: string, path: string, body?: unknown) => new Request(`https://x.test/api/app/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const ID = "123e4567-e89b-12d3-a456-426614174000";

beforeEach(() => { calls.length = 0; });

describe("owner feedback routes", async () => {
  const { handleOwnerFeedback } = await import("@/lib/api/owner-feedback");

  const NOT_OWNERS: Array<[string, Record<string, unknown>]> = [
    ["an agency user who is not the owner", { ...owner, platformOwner: false }],
    ["a session with no owner flag", { ...owner, platformOwner: undefined }],
    ["a business session, even with the flag", { ...owner, kind: "business", locationId: "L1" }],
    ["a client session, even with the flag", { ...owner, kind: "client", locationId: "L1" }],
    ["the demo", { ...owner, demo: true }],
  ];

  for (const [label, session] of NOT_OWNERS) {
    it(`answers 404 and touches nothing for ${label}`, async () => {
      for (const [m, p, b] of [["GET", "owner/feedback"], ["GET", "owner/feedback/count"], ["POST", "owner/feedback/status", { itemKind: "feedback", id: ID, status: "done" }], ["POST", "owner/feedback/settings", { digestOn: true }]] as Array<[string, string, unknown?]>) {
        const res = await handleOwnerFeedback(ctxOf(session), req(m, p, b), p.split("/"));
        expect(res.status, `${m} ${p}`).toBe(404);
      }
      expect(calls).toEqual([]);
    });
  }

  it("lets the owner read the inbox and the count", async () => {
    const res = await handleOwnerFeedback(ctxOf(owner), req("GET", "owner/feedback"), ["owner", "feedback"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.newCount).toBe(2);
    expect(JSON.stringify(body.delivery)).not.toMatch(/@|hooks\.slack/);
    expect((await (await handleOwnerFeedback(ctxOf(owner), req("GET", "owner/feedback/count"), ["owner", "feedback", "count"])).json()).count).toBe(3);
  });

  it("lets the owner change a status (checked) and the alert settings (checked)", async () => {
    const ok = await handleOwnerFeedback(ctxOf(owner), req("POST", "owner/feedback/status", { itemKind: "feedback", id: ID, status: "planned" }), ["owner", "feedback", "status"]);
    expect(ok.status).toBe(200);
    expect(calls).toContain(`status:feedback:${ID}:planned`);
    for (const bad of [{ itemKind: "feedback", id: "not-an-id", status: "done" }, { itemKind: "x", id: ID, status: "done" }, { itemKind: "feedback", id: ID, status: "deleted" }]) {
      expect((await handleOwnerFeedback(ctxOf(owner), req("POST", "owner/feedback/status", bad), ["owner", "feedback", "status"])).status).toBe(400);
    }
    const s = await handleOwnerFeedback(ctxOf(owner), req("POST", "owner/feedback/settings", { digestOn: true, instantLevel: "everything" }), ["owner", "feedback", "settings"]);
    expect(s.status).toBe(200);
    expect(calls.some((c) => c.startsWith("settings:"))).toBe(true);
    expect((await handleOwnerFeedback(ctxOf(owner), req("POST", "owner/feedback/settings", { instantLevel: "loud" }), ["owner", "feedback", "settings"])).status).toBe(400);
  });
});
