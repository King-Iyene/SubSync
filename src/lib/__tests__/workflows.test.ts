import assert from "node:assert/strict";
import { test } from "node:test";
import { changeWords, diffObserved, parseCampaignList, parseSearch, parseStats, statusOf, type WfItem } from "../workflows/model.ts";
import { alertDrafts, coverageFindings, findingsFor, nextSteps } from "../workflows/health.ts";
import { applyRule, planRename } from "../workflows/rename.ts";
import { capProblem, checkToken, makeToken, mayHaveActive, mayWrite, missingScopes, opKey, phraseMatches } from "../workflows/guards.ts";
import { accountBars, bucketOf, failingIds, inAccount, inBucket, itemsSpec, statusSlices } from "../workflows/reports.ts";
import { runOne } from "../workflows/run.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const DAY = 86_400_000;
const wf = (o: Partial<WfItem> & { workflowId: string }): WfItem => ({
  locationId: "L1", name: "Flow " + o.workflowId, status: "published", kind: null, folderId: null, version: "3", uiUrl: "https://crm.example/w/" + o.workflowId, createdAt: NOW - 90 * DAY,
  updatedAt: NOW - 3 * DAY, updatedBy: null, runs30d: 20, enrolled30d: 10, failed30d: 0, lastRunAt: NOW - DAY, removedSeenAt: null, ...o,
});

test("search answers are read from several spellings and folders are left out", () => {
  const p = parseSearch({ total: 3, searchAfter: ["1735689600000"], workflows: [{ id: "a", name: "Missed call", status: "published", updatedAt: "2026-11-01T10:00:00Z" }, { _id: "b", name: "Old", status: "draft" }, { id: "f", name: "A folder", type: "folder" }, { id: "x" }] }, "L1");
  assert.deepEqual(p.items.map((i) => [i.workflowId, i.status]), [["a", "published"], ["b", "draft"]]);
  assert.equal(p.total, 3);
  assert.deepEqual(p.next, ["1735689600000"]);
  assert.equal(parseSearch({}, "L1").items.length, 0);
});

test("log counts: enrolments and failures are summed by status, unknown answers are null", () => {
  assert.deepEqual(parseStats({ rows: [{ status: "added_to_workflow", count: 10 }, { status: "success", count: 30 }, { status: "error", count: 4 }, { status: "failed_retry_limit_reached", count: 1 }] }), { runs: 45, enrolled: 10, failed: 5 });
  assert.equal(parseStats({ nothing: true }), null);
});

test("campaign lists from all four sources get a namespaced id and a status", () => {
  const c = parseCampaignList({ campaigns: [{ id: "9", name: "Black Friday", status: "completed" }, { id: "10", name: "Bad", status: "error" }] }, "L1", "email");
  assert.equal(c[0].workflowId, "campaign:9");
  assert.equal(c[0].status, "done");
  assert.equal(c[1].status, "failed");
  assert.equal(statusOf("scheduled"), "published");
});

test("changes between two syncs are noticed once, and a first sync records nothing as new", () => {
  const saved = [{ workflowId: "a", name: "A", status: "published" as const, updatedAt: 1, removedSeenAt: null }, { workflowId: "gone", name: "G", status: "draft" as const, updatedAt: 1, removedSeenAt: null }];
  const fresh = [{ workflowId: "a", name: "A2", status: "draft" as const, updatedAt: 2 }, { workflowId: "n", name: "N", status: "draft" as const, updatedAt: 2 }];
  assert.deepEqual(diffObserved(saved, fresh, false).map((d) => d.kind).sort(), ["new", "removed", "renamed", "status"]);
  assert.deepEqual(diffObserved([], fresh, true), []);
  assert.match(changeWords("renamed", { name: "A" }, { name: "B" }), /Renamed "A" to "B"/);
});

