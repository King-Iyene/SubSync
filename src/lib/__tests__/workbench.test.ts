import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { fetchThread, fillTemplate, inverseOf, parseAction, planAction, resetLimits, runAction, type Action, type RunArgs, type Target } from "../ghl/workbench.ts";

// The Lead workbench gateway with a STUBBED platform only. The master switch is passed as an environment object, never read from process.env.
const ON = { WRITE_GHL_LIVE: "true" };
const OFF = {};
const T: Target = { locationId: "L1", contactId: "c1", name: "Dana Cole", dnd: false, phone: "+15550102030", email: "dana@x.com", timeZone: "America/New_York" };
const NOON = new Date("2026-11-04T17:00:00Z"); // 12:00 in New York
const MIDNIGHT = new Date("2026-11-04T05:00:00Z"); // 00:00 in New York
const SECRET = "Hi Dana, your quote is ready, SECRET-TEXT-123";

const stub = () => {
  const calls: Array<{ method: string; path: string; body: unknown; auth: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, body: init.body ? JSON.parse(init.body as string) : null, auth: (init.headers as Record<string, string>).Authorization });
    return Response.json({ id: "new-id-1" });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};
const rec = () => {
  const lines: Array<{ action: string; detail: Record<string, unknown> }> = [];
  return { lines, audit: async (r: { action: string; detail: Record<string, unknown> }) => { lines.push({ action: r.action, detail: r.detail }); }, log: () => undefined };
};
const run = (action: Action, o: Partial<RunArgs> = {}, env: Record<string, string> = ON, f = stub(), r = rec()) =>
  runAction({ installationId: "i1", actor: "Ann", target: T, action, optedIn: true, confirmed: true, ack: [], token: async () => "tok", now: NOON, ...o }, { env, fetchImpl: f.fetchImpl, sleep: async () => undefined, audit: r.audit, log: r.log }).then((res) => ({ res, f, r }));

beforeEach(() => resetLimits());

test("send: live, opted in, confirmed: one POST with the text, one audit line with no text", async () => {
  const { res, f, r } = await run({ kind: "message", channel: "SMS", text: SECRET });
  assert.equal(res.outcome, "done");
  assert.equal(f.calls.length, 1);
  assert.deepEqual([f.calls[0].method, f.calls[0].path], ["POST", "/conversations/messages"]);
  assert.equal((f.calls[0].body as Record<string, string>).message, SECRET);
  assert.equal(r.lines.length, 1);
  assert.ok(!JSON.stringify(r.lines).includes("SECRET-TEXT"), "the audit never holds message text");
  assert.ok(!JSON.stringify(r.lines).includes("Dana"), "nor a name");
});

test("dry run (switch off): nothing sent, WOULD SEND line recorded without text", async () => {
  const { res, f, r } = await run({ kind: "message", channel: "SMS", text: SECRET }, {}, OFF);
  assert.equal(res.outcome, "dry_run");
  assert.equal(f.calls.length, 0);
  assert.equal(r.lines[0].action, "dry_run.would_send");
  assert.ok(!JSON.stringify(r.lines).includes("SECRET-TEXT"));
});

test("dry run when the account is not allowed, even with the switch on", async () => {
  const { res, f } = await run({ kind: "note", text: "x" }, { optedIn: false });
  assert.equal(res.outcome, "dry_run");
  assert.equal((res as { reason: string }).reason, "account");
  assert.equal(f.calls.length, 0);
});

test("Do Not Disturb: refused for every channel, nothing sent", async () => {
  for (const channel of ["SMS", "Email", "WhatsApp"] as const) {
    const { res, f } = await run({ kind: "message", channel, text: "hello", subject: "s" }, { target: { ...T, dnd: true } });
    assert.equal(res.outcome, "blocked");
    assert.equal((res as { blockers: Array<{ id: string }> }).blockers[0].id, "dnd");
    assert.equal(f.calls.length, 0);
  }
});

