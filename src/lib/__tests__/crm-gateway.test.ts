import assert from "node:assert/strict";
import { test } from "node:test";
import type { Person } from "../analytics/dedupe.ts";
import { platformWriter, type ChangeRow } from "../analytics/cleanup-platform.ts";
import { gatedWriter, mergeViaWorkflow, planWorkflowMerge, SPACING_MS, type WorkflowArgs } from "../ghl/crm-gateway.ts";

// The write gateway with a STUBBED platform only: no test here can reach a real endpoint. The master switch is passed as an environment object, never read from process.env.
const ON = { WRITE_GHL_LIVE: "true" };
const OFF = {};

const p = (id: string, o: Partial<Person> = {}): Person => ({
  contactId: id, name: "Ada Lovelace", email: "ada@x.com", phone: "+15550102030", tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null, source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...o,
});
const change = (o: Partial<ChangeRow> = {}): ChangeRow => ({ id: 1, contactId: "c1", rule: "phone", field: "phone", before: "(555) 010-2030", after: "+15550102030", tag: null, ...o });

function platform(contacts: Record<string, Record<string, unknown>>) {
  const calls: Array<{ method: string; path: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : null });
    const m = /^\/contacts\/([^/]+)$/.exec(u.pathname);
    if (m && (init.method ?? "GET") === "GET") return contacts[m[1]] ? Response.json({ contact: contacts[m[1]] }) : new Response(null, { status: 404 });
    return Response.json({ succeeded: true });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const recorder = () => {
  const lines: Array<{ action: string; detail: Record<string, unknown> }> = [];
  return { lines, audit: async (r: { installationId: string; action: string; detail: Record<string, unknown> }) => { lines.push({ action: r.action, detail: r.detail }); }, log: () => undefined };
};

// ---------- field writes ----------

test("switched off: nothing is sent, one WOULD WRITE line is recorded, the change stays pending", async () => {
  const f = platform({ c1: { phone: "(555) 010-2030" } });
  const rec = recorder();
  const w = gatedWriter(platformWriter("tok", f.fetchImpl), { installationId: "i", locationId: "L1", actor: "Ann", optedIn: true }, { env: OFF, audit: rec.audit, log: rec.log });
  assert.deepEqual(await w.apply(change()), { result: "dry_run", detail: "Switched off on the server: nothing was sent" });
  assert.deepEqual(await w.apply(change({ id: 2, contactId: "c2" })), { result: "dry_run", detail: "Switched off on the server: nothing was sent" });
  assert.equal(f.calls.length, 0, "no request of any kind");
  assert.equal(rec.lines.length, 1, "one line per run, not per contact");
  assert.equal(rec.lines[0].action, "dry_run.would_write");
  assert.equal(rec.lines[0].detail.what, "crm.contact.update");
  assert.deepEqual(rec.lines[0].detail.fields, ["phone"]);
});

test("the master switch on but this account has not allowed changes: still nothing is sent", async () => {
  const f = platform({ c1: { phone: "(555) 010-2030" } });
  const w = gatedWriter(platformWriter("tok", f.fetchImpl), { installationId: "i", locationId: "L1", actor: null, optedIn: false }, { env: ON, audit: recorder().audit, log: () => undefined });
  const out = await w.apply(change());
  assert.equal(out.result, "dry_run");
  assert.match(out.detail ?? "", /Not allowed for this account/);
  assert.equal(f.calls.length, 0);
});

