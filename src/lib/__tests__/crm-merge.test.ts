import assert from "node:assert/strict";
import { test } from "node:test";
import type { Person } from "../analytics/dedupe.ts";
import { apiMergeBlockers, buildMergeSteps, mergeContacts } from "../ghl/crm-merge.ts";

// A stubbed client only: no test here ever reaches the network (docs/OVERNIGHT_RULES.md section 8).
const p = (id: string, o: Partial<Person> = {}): Person => ({
  contactId: id, name: "Ada Lovelace", email: "ada@x.com", phone: "5550101111", tags: [], createdAt: "2026-01-01T00:00:00Z", lastActivityAt: null,
  source: null, openDeals: 0, wonDeals: 0, hasConversation: false, ...o,
});
const recorder = () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};
const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
const deps = (env: Record<string, string>) => ({ env, audit: async (r: { action: string; detail: Record<string, unknown> }) => { audits.push(r); }, log: () => undefined });
const base = (people: Person[], r: ReturnType<typeof recorder>) => ({ installationId: "inst", locationId: "LOC1", keepId: "k", people, token: async () => "tok", fetchImpl: r.fetchImpl });

test("with the switch off (the committed default) nothing is sent and the dry run is recorded with ids and field names only", async () => {
  const r = recorder();
  audits.length = 0;
  const res = await mergeContacts(base([p("k", { email: null, tags: ["a"] }), p("g", { email: "ada@x.com", tags: ["b"] })], r), deps({}));
  assert.equal(res.outcome, "switched_off");
  assert.equal(r.calls.length, 0, "no request was made");
  assert.ok(res.outcome === "switched_off" && res.line.startsWith("WOULD WRITE crm.contact.merge"));
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "dry_run.would_write");
  const text = JSON.stringify(audits[0]);
  assert.ok(!text.includes("ada@x.com"), "no contact detail in the audit line");
  assert.deepEqual(audits[0].detail.fields, ["email", "tags"]);
});

test("any value other than exactly 'true' keeps it off", async () => {
  for (const v of ["", "1", "yes", "TRUE", "True"]) {
    const r = recorder();
    const res = await mergeContacts(base([p("k"), p("g")], r), deps({ WRITE_GHL_LIVE: v }));
    assert.equal(res.outcome, "switched_off", v);
    assert.equal(r.calls.length, 0);
  }
});

test("the request list fills gaps, adds tags, and deletes last", () => {
  const steps = buildMergeSteps([p("k", { phone: null, tags: ["vip"] }), p("g", { phone: "5550102222", tags: ["VIP", "lead"] })], "k");
  assert.deepEqual(steps.map((s) => `${s.method} ${s.path}`), ["PUT /contacts/k", "POST /contacts/k/tags", "DELETE /contacts/g"]);
  assert.deepEqual(steps[0].body, { phone: "5550102222" }, "only a blank field is filled; nothing is overwritten");
  assert.deepEqual(steps[1].body, { tags: ["lead"] }, "a tag the kept contact already has is not added twice");
  assert.ok(steps.every((s) => s.scope === "contacts.write"));
});

test("when the record to remove carries something the API cannot move, the merge refuses before any request", async () => {
  const cases: Array<[Partial<Person>, string]> = [[{ hasConversation: true }, "conversation"], [{ openDeals: 1 }, "deals"], [{ wonDeals: 1 }, "deals"], [{ appointments: 2 }, "appointments"], [{ dnd: true }, "dnd"]];
  for (const [o, id] of cases) {
    const r = recorder();
    const res = await mergeContacts(base([p("k"), p("g", o)], r), deps({ WRITE_GHL_LIVE: "true" }));
    assert.equal(res.outcome, "blocked", id);
    assert.ok(res.outcome === "blocked" && res.blockers.some((b) => b.id === id));
    assert.equal(r.calls.length, 0, "a blocked merge sends nothing even when the switch is on");
  }
  assert.ok(apiMergeBlockers([p("k", { email: "a@x.com", phone: "5550101111" }), p("g", { email: "b@x.com", phone: "5550102222" })], "k").some((b) => b.id === "different"));
  assert.ok(apiMergeBlockers([p("k"), p("g"), p("h")], "k").some((b) => b.id === "too_many"));
  assert.ok(apiMergeBlockers([p("g")], "k").some((b) => b.id === "same_contact"));
});

test("switched on (in a test, against a stub): the steps run in order and the delete is last", async () => {
  const r = recorder();
  const res = await mergeContacts(base([p("k", { phone: null }), p("g", { phone: "5550102222", tags: ["lead"] })], r), deps({ WRITE_GHL_LIVE: "true" }));
  assert.deepEqual(res, { outcome: "merged", steps: 3 });
  assert.deepEqual(r.calls.map((c) => c.method), ["PUT", "POST", "DELETE"]);
  assert.ok(r.calls[2].url.endsWith("/contacts/g"));
});

test("a failed step stops the merge: the delete never runs after a failure, and a missing permission is reported as one", async () => {
  const failing = (status: number) => {
    const calls: string[] = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => { calls.push(init.method ?? "GET"); return new Response("{}", { status }); }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const f = failing(400);
  const res = await mergeContacts({ ...base([p("k", { phone: null }), p("g", { phone: "5550102222" })], recorder()), fetchImpl: f.fetchImpl }, deps({ WRITE_GHL_LIVE: "true" }));
  assert.deepEqual(res, { outcome: "failed", status: 400, step: "update_keep" });
  assert.deepEqual(f.calls, ["PUT"], "stopped at the first failure");
  const forbidden = failing(403);
  const res2 = await mergeContacts({ ...base([p("k"), p("g")], recorder()), fetchImpl: forbidden.fetchImpl }, deps({ WRITE_GHL_LIVE: "true" }));
  assert.equal(res2.outcome, "needs_permission");
  assert.deepEqual(forbidden.calls, ["DELETE"], "the only step here is the delete, and it stops at the refusal");
});
