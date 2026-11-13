import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Found, Res, WfClient } from "../workflows-setup/client.ts";
import { judgeCheck } from "../workflows-setup/check.ts";
import { handSteps } from "../workflows-setup/hand-steps.ts";
import { DEFAULT_FOLDER, DEFAULT_CALL_TAG, hasVendorWord } from "../workflows-setup/naming.ts";
import { DEFAULT_SETUP, missingSetupScopes, provision, type Ctx, type Row, type Store } from "../workflows-setup/provisioner.ts";
import { resolveSteps, type StepType } from "../workflows-setup/steps.ts";
import { CALL_QUEUE } from "../workflows-setup/templates.ts";
import { GHL_SCOPES } from "../ghl/scopes.ts";
import { infoFor } from "../scope-groups.ts";
import { scopeWords } from "../scope-words.ts";

// Automatic call queue workflow: every case uses a stub client and an in-memory store. Nothing is sent.
const TYPES: StepType[] = [
  { id: "trg.tag", name: "Contact Tag", kind: "trigger" },
  { id: "act.manual_call", name: "Manual Action: Call", kind: "action" },
  { id: "act.rm_tag", name: "Remove Contact Tag", kind: "action" },
];
function stub(o: { list?: Res<Found[]>; types?: Res<StepType[]>; validate?: Res<null> } = {}) {
  const calls: string[] = [];
  const c: WfClient = {
    stepTypes: async () => { calls.push("types"); return o.types ?? { ok: true, value: TYPES }; },
    list: async () => { calls.push("list"); return o.list ?? { ok: true, value: [] }; },
    validate: async () => { calls.push("validate"); return o.validate ?? { ok: true, value: null }; },
    create: async () => { calls.push("create"); return { ok: true, value: { id: "wf-1", folderId: "fo-1" } }; },
    publish: async () => { calls.push("publish"); return { ok: true, value: null }; },
  };
  return { c, calls };
}
const mem = (initial: Row | null = null): Store & { row: Row | null } => { const s = { row: initial, get: async () => s.row, save: async (r: Row) => { s.row = r; } }; return s; };
const ctx = (client: WfClient, store: Store, over: Partial<Ctx> = {}): Ctx => ({
  client, store, installationId: null, locationId: "L1", optedIn: true, manual: true, settings: { folderName: DEFAULT_FOLDER, tag: DEFAULT_CALL_TAG, assign: { mode: "round_robin" } },
  env: { WRITE_GHL_LIVE: "true" }, audit: async () => {}, log: () => {}, sleep: async () => {}, ...over,
});
const GRANTED = ["workflows.readonly", "workflows.write", "contacts.readonly"];

test("definition builder: three steps for the account's own tag, real step ids, folder created if missing", () => {
  const steps = resolveSteps(TYPES);
  assert.ok(steps.ok);
  if (!steps.ok) return;
  const d = CALL_QUEUE.build({ folderName: "Sales Automations", tag: "ring-me", assign: { mode: "user", userId: "u1" }, steps }) as Record<string, any>;
  assert.equal(d.name, "Call queue");
  assert.equal(d.folderName, "Sales Automations");
  assert.equal(d.createFolderIfMissing, true);
  assert.deepEqual(d.triggers.map((t: any) => [t.type, t.config.tags]), [["trg.tag", ["ring-me"]]]);
  assert.deepEqual(d.actions.map((a: any) => a.type), ["act.manual_call", "act.rm_tag"]);
  assert.deepEqual(d.actions[1].config.tags, ["ring-me"]);
  assert.deepEqual(d.actions[0].config.assignTo, { type: "user", userId: "u1" });
  assert.deepEqual(d.edges, [{ source: "t1", target: "a1" }, { source: "a1", target: "a2" }]);
  assert.ok(!hasVendorWord(JSON.stringify(d)), "no product or platform name in anything sent to the customer's CRM");
});

test("scope missing: needs_permission, no request of any kind, hand-built steps returned", () => {
  const a = stub();
  return provision(CALL_QUEUE, ctx(a.c, mem(), { granted: ["workflows.readonly"] })).then((r) => {
    assert.equal(r.state, "needs_permission");
    assert.equal(r.code, "missing_scope");
    assert.deepEqual(a.calls, []);
    assert.ok(r.steps && r.steps.length === 5);
    assert.match(r.message, /^Needs permission/);
  });
});

