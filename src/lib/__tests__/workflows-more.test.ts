import assert from "node:assert/strict";
import { test } from "node:test";
import { againstOwnNormal, byAccount, filterCamps, flagsFor, parseStats as parseDelivery, rate, scoreOf, totals, type Camp } from "../workflows/delivery.ts";
import { applyMarks, markKey, parseLogs, proofOf, snoozeUntil, summarise } from "../workflows/detail.ts";
import { findingsFor } from "../workflows/health.ts";
import type { WfItem } from "../workflows/model.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const DAY = 86_400_000;
const wf = (o: Partial<WfItem> & { workflowId: string }): WfItem => ({
  locationId: "L1", name: "Flow " + o.workflowId, status: "published", kind: null, folderId: null, version: "3", uiUrl: null, createdAt: NOW - 90 * DAY,
  updatedAt: NOW - 3 * DAY, updatedBy: null, runs30d: 20, enrolled30d: 10, failed30d: 0, lastRunAt: NOW - DAY, removedSeenAt: null, ...o,
});
const camp = (id: string, loc: string, s: Camp["stats"], o: Partial<Camp> = {}): Camp => ({ campaignId: id, locationId: loc, name: id, status: "done", kind: "campaign:email", updatedAt: NOW - DAY, createdAt: NOW - 10 * DAY, takenAt: NOW, stats: s, ...o });
const st = (sent: number, delivered: number, extra: Partial<NonNullable<Camp["stats"]>> = {}) => ({ sent, delivered, opened: null, clicked: null, bounced: null, failed: null, unsubscribed: null, queued: null, ...extra });

test("delivery totals: spellings are read, hard and soft bounces add up, and a missing field stays null", () => {
  assert.deepEqual(parseDelivery({ stats: { sent: 100, delivered: "90", hardBounced: 4, softBounced: 2, unsubscribes: 1 } }), { sent: 100, delivered: 90, opened: null, clicked: null, bounced: 6, failed: null, unsubscribed: 1, queued: null });
  assert.equal(parseDelivery({ stats: {} }), null);
  assert.equal(parseDelivery({ stats: { sent: -3 } }), null);
  assert.equal(rate(null, 100), null);
  assert.equal(rate(5, 0), null);
});

test("delivery: looks sent but did not arrive, stuck, and small samples claim nothing", () => {
  const f = flagsFor([camp("bad", "L1", st(200, 100, { bounced: 80 })), camp("small", "L1", st(20, 2)), camp("fine", "L1", st(200, 195, { bounced: 2 })), camp("stuck", "L1", st(100, 90, { queued: 10 }), { updatedAt: NOW - 5 * DAY })], NOW);
  assert.deepEqual(f.map((x) => `${x.kind}:${x.campaignId}`).sort(), ["not_delivered:bad", "stuck:stuck"]);
  assert.match(f.find((x) => x.kind === "not_delivered")?.why ?? "", /bounced/);
});

test("delivery: an account score needs a minimum sample, the league sums only what was reported, and totals keep null when nobody reported", () => {
  assert.equal(scoreOf({ sent: 10, delivered: 10, bounced: 0, failed: 0, unsubscribed: 0 }), null);
  assert.equal(scoreOf({ sent: 100, delivered: 100, bounced: 0, failed: 0, unsubscribed: 0 }), 100);
  assert.ok((scoreOf({ sent: 100, delivered: 70, bounced: 20, failed: 5, unsubscribed: 3 }) ?? 100) < 70);
  const league = byAccount([camp("a", "L1", st(100, 100)), camp("b", "L2", st(100, 50, { bounced: 40 })), camp("c", "L2", null)]);
  assert.deepEqual(league.map((x) => x.locationId), ["L1", "L2"]);
  assert.equal(league[1].campaigns, 1);
  assert.equal(totals([camp("a", "L1", st(100, 90)), camp("b", "L1", null)]).opened, null);
  assert.equal(totals([camp("a", "L1", st(100, 90)), camp("b", "L1", st(50, 40))]).sent, 150);
});

test("delivery: against the account's own normal needs three earlier campaigns, and filters narrow by status, source and age", () => {
  const hist = [1, 2, 3].map((i) => camp("h" + i, "L1", st(100, 95), { createdAt: NOW - (20 + i) * DAY }));
  const now = camp("n", "L1", st(100, 60), { createdAt: NOW - DAY });
  const r = againstOwnNormal(now, [...hist, now]);
  assert.ok(r && r.diff < -0.3);
  assert.equal(againstOwnNormal(now, [hist[0], now]), null);
  const all = [...hist, now, camp("d", "L1", null, { status: "draft", kind: "campaign:bulk", createdAt: NOW - 100 * DAY })];
  assert.equal(filterCamps(all, { status: "draft", range: "all", source: "all", now: NOW }).length, 1);
  assert.equal(filterCamps(all, { status: "all", range: "30", source: "all", now: NOW }).length, 4);
  assert.equal(filterCamps(all, { status: "all", range: "all", source: "campaign:bulk", now: NOW }).length, 1);
});

test("detail: a definition is summarised in words, errors in plain words, and a missing shape gives nothing", () => {
  const s = summarise({ definition: { triggers: [{ type: "contact_created" }], actions: [{ id: "a", type: "sms", name: "Text them" }, { id: "b", type: "wait" }], edges: [{ from: "a", to: "b" }], settings: { allowReEntry: false } } });
  assert.deepEqual(s?.triggers, ["Contact created"]);
  assert.deepEqual(s?.steps.map((x) => x.name), ["Text them", "Wait"]);
  assert.deepEqual(s?.settings, ["A contact can enter only once"]);
  assert.equal(summarise({ nothing: 1 }), null);
  const l = parseLogs({ logs: [{ status: "failed", stepName: "Text them", createdAt: "2026-11-03T10:00:00Z", meta: { reason: "invalid number" } }] });
  assert.match(l[0].words, /failed: invalid number/);
});

test("the working queue: fixed hides a finding for a week, snooze until its date, and both come back by themselves", () => {
  const f = findingsFor([wf({ workflowId: "bad", runs30d: 40, failed30d: 30 }), wf({ workflowId: "idle", runs30d: 0, failed30d: 0 })], { now: NOW, logsKnown: true });
  const marks = new Map([[markKey(f[0]), { fixedAt: NOW - DAY, snoozedUntil: null }], [markKey(f[1]), { fixedAt: null, snoozedUntil: NOW + DAY }]]);
  assert.equal(applyMarks(f, marks, NOW).open.length, 0);
  assert.deepEqual(applyMarks(f, marks, NOW).muted.map((m) => m.why).sort(), ["fixed", "snoozed"]);
  assert.equal(applyMarks(f, marks, NOW + 8 * DAY).open.length, 2);
  assert.equal(snoozeUntil("week", NOW), NOW + 7 * DAY);
  assert.equal(snoozeUntil("never", NOW), null);
});

test("proof: raised, cleared and still open are counted from the alert rows in the window", () => {
  const a = [{ kind: "workflow_failing", title: "x", createdAt: NOW - 2 * DAY, resolvedAt: NOW - DAY, locationId: "L1" }, { kind: "workflow_failing", title: "y", createdAt: NOW - 20 * DAY, resolvedAt: null, locationId: "L1" }, { kind: "campaign_failed", title: "z", createdAt: NOW - DAY, resolvedAt: null, locationId: "L2" }];
  const p = proofOf(a, NOW, 7);
  assert.deepEqual([p.raised.length, p.cleared.length, p.open.length], [2, 1, 2]);
});