test("no phone, no email, empty text and a missing subject are refused", async () => {
  assert.equal((await run({ kind: "message", channel: "SMS", text: "hi" }, { target: { ...T, phone: null } })).res.outcome, "blocked");
  assert.equal((await run({ kind: "message", channel: "Email", text: "hi", subject: "s" }, { target: { ...T, email: null } })).res.outcome, "blocked");
  assert.equal((await run({ kind: "message", channel: "SMS", text: "   " })).res.outcome, "blocked");
  assert.equal((await run({ kind: "message", channel: "Email", text: "hi", subject: " " })).res.outcome, "blocked");
});

test("quiet hours need a tick; with the tick it goes", async () => {
  const a: Action = { kind: "message", channel: "SMS", text: "hi" };
  const first = await run(a, { now: MIDNIGHT });
  assert.equal(first.res.outcome, "needs_ack");
  assert.equal(first.f.calls.length, 0);
  assert.equal((await run(a, { now: MIDNIGHT, ack: ["quiet_hours"] })).res.outcome, "done");
  assert.equal(planAction({ kind: "message", channel: "Email", text: "hi", subject: "s" }, T, MIDNIGHT).warnings.length, 0, "email has no quiet hours");
});

test("no confirm click, no send", async () => {
  const { res, f } = await run({ kind: "note", text: "hi" }, { confirmed: false });
  assert.equal(res.outcome, "needs_confirm");
  assert.equal(f.calls.length, 0);
});

test("note, task, tag add and remove, owner, fields, deal stage, appointment status: the exact requests", async () => {
  const cases: Array<[Action, string, string, unknown]> = [
    [{ kind: "note", text: "called" }, "POST", "/contacts/c1/notes", { body: "called" }],
    [{ kind: "task", title: "Call back", dueDate: "2026-11-06T10:00:00Z" }, "POST", "/contacts/c1/tasks", { title: "Call back", dueDate: "2026-11-06T10:00:00.000Z", completed: false }],
    [{ kind: "tag_add", tag: "hot" }, "POST", "/contacts/c1/tags", { tags: ["hot"] }],
    [{ kind: "tag_remove", tag: "cold" }, "DELETE", "/contacts/c1/tags", { tags: ["cold"] }],
    [{ kind: "owner", userId: "u9" }, "PUT", "/contacts/c1", { assignedTo: "u9" }],
    [{ kind: "fields", fields: { email: "new@x.com" } }, "PUT", "/contacts/c1", { email: "new@x.com" }],
    [{ kind: "deal", opportunityId: "o1", stageId: "s2", status: "won", value: 500 }, "PUT", "/opportunities/o1", { pipelineStageId: "s2", status: "won", monetaryValue: 500 }],
    [{ kind: "appointment", appointmentId: "a1", status: "noshow" }, "PUT", "/calendars/events/appointments/a1", { appointmentStatus: "noshow" }],
  ];
  for (const [action, method, path, body] of cases) {
    const { res, f } = await run(action);
    assert.equal(res.outcome, "done", action.kind);
    assert.deepEqual([f.calls[0].method, f.calls[0].path, f.calls[0].body, f.calls[0].auth], [method, path, body, "Bearer tok"], action.kind);
  }
});

test("delete needs the exact name typed; a wrong name sends nothing", async () => {
  const wrong = await run({ kind: "delete", confirmText: "dan" });
  assert.equal(wrong.res.outcome, "blocked");
  assert.equal(wrong.f.calls.length, 0);
  const ok = await run({ kind: "delete", confirmText: " dana COLE " });
  assert.equal(ok.res.outcome, "done");
  assert.deepEqual([ok.f.calls[0].method, ok.f.calls[0].path], ["DELETE", "/contacts/c1"]);
});

