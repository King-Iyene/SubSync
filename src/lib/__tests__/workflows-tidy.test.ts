import assert from "node:assert/strict";
import { test } from "node:test";
import type { WfItem } from "../workflows/model.ts";
import { applyRule, planRename, ruleIsEmpty } from "../workflows/rename.ts";
import { compareAcross, FIX, findDuplicates, lintNames, norm, reviewDue, similarity, turnedOff, type SeenChange } from "../workflows/tidy.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const DAY = 86_400_000;
const wf = (o: Partial<WfItem> & { workflowId: string }): WfItem => ({
  locationId: "L1", name: "Flow " + o.workflowId, status: "published", kind: null, folderId: null, version: "3", uiUrl: null, createdAt: NOW - 90 * DAY,
  updatedAt: NOW - 3 * DAY, updatedBy: null, runs30d: 20, enrolled30d: 10, failed30d: 0, lastRunAt: NOW - DAY, removedSeenAt: null, ...o,
});
const seen = (o: Partial<SeenChange>): SeenChange => ({ locationId: "L1", workflowId: "a", kind: "status", source: "observed", before: { status: "published" }, after: { status: "draft" }, at: NOW - DAY, ...o });

test("turned off: only a published workflow noticed going to draft by someone else, in the last week, and still not published", () => {
  const items = [wf({ workflowId: "a", status: "draft" }), wf({ workflowId: "b", status: "published" }), wf({ workflowId: "c", status: "draft" }), wf({ workflowId: "d", status: "draft" })];
  const f = turnedOff([
    seen({ workflowId: "a" }), seen({ workflowId: "b" }), seen({ workflowId: "c", at: NOW - 10 * DAY }), seen({ workflowId: "d", source: "subsync" }), seen({ workflowId: "gone" }),
    seen({ workflowId: "a", at: NOW - 2 * DAY }),
  ], items, NOW);
  assert.deepEqual(f.map((x) => x.workflowId), ["a"], "one finding per workflow, none for the republished, the old, SubSync's own or the removed");
  assert.equal(f[0].kind, "turned_off");
  assert.match(f[0].why, /Nobody is told/);
});

test("compare: the same name in two or more accounts, with drift when states or versions differ or an account lacks it", () => {
  const items = [
    wf({ workflowId: "1", locationId: "L1", name: "Missed Call Text Back", version: "3" }), wf({ workflowId: "2", locationId: "L2", name: "missed call text back (copy)", version: "5", status: "draft" }),
    wf({ workflowId: "3", locationId: "L1", name: "Only Here" }), wf({ workflowId: "4", locationId: "L1", name: "Same", version: "2" }), wf({ workflowId: "5", locationId: "L2", name: "Same", version: "2" }),
    wf({ workflowId: "6", locationId: "L1", name: "A campaign", }), wf({ workflowId: "campaign:7", locationId: "L2", name: "A campaign" }),
  ];
  const g = compareAcross(items, ["L1", "L2", "L3"]);
  assert.deepEqual(g.map((x) => x.name), ["Missed Call Text Back", "Same"]);
  assert.deepEqual(g[0].drift, ["Published in some accounts and not in others", "Edited to different versions", "Missing from 1 account"]);
  assert.deepEqual(g[1].drift, ["Missing from 1 account"]);
  assert.equal(norm("Welcome (Copy)!"), "welcome");
});

test("names: extra spaces, leftover copies, default names and shouting are found, and each fix is a rename rule the preview shows", () => {
  const items = [wf({ workflowId: "1", name: "New  Lead " }), wf({ workflowId: "2", name: "Review Request (copy)" }), wf({ workflowId: "3", name: "New Workflow 2" }), wf({ workflowId: "4", name: "SEND REMINDERS" }), wf({ workflowId: "5", name: "Good Name" }), wf({ workflowId: "campaign:6", name: "new campaign" })];
  const issues = lintNames(items);
  assert.deepEqual(issues.map((i) => `${i.workflowId}:${i.issue}`).sort(), ["1:spaces", "2:copy", "3:default", "4:case"]);
  assert.equal(FIX.default, undefined, "a default name needs a person");
  assert.equal(ruleIsEmpty(FIX.spaces!), false);
  assert.equal(applyRule("New  Lead ", FIX.spaces!), "New Lead");
  assert.equal(applyRule("Review Request (copy)", FIX.copy!), "Review Request");
  assert.equal(applyRule("SEND REMINDERS", FIX.case!), "Send Reminders");
  const rows = planRename(items.filter((i) => ["1", "2"].includes(i.workflowId)), FIX.spaces!, true);
  assert.deepEqual(rows.map((r) => r.status), ["change", "unchanged"]);
});

test("duplicates: the same or nearly the same name inside one account, never across accounts", () => {
  const items = [
    wf({ workflowId: "1", name: "New Lead Follow Up" }), wf({ workflowId: "2", name: "New lead follow-up (copy)" }), wf({ workflowId: "3", name: "Lead Follow Up New Form" }),
    wf({ workflowId: "4", name: "Review Request" }), wf({ workflowId: "5", locationId: "L2", name: "Review Request" }), wf({ workflowId: "6", name: "Totally different" }),
  ];
  const d = findDuplicates(items);
  assert.equal(d.length, 1);
  assert.deepEqual(d[0].items.map((w) => w.workflowId).sort(), ["1", "2", "3"]);
  assert.equal(similarity("lead follow up", "lead follow up form") >= 0.7, true);
  assert.equal(findDuplicates([wf({ workflowId: "x", name: "Same" }), wf({ workflowId: "y", name: "same" })])[0].exact, true);
});

test("review due: an item marked Review and not touched for two weeks comes back, Keep or Retire clears it", () => {
  const l = (decision: "keep" | "review" | "retire", days: number) => ({ labels: [], group: null, rating: null, decision, note: null, owner: null, updatedBy: null, updatedAt: NOW - days * DAY, fixedAt: null, snoozedUntil: null, watch: false });
  const items = [wf({ workflowId: "a" }), wf({ workflowId: "b" }), wf({ workflowId: "c" })];
  const f = reviewDue(items, new Map([["L1|a", l("review", 20)], ["L1|b", l("review", 3)], ["L1|c", l("keep", 40)]]), NOW);
  assert.deepEqual(f.map((x) => x.workflowId), ["a"]);
});
