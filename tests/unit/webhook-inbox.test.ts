import { beforeEach, describe, expect, it, vi } from "vitest";

// Routing of the platform webhook: high-volume events are queued with ONE statement and answered at once; install, uninstall and plan events (and everything when the
// webhook_inbox switch is off) are handled in the request as before; a failed queue write is a 5xx so the platform retries. No database: sql() and the handler are replaced.
const h = vi.hoisted(() => ({ calls: [] as string[], failInsert: false, seen: new Set<string>(), inboxOn: true, handle: vi.fn(async (..._a: unknown[]) => ({ ok: true })) }));
const { calls, seen, handle } = h;

vi.mock("@/lib/db", () => {
  const tag = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const q = strings.join("?");
    calls.push(q.replace(/\s+/g, " ").trim());
    if (/insert into webhook_inbox/.test(q)) {
      if (h.failInsert) return Promise.reject(new Error("pool exhausted"));
      const id = String(vals[0]);
      const fresh = !seen.has(id);
      seen.add(id);
      return Promise.resolve(fresh ? [{}] : []);
    }
    if (/insert into webhook_events/.test(q)) return Promise.resolve([{ webhook_id: vals[0] }]);
    return Promise.resolve([]);
  };
  tag.json = (v: unknown) => v;
  return { sql: () => tag };
});
vi.mock("@/lib/flags", () => ({ featureOn: async () => h.inboxOn }));
vi.mock("@/lib/ghl/webhook", async (orig) => ({ ...(await orig<typeof import("@/lib/ghl/webhook")>()), verifyWebhook: () => true }));
vi.mock("@/lib/ghl/webhook-process", async (orig) => ({ ...(await orig<typeof import("@/lib/ghl/webhook-process")>()), handleWebhook: h.handle }));

import { POST } from "@/app/api/webhooks/ghl/route";
import { isQueuedType } from "@/lib/ghl/webhook-process";
import { deleteIdOf } from "@/lib/ghl/webhook-inbox";

const post = (body: unknown) => POST(new Request("http://localhost/api/webhooks/ghl", { method: "POST", headers: { "x-ghl-signature": "x" }, body: JSON.stringify(body) }));

beforeEach(() => { calls.length = 0; seen.clear(); handle.mockClear(); h.failInsert = false; h.inboxOn = true; });

describe("which events are queued", () => {
  it("queues the high-volume families and nothing else", () => {
    for (const t of ["ContactCreate", "ContactUpdate", "ContactDelete", "ContactTagUpdate", "ContactDndUpdate", "OpportunityCreate", "OpportunityDelete", "OpportunityStageUpdate", "NoteCreate", "NoteUpdate", "NoteDelete",
      "ConversationUnreadUpdate", "ConversationUnreadWebhook", "ConversationUpdate", "InboundMessage", "OutboundMessage", "AppointmentCreate", "AppointmentUpdate", "AppointmentDelete"]) {
      expect(isQueuedType(t), t).toBe(true);
    }
    for (const t of ["AppInstall", "AppUninstall", "INSTALL", "UNINSTALL", "UPDATE", "PlanChange", "LocationUpdate", "ProductCreate", null, ""]) expect(isQueuedType(t), String(t)).toBe(false);
  });
  it("reads the id a delete names the same way the one-at-a-time handler does", () => {
    expect(deleteIdOf("ContactDelete", { id: "c1" })).toBe("c1");
    expect(deleteIdOf("ContactDelete", { data: { contactId: "c2" } })).toBe("c2");
    expect(deleteIdOf("OpportunityDelete", { data: { id: "o1" } })).toBe("o1");
    expect(deleteIdOf("ContactUpdate", { id: "c1" })).toBeNull();
  });
});

describe("the webhook route with the inbox on", () => {
  it("answers a contact delete with exactly one statement and does not handle it in the request", async () => {
    const res = await post({ type: "ContactDelete", id: "c1", locationId: "L1", webhookId: "w1" });
    expect(res.status).toBe(200);
    expect((await res.json()).queued).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/insert into webhook_inbox .* on conflict \(webhook_id\) do nothing/);
    expect(handle).not.toHaveBeenCalled();
  });
  it("the same webhook twice is accepted twice and stored once (the platform retries)", async () => {
    const a = await post({ type: "OpportunityDelete", id: "o1", locationId: "L1", webhookId: "w2" });
    const b = await post({ type: "OpportunityDelete", id: "o1", locationId: "L1", webhookId: "w2" });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(seen.size).toBe(1);
  });
  it("a failed queue write is a 5xx, so the platform retries and the event is never lost", async () => {
    h.failInsert = true;
    const res = await post({ type: "InboundMessage", contactId: "c1", locationId: "L1", webhookId: "w3" });
    expect(res.status).toBe(500);
    expect(handle).not.toHaveBeenCalled();
  });
  it("install, uninstall and plan changes are still handled in the request", async () => {
    for (const [type, id] of [["INSTALL", "w4"], ["UNINSTALL", "w5"], ["PlanChange", "w6"]]) {
      const res = await post({ type, webhookId: id, companyId: "co" });
      expect(res.status).toBe(200);
    }
    expect(handle).toHaveBeenCalledTimes(3);
    expect(calls.some((c) => /webhook_inbox/.test(c))).toBe(false);
  });
  it("an event with no id cannot be de-duplicated, so it takes the old path", async () => {
    const res = await post({ type: "ContactUpdate", contactId: "c1", locationId: "L1" });
    expect(res.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
  });
  it("a signed event for another app is ignored before anything is stored", async () => {
    process.env.GHL_APP_ID = "ours";
    const res = await post({ type: "ContactUpdate", id: "c1", locationId: "L1", webhookId: "w7", appId: "theirs" });
    delete process.env.GHL_APP_ID;
    expect((await res.json()).ignored).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("the webhook route with the inbox switched off", () => {
  it("keeps today's path: de-duplication mark, then the handler, in the request", async () => {
    h.inboxOn = false;
    const res = await post({ type: "ContactDelete", id: "c1", locationId: "L1", webhookId: "w8" });
    expect(res.status).toBe(200);
    expect(calls.some((c) => /insert into webhook_inbox/.test(c))).toBe(false);
    expect(calls.some((c) => /insert into webhook_events/.test(c))).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });
  it("a handler failure lifts the duplicate mark and answers 500", async () => {
    h.inboxOn = false;
    handle.mockRejectedValueOnce(new Error("boom"));
    const res = await post({ type: "ContactUpdate", id: "c1", locationId: "L1", webhookId: "w9" });
    expect(res.status).toBe(500);
    expect(calls.some((c) => /delete from webhook_events/.test(c))).toBe(true);
  });
});