test("health: failing needs enough failures and a share, idle needs known logs, drafts need age, and unknown logs never mean zero", () => {
  const items = [
    wf({ workflowId: "bad", runs30d: 40, failed30d: 30 }), wf({ workflowId: "few", runs30d: 40, failed30d: 2 }), wf({ workflowId: "idle", runs30d: 0, failed30d: 0 }),
    wf({ workflowId: "old", status: "draft", updatedAt: NOW - 60 * DAY }), wf({ workflowId: "new", status: "draft", updatedAt: NOW - 2 * DAY }),
    wf({ workflowId: "unk", runs30d: null, enrolled30d: null, failed30d: null }),
  ];
  const f = findingsFor(items, { now: NOW, logsKnown: true });
  assert.deepEqual(f.map((x) => `${x.kind}:${x.workflowId}`).sort(), ["draft_stale:old", "failing:bad", "idle:idle"]);
  assert.equal(f.find((x) => x.kind === "failing")?.severity, "critical");
  assert.ok(f.find((x) => x.kind === "idle")?.estimate);
  assert.equal(findingsFor(items.filter((i) => i.workflowId === "unk"), { now: NOW, logsKnown: false }).length, 0);
  assert.equal(findingsFor([wf({ workflowId: "r", runs30d: 40, failed30d: 30, removedSeenAt: NOW })], { now: NOW, logsKnown: true }).length, 0);
});

test("health: campaigns can be failed, stuck or old drafts", () => {
  const c = (id: string, status: WfItem["status"], days: number) => wf({ workflowId: "campaign:" + id, status, updatedAt: NOW - days * DAY, runs30d: null, failed30d: null });
  const f = findingsFor([c("1", "failed", 1), c("2", "published", 30), c("3", "draft", 45), c("4", "published", 2)], { now: NOW, logsKnown: true });
  assert.deepEqual(f.map((x) => x.kind).sort(), ["campaign_failed", "draft_stale", "stuck"]);
});

test("coverage: only accounts whose list is known are judged, found by name, and said to be an estimate", () => {
  const items = [wf({ workflowId: "1", name: "Missed Call Text Back" }), wf({ workflowId: "2", name: "New Lead Follow Up" }), wf({ workflowId: "3", locationId: "L2", name: "Newsletter" })];
  const f = coverageFindings([{ locationId: "L1", name: "One" }, { locationId: "L2", name: "Two" }, { locationId: "L3", name: "Three" }], items, new Set(["L1", "L2"]));
  assert.deepEqual(f.map((x) => x.locationId), ["L1", "L2"]);
  assert.ok(f.every((x) => x.estimate));
  assert.equal(f[1].severity, "warning");
  assert.ok(nextSteps(f, false).length <= 3);
  assert.deepEqual(alertDrafts(f).map((a) => a.locationId), ["L2"]);
});

test("rename: rules apply in order, collisions and published workflows are blocked until ticked, nothing is empty", () => {
  assert.equal(applyRule("  new   lead  ", { casing: "title", prefix: "[Sales] " }), "[Sales] New Lead");
  assert.equal(applyRule("Welcome (old)", { find: "(old)", replace: "" }), "Welcome");
  const items = [wf({ workflowId: "1", name: "A" }), wf({ workflowId: "2", name: "B ", status: "draft" }), wf({ workflowId: "3", name: "Draft one", status: "draft" })];
  const rows = planRename(items, { find: "A", replace: "X", prefix: "" }, false);
  assert.equal(rows[0].status, "blocked");
  assert.match(rows[0].problem ?? "", /Published/);
  assert.equal(planRename(items, { prefix: "Z " }, true).filter((r) => r.status === "change").length, 3);
  const clash = planRename([wf({ workflowId: "1", name: "Foo", status: "draft" }), wf({ workflowId: "2", name: "Bar", status: "draft" })], { find: "Bar", replace: "Foo" }, true);
  assert.equal(clash[1].status, "blocked");
  assert.equal(planRename([wf({ workflowId: "1", name: "Foo", status: "draft" })], { find: "Foo", replace: "" }, true)[0].problem, "The new name would be empty.");
});

