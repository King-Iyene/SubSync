import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDraft, checkFollowUp, checkStageName, contactForDraft, createDraft, createFollowUp, draftTotal, estimateBody, followUpBody, followUpWords, forgetRecentDrafts, invoiceBody,
  listEmailTemplates, planStageRename, readFollowUp, readInstaller, readPipeline, renameStage, stageUpdateBody, templateBody, type PipelineRead,
} from "../ghl/more-tools-gateway.ts";
import { resetLimits } from "../ghl/workbench.ts";

const base = { installationId: "xtest-inst", locationId: "xtest-loc", actor: "xtest-user", optedIn: true, token: async () => "xtest-token" };
const LIVE = { WRITE_GHL_LIVE: "true" };
const NOW = new Date("2026-11-14T10:00:00Z");
type Seen = { url: string; method: string; body: string | null };
function stub(status = 200, answer: unknown = {}) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), method: init?.method ?? "GET", body: (init?.body as string | undefined) ?? null }); return new Response(JSON.stringify(answer), { status }); }) as typeof fetch;
  return { seen, fetchImpl };
}
const rec = () => { const rows: Array<{ detail: Record<string, unknown> }> = []; return { rows, audit: async (r: { detail: Record<string, unknown> }) => { rows.push(r); } }; };
const sleep = async () => {};
const fresh = () => { resetLimits(); forgetRecentDrafts(); return rec(); };
const fu = { title: "Call back about the quote", intervalType: "weekly", interval: 1, count: 4, startDate: "2026-11-20", dueAfterHours: 24 };
const contact = { id: "c1abc", name: "Dana Reed", email: "dana@example.com", phone: "+15551230000" };
const draft = { name: "Roof quote", itemName: "Roof repair", amount: "1200.50", qty: 2, currency: "usd" };

test("follow-up rules: plain title, bounded repeats, no past start", () => {
  assert.equal(checkFollowUp(fu, NOW).ok, true);
  assert.equal(checkFollowUp({ ...fu, title: "" }, NOW).ok, false);
  assert.equal(checkFollowUp({ ...fu, title: "<b>x" }, NOW).ok, false);
  assert.equal(checkFollowUp({ ...fu, count: 0 }, NOW).ok, false);
  assert.equal(checkFollowUp({ ...fu, count: 53 }, NOW).ok, false);
  assert.equal(checkFollowUp({ ...fu, intervalType: "hourly" }, NOW).ok, false);
  assert.equal(checkFollowUp({ ...fu, startDate: "2026-11-01" }, NOW).ok, false);
  assert.equal(checkFollowUp({ ...fu, startDate: "2028-01-01" }, NOW).ok, false);
  const c = checkFollowUp(fu, NOW);
  if (!c.ok) throw new Error("x");
  assert.equal(followUpWords(c.value), "every week, 4 times, starting 2026-11-20");
  const b = followUpBody(c.value, "c1abc") as { rruleOptions: Record<string, unknown>; contactIds: string[] };
  assert.deepEqual(b.contactIds, ["c1abc"]);
  assert.equal(b.rruleOptions.count, 4);
  assert.equal(b.rruleOptions.dueAfterSeconds, 86400);
});

test("draft rules and bodies: contact needs name, email and phone; nothing is sent to the contact", () => {
  const d = checkDraft(draft);
  if (!d.ok) throw new Error("x");
  assert.equal(d.value.currency, "USD");
  assert.equal(draftTotal(d.value), 2401);
  assert.equal(checkDraft({ ...draft, amount: 0 }).ok, false);
  assert.equal(checkDraft({ ...draft, amount: "abc" }).ok, false);
  assert.equal(checkDraft({ ...draft, currency: "dollars" }).ok, false);
  assert.equal(contactForDraft({ id: "c", name: "A", email: "", phone: "1" }).ok, false);
  assert.equal(contactForDraft(null).ok, false);
  const c = contactForDraft(contact);
  if (!c.ok) throw new Error("x");
  const est = estimateBody("L1", "Acme", d.value, c.value, NOW) as Record<string, unknown>;
  assert.equal(est.sendEstimateDetails, undefined, "an estimate is never sent");
  assert.equal(est.issueDate, "2026-11-14");
  const inv = invoiceBody("L1", "Acme", d.value, c.value, NOW) as Record<string, unknown>;
  assert.equal(inv.dueDate, "2026-11-28");
  assert.equal(templateBody("L1", "Acme", d.value).contactDetails, undefined);
});

