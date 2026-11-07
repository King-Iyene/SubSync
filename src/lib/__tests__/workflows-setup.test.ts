import assert from "node:assert/strict";
import { test } from "node:test";
import { mapFailure, type Found, type Res, type WfClient } from "../workflows-setup/client.ts";
import { DEFAULT_CALL_TAG, DEFAULT_FOLDER, folderNameFor, hasVendorWord, neutralName } from "../workflows-setup/naming.ts";
import { provision, type Ctx, type Row, type Store } from "../workflows-setup/provisioner.ts";
import { resolveSteps, type StepType } from "../workflows-setup/steps.ts";
import { CALL_QUEUE, TEMPLATES } from "../workflows-setup/templates.ts";
import { DEFAULT_TAG } from "../dial/callqueue.ts";

// Every test uses a stubbed client and an in-memory store: nothing is ever sent.
const TYPES: StepType[] = [
  { id: "trg.tag", name: "Contact Tag", kind: "trigger" },
  { id: "act.manual_call", name: "Manual Action: Call", kind: "action" },
  { id: "act.rm_tag", name: "Remove Contact Tag", kind: "action" },
];
type Calls = string[];
function stub(o: { list?: Res<Found[]>; types?: Res<StepType[]>; create?: Res<{ id: string; folderId: string | null }>; publish?: Res<null>; validate?: Res<null> } = {}): { c: WfClient; calls: Calls } {
  const calls: Calls = [];
  const c: WfClient = {
    stepTypes: async () => { calls.push("types"); return o.types ?? { ok: true, value: TYPES }; },
    list: async () => { calls.push("list"); return o.list ?? { ok: true, value: [] }; },
    validate: async () => { calls.push("validate"); return o.validate ?? { ok: true, value: null }; },
    create: async () => { calls.push("create"); return o.create ?? { ok: true, value: { id: "wf-1", folderId: "fo-1" } }; },
    publish: async () => { calls.push("publish"); return o.publish ?? { ok: true, value: null }; },
  };
  return { c, calls };
}
function mem(initial: Row | null = null): Store & { row: Row | null } {
  const s = { row: initial, get: async () => s.row, save: async (r: Row) => { s.row = r; } };
  return s;
}
const base = (client: WfClient, store: Store, over: Partial<Ctx> = {}): Ctx => ({
  client, store, installationId: null, locationId: "L1", optedIn: true, manual: true, settings: { folderName: DEFAULT_FOLDER, tag: DEFAULT_CALL_TAG, assign: { mode: "round_robin" } },
  env: { WRITE_GHL_LIVE: "true" }, audit: async () => {}, log: () => {}, sleep: async () => {}, ...over,
});

test("creates once, publishes, and a second run creates nothing (idempotent)", async () => {
  const store = mem();
  const a = stub();
  const r1 = await provision(CALL_QUEUE, base(a.c, store));
  assert.equal(r1.state, "created");
  assert.deepEqual(a.calls.filter((x) => x === "create" || x === "publish"), ["create", "publish"]);
  assert.equal(store.row?.status, "active");
  const b = stub({ list: { ok: true, value: [{ id: "wf-1", name: "Call queue", status: "published", folderId: "fo-1" }] } });
  const r2 = await provision(CALL_QUEUE, base(b.c, store));
  assert.equal(r2.state, "ready");
  assert.ok(!b.calls.includes("create") && !b.calls.includes("publish"));
});

test("adopts a workflow with the exact name already in the account and creates nothing", async () => {
  const a = stub({ list: { ok: true, value: [{ id: "x9", name: "Call queue", status: "draft", folderId: null }] } });
  const store = mem();
  const r = await provision(CALL_QUEUE, base(a.c, store));
  assert.equal(r.state, "ready");
  assert.equal(store.row?.workflowId, "x9");
  assert.ok(!a.calls.includes("create") && !a.calls.includes("publish"), "a draft the person made is never published or edited");
});

test("a newer template version only shows 'Update available' and writes nothing", async () => {
  const old: Row = { templateKey: "call_queue", folderId: null, workflowId: "wf-1", templateVersion: 0, status: "active", lastError: null };
  const a = stub({ list: { ok: true, value: [{ id: "wf-1", name: "Renamed by the customer", status: "published", folderId: null }] } });
  const r = await provision(CALL_QUEUE, base(a.c, mem(old)));
  assert.equal(r.state, "update_available");
  assert.ok(!a.calls.includes("create") && !a.calls.includes("publish"));
});

test("a deleted workflow is not silently re-created by an automatic run, only by the button", async () => {
  const row: Row = { templateKey: "call_queue", folderId: null, workflowId: "gone", templateVersion: 1, status: "active", lastError: null };
  const auto = stub();
  const r = await provision(CALL_QUEUE, base(auto.c, mem(row), { manual: false }));
  assert.equal(r.state, "missing");
  assert.ok(!auto.calls.includes("create"));
  const hand = stub();
  assert.equal((await provision(CALL_QUEUE, base(hand.c, mem(row), { manual: true }))).state, "created");
});

test("dry run: master switch off, or account not opted in, sends nothing and says what would be created", async () => {
  for (const over of [{ env: { WRITE_GHL_LIVE: "false" } }, { optedIn: false }]) {
    const lines: string[] = [];
    const a = stub();
    const store = mem();
    const r = await provision(CALL_QUEUE, base(a.c, store, { ...over, installationId: "inst-1", audit: async (x) => { lines.push(x.action); } }));
    assert.equal(r.state, "would_create");
    assert.match(r.message, /Would create folder "Lead Response Automations" and workflow "Call queue"/);
    assert.ok(!a.calls.includes("create") && !a.calls.includes("publish") && !a.calls.includes("validate"));
    assert.equal(store.row, null);
    assert.deepEqual(lines, ["dry_run.would_write"], "one audit line per write");
  }
});

