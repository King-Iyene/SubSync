import assert from "node:assert/strict";
import { test } from "node:test";
import { CLICK_MAX, cleanQueueTag, DEFAULT_TAG, planQueue, planSend, statusLine, type Cand, type Cfg } from "../dial/callqueue.ts";
import { execute } from "../dial/callqueue-exec.ts";
import type { CrmRequest, WriteResult } from "../ghl/crm-writes.ts";

const NOW = Date.UTC(2026, 10, 6, 17, 0); // noon in New York
const cand = (id: string, o: Partial<Cand> = {}): Cand => ({ key: `L1:${id}`, contactId: id, locationId: "L1", phone: "+15550001111", dnd: false, timeZone: "America/New_York", openValue: 100, ageHours: 2, priority: 50, list: "missed", ...o });
const cfg: Cfg = { maxPerRun: 25, maxPerDay: 100, window: { start: 9, end: 20 }, addedToday: 0, writeBudget: 30 };
const none = new Map<string, number>();

test("tag name: cleaned, lower case, falls back to the default", () => {
  assert.equal(cleanQueueTag("  Call-Now "), "call-now");
  assert.equal(cleanQueueTag("x"), DEFAULT_TAG);
  assert.equal(cleanQueueTag("a,b;c"), DEFAULT_TAG);
  assert.equal(cleanQueueTag(null), DEFAULT_TAG);
});

test("rules: blocked leads are never added and come off; ranked by money; outside hours waits", () => {
  const p = planQueue([cand("a", { openValue: 10 }), cand("b", { openValue: 9000 }), cand("dnd", { dnd: true }), cand("nophone", { phone: null }), cand("night", { timeZone: "Asia/Tokyo" })], new Set(["L1:dnd"]), none, cfg, NOW);
  assert.deepEqual(p.add.map((c) => c.contactId), ["b", "a"]);
  assert.deepEqual(p.remove, ["L1:dnd"]);
  assert.deepEqual([p.skipped.dnd, p.skipped.noPhone, p.skipped.outsideHours], [1, 1, 1]);
  assert.match(p.sendNote, /Would add 2 leads/);
});

test("caps: per run, per day and the write budget (removals first)", () => {
  const many = Array.from({ length: 40 }, (_, i) => cand(`c${i}`));
  assert.equal(planQueue(many, new Set(), none, { ...cfg, maxPerRun: 10 }, NOW).add.length, 10);
  assert.equal(planQueue(many, new Set(), none, { ...cfg, maxPerDay: 100, addedToday: 97 }, NOW).add.length, 3);
  assert.equal(planQueue(many, new Set(), none, cfg, NOW).add.length, 25);
  const tagged = new Set(Array.from({ length: 8 }, (_, i) => `L1:old${i}`));
  const p = planQueue(many, tagged, none, { ...cfg, writeBudget: 12 }, NOW);
  assert.equal(p.remove.length, 8);
  assert.equal(p.add.length, 4);
  assert.equal(p.skipped.cap, 36);
});

test("idempotent: tagged leads are not added again; 24 h memory holds back everything but a due redial", () => {
  const p1 = planQueue([cand("a")], new Set(["L1:a"]), none, cfg, NOW);
  assert.equal(p1.add.length, 0);
  assert.equal(p1.remove.length, 0);
  const recent = new Map([["L1:a", NOW - 3_600_000], ["L1:r", NOW - 3_600_000], ["L1:old", NOW - 25 * 3_600_000]]);
  const p2 = planQueue([cand("a"), cand("r", { list: "redial" }), cand("old")], new Set(), recent, cfg, NOW);
  assert.deepEqual(p2.add.map((c) => c.contactId).sort(), ["old", "r"]);
  assert.equal(p2.skipped.recent, 1);
});

test("un-tag: a lead that no longer qualifies (called, replied, booked) leaves the queue", () => {
  const p = planQueue([cand("still")], new Set(["L1:still", "L1:gone"]), none, cfg, NOW);
  assert.deepEqual(p.remove, ["L1:gone"]);
});

test("manual send: top of the list, never beyond 25, never a lead already queued", () => {
  const many = Array.from({ length: 80 }, (_, i) => cand(`c${i}`));
  assert.equal(planSend(many, new Set(), none, { ...cfg, maxPerRun: 99, maxPerDay: 500, writeBudget: 500 }, NOW, 200).add.length, CLICK_MAX);
  assert.equal(planSend(many, new Set(["L1:c0"]), none, cfg, NOW, 5).add.some((c) => c.contactId === "c0"), false);
  assert.equal(planSend(many, new Set(), none, cfg, NOW, 5).remove.length, 0);
});

test("executor with a stub client: adds and removes the tag, stops on missing permission, dry run records nothing as queued", async () => {
  const seen: CrmRequest[] = []; const rec: string[] = [];
  const plan = planQueue([cand("a"), cand("b")], new Set(["L1:gone"]), none, cfg, NOW);
  const ok = async (r: CrmRequest): Promise<WriteResult> => { seen.push(r); return { outcome: "written", id: null }; };
  const d = await execute(plan, { route: "tag", tag: "call-now" }, ok, async (a) => { rec.push(`${a.action}:${a.contactId}:${a.status}`); }, { sleep: async () => undefined });
  assert.deepEqual([d.added, d.removed], [2, 1]);
  assert.deepEqual(seen.map((r) => `${r.method} ${r.path}`), ["DELETE /contacts/gone/tags", "POST /contacts/a/tags", "POST /contacts/b/tags"]);
  const slept: number[] = []; seen.length = 0;
  const wf = await execute(plan, { route: "workflow", workflowId: "wf-12345678" }, ok, async () => undefined, { sleep: async (m) => { slept.push(m); } });
  assert.deepEqual(seen.map((r) => r.path), ["/contacts/a/workflow/wf-12345678", "/contacts/b/workflow/wf-12345678"]);
  assert.equal(wf.removed, 0);
  assert.equal(slept.length, 1); // spaced between writes
  const denied = await execute(plan, { route: "tag", tag: "t1" }, async () => ({ outcome: "needs_permission" }), async () => undefined, { sleep: async () => undefined });
  assert.equal(denied.needsPermission, true);
  const dry = await execute(plan, { route: "tag", tag: "t1" }, async () => ({ outcome: "dry_run", line: "x" }), async (a) => { rec.push(a.status); }, { sleep: async () => undefined });
  assert.deepEqual([dry.wouldAdd, dry.wouldRemove, dry.added], [2, 1, 0]);
});

test("status line", () => {
  assert.equal(statusLine({ autoOn: false, paused: false, inQueue: 0, lastRunAt: null, live: true }, NOW), "Auto call queue: OFF");
  assert.match(statusLine({ autoOn: true, paused: false, inQueue: 38, lastRunAt: NOW - 120_000, live: true }, NOW), /ON, 38 leads in queue, last filled 2 min ago/);
  assert.match(statusLine({ autoOn: true, paused: true, inQueue: 3, lastRunAt: null, live: true }, NOW), /PAUSED/);
});