test("a duplicate message within a minute is refused; a burst is slowed", async () => {
  const a: Action = { kind: "message", channel: "SMS", text: "same" };
  assert.equal((await run(a)).res.outcome, "done");
  assert.equal((await run(a)).res.outcome, "blocked");
  assert.equal((await run({ kind: "message", channel: "SMS", text: "b" })).res.outcome, "done");
  assert.equal((await run({ kind: "message", channel: "SMS", text: "c" })).res.outcome, "done");
  assert.equal((await run({ kind: "message", channel: "SMS", text: "d" })).res.outcome, "rate_limited");
});

test("a refused or failed call is named, and a 403 is a permission message", async () => {
  const f403 = { calls: [], fetchImpl: (async () => new Response(null, { status: 403 })) as unknown as typeof fetch };
  assert.equal((await run({ kind: "note", text: "x" }, {}, ON, f403 as never)).res.outcome, "needs_permission");
  const f422 = { calls: [], fetchImpl: (async () => new Response(null, { status: 422 })) as unknown as typeof fetch };
  const r = await run({ kind: "note", text: "x" }, {}, ON, f422 as never);
  assert.deepEqual(r.res, { outcome: "failed", status: 422 });
});

test("undo: the inverse is built from the before-values; a sent message and a delete have none", () => {
  assert.deepEqual(inverseOf({ kind: "tag_add", tag: "hot" }, { tags: [] }, null), { kind: "tag_remove", tag: "hot" });
  assert.deepEqual(inverseOf({ kind: "tag_remove", tag: "hot" }, { tags: ["hot"] }, null), { kind: "tag_add", tag: "hot" });
  assert.deepEqual(inverseOf({ kind: "owner", userId: "u2" }, { owner: "u1" }, null), { kind: "owner", userId: "u1" });
  assert.deepEqual(inverseOf({ kind: "deal", opportunityId: "o", stageId: "s2" }, { deal: { stageId: "s1", pipelineId: "p" } }, null), { kind: "deal", opportunityId: "o", stageId: "s1", pipelineId: "p" });
  assert.deepEqual(inverseOf({ kind: "appointment", appointmentId: "a", status: "showed" }, { appointmentStatus: "confirmed" }, null), { kind: "appointment", appointmentId: "a", status: "confirmed" });
  assert.equal(inverseOf({ kind: "appointment", appointmentId: "a", status: "showed" }, { appointmentStatus: "new" }, null), null);
  assert.deepEqual(inverseOf({ kind: "note", text: "x" }, {}, "n1"), { kind: "note_delete", noteId: "n1" });
  assert.equal(inverseOf({ kind: "message", channel: "SMS", text: "x" }, {}, "m1"), null);
  assert.equal(inverseOf({ kind: "delete", confirmText: "x" }, {}, null), null);
});

test("parseAction drops unknown shapes and keys", () => {
  assert.equal(parseAction({ kind: "nuke" }).ok, false);
  assert.equal(parseAction({ kind: "owner", userId: "../x" }).ok, false);
  const p = parseAction({ kind: "tag_add", tag: "hot", evil: 1 });
  assert.deepEqual(p.ok && p.action, { kind: "tag_add", tag: "hot" });
});

test("merge fields fill in and a stray brace is dropped", () => {
  assert.equal(fillTemplate("Hi {{first_name}} from {{ business }} {{nope}}", { name: "Dana Cole", business: "Acme" }), "Hi Dana from Acme ");
});

test("thread: parsed oldest first, text kept in memory only", async () => {
  const fetchImpl = (async () => Response.json({ messages: { messages: [{ id: "m2", direction: "outbound", messageType: "TYPE_SMS", body: "Reply", dateAdded: "2026-11-04T10:05:00Z" }, { id: "m1", direction: "inbound", messageType: "TYPE_SMS", body: "Hello", dateAdded: "2026-11-04T10:00:00Z" }] } })) as unknown as typeof fetch;
  const t = await fetchThread("tok", "conv1", { fetchImpl });
  assert.deepEqual(t.map((m) => [m.id, m.direction, m.channel, m.text]), [["m1", "in", "Text", "Hello"], ["m2", "out", "Text", "Reply"]]);
});
