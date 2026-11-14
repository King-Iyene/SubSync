import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUSTOM_VALUE_WRITE_SCOPE, PIPELINE_CREATE_SCOPE, SLA_VALUE_NAME, STANDARD_PIPELINE, TAG_WRITE_SCOPE, TASK_WRITE_SCOPE,
  checkSlaMinutes, checkTagName, completeTask, createPipeline, createTag, customValueBody, deleteTask, deleteTaskConfirmed, pipelineBody, planCustomValue, setCustomValue, tagBody,
} from "../ghl/safe-writes-gateway.ts";
import { resetLimits } from "../ghl/workbench.ts";

const base = { installationId: "xtest-inst", locationId: "xtest-loc", actor: "xtest-user", optedIn: true, token: async () => "xtest-token" };
const LIVE = { WRITE_GHL_LIVE: "true" };
type Seen = { url: string; method: string; body: string | null; version: string | null };
function stub(status = 200, answer: unknown = {}) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method ?? "GET", body: (init?.body as string | undefined) ?? null, version: ((init?.headers ?? {}) as Record<string, string>).Version ?? null });
    return new Response(JSON.stringify(answer), { status });
  }) as typeof fetch;
  return { seen, fetchImpl };
}
function recorder() {
  const rows: Array<{ installationId: string; action: string; detail: Record<string, unknown> }> = [];
  return { rows, audit: async (r: (typeof rows)[number]) => { rows.push(r); } };
}
const fresh = () => { resetLimits(); return recorder(); };
const sleep = async () => {};

// ---------------- pure rules ----------------

test("tag name: plain, trimmed, at most 60, no comma or markup", () => {
  assert.deepEqual(checkTagName("  needs   first reply "), { ok: true, name: "needs first reply" });
  assert.equal(checkTagName("").ok, false);
  assert.equal(checkTagName("a,b").ok, false);
  assert.equal(checkTagName("<b>x</b>").ok, false);
  assert.equal(checkTagName("x".repeat(61)).ok, false);
  assert.equal(checkTagName(42).ok, false);
  assert.deepEqual(tagBody("call-now"), { name: "call-now" });
});

test("standard pipeline: six stages in order with unique positions, named SubSync Sales", () => {
  const b = pipelineBody("xtest-loc") as { name: string; locationId: string; stages: Array<{ name: string; position: number }> };
  assert.equal(b.name, "SubSync Sales");
  assert.equal(b.locationId, "xtest-loc");
  assert.deepEqual(b.stages.map((s) => s.name), ["New lead", "Contacted", "Booked", "Showed", "Won", "Lost"]);
  assert.deepEqual(b.stages.map((s) => s.position), [0, 1, 2, 3, 4, 5]);
  assert.equal(STANDARD_PIPELINE.stages.length, 6);
});

test("reply target: a whole number of minutes, 1 to 1440; the value is stored as text under subsync_sla_minutes", () => {
  assert.deepEqual(checkSlaMinutes(15), { ok: true, minutes: 15 });
  assert.deepEqual(checkSlaMinutes("30"), { ok: true, minutes: 30 });
  for (const bad of [0, -1, 1441, 2.5, "", "abc", null, NaN]) assert.equal(checkSlaMinutes(bad).ok, false, String(bad));
  assert.deepEqual(customValueBody(15), { name: SLA_VALUE_NAME, value: "15" });
  assert.equal(SLA_VALUE_NAME, "subsync_sla_minutes");
});

test("custom value plan: create when missing, update when different, unchanged when equal", () => {
  assert.equal(planCustomValue(null, 15), "create");
  assert.equal(planCustomValue({ id: "xtest-v1", value: "10" }, 15), "update");
  assert.equal(planCustomValue({ id: "xtest-v1", value: " 15 " }, 15), "unchanged");
});

test("task delete confirmation: the task's own name typed back, any case", () => {
  assert.equal(deleteTaskConfirmed("Call Dana", "call dana"), true);
  assert.equal(deleteTaskConfirmed("Call Dana", "Call"), false);
  assert.equal(deleteTaskConfirmed("", ""), false);
});

