import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEAL_BATCH_CAPS, beforeOf, bulkDeleteConfirmed, bulkDeletePhrase, deleteConfirmed, inversePatch, nextStageOf, parseAction, planAction, planBulk, unclogSuggestions,
  type DealFacts, type PipelineRef,
} from "../analytics/pipeline-actions.ts";
import { DEAL_WRITE_SCOPE, updateBody, writeDeal } from "../ghl/pipeline-gateway.ts";
import { resetLimits } from "../ghl/workbench.ts";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const PL: PipelineRef[] = [{ id: "xtest-p1", name: "Sales", stages: [{ id: "xtest-s1", name: "New" }, { id: "xtest-s2", name: "Quoted" }, { id: "xtest-s3", name: "Closing" }] }];
const deal = (o: Partial<DealFacts> = {}): DealFacts => ({ opportunityId: "xtest-d1", locationId: "xtest-loc", pipelineId: "xtest-p1", pipelineName: "Sales", stageId: "xtest-s1", stageName: "New", contactId: "xtest-c1", contactName: "Dana Reed", name: "Roof repair", value: 4000, status: "open", assignedTo: "xtest-u1", ...o });
const ctx = () => ({ now: NOW, pipelines: PL, teamIds: ["xtest-u1", "xtest-u2"] as string[] | null });

test("parseAction keeps only known actions and drops unknown keys", () => {
  assert.equal(parseAction({ kind: "stage", pipelineId: "xtest-p1", stageId: "xtest-s2" }).ok, true);
  assert.equal(parseAction({ kind: "stage", pipelineId: "../x", stageId: "xtest-s2" }).ok, false);
  assert.equal(parseAction({ kind: "value", value: -5 }).ok, false);
  assert.equal(parseAction({ kind: "value", value: "12.5" }).ok, true);
  assert.equal(parseAction({ kind: "value", value: 1e12 }).ok, false);
  assert.equal(parseAction({ kind: "status", status: "paid" }).ok, false);
  assert.equal(parseAction({ kind: "status", status: "lost", reason: "because" }).ok, false);
  const r = parseAction({ kind: "status", status: "lost", reason: "price", junk: 1 });
  assert.ok(r.ok && !("junk" in r.action));
  assert.equal(parseAction({ kind: "owner", userId: "x" }).ok, false);
  assert.equal(parseAction({ kind: "task", title: "Call", dueDate: "soon" }).ok, false);
  assert.equal(parseAction({ kind: "nope" }).ok, false);
});

test("stage move: valid, same stage, unknown stage, closed deal warning", () => {
  const ok = planAction({ kind: "stage", pipelineId: "xtest-p1", stageId: "xtest-s2" }, deal(), ctx());
  assert.equal(ok.blockers.length, 0);
  assert.deepEqual(ok.patch, { stageId: "xtest-s2" });
  assert.equal(planAction({ kind: "stage", pipelineId: "xtest-p1", stageId: "xtest-s1" }, deal(), ctx()).blockers[0]?.id, "same");
  assert.equal(planAction({ kind: "stage", pipelineId: "xtest-p1", stageId: "xtest-zzz" }, deal(), ctx()).blockers[0]?.id, "stage", "a stage of another account is refused");
  assert.ok(planAction({ kind: "stage", pipelineId: "xtest-p1", stageId: "xtest-s2" }, deal({ status: "won" }), ctx()).warnings.some((w) => w.id === "closed"));
});

test("owner: must be on the team; a deal with no owner cannot be put back", () => {
  assert.equal(planAction({ kind: "owner", userId: "xtest-u9" }, deal(), ctx()).blockers[0]?.id, "owner");
  assert.equal(planAction({ kind: "owner", userId: "xtest-u1" }, deal(), ctx()).blockers[0]?.id, "same");
  const p = planAction({ kind: "owner", userId: "xtest-u2" }, deal({ assignedTo: null }), ctx());
  assert.equal(p.reversible, false);
  assert.ok(p.warnings.some((w) => w.id === "noundo"));
});

