import assert from "node:assert/strict";
import { test } from "node:test";
import { CLICK_MAX, planSend, type Cand, type Cfg } from "../dial/callqueue.ts";
import { execute } from "../dial/callqueue-exec.ts";
import { capNote, confirmText, finishTab, gate, handSteps, reserveTab, setupState, shouldOpenQueue, summaryLine, statusLineFor, type TabWin } from "../dial/powerdialer.ts";
import { deepLinks } from "../links.ts";
import type { CrmRequest, WriteResult } from "../ghl/crm-writes.ts";

const NOW = Date.UTC(2026, 10, 6, 17, 0); // noon in New York
const cand = (id: string, o: Partial<Cand> = {}): Cand => ({ key: `L1:${id}`, contactId: id, locationId: "L1", phone: "+15550001111", dnd: false, timeZone: "America/New_York", openValue: 100, ageHours: 5, priority: 50, list: "new_unanswered", ...o });
const cfg: Cfg = { maxPerRun: 25, maxPerDay: 100, window: { start: 9, end: 20 }, addedToday: 0, writeBudget: 30 };
const none = new Map<string, number>();

test("one click: at most 25, hours in the lead's own time zone, DND and no phone skipped, already tagged skipped", () => {
  const many = Array.from({ length: 40 }, (_, i) => cand(`c${i}`));
  const p = planSend([...many, cand("dnd", { dnd: true }), cand("nophone", { phone: null }), cand("tokyo", { timeZone: "Asia/Tokyo" }), cand("tagged")], new Set(["L1:tagged"]), none, { ...cfg, maxPerRun: 99, maxPerDay: 500, writeBudget: 500 }, NOW, 200);
  assert.equal(CLICK_MAX, 25);
  assert.equal(p.add.length, 25);
  assert.equal(p.skipped.cap, 15);
  assert.equal(p.skipped.dnd, 1);
  assert.equal(p.skipped.noPhone, 1);
  assert.equal(p.skipped.outsideHours, 1);
  assert.ok(!p.add.some((c) => ["dnd", "nophone", "tokyo", "tagged"].includes(c.contactId)));
  assert.equal(p.remove.length, 0);
});

test("wording: the preview names the count and the tag; the cap note says what is held back", () => {
  assert.equal(confirmText(12, "call-now"), "Send 12 leads to your CRM call queue. They get the tag call-now; your CRM adds a call task for each.");
  assert.match(confirmText(1, "x"), /^Send 1 lead to your CRM call queue\. It gets the tag x/);
  assert.match(confirmText(5, "call-now", 2), /\(2 accounts\)/);
  assert.equal(capNote(25, 0), "");
  assert.match(capNote(25, 15), /25 of 40 will go now: one click sends at most 25/);
});