test("both on: the change is spaced, sent after a re-read, and audited with ids and field names only", async () => {
  const f = platform({ c1: { phone: "(555) 010-2030" } });
  const rec = recorder();
  const waits: number[] = [];
  const w = gatedWriter(platformWriter("tok", f.fetchImpl), { installationId: "i", locationId: "L1", actor: "Ann", runId: "run-1", optedIn: true }, { env: ON, audit: rec.audit, log: rec.log, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(await w.apply(change()), { result: "applied" });
  assert.deepEqual(waits, [SPACING_MS], "calls are spaced under the platform's rate limit");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET", "PUT"], "it re-reads the contact before writing");
  assert.equal(rec.lines.length, 1);
  assert.equal(rec.lines[0].action, "crm.write");
  const text = JSON.stringify(rec.lines[0].detail);
  assert.ok(!text.includes("555") && !text.includes("Lovelace") && !text.includes("@"), "no phone number, name or email in the audit line");
  assert.deepEqual(rec.lines[0].detail, { what: "crm.contact.write", op: "apply.phone", locationId: "L1", contactId: "c1", fields: ["phone"], result: "applied", runId: "run-1" });
});

test("a contact changed since the preview is skipped, never overwritten; an undo restores the stored value", async () => {
  const f = platform({ c1: { phone: "+19998887777" } });
  const w = gatedWriter(platformWriter("tok", f.fetchImpl), { installationId: "i", locationId: "L1", actor: null, optedIn: true }, { env: ON, audit: recorder().audit, log: () => undefined, sleep: async () => undefined });
  assert.equal((await w.apply(change())).result, "skipped");
  assert.deepEqual(f.calls.map((c) => c.method), ["GET"], "nothing was written");
  const g = platform({ c1: { phone: "+15550102030" } });
  const u = gatedWriter(platformWriter("tok", g.fetchImpl), { installationId: "i", locationId: "L1", actor: null, optedIn: true }, { env: ON, audit: recorder().audit, log: () => undefined, sleep: async () => undefined });
  assert.equal((await u.revert(change())).result, "applied");
  assert.deepEqual(g.calls[1].body, { phone: "(555) 010-2030" }, "the stored before-value goes back");
});

test("an email fix is written to the email field only", async () => {
  const f = platform({ c1: { email: "ada@gmial.com" } });
  const w = gatedWriter(platformWriter("tok", f.fetchImpl), { installationId: "i", locationId: "L1", actor: null, optedIn: true }, { env: ON, audit: recorder().audit, log: () => undefined, sleep: async () => undefined });
  assert.equal((await w.apply(change({ rule: "email", field: "email", before: "ada@gmial.com", after: "ada@gmail.com" }))).result, "applied");
  assert.deepEqual(f.calls[1].body, { email: "ada@gmail.com" });
});

// ---------- merging through the customer's workflow ----------

test("the workflow route keeps the OLDER record, enrols the newer one, and refuses what it cannot do safely", () => {
  const a = p("old", { createdAt: "2026-01-01T00:00:00Z" });
  const b = p("new", { createdAt: "2026-03-01T00:00:00Z" });
  const plan = planWorkflowMerge([b, a], "new", { workflowId: "wf12345678", others: 0 });
  assert.equal(plan.survivorId, "old");
  assert.equal(plan.enrolId, "new");
  assert.equal(plan.survivorDiffers, true, "SubSync's pick was the newer one");
  assert.equal(plan.matchBy, "both");
  assert.deepEqual(plan.blockers, []);
  const ids = (x: ReturnType<typeof planWorkflowMerge>) => x.blockers.map((y) => y.id);
  assert.deepEqual(ids(planWorkflowMerge([a, b], "old", { workflowId: null, others: 0 })), ["no_workflow"]);
  assert.ok(ids(planWorkflowMerge([a, p("n", { dnd: true })], "old", { workflowId: "wf12345678", others: 0 })).includes("dnd"));
  assert.ok(ids(planWorkflowMerge([a, b, p("c3")], "old", { workflowId: "wf12345678", others: 0 })).includes("size"));
  assert.ok(ids(planWorkflowMerge([a, b], "old", { workflowId: "wf12345678", others: 2 })).includes("other_match"), "a third contact sharing the email would be merged too");
  assert.ok(ids(planWorkflowMerge([a, p("x", { email: "z@z.com", phone: "+19990001111" })], "old", { workflowId: "wf12345678", others: 0 })).includes("different"));
  assert.ok(ids(planWorkflowMerge([p("a", { email: "a@x.com", phone: null }), p("b", { email: "b@x.com", phone: null })], "a", { workflowId: "wf12345678", others: 0 })).includes("not_exact"));
  assert.ok(ids(planWorkflowMerge([a, p("n", { createdAt: null })], "old", { workflowId: "wf12345678", others: 0 })).includes("no_dates"));
  const warn = planWorkflowMerge([a, p("n", { createdAt: "2026-02-01T00:00:00Z", wonDeals: 1 })], "old", { workflowId: "wf12345678", others: 0 });
  assert.deepEqual(warn.warnings.map((x) => x.id), ["customer"], "a won deal on the record that goes is a warning to confirm, not a block");
});

const base = (o: Partial<WorkflowArgs> = {}): WorkflowArgs => ({
  installationId: "i", locationId: "L1", actor: "Ann", optedIn: true, workflowId: "wf12345678", people: [p("old"), p("new", { createdAt: "2026-03-01T00:00:00Z" })], pickedKeepId: "old", others: 0,
  confirmed: true, token: async () => "tok", workflowPublished: null, ...o,
});

test("no opt-in, no confirm, or a blocker: nothing is sent", async () => {
  const f = platform({});
  const d = { env: ON, audit: recorder().audit, log: () => undefined, fetchImpl: f.fetchImpl, sleep: async () => undefined };
  assert.equal((await mergeViaWorkflow(base({ optedIn: false }), d)).outcome, "opted_out");
  assert.equal((await mergeViaWorkflow(base({ confirmed: false }), d)).outcome, "blocked");
  assert.equal((await mergeViaWorkflow(base({ people: [p("old"), p("new", { createdAt: "2026-03-01T00:00:00Z", dnd: true })] }), d)).outcome, "blocked");
  assert.equal((await mergeViaWorkflow(base({ workflowPublished: false }), d)).outcome, "blocked");
  assert.equal((await mergeViaWorkflow(base({ workflowId: null }), d)).outcome, "blocked");
  assert.equal(f.calls.length, 0);
});

test("master switch off: a dry run is recorded and nothing is sent", async () => {
  const f = platform({});
  const rec = recorder();
  const r = await mergeViaWorkflow(base(), { env: OFF, audit: rec.audit, log: () => undefined, fetchImpl: f.fetchImpl, sleep: async () => undefined });
  assert.equal(r.outcome, "switched_off");
  assert.equal(f.calls.length, 0);
  assert.equal(rec.lines[0].detail.what, "crm.contact.merge_workflow");
  assert.equal(rec.lines[0].action, "dry_run.would_write");
});

test("everything on: the newer contact is added to the customer's workflow, and the write is audited", async () => {
  const f = platform({});
  const rec = recorder();
  const r = await mergeViaWorkflow(base(), { env: ON, audit: rec.audit, log: () => undefined, fetchImpl: f.fetchImpl, sleep: async () => undefined });
  assert.deepEqual(r, { outcome: "requested", survivorId: "old" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, "POST");
  assert.equal(f.calls[0].path, "/contacts/new/workflow/wf12345678");
  assert.equal(f.calls[0].headers.Authorization, "Bearer tok");
  assert.match(String((f.calls[0].body as { eventStartTime: string }).eventStartTime), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(rec.lines.at(-1)?.action, "crm.write");
  assert.equal(rec.lines.at(-1)?.detail.op, "merge_workflow");
});

test("a refused permission and a server error are named, and retried only by the person pressing again", async () => {
  const denied = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
  const d1 = { env: ON, audit: recorder().audit, log: () => undefined, fetchImpl: denied, sleep: async () => undefined };
  assert.equal((await mergeViaWorkflow(base(), d1)).outcome, "needs_permission");
  let n = 0;
  const broken = (async () => { n++; return new Response(null, { status: 500 }); }) as unknown as typeof fetch;
  const r = await mergeViaWorkflow(base(), { ...d1, fetchImpl: broken });
  assert.deepEqual(r, { outcome: "failed", status: 500 });
  assert.ok(n > 1, "the platform client retried the server error with backoff before giving up");
});