test("scopes: the four permissions and the one the task endpoints really use", () => {
  assert.equal(TAG_WRITE_SCOPE, "locations/tags.write");
  assert.equal(PIPELINE_CREATE_SCOPE, "pipelines.create");
  assert.equal(CUSTOM_VALUE_WRITE_SCOPE, "locations/customValues.write");
  assert.equal(TASK_WRITE_SCOPE, "contacts.write");
});

// ---------------- tag ----------------

test("tag: practice run when the switch is off, and when the account is not allowed; nothing is sent", async () => {
  const { rows, audit } = fresh();
  const { seen, fetchImpl } = stub();
  const a = await createTag({ ...base, name: "call-now", existing: [] }, { env: {}, fetchImpl, sleep, audit });
  assert.equal(a.outcome, "dry_run"); assert.equal(a.outcome === "dry_run" && a.reason, "switch");
  assert.ok(a.outcome === "dry_run" && a.line.startsWith("WOULD WRITE crm.tag.create"));
  const b = await createTag({ ...base, optedIn: false, name: "call-now", existing: [] }, { env: LIVE, fetchImpl, sleep, audit });
  assert.equal(b.outcome === "dry_run" && b.reason, "account");
  assert.equal(seen.length, 0);
  assert.ok(rows.every((r) => r.action === "dry_run.would_write"));
  assert.ok(!JSON.stringify(rows).includes("call-now"), "the tag name is never written to the audit trail");
});

test("tag: live sends POST /locations/{id}/tags with the name only, audits once, no tag name in the audit line", async () => {
  const { rows, audit } = fresh();
  const { seen, fetchImpl } = stub(200, { tag: { id: "xtest-t1", name: "call-now" } });
  const r = await createTag({ ...base, name: "call-now", existing: ["other"] }, { env: LIVE, fetchImpl, sleep, audit });
  assert.deepEqual(r, { outcome: "done", id: "xtest-t1" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, "POST"); assert.ok(seen[0].url.endsWith("/locations/xtest-loc/tags")); assert.equal(seen[0].body, JSON.stringify({ name: "call-now" }));
  assert.equal(seen[0].version, "2021-07-28");
  const audits = rows.filter((x) => x.action === "crm.write");
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].detail.fields, ["name"]); assert.equal(audits[0].detail.result, "done"); assert.equal(audits[0].detail.op, "tag.create");
  assert.ok(!JSON.stringify(rows).includes("call-now"));
});

test("tag: idempotent. An existing tag (any case) is never created again, before or just before the call", async () => {
  const { audit } = fresh();
  const { seen, fetchImpl } = stub();
  assert.deepEqual(await createTag({ ...base, name: "Call-Now", existing: ["call-now"] }, { env: LIVE, fetchImpl, sleep, audit }), { outcome: "already" });
  assert.deepEqual(await createTag({ ...base, name: "call-now", existing: [], recheck: async () => ["CALL-NOW"] }, { env: LIVE, fetchImpl, sleep, audit }), { outcome: "already" });
  assert.equal(seen.length, 0);
});

test("tag: a bad name is blocked, 403 is needs_permission, 500 is failed", async () => {
  const { audit } = fresh();
  assert.equal((await createTag({ ...base, name: "a,b", existing: [] }, { env: LIVE, fetchImpl: stub().fetchImpl, sleep, audit })).outcome, "blocked");
  assert.equal((await createTag({ ...base, name: "x1", existing: [] }, { env: LIVE, fetchImpl: stub(403).fetchImpl, sleep, audit })).outcome, "needs_permission");
  assert.deepEqual(await createTag({ ...base, name: "x2", existing: [] }, { env: LIVE, fetchImpl: stub(500).fetchImpl, sleep, audit }), { outcome: "failed", status: 500 });
});

// ---------------- pipeline ----------------

test("pipeline: only for an account with none. One that has a pipeline is blocked and nothing is sent", async () => {
  const { audit } = fresh();
  const { seen, fetchImpl } = stub();
  const r = await createPipeline({ ...base, existingCount: 2 }, { env: LIVE, fetchImpl, sleep, audit });
  assert.equal(r.outcome, "blocked");
  assert.equal(seen.length, 0);
});