test("confirm vs dry run: a live send tags and records; a dry run tags nothing, records nothing and the page does not open", async () => {
  const plan = planSend([cand("a"), cand("b")], new Set(), none, cfg, NOW);
  const calls: CrmRequest[] = [];
  const recorded: string[] = [];
  const noSleep = { sleep: async () => undefined };
  const live = await execute(plan, { route: "tag", tag: "call-now" }, async (r) => { calls.push(r); return { outcome: "saved" } as unknown as WriteResult; }, async (x) => { recorded.push(`${x.contactId}:${x.status}`); }, noSleep);
  assert.equal(live.added, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(recorded, ["a:saved", "b:saved"]);
  assert.equal(shouldOpenQueue({ live: true, added: live.added }), true);
  const rec2: string[] = [];
  const dry = await execute(plan, { route: "tag", tag: "call-now" }, async () => ({ outcome: "dry_run" } as unknown as WriteResult), async (x) => { rec2.push(x.status); }, noSleep);
  assert.equal(dry.added, 0);
  assert.equal(dry.wouldAdd, 2);
  assert.deepEqual(rec2, ["dry_run", "dry_run"]);
  assert.equal(shouldOpenQueue({ live: false, added: 0 }), false);
  assert.equal(shouldOpenQueue({ live: true, added: 0 }), false);
});

test("undo: the same executor removes the tag, nothing else", async () => {
  const calls: CrmRequest[] = [];
  const plan = { add: [], remove: ["L1:a", "L1:b"], skipped: { dnd: 0, noPhone: 0, outsideHours: 0, recent: 0, cap: 0 }, sendNote: "" };
  const d = await execute(plan, { route: "tag", tag: "call-now" }, async (r) => { calls.push(r); return { outcome: "saved" } as unknown as WriteResult; }, async () => undefined, { sleep: async () => undefined });
  assert.equal(d.removed, 2);
  assert.equal(d.added, 0);
  assert.equal(calls.length, 2);
});

test("setup state: the workflow list wins; unreadable falls back to the person's word or a tag that disappeared", () => {
  assert.equal(setupState({ listed: "published", marked: false, observed: false }), "set_up");
  assert.equal(setupState({ listed: "missing", marked: true, observed: true }), "not_set_up");
  assert.equal(setupState({ listed: "draft", marked: false, observed: false }), "not_set_up");
  assert.equal(setupState({ listed: "unreadable", marked: true, observed: false }), "set_up");
  assert.equal(setupState({ listed: "unreadable", marked: false, observed: true }), "set_up");
  assert.equal(setupState({ listed: "unreadable", marked: false, observed: false }), "not_sure");
  assert.equal(statusLineFor("not_sure"), "Call queue workflow: not sure");
  assert.equal(statusLineFor("set_up"), "Call queue workflow: set up");
  assert.equal(summaryLine(["set_up", "set_up", "not_set_up"]), "Call queue workflow: set up in 2 of 3 accounts, not set up in 1");
  assert.deepEqual(["not_set_up", "not_sure", "set_up"].map((s) => gate(s as never)), ["setup_card", "warn", "go"]);
});

test("the 5 hand-built steps use the account's tag", () => {
  const s = handSteps("hot-now");
  assert.equal(s.length, 5);
  assert.match(s[0], /Call queue \(tag\)/);
  assert.match(s[1], /Tag added includes hot-now/);
  assert.match(s[2], /Manual Action/);
  assert.match(s[3], /Remove Contact Tag hot-now/);
  assert.match(s[4], /Publish/);
});

test("new tab: reserved in the click, sent to the CRM page after; a blocked pop-up gives no tab and no crash", () => {
  const tab: TabWin = { location: { href: "" }, close: () => { tab.closed = true; }, opener: "x" };
  const got = reserveTab(() => tab);
  assert.equal(got, tab);
  assert.equal(tab.opener, null);
  assert.equal(finishTab(got, "https://crm.example.test/v2/location/L1/conversations/manual_actions"), true);
  assert.match(tab.location.href, /manual_actions$/);
  const t2: TabWin = { location: { href: "" }, close: () => { t2.closed = true; }, opener: "x" };
  assert.equal(finishTab(t2, null), false);
  assert.equal(t2.closed, true);
  assert.equal(reserveTab(() => null), null);
  assert.equal(finishTab(null, "https://x.test"), false);
  assert.equal(reserveTab(() => { throw new Error("blocked"); }), null);
});

test("link: the Manual Actions page uses the agency's own domain, never a path-injected host", () => {
  assert.equal(deepLinks({ whitelabelDomain: "crm.youragency.com" }).manualActions("L1"), "https://crm.youragency.com/v2/location/L1/conversations/manual_actions");
  assert.equal(deepLinks({ appDomain: "own.example.com", whitelabelDomain: "crm.youragency.com" }).manualActions("L1"), "https://own.example.com/v2/location/L1/conversations/manual_actions");
  assert.match(deepLinks(null).manualActions("L1"), /^https:\/\/[a-z0-9.-]+\/v2\/location\/L1\/conversations\/manual_actions$/);
});