test("lost needs a reason; won with no value warns; value warnings", () => {
  assert.equal(planAction({ kind: "status", status: "lost" }, deal(), ctx()).blockers[0]?.id, "reason");
  const lost = planAction({ kind: "status", status: "lost", reason: "price" }, deal(), ctx());
  assert.equal(lost.blockers.length, 0); assert.equal(lost.reason, "price"); assert.deepEqual(lost.patch, { status: "lost" });
  assert.ok(planAction({ kind: "status", status: "won" }, deal({ value: 0 }), ctx()).warnings.some((w) => w.id === "novalue"));
  assert.equal(planAction({ kind: "status", status: "open" }, deal(), ctx()).blockers[0]?.id, "same");
  assert.ok(planAction({ kind: "value", value: 0 }, deal(), ctx()).warnings.some((w) => w.id === "zero"));
  assert.ok(planAction({ kind: "value", value: 90000 }, deal(), ctx()).warnings.some((w) => w.id === "big"));
});

test("delete needs the typed words, names the deal, and says it cannot be undone", () => {
  const d = deal();
  const p = planAction({ kind: "delete", typed: "" }, d, ctx());
  assert.equal(p.blockers[0]?.id, "confirm"); assert.equal(p.reversible, false); assert.equal(p.confirm?.needed, true);
  assert.ok(p.summary.includes("Roof repair"));
  assert.equal(deleteConfirmed("delete", d), true);
  assert.equal(deleteConfirmed("  roof   REPAIR ", d), true);
  assert.equal(deleteConfirmed("yes", d), false);
  assert.equal(planAction({ kind: "delete", typed: "DELETE" }, d, ctx()).blockers.length, 0);
  assert.ok(planAction({ kind: "delete", typed: "DELETE" }, deal({ status: "won" }), ctx()).warnings.some((w) => w.id === "won"));
  assert.ok(planAction({ kind: "delete", typed: "DELETE" }, deal({ upcomingAppointments: 1 }), ctx()).warnings.some((w) => w.id === "appt"));
});

test("bulk delete: typed exact count, never won, never with an appointment, never an open deal with money", () => {
  const items = [deal({ opportunityId: "xtest-a", status: "lost", value: 0 }), deal({ opportunityId: "xtest-b", status: "won" }), deal({ opportunityId: "xtest-c", upcomingAppointments: 2, status: "lost" }), deal({ opportunityId: "xtest-d" }), deal({ opportunityId: "xtest-e", status: "open", value: 0 })];
  const p = planBulk("delete", items, {});
  assert.deepEqual(p.allowed.map((f) => f.opportunityId), ["xtest-a", "xtest-e"]);
  assert.equal(p.skipped.length, 3);
  assert.equal(p.phrase, bulkDeletePhrase(2));
  assert.equal(bulkDeleteConfirmed("Delete 2", 2), true);
  assert.equal(bulkDeleteConfirmed("delete", 2), false);
  assert.equal(bulkDeleteConfirmed("delete 3", 2), false);
});

test("bulk caps, duplicates and already-done items", () => {
  const many = Array.from({ length: 130 }, (_, i) => deal({ opportunityId: `xtest-${i}`, assignedTo: "xtest-u1" }));
  const p = planBulk("owner", [...many, many[0]], { userId: "xtest-u2" });
  assert.equal(p.allowed.length, DEAL_BATCH_CAPS.owner); assert.equal(p.overCap, 30);
  assert.equal(planBulk("owner", [deal()], { userId: "xtest-u1" }).skipped[0]?.reason, "already theirs");
  assert.equal(planBulk("task", [deal({ contactId: null })], {}).skipped[0]?.reason, "no contact");
});

test("unclog suggestions: claim when ownerless, follow-up task, advance, close as lost; never for a closed deal", () => {
  const s = unclogSuggestions(deal({ assignedTo: null }), { now: NOW, me: "xtest-u2", nextStage: nextStageOf(PL, "xtest-p1", "xtest-s1"), pipelineId: "xtest-p1", staleDays: 21 });
  assert.deepEqual(s.map((x) => x.id), ["claim", "task", "advance", "lost"]);
  assert.equal(s.find((x) => x.id === "lost")?.action.kind, "status");
  assert.equal(unclogSuggestions(deal({ status: "won" }), { now: NOW, me: "xtest-u2", nextStage: null, pipelineId: "xtest-p1" }).length, 0);
  assert.equal(nextStageOf(PL, "xtest-p1", "xtest-s3"), null);
});

