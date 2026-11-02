import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCustomerFacing, isInternalComment } from "@/lib/analytics/message-kinds";
import { isHumanTouch, leadFromMessages, mapMessage, type Msg } from "@/lib/analytics/speed-intel";
import { waitingState } from "@/lib/analytics/waiting";
import { mapConversation } from "@/lib/sync/ghl-data";
import { candidateIds, isOurActivity, keepsOlderActivity, OUR_WRITE_LEAD_MS, OUR_WRITE_WINDOW_MS } from "@/lib/connections/echo";
import { connectError, MESSAGE, PENDING_MS, providerCodeOf, shownStatus, STATUS_WORDS } from "@/lib/connections/messages";
import { exchangeSlack, fetchZoomUser, createFathomWebhook } from "@/lib/connections/oauth";
import { refreshLocked, type LockedRow, type RefreshStore, type Stored } from "@/lib/connections/refresh";

// Stage E0 items 4 and 6 and the refresh rule of spec 11.1, all without a database or a network.

const fake = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
const keys = { clientId: "id", clientSecret: "secret" };

describe("pending states run out after 2 minutes (N92)", () => {
  const t0 = Date.parse("2026-11-02T10:00:00Z");
  it("waiting for up to 2 minutes, then expired with Try again", () => {
    expect(PENDING_MS).toBe(120_000);
    expect(shownStatus("pending", t0, t0 + 1_000)).toBe("waiting");
    expect(shownStatus("pending", t0, t0 + 119_999)).toBe("waiting");
    expect(shownStatus("pending", t0, t0 + 120_000)).toBe("expired");
    expect(shownStatus("pending", new Date(t0), t0 + 10 * 60_000)).toBe("expired");
    expect(shownStatus("pending", null, t0)).toBe("expired");
    expect(STATUS_WORDS.expired).toBe("This did not finish. Try again.");
    expect(MESSAGE.pendingExpired).toBe("This did not finish. Try again.");
  });
  it("other stored statuses show as themselves, no row is 'not connected', and an unknown status is an error", () => {
    for (const s of ["connected", "needs_reconnect", "revoked", "error"] as const) expect(shownStatus(s, null)).toBe(s);
    expect(shownStatus(null, null)).toBe("not_connected");
    expect(shownStatus("mystery", null)).toBe("error");
  });
});

describe("plain messages and codes (spec section 12), and the real provider error goes to the log by code only", () => {
  it("Zoom could not say who signed in is Z-IDENT, in the spec's words, and the internal wording is gone", async () => {
    const r = await fetchZoomUser("tok", fake(400, { code: 4711, message: "Invalid access token, does not contain scopes [user:read:user:admin, user:read:user]" }));
    expect(r).toMatchObject({ ok: false, code: "Z-IDENT", providerCode: "4711" });
    expect((r as { error: string }).error).toBe("We could not confirm which Zoom account you used. Try again. If it happens again, send us this code: Z-IDENT.");
    expect(JSON.stringify(r)).not.toMatch(/did not say who|scopes|user:read/);
  });
  it("Slack refusing the return address is S-REDIRECT, in the spec's words, for each of Slack's spellings of that error", async () => {
    for (const code of ["bad_redirect_uri", "redirect_uri_mismatch", "invalid_redirect_uri"]) {
      const r = await exchangeSlack("c", keys, "https://x/cb", fake(200, { ok: false, error: code }));
      expect(r).toMatchObject({ ok: false, code: "S-REDIRECT", providerCode: code });
      expect((r as { error: string }).error).toBe("Slack refused the connection. This is a setup problem on our side, not yours. Contact us and we will fix it within 24 hours. Code: S-REDIRECT.");
    }
    const other = await exchangeSlack("c", keys, "https://x/cb", fake(200, { ok: false, error: "invalid_code" }));
    expect(other).toMatchObject({ ok: false, code: "P-AUTH", providerCode: "invalid_code" });
  });
  it("a failed webhook set-up and an unreachable provider have their own plain messages and codes", async () => {
    const hook = await createFathomWebhook("tok", "https://x/hook", fake(500, {}));
    expect(hook).toMatchObject({ ok: false, code: "F-HOOK" });
    const down = await fetchZoomUser("tok", (async () => { throw new Error("offline"); }) as unknown as typeof fetch);
    expect(down).toMatchObject({ ok: false, code: "P-NET" });
    expect(connectError("P-NET", "Fathom").error).toBe("We could not reach Fathom. Try again in a moment. If it happens again, send us this code: P-NET.");
    expect(MESSAGE.needsPermission).toBe("Needs permission: reconnect.");
    expect(MESSAGE.notAvailable("Zoom")).toBe("Not available from Zoom yet.");
    expect(MESSAGE.noContact).toBe("Nobody in this meeting is in your contacts. It is in your Meeting inbox for 14 days.");
  });
  it("the provider code kept for the log is a short machine code, never free text, an email or a token", () => {
    expect(providerCodeOf(400, { error: "invalid_grant" })).toBe("invalid_grant");
    expect(providerCodeOf(400, { code: 124 })).toBe("124");
    expect(providerCodeOf(500, { error: "Invalid access token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" })).toBe("http_500");
    expect(providerCodeOf(401, { error: "someone@example.com is not allowed" })).toBe("http_401");
    expect(providerCodeOf(502, {})).toBe("http_502");
  });
  it("no message a person can read contains a token, a secret or the provider's own free text", async () => {
    const r = await exchangeSlack("c", keys, "https://x/cb", fake(200, { ok: false, error: "bad_redirect_uri", access_token: "xoxb-SHOULD-NOT-LEAK", detail: "SHOULD-NOT-LEAK" }));
    expect(JSON.stringify(r)).not.toContain("SHOULD-NOT-LEAK");
  });
});