test("follow-up write: off sends nothing; live posts the recurring task and audits ids and field names only", async () => {
  const off = stub(), a1 = fresh();
  const r = await createFollowUp({ ...base, contactId: "c1abc", followUp: fu as never }, { fetchImpl: off.fetchImpl, sleep, env: {}, audit: a1.audit });
  assert.equal(r.outcome, "dry_run"); assert.deepEqual(off.seen, []);
  const on = stub(201, { recurringTask: { id: "rt123" } }), a2 = fresh();
  const r2 = await createFollowUp({ ...base, contactId: "c1abc", followUp: fu as never }, { fetchImpl: on.fetchImpl, sleep, env: LIVE, audit: a2.audit });
  assert.deepEqual(r2, { outcome: "done", id: "rt123" });
  assert.equal(on.seen[0].method, "POST"); assert.match(on.seen[0].url, /\/locations\/xtest-loc\/recurring-tasks$/);
  assert.ok(!JSON.stringify(a2.rows).includes("Call back about"), "no title in the audit line");
  const denied = stub(403), a3 = fresh();
  assert.equal((await createFollowUp({ ...base, contactId: "c1abc", followUp: fu as never }, { fetchImpl: denied.fetchImpl, sleep, env: LIVE, audit: a3.audit })).outcome, "needs_permission");
  const notOpted = stub(), a4 = fresh();
  assert.equal((await createFollowUp({ ...base, optedIn: false, contactId: "c1abc", followUp: fu as never }, { fetchImpl: notOpted.fetchImpl, sleep, env: LIVE, audit: a4.audit })).outcome, "dry_run");
  assert.deepEqual(notOpted.seen, []);
});

test("draft write: right endpoint per kind, the same draft twice is saved once, a bad contact is blocked before any call", async () => {
  const c = contactForDraft(contact);
  if (!c.ok) throw new Error("x");
  for (const [kind, path] of [["estimate", "/invoices/estimate"], ["invoice", "/invoices/"], ["template", "/invoices/template"]] as const) {
    const s = stub(200, { _id: "x1" }), a = fresh();
    const r = await createDraft({ ...base, kind, draft: draft as never, businessName: "Acme", contact: c.value, now: NOW }, { fetchImpl: s.fetchImpl, sleep, env: LIVE, audit: a.audit });
    assert.equal(r.outcome, "done", kind);
    assert.ok(s.seen[0].url.endsWith(path), kind);
    const again = await createDraft({ ...base, kind, draft: draft as never, businessName: "Acme", contact: c.value, now: NOW }, { fetchImpl: s.fetchImpl, sleep, env: LIVE, audit: a.audit });
    assert.equal(again.outcome, "already", kind); assert.equal(s.seen.length, 1);
  }
  const s = stub(), a = fresh();
  const blocked = await createDraft({ ...base, kind: "invoice", draft: draft as never, businessName: "Acme", contact: null }, { fetchImpl: s.fetchImpl, sleep, env: LIVE, audit: a.audit });
  assert.equal(blocked.outcome, "blocked"); assert.deepEqual(s.seen, []);
});

const pipe: PipelineRead = { id: "p1abc", name: "Sales", stages: [{ id: "s1abc", name: "New", position: 0, showInFunnel: true }, { id: "s2abc", name: "Booked", position: 1 }] };

test("stage rename plan: one name changes, ids and positions stay, a duplicate or missing stage is refused", () => {
  const p = planStageRename(pipe, "s1abc", "Fresh lead");
  assert.equal(p.kind, "change");
  if (p.kind !== "change") return;
  const body = stageUpdateBody(p.stages) as { stages: Array<{ id: string; name: string; position: number; showInFunnel?: boolean }> };
  assert.deepEqual(body.stages.map((s) => [s.id, s.name, s.position]), [["s1abc", "Fresh lead", 0], ["s2abc", "Booked", 1]]);
  assert.equal(body.stages[0].showInFunnel, true);
  assert.equal(planStageRename(pipe, "s1abc", "booked").kind, "blocked");
  assert.equal(planStageRename(pipe, "nope", "X").kind, "blocked");
  assert.equal(planStageRename(pipe, "s1abc", "New").kind, "same");
  assert.equal(checkStageName("  ").ok, false);
});