test("scope list unknown (null) blocks nothing; both scopes present is fine", () => {
  assert.equal(missingSetupScopes(null), null);
  assert.equal(missingSetupScopes(GRANTED), null);
  assert.deepEqual(missingSetupScopes(["workflows.write"]), ["workflows.readonly"]);
});

test("403 WORKFLOW_API_NOT_ENABLED: unavailable with a plain reason and the hand-built steps, nothing created", async () => {
  const a = stub({ list: { ok: false, kind: "not_enabled", status: 403 } });
  const st = mem();
  const r = await provision(CALL_QUEUE, ctx(a.c, st, { granted: GRANTED }));
  assert.equal(r.state, "unavailable");
  assert.equal(r.code, "not_enabled");
  assert.ok(r.steps?.some((s) => s.includes("call-now")));
  assert.ok(!a.calls.includes("create"));
  assert.equal(st.row, null, "no list result and no stored row: nothing to record");
  // the same answer arrives at a later step (the list read worked, creating did not)
  const b = stub({ types: { ok: false, kind: "not_enabled", status: 403 } });
  const r2 = await provision(CALL_QUEUE, ctx(b.c, mem(), { granted: GRANTED }));
  assert.equal(r2.state, "unavailable");
  assert.ok(r2.steps);
});

test("a missing step type fails soft with the names and the steps", async () => {
  const a = stub({ types: { ok: true, value: TYPES.slice(0, 2) } });
  const r = await provision(CALL_QUEUE, ctx(a.c, mem(), { granted: GRANTED }));
  assert.equal(r.state, "unavailable");
  assert.equal(r.code, "step_missing");
  assert.match(r.message, /Remove tag/);
  assert.ok(r.steps);
});

test("validate refusal stops before create", async () => {
  const a = stub({ validate: { ok: false, kind: "rejected", status: 400 } });
  const r = await provision(CALL_QUEUE, ctx(a.c, mem(), { granted: GRANTED }));
  assert.equal(r.code, "rejected");
  assert.deepEqual(a.calls.filter((x) => x === "create" || x === "publish"), []);
});

test("dry run (write switch off): explains 'Would create', sends no create and no publish", async () => {
  const a = stub();
  const r = await provision(CALL_QUEUE, ctx(a.c, mem(), { granted: GRANTED, env: { WRITE_GHL_LIVE: "false" } }));
  assert.equal(r.state, "would_create");
  assert.match(r.message, /Would create folder "Lead Response Automations" and workflow "Call queue"/);
  assert.ok(!a.calls.includes("create") && !a.calls.includes("publish") && !a.calls.includes("validate"));
  const b = stub();
  const r2 = await provision(CALL_QUEUE, ctx(b.c, mem(), { granted: GRANTED, optedIn: false }));
  assert.equal(r2.state, "would_create", "the account's own opt-in is also required");
});

test("auto-publish on (default): created and published; off: created as a draft and never published", async () => {
  const a = stub();
  const on = await provision(CALL_QUEUE, ctx(a.c, mem(), { granted: GRANTED }));
  assert.equal(on.state, "created");
  assert.deepEqual(a.calls.filter((x) => x === "create" || x === "publish"), ["create", "publish"]);
  const b = stub();
  const st = mem();
  const off = await provision(CALL_QUEUE, ctx(b.c, st, { granted: GRANTED, autoPublish: false }));
  assert.equal(off.state, "created");
  assert.match(off.message, /draft/);
  assert.deepEqual(b.calls.filter((x) => x === "create" || x === "publish"), ["create"]);
  assert.equal(st.row?.status, "created_draft");
  assert.deepEqual(DEFAULT_SETUP, { autoSetup: true, autoPublish: true });
});

test("idempotent by stored id: a workflow the customer RENAMED is found by id and never touched or re-created", async () => {
  const row: Row = { templateKey: "call_queue", folderId: "fo-1", workflowId: "wf-9", templateVersion: 1, status: "active", lastError: null };
  const a = stub({ list: { ok: true, value: [{ id: "wf-9", name: "My own name", status: "draft", folderId: "fo-1" }] } });
  const r = await provision(CALL_QUEUE, ctx(a.c, mem(row), { granted: GRANTED }));
  assert.equal(r.state, "ready");
  assert.equal(r.workflowId, "wf-9");
  assert.deepEqual(a.calls.filter((x) => x === "create" || x === "publish" || x === "validate"), []);
});

