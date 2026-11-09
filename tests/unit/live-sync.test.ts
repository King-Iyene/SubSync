import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptSecret } from "@/lib/crypto";
import { closeDb, sql } from "@/lib/db";
import { diffTagEvents } from "@/lib/sync/tag-events";
import { ForeignContact, liveRead, type LiveSource } from "@/lib/live/live-read";
import { pollPlan, IDLE_STOP_MS, MAX_BACKOFF_MS, POLL_MS } from "@/lib/live/poll";
import { deltaDue, runDelta } from "@/lib/live/delta";
import { cacheContacts } from "@/lib/live/live-cache";
import { applyLiveWebhook } from "@/lib/live/webhook-apply";
import type { ContactRow } from "@/lib/sync/ghl-data";

// Live sync. The CRM is always a stub here: nothing in this file can reach a real account. The database part uses two fixture companies (removed afterwards; no refresh token, so the scheduler ignores them).
const contact = (id: string, tags: string[], over: Partial<ContactRow> = {}): ContactRow => ({ contactId: id, firstName: "A", lastName: "B", email: null, phone: null, tags, dateAdded: null, lastActivityAt: null, updatedAt: null, source: null, dnd: false, birthDate: null, assignedTo: null, ...over });
const stub = (locationId: string | null, over: Partial<LiveSource> = {}): LiveSource => ({
  contact: async (id) => ({ locationId, contact: contact(id, ["hot"]) }), conversation: async () => null, calls: async () => [], notes: async () => [], tasks: async () => [], appointments: async () => [], deals: async () => [], ...over,
});

describe("diff to tag events", () => {
  it("a tag added and a tag removed, and nothing for an unchanged contact", () => {
    const known = new Map([["c1", ["a", "b"]], ["c2", ["x"]]]);
    const ev = diffTagEvents([{ contactId: "c1", tags: ["a", "c"] }, { contactId: "c2", tags: ["x"] }], known, true);
    expect(ev).toEqual([{ contactId: "c1", tag: "c", kind: "added" }, { contactId: "c1", tag: "b", kind: "removed" }]);
  });
});

describe("poll schedule and backoff", () => {
  it("polls every 5 s, a full read every 6th, pauses when hidden, stops after 10 idle minutes, backs off up to a minute", () => {
    expect(pollPlan({ failures: 0, hidden: false, idleMs: 0, polls: 1 })).toEqual({ action: "poll", delayMs: POLL_MS, full: false });
    expect(pollPlan({ failures: 0, hidden: false, idleMs: 0, polls: 6 }).full).toBe(true);
    expect(pollPlan({ failures: 0, hidden: true, idleMs: 0, polls: 1 }).action).toBe("pause");
    expect(pollPlan({ failures: 0, hidden: false, idleMs: IDLE_STOP_MS, polls: 1 }).action).toBe("stop");
    expect(pollPlan({ failures: 2, hidden: false, idleMs: 0, polls: 1 }).delayMs).toBe(POLL_MS * 4);
    expect(pollPlan({ failures: 30, hidden: false, idleMs: 0, polls: 1 }).delayMs).toBe(MAX_BACKOFF_MS);
  });
  it("the delta runs at most once per 45 s per account", () => {
    expect(deltaDue("t:1", 1000)).toBe(true);
    expect(deltaDue("t:1", 20_000)).toBe(false);
    expect(deltaDue("t:1", 50_000)).toBe(true);
  });
});

describe("live read refuses another account's person", () => {
  it("a contact that belongs to another location is refused, one that is missing is refused, and an own one is read", async () => {
    await expect(liveRead(stub("locOTHER"), "locMine", "c1", false)).rejects.toBeInstanceOf(ForeignContact);
    await expect(liveRead(stub(null, { contact: async () => null }), "locMine", "c1", false)).rejects.toBeInstanceOf(ForeignContact);
    const ok = await liveRead(stub("locMine"), "locMine", "c1", true);
    expect(ok.contact.tags).toEqual(["hot"]);
  });
  it("a part the CRM will not give is reported as missing, not as an error", async () => {
    const r = await liveRead(stub("locMine", { conversation: async () => ({ conversationId: "v1", contactId: "c1", contactName: null, lastMessageType: null, lastMessageDirection: null, lastMessageAt: null, unreadCount: 0, assignedTo: null }), calls: async () => { throw new Error("403"); }, notes: async () => { throw new Error("403"); } }), "locMine", "c1", true);
    expect(r.missing.sort()).toEqual(["calls", "notes"]);
  });
});