test("pipeline: practice run, then live sends POST /opportunities/pipelines with the six stages; recheck makes it idempotent", async () => {
  const { rows, audit } = fresh();
  const s1 = stub();
  assert.equal((await createPipeline({ ...base, existingCount: 0 }, { env: {}, fetchImpl: s1.fetchImpl, sleep, audit })).outcome, "dry_run");
  assert.equal(s1.seen.length, 0);
  const s2 = stub(200, { id: "xtest-p1", name: "SubSync Sales" });
  const r = await createPipeline({ ...base, existingCount: 0 }, { env: LIVE, fetchImpl: s2.fetchImpl, sleep, audit });
  assert.deepEqual(r, { outcome: "done", id: "xtest-p1" });
  assert.equal(s2.seen[0].method, "POST"); assert.ok(s2.seen[0].url.endsWith("/opportunities/pipelines"));
  assert.equal(s2.seen[0].body, JSON.stringify(pipelineBody("xtest-loc")));
  const s3 = stub();
  assert.deepEqual(await createPipeline({ ...base, existingCount: 0, recheck: async () => 1 }, { env: LIVE, fetchImpl: s3.fetchImpl, sleep, audit }), { outcome: "already" });
  assert.equal(s3.seen.length, 0);
  assert.equal(rows.filter((x) => x.action === "crm.write").length, 2, "one audit line for the write and one for the stopped repeat");
});

test("pipeline: no permission is named, not blurred", async () => {
  const { audit } = fresh();
  assert.equal((await createPipeline({ ...base, existingCount: 0 }, { env: LIVE, fetchImpl: stub(401).fetchImpl, sleep, audit })).outcome, "needs_permission");
});

// ---------------- custom value ----------------

test("custom value: create when missing (POST), update when it exists (PUT by id), unchanged when equal", async () => {
  const { audit } = fresh();
  const c = stub(200, { customValue: { id: "xtest-v9" } });
  assert.deepEqual(await setCustomValue({ ...base, minutes: 15, existing: null }, { env: LIVE, fetchImpl: c.fetchImpl, sleep, audit }), { outcome: "done", id: "xtest-v9" });
  assert.equal(c.seen[0].method, "POST"); assert.ok(c.seen[0].url.endsWith("/locations/xtest-loc/customValues")); assert.equal(c.seen[0].body, JSON.stringify({ name: "subsync_sla_minutes", value: "15" }));
  const u = stub();
  assert.equal((await setCustomValue({ ...base, minutes: 20, existing: { id: "xtest-v1", value: "15" } }, { env: LIVE, fetchImpl: u.fetchImpl, sleep, audit })).outcome, "done");
  assert.equal(u.seen[0].method, "PUT"); assert.ok(u.seen[0].url.endsWith("/locations/xtest-loc/customValues/xtest-v1")); assert.equal(u.seen[0].body, JSON.stringify({ name: "subsync_sla_minutes", value: "20" }));
  const n = stub();
  assert.deepEqual(await setCustomValue({ ...base, minutes: 15, existing: { id: "xtest-v1", value: "15" } }, { env: LIVE, fetchImpl: n.fetchImpl, sleep, audit }), { outcome: "unchanged" });
  assert.equal(n.seen.length, 0);
});

test("custom value: practice run sends nothing; a failed re-read stops the write instead of guessing; a bad number is blocked", async () => {
  const { rows, audit } = fresh();
  const p = stub();
  assert.equal((await setCustomValue({ ...base, minutes: 15, existing: null }, { env: {}, fetchImpl: p.fetchImpl, sleep, audit })).outcome, "dry_run");
  assert.equal((await setCustomValue({ ...base, optedIn: false, minutes: 15, existing: null }, { env: LIVE, fetchImpl: p.fetchImpl, sleep, audit })).outcome, "dry_run");
  const f = stub();
  assert.deepEqual(await setCustomValue({ ...base, minutes: 15, existing: null, recheck: async () => undefined }, { env: LIVE, fetchImpl: f.fetchImpl, sleep, audit }), { outcome: "failed", status: 0 });
  assert.equal(p.seen.length + f.seen.length, 0);
  assert.equal((await setCustomValue({ ...base, minutes: 0, existing: null }, { env: LIVE, fetchImpl: f.fetchImpl, sleep, audit })).outcome, "blocked");
  // recheck found the same value in the meantime: nothing to write
  assert.deepEqual(await setCustomValue({ ...base, minutes: 15, existing: null, recheck: async () => ({ id: "xtest-v2", value: "15" }) }, { env: LIVE, fetchImpl: f.fetchImpl, sleep, audit }), { outcome: "unchanged" });
  assert.ok(!JSON.stringify(rows).includes('"15"'), "the stored value is not written to the audit trail");
});