test("guards: roles, caps, typed delete, scopes, active contacts", () => {
  assert.equal(mayWrite({ kind: "client", role: "user", isOwnerOrAdmin: false }), false);
  assert.equal(mayWrite({ kind: "agency", role: "user", isOwnerOrAdmin: false }), false);
  assert.equal(mayWrite({ kind: "agency", role: "admin", isOwnerOrAdmin: true }), true);
  assert.ok(capProblem("delete", 3, { deletesToday: 3, writesToday: 3 }));
  assert.equal(capProblem("rename", 3, { deletesToday: 5, writesToday: 3 }), null);
  assert.ok(capProblem("rename", 51, { deletesToday: 0, writesToday: 0 }));
  assert.ok(capProblem("rename", 0, { deletesToday: 0, writesToday: 0 }));
  assert.equal(phraseMatches("Flow a", ["Flow a"]), true);
  assert.equal(phraseMatches("flow a", ["Flow a"]), false);
  assert.equal(phraseMatches("DELETE 2", ["a", "b"]), true);
  assert.deepEqual(missingScopes("delete", ["workflows.readonly"]), ["workflows.delete"]);
  assert.equal(missingScopes("publish", null), null);
  assert.equal(mayHaveActive({ status: "published", runs30d: 5, lastRunAt: NOW - DAY }, NOW), true);
  assert.equal(mayHaveActive({ status: "published", runs30d: 5, lastRunAt: NOW - 20 * DAY }, NOW), false);
  assert.equal(mayHaveActive({ status: "published", runs30d: null, lastRunAt: null }, NOW), true);
  assert.equal(mayHaveActive({ status: "draft", runs30d: 5, lastRunAt: NOW }, NOW), false);
});

test("the confirm token is tied to the company, the person, the kind and the exact changes", () => {
  const scope = { installationId: "i1", actor: "u1", kind: "rename" as const, changes: [{ id: "a", to: "B" }] };
  const t = makeToken(scope, NOW);
  assert.equal(checkToken(t, scope, NOW + 1000), "ok");
  assert.equal(checkToken(t, { ...scope, installationId: "i2" }, NOW), "invalid");
  assert.equal(checkToken(t, { ...scope, actor: "u2" }, NOW), "invalid");
  assert.equal(checkToken(t, { ...scope, changes: [{ id: "a", to: "C" }] }, NOW), "invalid");
  assert.equal(checkToken(t, { ...scope, kind: "delete" as never }, NOW), "invalid");
  assert.equal(checkToken(t, scope, NOW + 16 * 60_000), "expired");
  assert.equal(checkToken("x.y", scope, NOW), "invalid");
  assert.equal(opKey(t, "rename", "L1", "a"), opKey(t, "rename", "L1", "a"));
  assert.notEqual(opKey(t, "rename", "L1", "a"), opKey(t, "rename", "L1", "b"));
});

test("a number and the rows behind it are the same list", () => {
  const items = [wf({ workflowId: "1", runs30d: 40, failed30d: 30 }), wf({ workflowId: "2", runs30d: 0 }), wf({ workflowId: "3", status: "draft" }), wf({ workflowId: "4", locationId: "L2" }), wf({ workflowId: "5", removedSeenAt: NOW })];
  const f = findingsFor(items, { now: NOW, logsKnown: true });
  const failing = failingIds(f);
  const slices = statusSlices(items, failing);
  for (const s of slices) assert.equal(inBucket(items, failing, s.bucket).length, s.count, s.label);
  assert.equal(slices.reduce((n, s) => n + s.count, 0), 4, "a removed workflow is not counted");
  const bars = accountBars(items, [{ locationId: "L1", name: "One" }, { locationId: "L2", name: "Two" }], failing);
  for (const b of bars) assert.equal(inAccount(items, b.locationId).length, b.total);
  assert.equal(bars[0].locationId, "L1");
  assert.equal(bucketOf(items[0], failing), "failing");
  const spec = itemsSpec({ key: "k", title: "t", subtitle: "s", items: inBucket(items, failing, "failing"), accounts: [{ locationId: "L1", name: "One" }], failing, labels: new Map() });
  assert.equal(spec.count, spec.rows.length);
  assert.equal(spec.rows[0].cells.account, "One");
});