test("idempotent by exact name: an existing 'Call queue' is adopted, not duplicated", async () => {
  const a = stub({ list: { ok: true, value: [{ id: "x1", name: "Call queue", status: "published", folderId: null }] } });
  const st = mem();
  const r = await provision(CALL_QUEUE, ctx(a.c, st, { granted: GRANTED }));
  assert.equal(r.state, "ready");
  assert.equal(st.row?.workflowId, "x1");
  assert.ok(!a.calls.includes("create"));
});

test("an automatic run does not re-create a workflow that was deleted; a person's Set up press does", async () => {
  const row: Row = { templateKey: "call_queue", folderId: "fo-1", workflowId: "wf-9", templateVersion: 1, status: "active", lastError: null };
  const a = stub();
  const auto = await provision(CALL_QUEUE, ctx(a.c, mem(row), { granted: GRANTED, manual: false }));
  assert.equal(auto.state, "missing");
  assert.ok(!a.calls.includes("create"));
  const b = stub();
  const manual = await provision(CALL_QUEUE, ctx(b.c, mem(row), { granted: GRANTED, manual: true }));
  assert.equal(manual.state, "created");
});

test("daily check verdicts: ok, removed, unpublished, renamed-but-present", () => {
  const live: Found = { id: "wf-9", name: "Call queue", status: "published", folderId: null };
  assert.equal(judgeCheck({ workflowId: "wf-9" }, [live], "Call queue").kind, "ok");
  assert.equal(judgeCheck({ workflowId: "wf-9" }, [], "Call queue").kind, "removed");
  assert.equal(judgeCheck({ workflowId: "wf-9" }, [{ ...live, status: "draft" }], "Call queue").kind, "unpublished");
  assert.equal(judgeCheck({ workflowId: "wf-9" }, [{ ...live, name: "Renamed" }], "Call queue").kind, "ok");
  // another workflow with the same name is not ours when we hold an id
  assert.equal(judgeCheck({ workflowId: "wf-9" }, [{ ...live, id: "other" }], "Call queue").kind, "removed");
  const v = judgeCheck({ workflowId: "wf-9" }, [], "Call queue");
  assert.ok(v.kind !== "ok" && !hasVendorWord(v.message));
});

test("hand-built steps use the account's tag and never name the product", () => {
  const s = handSteps("ring-me", { mode: "round_robin" }, "Sales Automations", "Call queue");
  assert.equal(s.length, 5);
  assert.ok(s.join(" ").includes("ring-me") && s.join(" ").includes("Sales Automations"));
  assert.ok(!hasVendorWord(s.join(" ")));
});

// ---- scope parity: code, permissions screen, release doc and setup guide say the same about the two permissions
test("scope list parity: code, plain words, permission groups, release doc and setup guide", () => {
  const two = ["workflows.readonly", "workflows.write"];
  for (const s of two) {
    assert.ok((GHL_SCOPES as readonly string[]).includes(s), `${s} in GHL_SCOPES`);
    assert.notEqual(scopeWords(s), "read this part of your account", `${s} has plain words`);
    const info = infoFor(s);
    assert.ok(info && info.required === false, `${s} is listed as optional on the permissions screen`);
  }
  const rel = readFileSync(new URL("../../../docs/RELEASE_1_1_0.md", import.meta.url), "utf8");
  const guide = readFileSync(new URL("../../../docs/KING_SETUP_GUIDE.md", import.meta.url), "utf8");
  for (const s of two) { assert.ok(rel.includes("`" + s + "`"), `${s} in RELEASE_1_1_0.md`); assert.ok(guide.includes(s), `${s} in KING_SETUP_GUIDE.md`); }
  const n = GHL_SCOPES.length;
  assert.ok(rel.includes(`${n} permissions today`), `RELEASE_1_1_0.md says ${n} permissions`);
});

test("install hook wiring: the INSTALL webhook runs automatic setup, and the cron runs the daily check", () => {
  const hook = readFileSync(new URL("../../app/api/webhooks/ghl/route.ts", import.meta.url), "utf8");
  assert.match(hook, /action\.kind === "install"[\s\S]{0,600}autoSetupOnInstall\(target\.id, target\.companyId, event\.locationId\)/);
  const cron = readFileSync(new URL("../../app/api/cron/workflows/route.ts", import.meta.url), "utf8");
  assert.match(cron, /runCallQueueDailyCheck/);
  const run = readFileSync(new URL("../workflows-setup/run.ts", import.meta.url), "utf8");
  assert.match(run, /autoSetup/);
});