// ---------------- one refresh at a time ----------------

function memLock(initial: Stored) {
  let row: Stored | null = initial;
  let status = "connected";
  let tail: Promise<unknown> = Promise.resolve();
  let holders = 0, maxHolders = 0;
  const store: RefreshStore = {
    // Takes turns, like `select ... for update`: the next caller starts only when the one before has finished.
    withLock: <T,>(_id: string, fn: (r: LockedRow) => Promise<T>): Promise<T> => {
      const run = tail.then(async () => {
        holders++; maxHolders = Math.max(maxHolders, holders);
        try { return await fn({ read: async () => (row && status === "connected" ? { ...row } : null), save: async (n) => { row = { accessToken: n.accessToken, refreshToken: n.refreshToken, expiresAt: n.expiresAt }; status = "connected"; }, markNeedsReconnect: async () => { status = "needs_reconnect"; } }); }
        finally { holders--; }
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
  return { store, get status() { return status; }, get row() { return row; }, get maxHolders() { return maxHolders; } };
}

describe("token refresh: one at a time (spec 11.1 item 6)", () => {
  const NOW = Date.parse("2026-11-02T10:00:00Z");
  it("ten simultaneous callers with an expired token cause exactly ONE refresh, and all ten get the new token", async () => {
    const m = memLock({ accessToken: "old", refreshToken: "r1", expiresAt: NOW - 1000 });
    let calls = 0;
    const refresh = async (rt: string) => { calls++; await new Promise((r) => setTimeout(r, 5)); return rt === "r1" ? { ok: true as const, tokens: { accessToken: "new", refreshToken: "r2", expiresAt: NOW + 3_600_000 } } : { ok: false as const }; };
    const out = await Promise.all(Array.from({ length: 10 }, () => refreshLocked(m.store, "c1", refresh, () => NOW)));
    expect(calls).toBe(1);
    expect(out.every((o) => o.ok && o.accessToken === "new")).toBe(true);
    expect(out.filter((o) => o.ok && o.refreshed)).toHaveLength(1);
    expect(m.maxHolders, "never two inside the lock at once").toBe(1);
    expect(m.row?.refreshToken, "the rotated refresh token was saved").toBe("r2");
  });
  it("a token that is still good is not refreshed at all", async () => {
    const m = memLock({ accessToken: "good", refreshToken: "r1", expiresAt: NOW + 10 * 60_000 });
    let calls = 0;
    const out = await refreshLocked(m.store, "c1", async () => { calls++; return { ok: false }; }, () => NOW);
    expect(out).toEqual({ ok: true, accessToken: "good", refreshed: false });
    expect(calls).toBe(0);
  });
  it("one that expires inside the next minute is refreshed", async () => {
    const m = memLock({ accessToken: "soon", refreshToken: "r1", expiresAt: NOW + 30_000 });
    const out = await refreshLocked(m.store, "c1", async () => ({ ok: true, tokens: { accessToken: "fresh", refreshToken: "r2", expiresAt: NOW + 3_600_000 } }), () => NOW);
    expect(out).toEqual({ ok: true, accessToken: "fresh", refreshed: true });
  });
  it("a refusal marks the connection as needing a reconnect, and the callers waiting behind it do not ask the provider again", async () => {
    const m = memLock({ accessToken: "old", refreshToken: "r1", expiresAt: NOW - 1000 });
    let calls = 0;
    const out = await Promise.all([1, 2, 3].map(() => refreshLocked(m.store, "c1", async () => { calls++; return { ok: false }; }, () => NOW)));
    expect(m.status).toBe("needs_reconnect");
    expect(out.every((o) => !o.ok)).toBe(true);
    expect(calls).toBe(1);
  });
  it("a row with no tokens (revoked, never connected) has nothing to refresh", async () => {
    const empty: RefreshStore = { withLock: (_id, fn) => fn({ read: async () => null, save: async () => undefined, markNeedsReconnect: async () => undefined }) };
    expect(await refreshLocked(empty, "c1", async () => ({ ok: false }))).toEqual({ ok: false, reason: "no_tokens" });
  });
});

// ---------------- our own writes must not change our own numbers ----------------

// The webhook the platform documents for an internal comment: an OutboundMessage whose messageType is InternalComment.
const INTERNAL_COMMENT_MESSAGE = { id: "msg-1", direction: "outbound", messageType: "InternalComment", userId: "U1", source: "app", dateAdded: "2026-11-02T10:05:00.000Z", contactId: "C1" };
const SMS_REPLY = { id: "msg-2", direction: "outbound", messageType: "TYPE_SMS", userId: "U1", source: "app", dateAdded: "2026-11-02T10:30:00.000Z", contactId: "C1" };
const INBOUND = { id: "msg-0", direction: "inbound", messageType: "TYPE_SMS", dateAdded: "2026-11-02T10:00:00.000Z", contactId: "C1" };

describe("internal comments never count as a reply (spec section 10)", () => {
  it("is recognised whichever way the platform spells it", () => {
    for (const t of ["InternalComment", "TYPE_INTERNAL_COMMENT", "internal_comment", "Internal Comment", "internal-comment"]) expect(isInternalComment(t), t).toBe(true);
    for (const t of ["TYPE_SMS", "TYPE_CALL", "TYPE_EMAIL", "", null, undefined]) expect(isInternalComment(t as string | null), String(t)).toBe(false);
    expect(isCustomerFacing("InternalComment")).toBe(false);
    expect(isCustomerFacing("TYPE_SMS")).toBe(true);
  });
  it("speed to lead: a real internal comment is not a touch, with or without 'count automated touches', even from a person in the app", () => {
    const comment = mapMessage(INTERNAL_COMMENT_MESSAGE) as Msg;
    expect(comment).toMatchObject({ direction: "outbound", userId: "U1", source: "app", type: "InternalComment" });
    expect(isHumanTouch(comment, false)).toBe(false);
    expect(isHumanTouch(comment, true)).toBe(false);
    expect(isHumanTouch(mapMessage(SMS_REPLY) as Msg, false), "a real reply still counts").toBe(true);
  });
  it("a lead whose only outbound entry is an internal comment is still waiting; the real reply after it is the touch, and the comment does not shorten the time", () => {
    const msgs = [INBOUND, INTERNAL_COMMENT_MESSAGE].map((m) => mapMessage(m) as Msg);
    expect(leadFromMessages(msgs, null)).toMatchObject({ touchAt: null, touchUserId: null });
    const withReply = [INBOUND, INTERNAL_COMMENT_MESSAGE, SMS_REPLY].map((m) => mapMessage(m) as Msg);
    expect(leadFromMessages(withReply, null)).toMatchObject({ touchAt: Date.parse("2026-11-02T10:30:00.000Z") });
    expect(leadFromMessages(withReply, null, true)?.touchAt, "even counting automated touches").toBe(Date.parse("2026-11-02T10:30:00.000Z"));
  });
  it("waiting: a conversation whose latest entry is an internal comment is not judged (neither waiting nor answered) instead of looking answered", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    const at = Date.parse("2026-11-02T10:05:00Z");
    expect(waitingState({ direction: "outbound", at, type: "InternalComment" }, now, 1)).toBe("none");
    expect(waitingState({ direction: "outbound", at, type: "TYPE_INTERNAL_COMMENT" }, now, 1)).toBe("none");
    expect(waitingState({ direction: "outbound", at, type: "TYPE_SMS" }, now, 1)).toBe("answered");
    expect(waitingState({ direction: "inbound", at, type: "TYPE_SMS" }, now, 1)).toBe("waiting");
  });
  it("the conversation sync stores an internal comment's direction as nothing, so no query that looks for 'outbound' or 'inbound' counts it", () => {
    const comment = mapConversation({ id: "v1", contactId: "C1", lastMessageType: "TYPE_INTERNAL_COMMENT", lastMessageDirection: "outbound", lastMessageDate: 1_700_000_000_000, unreadCount: 0 });
    expect(comment).toMatchObject({ lastMessageType: "TYPE_INTERNAL_COMMENT", lastMessageDirection: null });
    const sms = mapConversation({ id: "v2", contactId: "C1", lastMessageType: "TYPE_SMS", lastMessageDirection: "outbound", lastMessageDate: 1_700_000_000_000 });
    expect(sms?.lastMessageDirection).toBe("outbound");
  });
});

describe("our writes and their echoes", () => {
  it("finds the ids a note or message webhook carries, and nothing that is not an id", () => {
    expect(candidateIds({ type: "OutboundMessage", messageId: "msgId123456", conversationId: "conv", id: "evt-12345" })).toEqual(["msgId123456", "evt-12345"]);
    expect(candidateIds({ type: "NoteCreate", data: { id: "note-1234567", note: { id: "n-98765432" } } })).toEqual(["note-1234567", "n-98765432"]);
    expect(candidateIds({ messageId: "short" })).toEqual([]);
    expect(candidateIds({ messageId: "has spaces in it" })).toEqual([]);
    expect(candidateIds(null)).toEqual([]);
    expect(candidateIds("text")).toEqual([]);
  });
  it("a contact's new last-activity date within the window after one of our writes is ours, and the older date is kept", () => {
    const wrote = Date.parse("2026-11-02T10:00:00Z");
    expect(OUR_WRITE_WINDOW_MS).toBe(30 * 60_000);
    expect(OUR_WRITE_LEAD_MS).toBe(60_000);
    expect(isOurActivity(wrote + 5_000, [wrote])).toBe(true);
    expect(isOurActivity(wrote - 30_000, [wrote]), "the platform stamps a little before our record").toBe(true);
    expect(isOurActivity(wrote + OUR_WRITE_WINDOW_MS, [wrote])).toBe(true);
    expect(isOurActivity(wrote + OUR_WRITE_WINDOW_MS + 1, [wrote]), "later activity is a real person's").toBe(false);
    expect(isOurActivity(wrote - 2 * 60_000, [wrote])).toBe(false);
    expect(isOurActivity(null, [wrote])).toBe(false);
    expect(isOurActivity(wrote, [])).toBe(false);
    const before = Date.parse("2026-08-01T00:00:00Z");
    expect(keepsOlderActivity(wrote + 1000, before, [wrote]), "ours: keep what was there").toBe(before);
    expect(keepsOlderActivity(wrote + 3 * 3_600_000, before, [wrote]), "a person's later activity is taken").toBe(wrote + 3 * 3_600_000);
  });
  it("the contact sync really uses these numbers in its SQL (so the guard is the one tested here, not a copy)", () => {
    const sync = readFileSync(join(process.cwd(), "src/lib/sync/engine.ts"), "utf8");
    expect(sync).toMatch(/OUR_WRITE_LEAD_MS/);
    expect(sync).toMatch(/OUR_WRITE_WINDOW_MS/);
    expect(sync).toMatch(/from crm_writes w where w\.installation_id = excluded\.installation_id/);
    expect(sync).toMatch(/w\.undone_at is null/);
  });
  it("the webhook handler drops an echo of our own write before it queues any work", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/webhooks/ghl/route.ts"), "utf8");
    expect(route).toMatch(/isEchoOfOurWrite\(target\.id, parsed\)/);
    expect(route.indexOf("isEchoOfOurWrite")).toBeLessThan(route.indexOf("enqueueAreaSync(target.id"));
  });
});