// ---------------- tasks ----------------

const task = { ...base, contactId: "xtest-c1", taskId: "xtest-task1" };

test("task done: PUT /contacts/{c}/tasks/{t}/completed with completed true; practice run sends nothing; 403 is needs_permission", async () => {
  const { rows, audit } = fresh();
  const d = stub();
  assert.equal((await completeTask(task, { env: {}, fetchImpl: d.fetchImpl, sleep, audit })).outcome, "dry_run");
  assert.equal(d.seen.length, 0);
  const l = stub(200, { task: { id: "xtest-task1", completed: true } });
  assert.equal((await completeTask(task, { env: LIVE, fetchImpl: l.fetchImpl, sleep, audit })).outcome, "done");
  assert.equal(l.seen[0].method, "PUT"); assert.ok(l.seen[0].url.endsWith("/contacts/xtest-c1/tasks/xtest-task1/completed")); assert.equal(l.seen[0].body, JSON.stringify({ completed: true }));
  assert.equal((await completeTask(task, { env: LIVE, fetchImpl: stub(403).fetchImpl, sleep, audit })).outcome, "needs_permission");
  const line = rows.find((x) => x.action === "crm.write")!;
  assert.deepEqual(line.detail.ids, { contactId: "xtest-c1", taskId: "xtest-task1" });
  assert.equal((await completeTask({ ...task, taskId: "../x" }, { env: LIVE, fetchImpl: l.fetchImpl, sleep, audit })).outcome, "blocked");
});

test("task delete: only a task SubSync made, only with its name typed back, only through the live switch and the account's opt-in", async () => {
  const { rows, audit } = fresh();
  const s = stub();
  const mk = (o: object) => ({ ...task, title: "Call Dana back", confirmText: "Call Dana back", ours: true, ...o });
  assert.equal((await deleteTask(mk({ ours: false }), { env: LIVE, fetchImpl: s.fetchImpl, sleep, audit })).outcome, "blocked");
  assert.equal((await deleteTask(mk({ confirmText: "" }), { env: LIVE, fetchImpl: s.fetchImpl, sleep, audit })).outcome, "blocked");
  assert.equal((await deleteTask(mk({ confirmText: "Call Dana" }), { env: LIVE, fetchImpl: s.fetchImpl, sleep, audit })).outcome, "blocked");
  assert.equal(s.seen.length, 0, "a refused delete sends nothing");
  assert.equal((await deleteTask(mk({}), { env: {}, fetchImpl: s.fetchImpl, sleep, audit })).outcome, "dry_run");
  assert.equal((await deleteTask(mk({ optedIn: false }), { env: LIVE, fetchImpl: s.fetchImpl, sleep, audit })).outcome, "dry_run");
  assert.equal(s.seen.length, 0);
  assert.equal((await deleteTask(mk({ confirmText: "CALL DANA BACK" }), { env: LIVE, fetchImpl: s.fetchImpl, sleep, audit })).outcome, "done");
  assert.equal(s.seen.length, 1);
  assert.equal(s.seen[0].method, "DELETE"); assert.ok(s.seen[0].url.endsWith("/contacts/xtest-c1/tasks/xtest-task1"));
  assert.equal((await deleteTask(mk({}), { env: LIVE, fetchImpl: stub(404).fetchImpl, sleep, audit })).outcome, "done", "already gone is what a delete wanted");
  assert.ok(!JSON.stringify(rows).includes("Dana"), "the task name is never written to the audit trail");
  assert.ok(rows.some((r) => r.action === "dry_run.would_write" && (r.detail.what === "crm.task.delete")));
});

test("rate limit: more than 30 writes a minute for one installation are held back, nothing is sent for them", async () => {
  const { audit } = fresh();
  const { seen, fetchImpl } = stub();
  let held = 0;
  for (let i = 0; i < 32; i++) { const r = await completeTask({ ...task, taskId: `xtest-t${i + 100}` }, { env: LIVE, fetchImpl, sleep, audit }); if (r.outcome === "rate_limited") held++; }
  assert.equal(held, 2);
  assert.equal(seen.length, 30);
});
