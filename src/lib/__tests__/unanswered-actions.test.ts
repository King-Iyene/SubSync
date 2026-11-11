import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BATCH_CAPS, claimBlockers, clearConfirmed, clearPhrase, DEFAULT_HIDE, hideReason, isSnoozeDuration, isSnoozeReason, planAssign, planClear, protectionBlockers, snoozeActive, snoozeUntil,
  type ClearItem, type HideFacts,
} from "../analytics/unanswered-actions.ts";
import { deleteConversation } from "../ghl/unanswered-gateway.ts";
import { resetLimits } from "../ghl/workbench.ts";

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

test("snooze lengths are fixed and capped at 30 days", () => {
  assert.equal(snoozeUntil("h1", NOW), NOW + H);
  assert.equal(snoozeUntil("d7", NOW), NOW + 168 * H);
  assert.equal(snoozeUntil("d30", NOW), NOW + 30 * 24 * H);
  assert.equal(isSnoozeDuration("forever"), false);
  assert.equal(isSnoozeReason("other"), true);
  assert.equal(isSnoozeReason("because"), false);
});

test("tomorrow is the next 9am in the account's zone, never earlier than 6 hours away", () => {
  // 12:00 UTC = 08:00 in New York (EST, November): the next 9am that is 6+ hours away is tomorrow 9am.
  const t = snoozeUntil("tomorrow", NOW, "America/New_York");
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(new Date(t)));
  assert.equal(hour, 9);
  assert.ok(t - NOW >= 6 * H && t - NOW <= 31 * H, "between 6 and 31 hours away");
  assert.equal(snoozeUntil("tomorrow", NOW, null), NOW + 24 * H, "unknown zone: 24 hours");
  assert.equal(snoozeUntil("tomorrow", NOW, "Not/AZone"), NOW + 24 * H, "bad zone: 24 hours");
});

test("a snooze hides only until it runs out or is released", () => {
  assert.equal(snoozeActive({ releasedAt: null, until: NOW + H }, NOW), true);
  assert.equal(snoozeActive({ releasedAt: null, until: NOW - 1 }, NOW), false);
  assert.equal(snoozeActive({ releasedAt: NOW - 5, until: NOW + H }, NOW), false);
});

const facts = (o: Partial<HideFacts> = {}): HideFacts => ({ snoozed: false, notALead: false, tags: [], email: "a@x.com", phone: "+1 555 010 2030", ownEmail: "front@biz.com", ownPhone: "+1 555 999 0000", automatedLastInbound: false, ...o });

test("hide reasons: one each, in the order set aside, not a lead, own team or spam, automatic", () => {
  assert.equal(hideReason(facts()), null);
  assert.equal(hideReason(facts({ snoozed: true, notALead: true })), "snoozed");
  assert.equal(hideReason(facts({ notALead: true, automatedLastInbound: true })), "not_a_lead");
  assert.equal(hideReason(facts({ tags: ["Spam"] })), "internal");
  assert.equal(hideReason(facts({ email: " FRONT@biz.com " })), "internal", "the business's own address");
  assert.equal(hideReason(facts({ phone: "(555) 999-0000" })), "internal", "the business's own number, any format");
  assert.equal(hideReason(facts({ automatedLastInbound: true })), "automatic");
  assert.equal(hideReason(facts({ tags: ["hot lead"] })), null, "an ordinary tag hides nobody");
  assert.equal(hideReason(facts({ phone: "123", ownPhone: "123" })), null, "a too-short number never matches");
});

test("each default hide can be switched off, a snooze cannot", () => {
  const off = { notALead: false, internal: false, automatic: false };
  assert.equal(hideReason(facts({ notALead: true }), off), null);
  assert.equal(hideReason(facts({ tags: ["staff"] }), off), null);
  assert.equal(hideReason(facts({ automatedLastInbound: true }), off), null);
  assert.equal(hideReason(facts({ snoozed: true }), off), "snoozed");
  assert.deepEqual(DEFAULT_HIDE, { notALead: true, internal: true, automatic: true });
});

test("protected people are never cleared: do not disturb, open deal, customer, upcoming appointment", () => {
  const ok = { name: "Ada", dnd: false, openDeals: 0, wonDeals: 0, upcomingAppointments: 0 };
  assert.deepEqual(protectionBlockers(ok), []);
  assert.deepEqual(protectionBlockers({ ...ok, dnd: true }).map((b) => b.id), ["dnd"]);
  assert.deepEqual(protectionBlockers({ ...ok, openDeals: 1, wonDeals: 2, upcomingAppointments: 1 }).map((b) => b.id), ["open_deal", "customer", "appointment"]);
  assert.match(protectionBlockers({ ...ok, openDeals: 1 })[0].text, /Ada/);
});

const item = (id: string, blockers: ClearItem["blockers"] = []): ClearItem => ({ conversationId: id, contactId: `c${id}`, name: `Person ${id}`, blockers });

test("clear plan: protected ones are split out with why, duplicates dropped, the cap applies, the phrase carries the count", () => {
  const items = [item("c1"), item("c2", [{ id: "dnd", text: "x" }]), item("c1"), ...Array.from({ length: 12 }, (_, i) => item(`x${i}`))];
  const p = planClear(items);
  assert.equal(p.blocked.length, 1);
  assert.equal(p.allowed.length, BATCH_CAPS.clear);
  assert.equal(p.overCap, 13 - BATCH_CAPS.clear);
  assert.equal(p.phrase, `delete ${BATCH_CAPS.clear}`);
  assert.equal(planClear([]).allowed.length, 0);
});