const HAS_DB = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_PASSWORD);
describe.skipIf(!HAS_DB)("write-through, webhook apply and delta on fixture companies", () => {
  const CO_A = "xtest-live-a", CO_B = "xtest-live-b", LA = "xtestLiveLocA", LB = "xtestLiveLocB";
  let a = "", b = "";
  const mk = async (company: string, loc: string) => {
    await sql()`delete from installations where company_id = ${company}`;
    const [i] = await sql()`insert into installations (company_id, company_name, plan, access_token_enc, token_expires_at) values (${company}, ${"zz" + company}, 'pro', ${encryptSecret("x")}, now() + interval '1 hour') returning id`;
    await sql()`insert into locations (installation_id, location_id, name, timezone, ignored) values (${i.id}, ${loc}, ${"Live " + loc}, 'UTC', false)`;
    return i.id as string;
  };
  beforeAll(async () => { a = await mk(CO_A, LA); b = await mk(CO_B, LB); });
  afterAll(async () => { await sql()`delete from installations where company_id in (${CO_A}, ${CO_B})`; await closeDb(); });

  it("a tag change seen live is recorded once with the real time, and a second identical read adds nothing", async () => {
    await cacheContacts(a, LA, [contact("cLive1", ["old"])]);
    expect(await cacheContacts(a, LA, [contact("cLive1", ["old", "new"])])).toBe(1);
    expect(await cacheContacts(a, LA, [contact("cLive1", ["old", "new"])])).toBe(0);
    const ev = await sql()`select tag, kind, at from contact_tag_events where installation_id = ${a} and contact_id = 'cLive1'`;
    expect(ev.map((e) => `${e.tag}:${e.kind}`)).toEqual(["new:added"]);
    expect(Math.abs(Date.now() - new Date(ev[0].at as string).getTime())).toBeLessThan(60_000);
  });
  it("a new contact seen first records no tag events", async () => {
    expect(await cacheContacts(a, LA, [contact("cLive2", ["x", "y"])])).toBe(0);
  });
  it("a webhook for an account that is not this installation's changes nothing, and a delete removes only the own row", async () => {
    await cacheContacts(b, LB, [contact("cLive3", ["k"])]);
    const deps = { token: async () => { throw new Error("no real call in a test"); } };
    expect((await applyLiveWebhook({ installationId: a, locationId: LB, type: "ContactDelete", body: { id: "cLive3" } }, deps)).skipResync).toBe(false);
    expect((await sql()`select 1 from cached_contacts where installation_id = ${b} and contact_id = 'cLive3'`).length).toBe(1);
    expect((await applyLiveWebhook({ installationId: b, locationId: LB, type: "ContactDelete", body: { id: "cLive3" } }, deps)).skipResync).toBe(true);
    expect((await sql()`select 1 from cached_contacts where installation_id = ${b} and contact_id = 'cLive3'`).length).toBe(0);
  });
  it("an opportunity event is stored at once and idempotently", async () => {
    const deps = { token: async () => "t" };
    const body = { id: "opLive1", pipelineId: "p1", pipelineStageId: "s2", status: "open", monetaryValue: 500, contactId: "cLive1", name: "Deal" };
    await applyLiveWebhook({ installationId: a, locationId: LA, type: "OpportunityStageUpdate", body }, deps);
    await applyLiveWebhook({ installationId: a, locationId: LA, type: "OpportunityStageUpdate", body }, deps);
    const rows = await sql()`select stage_id from cached_opportunities where installation_id = ${a} and opportunity_id = 'opLive1'`;
    expect(rows.map((r) => r.stage_id)).toEqual(["s2"]);
  });
  it("the delta stores the newest contacts and conversations from a stubbed CRM", async () => {
    const r = await runDelta(a, LA, { contacts: async () => [contact("cLive4", ["d"])], conversations: async () => [{ conversationId: "vLive4", contactId: "cLive4", contactName: "A B", lastMessageType: "TYPE_SMS", lastMessageDirection: "inbound", lastMessageAt: new Date().toISOString(), unreadCount: 1, assignedTo: null }] });
    expect(r).toEqual({ contacts: 1, conversations: 1 });
    expect((await sql()`select conversation_id from cached_conversations where installation_id = ${a} and contact_id = 'cLive4'`).length).toBe(1);
  });
});