test("undo: the inverse comes from what was before, and delete, note and task have none", () => {
  const patch = { stageId: "xtest-s2", status: "won" as const, value: 10 };
  const before = beforeOf(deal(), patch);
  assert.deepEqual(before, { stageId: "xtest-s1", pipelineId: "xtest-p1", status: "open", value: 4000 });
  assert.deepEqual(inversePatch("stage", before), { stageId: "xtest-s1", pipelineId: "xtest-p1", status: "open", value: 4000 });
  assert.equal(inversePatch("remove", {}), null); assert.equal(inversePatch("delete", {}), null); assert.equal(inversePatch("note", { status: "open" }), null);
});

test("gateway request body maps to the platform field names", () => {
  assert.deepEqual(updateBody({ stageId: "s", pipelineId: "p", status: "won", value: 5, assignedTo: "u", name: "n" }), { pipelineId: "p", pipelineStageId: "s", status: "won", monetaryValue: 5, assignedTo: "u", name: "n" });
  assert.equal(DEAL_WRITE_SCOPE, "opportunities.write");
});

const base = { installationId: "xtest-inst", locationId: "xtest-loc", actor: "xtest-u1", contactId: "xtest-c1", opportunityId: "xtest-d1", token: async () => "xtest-token" };

test("gateway: dry run when the switch is off or the account has not opted in; nothing is sent", async () => {
  resetLimits();
  let calls = 0; const fetchImpl = (async () => { calls++; return new Response("{}", { status: 200 }); }) as typeof fetch;
  const audit = async () => {};
  const a = await writeDeal({ ...base, op: "update", patch: { status: "won" }, optedIn: true }, { env: {}, fetchImpl, sleep: async () => {}, audit });
  assert.equal(a.outcome, "dry_run");
  const b = await writeDeal({ ...base, op: "delete", optedIn: false }, { env: { WRITE_GHL_LIVE: "true" }, fetchImpl, sleep: async () => {}, audit });
  assert.equal(b.outcome, "dry_run"); assert.equal(b.outcome === "dry_run" && b.reason, "account");
  assert.equal(calls, 0);
});

test("gateway live: sends the right request, 404 on delete counts as done, 403 is needs_permission, 500 is failed", async () => {
  resetLimits();
  const seen: Array<{ url: string; method: string; body: string | null }> = [];
  const mk = (status: number) => (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), method: init?.method ?? "GET", body: (init?.body as string | undefined) ?? null }); return new Response("{}", { status }); }) as typeof fetch;
  const env = { WRITE_GHL_LIVE: "true" };
  const audit = async () => {};
  const up = await writeDeal({ ...base, op: "update", patch: { status: "lost" }, optedIn: true }, { env, fetchImpl: mk(200), sleep: async () => {}, audit });
  assert.equal(up.outcome, "done");
  assert.equal(seen[0].method, "PUT"); assert.ok(seen[0].url.endsWith("/opportunities/xtest-d1")); assert.equal(seen[0].body, JSON.stringify({ status: "lost" }));
  assert.equal((await writeDeal({ ...base, op: "delete", optedIn: true }, { env, fetchImpl: mk(404), sleep: async () => {}, audit })).outcome, "done");
  assert.equal(seen[1].method, "DELETE");
  assert.equal((await writeDeal({ ...base, op: "update", patch: { value: 1 }, optedIn: true }, { env, fetchImpl: mk(403), sleep: async () => {}, audit })).outcome, "needs_permission");
  assert.equal((await writeDeal({ ...base, op: "update", patch: { value: 1 }, optedIn: true }, { env, fetchImpl: mk(500), sleep: async () => {}, audit })).outcome, "failed");
});