function mockFetch(log: string[], answers: Record<string, unknown> = {}) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url).replace("https://services.leadconnectorhq.com", "");
    log.push(`${init?.method ?? "GET"} ${u}`);
    const body = u.endsWith("/definition") && (init?.method ?? "GET") === "GET" ? { definition: { name: "Old", version: 4, triggers: [], actions: [], edges: [] } } : answers[u] ?? { ok: true };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}
const LIVE = { env: { WORKFLOWS_WRITE_LIVE: "true" }, audit: async () => undefined, log: () => undefined };
const deps = (log: string[], over: Record<string, unknown> = {}) => ({ installationId: "i", granted: ["workflows.readonly", "workflows.write", "workflows.publish", "workflows.delete"], token: async () => "tok", fetchImpl: mockFetch(log), outward: LIVE, demo: false, idem: "k", ...over });

test("dry run: with live changes off nothing is sent, and the answer says so", async () => {
  const log: string[] = [];
  const r = await runOne("publish", { workflowId: "w1", locationId: "L1", name: "A", status: "draft" }, {}, { ...deps(log), outward: { env: {}, audit: async () => undefined, log: () => undefined } });
  assert.equal(r.outcome, "dry_run");
  assert.deepEqual(log, []);
});

test("rename of a draft overwrites the definition once; of a published workflow it is draft, read again, overwrite, publish", async () => {
  const a: string[] = [];
  const draft = await runOne("rename", { workflowId: "w1", locationId: "L1", name: "Old", status: "draft" }, { newName: "New" }, deps(a));
  assert.equal(draft.outcome, "done");
  assert.deepEqual(a, ["GET /workflows/w1/definition", "PUT /workflows/w1/definition"]);
  const b: string[] = [];
  const pub = await runOne("rename", { workflowId: "w1", locationId: "L1", name: "Old", status: "published" }, { newName: "New" }, deps(b));
  assert.equal(pub.outcome, "done");
  assert.deepEqual(b, ["GET /workflows/w1/definition", "PUT /workflows/w1/status", "GET /workflows/w1/definition", "PUT /workflows/w1/definition", "PUT /workflows/w1/status"]);
});

test("delete saves a copy first and refuses when the copy cannot be read; missing permission is named exactly", async () => {
  const a: string[] = [];
  const r = await runOne("delete", { workflowId: "w1", locationId: "L1", name: "Old", status: "draft" }, {}, deps(a));
  assert.equal(r.outcome, "done");
  assert.ok(r.snapshot);
  assert.deepEqual(a, ["GET /workflows/w1/definition", "DELETE /workflows/w1"]);
  const denied = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
  const b = await runOne("delete", { workflowId: "w1", locationId: "L1", name: "Old", status: "draft" }, {}, deps([], { fetchImpl: denied }));
  assert.equal(b.outcome, "needs_permission");
  const c = await runOne("delete", { workflowId: "w1", locationId: "L1", name: "Old", status: "draft" }, {}, deps([], { granted: ["workflows.readonly"] }));
  assert.equal(c.outcome, "needs_permission");
  assert.match(c.message, /workflows\.delete/);
});

test("clone checks the other client account first and creates a draft there with a fresh version", async () => {
  const log: string[] = [];
  const r = await runOne("clone", { workflowId: "w1", locationId: "L1", name: "Old", status: "published" }, { targetLocationId: "L2" }, deps(log, { fetchImpl: mockFetch(log, { "/workflows/definition/validate": { valid: true }, "/workflows/": { workflowId: "n1" } }) }));
  assert.equal(r.outcome, "done");
  assert.equal(r.newWorkflowId, "n1");
  assert.deepEqual(log, ["GET /workflows/w1/definition", "POST /workflows/definition/validate", "POST /workflows/"]);
  const bad = await runOne("clone", { workflowId: "w1", locationId: "L1", name: "Old", status: "draft" }, { targetLocationId: "L2" }, deps([], { fetchImpl: mockFetch([], { "/workflows/definition/validate": { valid: false } }) }));
  assert.equal(bad.outcome, "skipped");
});