test("stage rename write: re-reads before sending and never overwrites a stage that changed", async () => {
  const s = stub(200, {}), a = fresh();
  const r = await renameStage({ ...base, pipelineId: "p1abc", stageId: "s1abc", newName: "Fresh lead", current: pipe, recheck: async () => pipe }, { fetchImpl: s.fetchImpl, sleep, env: LIVE, audit: a.audit });
  assert.equal(r.outcome, "done");
  assert.equal(s.seen[0].method, "PUT"); assert.match(s.seen[0].url, /\/opportunities\/pipelines\/p1abc$/);
  const s2 = stub(), a2 = fresh();
  const taken: PipelineRead = { ...pipe, stages: [pipe.stages[0], { id: "s2abc", name: "Fresh lead", position: 1 }] };
  const r2 = await renameStage({ ...base, pipelineId: "p1abc", stageId: "s1abc", newName: "Fresh lead", current: pipe, recheck: async () => taken }, { fetchImpl: s2.fetchImpl, sleep, env: LIVE, audit: a2.audit });
  assert.equal(r2.outcome, "blocked"); assert.deepEqual(s2.seen, []);
  const s3 = stub(), a3 = fresh();
  const r3 = await renameStage({ ...base, pipelineId: "p1abc", stageId: "s1abc", newName: "Fresh lead", current: pipe, recheck: async () => undefined }, { fetchImpl: s3.fetchImpl, sleep, env: LIVE, audit: a3.audit });
  assert.equal(r3.outcome, "failed"); assert.deepEqual(s3.seen, []);
});

test("reads: pipeline, follow-up read-back, email templates and installer parse the platform's shapes and map 403 to needs_permission", async () => {
  const p = await readPipeline({ pipelineId: "p1abc", token: "t" }, { fetchImpl: stub(200, { id: "p1abc", name: "Sales", stages: [{ id: "s1abc", name: "New" }] }).fetchImpl, sleep });
  assert.deepEqual(p.ok && p.value?.stages.map((s) => s.position), [0]);
  assert.deepEqual(await readPipeline({ pipelineId: "p1abc", token: "t" }, { fetchImpl: stub(403).fetchImpl, sleep }), { ok: false, reason: "needs_permission" });
  const f = await readFollowUp({ locationId: "L1", token: "t", id: "rt123" }, { fetchImpl: stub(200, { recurringTask: { title: "x" } }).fetchImpl, sleep });
  assert.equal(f.ok && f.value.found, true);
  const gone = await readFollowUp({ locationId: "L1", token: "t", id: "rt123" }, { fetchImpl: stub(404).fetchImpl, sleep });
  assert.equal(gone.ok && gone.value.found, false);
  const t = await listEmailTemplates({ locationId: "L1", token: "t" }, { fetchImpl: stub(200, { items: [{ id: "a", name: "Welcome", type: "template", editorType: "builder", updatedAt: "2025-01-01T00:00:00Z" }, { id: "f", name: "Folder", type: "folder" }], total: 2 }).fetchImpl, sleep });
  assert.equal(t.ok && t.value.templates.length, 1); assert.equal(t.ok && t.value.folders, 1);
  assert.deepEqual(await listEmailTemplates({ locationId: "L1", token: "t" }, { fetchImpl: stub(401).fetchImpl, sleep }), { ok: false, reason: "needs_permission" });
  const i = await readInstaller({ appId: "app1", token: "t" }, { fetchImpl: stub(200, { installations: [{ planId: "plan9", isWhitelabelCompany: false, installedAt: "2026-11-01T00:00:00Z", email: "a@b.c" }] }).fetchImpl, sleep });
  assert.equal(i.ok && i.value.planId, "plan9");
});