test("a typed confirmation must be the exact count", () => {
  assert.equal(clearPhrase(3), "delete 3");
  assert.equal(clearConfirmed("Delete 3", 3), true);
  assert.equal(clearConfirmed("  delete   3 ", 3), true);
  assert.equal(clearConfirmed("delete 4", 3), false);
  assert.equal(clearConfirmed("delete", 3), false);
  assert.equal(clearConfirmed("delete 0", 0), false, "nothing to confirm is never confirmed");
});

test("assign plan: only a member of that account's team, leads that already have that owner are left alone, the cap applies", () => {
  const members = [{ id: "u1" }, { id: "u2" }];
  const people = [{ contactId: "a", name: "A", currentOwner: null }, { contactId: "b", name: "B", currentOwner: "u1" }, { contactId: "a", name: "A", currentOwner: null }];
  const p = planAssign(people, "u1", members);
  assert.deepEqual(p.blockers, []);
  assert.deepEqual(p.change.map((x) => x.contactId), ["a"]);
  assert.equal(p.same.length, 1);
  assert.equal(planAssign(people, "stranger", members).blockers[0].id, "owner", "an id from another account is refused");
  assert.equal(planAssign([], "u1", members).blockers.some((b) => b.id === "none"), true);
  const many = Array.from({ length: 30 }, (_, i) => ({ contactId: `c${i}`, name: "n", currentOwner: null }));
  const big = planAssign(many, "u2", members);
  assert.equal(big.change.length, BATCH_CAPS.assign);
  assert.equal(big.overCap, 30 - BATCH_CAPS.assign);
});

test("claim: only an ownerless lead, only by someone on that account's team", () => {
  const members = [{ id: "me" }];
  assert.deepEqual(claimBlockers({ currentOwner: null, me: "me", members }), []);
  assert.equal(claimBlockers({ currentOwner: "me", me: "me", members })[0].id, "mine");
  assert.equal(claimBlockers({ currentOwner: "other", me: "me", members })[0].id, "taken");
  assert.equal(claimBlockers({ currentOwner: null, me: null, members })[0].id, "who");
  assert.equal(claimBlockers({ currentOwner: null, me: "me", members: [{ id: "x" }] })[0].id, "team");
});

// ---------------- the delete gateway, with a STUBBED platform only ----------------

const rec = () => {
  const lines: Array<{ action: string; detail: Record<string, unknown> }> = [];
  return { lines, audit: async (r: { installationId: string; action: string; detail: Record<string, unknown> }) => { lines.push({ action: r.action, detail: r.detail }); }, log: () => undefined };
};
const args = (o: Partial<Parameters<typeof deleteConversation>[0]> = {}) => ({ installationId: "xtest-inst", locationId: "xtest-loc", conversationId: "xtest-conv", contactId: "xtest-c", actor: "Dana", optedIn: true, token: async () => "tok", ...o });
const stub = (status: number) => { const calls: Array<{ method: string; url: string }> = []; return { calls, fetchImpl: (async (u: string, init: RequestInit) => { calls.push({ method: init.method ?? "GET", url: u }); return new Response("{}", { status }); }) as unknown as typeof fetch }; };

test("delete gateway: the master switch off sends nothing and records one WOULD line", async () => {
  resetLimits();
  const r = rec(); const s = stub(200);
  const out = await deleteConversation(args(), { env: {}, ...r, fetchImpl: s.fetchImpl, sleep: async () => undefined });
  assert.equal(out.outcome, "dry_run");
  assert.equal(s.calls.length, 0);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].action, "dry_run.would_write");
  assert.equal(r.lines[0].detail.what, "crm.conversation.delete");
});

test("delete gateway: an account that has not opted in is a dry run even with the switch on", async () => {
  resetLimits();
  const r = rec(); const s = stub(200);
  const out = await deleteConversation(args({ optedIn: false }), { env: { WRITE_GHL_LIVE: "true" }, ...r, fetchImpl: s.fetchImpl, sleep: async () => undefined });
  assert.equal(out.outcome, "dry_run");
  assert.equal(out.outcome === "dry_run" && out.reason, "account");
  assert.equal(s.calls.length, 0);
});

test("delete gateway: live, it deletes only the conversation, audits ids only, maps 403 to needs permission and treats 404 as done", async () => {
  resetLimits();
  const r = rec(); const s = stub(200);
  assert.equal((await deleteConversation(args(), { env: { WRITE_GHL_LIVE: "true" }, ...r, fetchImpl: s.fetchImpl, sleep: async () => undefined })).outcome, "done");
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].method, "DELETE");
  assert.match(s.calls[0].url, /\/conversations\/xtest-conv$/, "never the contact");
  const audit = r.lines.find((l) => l.action === "crm.write");
  assert.ok(audit);
  assert.doesNotMatch(JSON.stringify(audit), /tok/, "no token in the audit line");
  resetLimits();
  assert.equal((await deleteConversation(args(), { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: stub(403).fetchImpl, sleep: async () => undefined })).outcome, "needs_permission");
  resetLimits();
  assert.equal((await deleteConversation(args(), { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: stub(404).fetchImpl, sleep: async () => undefined })).outcome, "done");
  resetLimits();
  assert.equal((await deleteConversation(args(), { env: { WRITE_GHL_LIVE: "true" }, ...rec(), fetchImpl: stub(500).fetchImpl, sleep: async () => undefined })).outcome, "failed");
});
