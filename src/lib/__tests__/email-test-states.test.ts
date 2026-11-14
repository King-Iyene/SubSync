import assert from "node:assert/strict";
import { test } from "node:test";

import { maskEmail, providerReason, runEmailTest, type SendOutcome } from "../connections/email-test.ts";

const mail = { subject: "[TEST] SubSync email check", text: "This is a test." };
const run = (send: () => Promise<SendOutcome>, extra: { budgetMs?: number; logged?: string[] } = {}) =>
  runEmailTest({ to: "king@example.com", mail, send, budgetMs: extra.budgetMs, logError: async (id, d) => { extra.logged?.push(`${id}|${d}`); } });

test("not configured is an info answer (200-style), not an error", async () => {
  const a = await run(async () => ({ ok: false, permanent: false, code: "email_not_configured" }));
  assert.equal(a.state, "not_configured");
  assert.equal(a.ok, true);
  assert.equal(a.tone, "info");
  assert.match(a.text, /not switched on yet: your address is saved/);
  assert.equal(a.preview?.subject, mail.subject);
});

test("a dry run shows the subject and text and says nothing was sent", async () => {
  const a = await run(async () => ({ ok: true, dryRun: true }));
  assert.equal(a.state, "dry_run");
  assert.equal(a.dryRun, true);
  assert.match(a.text, /^Preview only: this is what the test email would say/);
  assert.deepEqual(a.preview, { to: "king@example.com", subject: mail.subject, body: mail.text });
});

test("a provider refusal gives a short plain reason and no secret", async () => {
  const a = await run(async () => ({ ok: false, permanent: true, code: "http_403" }));
  assert.equal(a.state, "rejected");
  assert.equal(a.ok, false);
  assert.match(a.text, /refused our key/);
  assert.doesNotMatch(a.text, /re_|Bearer/);
  assert.equal(providerReason("http_422"), "the mail service did not accept the sender or the address");
  assert.equal(providerReason("http_0"), "the mail service could not be reached");
});

test("a real success names the masked address", async () => {
  const a = await run(async () => ({ ok: true }));
  assert.equal(a.state, "sent");
  assert.equal(a.tone, "success");
  assert.match(a.text, /^Test sent to k\*\*\*@example\.com\./);
  assert.doesNotMatch(a.text, /king@/);
  assert.equal(maskEmail("ab@x.io"), "a***@x.io");
});

test("a thrown error is caught, logged with an id, and shown with that id", async () => {
  const logged: string[] = [];
  const a = await run(async () => { throw new Error("boom"); }, { logged });
  assert.equal(a.state, "error");
  assert.ok(a.errorId && /^E-[A-Z2-9]{8}$/.test(a.errorId));
  assert.match(a.text, new RegExp(a.errorId!));
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /boom/);
});

test("a send that never answers is cut off at the budget and answered", async () => {
  const t0 = Date.now();
  const a = await run(() => new Promise<SendOutcome>(() => undefined), { budgetMs: 50 });
  assert.equal(a.state, "error");
  assert.ok(Date.now() - t0 < 2000);
});

test("a failing error log never breaks the answer", async () => {
  const a = await runEmailTest({ to: "a@b.com", mail, send: async () => { throw new Error("x"); }, logError: async () => { throw new Error("db down"); } });
  assert.equal(a.state, "error");
});

test("the provider call has a hard timeout", async () => {
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("../email.ts", import.meta.url), "utf8"), /AbortSignal\.timeout\(/);
});