test("live: one audit line for create and one for publish, validated first", async () => {
  const lines: string[] = [];
  const a = stub();
  await provision(CALL_QUEUE, base(a.c, mem(), { installationId: "inst-1", audit: async (x) => { lines.push(x.action); } }));
  assert.ok(a.calls.indexOf("validate") < a.calls.indexOf("create"));
  assert.equal(a.calls.filter((x) => x === "create").length, 1);
  assert.deepEqual(lines, ["live.write", "live.write"], "one audit line per live write");
});

test("error mapping: not enabled, missing permission, rejected, failed", () => {
  assert.equal(mapFailure(403, { code: "WORKFLOW_API_NOT_ENABLED_FOR_LOCATION" }).kind, "not_enabled");
  assert.equal(mapFailure(403, { message: "forbidden" }).kind, "missing_scope");
  assert.equal(mapFailure(401, {}).kind, "missing_scope");
  assert.equal(mapFailure(422, {}).kind, "rejected");
  assert.equal(mapFailure(500, {}).kind, "failed");
});

test("each failure leaves the guide path: a calm message, no create, no throw", async () => {
  const cases: Array<[string, Partial<Parameters<typeof stub>[0]>, string]> = [
    ["not_enabled", { list: { ok: false, kind: "not_enabled", status: 403 } }, "not_enabled"],
    ["missing_scope", { types: { ok: false, kind: "missing_scope", status: 403 } }, "missing_scope"],
    ["rejected", { validate: { ok: false, kind: "rejected", status: 422 } }, "rejected"],
    ["step missing", { types: { ok: true, value: TYPES.filter((t) => !/Manual/.test(t.name)) } }, "step_missing"],
  ];
  for (const [name, o, code] of cases) {
    const a = stub(o);
    const r = await provision(CALL_QUEUE, base(a.c, mem()));
    assert.equal(r.state, "unavailable", name);
    assert.equal(r.code, code, name);
    assert.ok(!a.calls.includes("create"), name);
  }
  const a = stub({ types: { ok: true, value: TYPES.filter((t) => !/Manual/.test(t.name)) } });
  assert.match((await provision(CALL_QUEUE, base(a.c, mem()))).message, /Manual Action: Call/);
});

test("a created-but-unpublished workflow is published on the next run (ours), a failed publish is reported", async () => {
  const bad = stub({ publish: { ok: false, kind: "failed", status: 500 } });
  const store = mem();
  const r = await provision(CALL_QUEUE, base(bad.c, store));
  assert.match(r.message, /could not be published/);
  assert.equal(store.row?.status, "created_draft");
  const ok = stub({ list: { ok: true, value: [{ id: "wf-1", name: "Call queue", status: "draft", folderId: "fo-1" }] } });
  const r2 = await provision(CALL_QUEUE, base(ok.c, store));
  assert.equal(r2.state, "ready");
  assert.ok(ok.calls.includes("publish") && !ok.calls.includes("create"));
});

test("the definition is built from the real step ids, with a chosen user or round robin, never the contact owner", () => {
  const steps = resolveSteps(TYPES);
  assert.ok(steps.ok);
  if (!steps.ok) return;
  const rr = JSON.stringify(CALL_QUEUE.build({ folderName: "F", tag: "call-now", assign: { mode: "round_robin" }, steps }));
  assert.ok(rr.includes("act.manual_call") && rr.includes("round_robin") && !/owner/i.test(rr));
  assert.ok(JSON.stringify(CALL_QUEUE.build({ folderName: "F", tag: "t", assign: { mode: "user", userId: "u1" }, steps })).includes('"userId":"u1"'));
  assert.equal(resolveSteps([]).ok, false);
});

test("naming: default, brand, custom; never a vendor word; tag is neutral", () => {
  assert.equal(folderNameFor({}), "Lead Response Automations");
  assert.equal(folderNameFor({ brand: { whiteLabel: false, name: "Acme" } }), "Lead Response Automations");
  assert.equal(folderNameFor({ brand: { whiteLabel: true, name: "Acme Growth" } }), "Acme Growth Automations");
  assert.equal(folderNameFor({ brand: { whiteLabel: true, name: "SubSync Pro" } }), "Lead Response Automations");
  assert.equal(folderNameFor({ custom: "Sales Robots", brand: { whiteLabel: true, name: "Acme" } }), "Sales Robots");
  assert.equal(folderNameFor({ custom: "SubSync stuff" }), "Lead Response Automations");
  for (const bad of ["SubSync", "Sub Sync", "GoHighLevel", "High Level", "my ghl", "LeadConnector"]) assert.equal(hasVendorWord(bad), true, bad);
  assert.equal(neutralName("<script>"), null);
  for (const t of TEMPLATES) { assert.equal(hasVendorWord(t.name), false); assert.equal(hasVendorWord(JSON.stringify(t.build({ folderName: DEFAULT_FOLDER, tag: DEFAULT_CALL_TAG, assign: { mode: "round_robin" }, steps: resolveSteps(TYPES) as never }))), false); }
  assert.equal(hasVendorWord(DEFAULT_CALL_TAG), false);
  assert.equal(DEFAULT_TAG, "call-now");
});

test("a vendor word in a setting is refused before anything is read or sent", async () => {
  const a = stub();
  const r = await provision(CALL_QUEUE, base(a.c, mem(), { settings: { folderName: "SubSync Automations", tag: "call-now", assign: { mode: "round_robin" } } }));
  assert.equal(r.code, "bad_setting");
  assert.deepEqual(a.calls, []);
});
