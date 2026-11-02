import assert from "node:assert/strict";
import { test } from "node:test";
import { allowlisted, assertAllowlisted, sendTestMail, testOutcomeText, TEST_EMAIL_ALLOWLIST, TEST_EMAIL_CAP, type MailLike, type TestSendDeps } from "../notifications/test-send.ts";

// The one live exception of the overnight run: a test email may really be sent only to the allowlisted address, at most 5 times in 24 hours. Every other
// address is a dry run. The real transport here is a fake that records its calls.

const MAIL: MailLike = { subject: "[TEST] x", text: "t", html: "<p>t</p>" };
const KING = "king@kdsquares.com";

function deps(o: { switchOn?: boolean; used?: number; ready?: boolean; liveResult?: { ok: true } | { ok: false; permanent: boolean; code: string } } = {}) {
  const calls = { live: [] as string[], gated: [] as string[], recorded: 0 };
  let used = o.used ?? 0;
  const d: TestSendDeps = {
    switchOn: () => o.switchOn ?? false,
    liveReady: () => o.ready ?? true,
    liveSend: async (to) => { assertAllowlisted(to); calls.live.push(to); return o.liveResult ?? { ok: true }; },
    gatedSend: async (to) => { calls.gated.push(to); return { ok: true, dryRun: !(o.switchOn ?? false) }; },
    usedInLast24h: async () => used,
    recordUse: async () => { calls.recorded++; used++; },
  };
  return { d, calls };
}

test("the allowlist holds exactly one address, and the cap is five", () => {
  assert.deepEqual([...TEST_EMAIL_ALLOWLIST], [KING]);
  assert.equal(TEST_EMAIL_CAP, 5);
});

test("the guard accepts the allowlisted address (any capital letters) and rejects every other kind of address or trick", () => {
  assert.equal(allowlisted(KING), true);
  assert.equal(allowlisted("King@KDSquares.com"), true);
  for (const bad of [
    "someone@example.com", "owner@kdsquares.com", "king@kdsquares.co", "king@kdsquares.com.evil.io", "xking@kdsquares.com", "king@sub.kdsquares.com",
    "king@kdsquares.com, other@example.com", "other@example.com,king@kdsquares.com", "king@kdsquares.com;other@example.com", "King <king@kdsquares.com>",
    " king@kdsquares.com", "king@kdsquares.com ", "king@kdsquares.com\nBcc: x@y.test", "\"king@kdsquares.com\"@evil.io", "king@kdsquares.com@evil.io", "king+tag@kdsquares.com",
    "", "king", "@kdsquares.com", "king@", "kіng@kdsquares.com", // the last has a Cyrillic i
  ]) assert.equal(allowlisted(bad), false, JSON.stringify(bad));
  for (const bad of [null, undefined, 5, {}, [KING], ["a@b.test", KING]]) assert.equal(allowlisted(bad), false, String(bad));
  assert.doesNotThrow(() => assertAllowlisted(KING));
  assert.throws(() => assertAllowlisted("someone@example.com"), /Refused/);
  assert.throws(() => assertAllowlisted(undefined), /Refused/);
});

test("while sending is off, an allowlisted saved address gets a real test and it is counted BEFORE the send", async () => {
  const { d, calls } = deps();
  const out = await sendTestMail(KING, [KING], MAIL, d);
  assert.deepEqual(out, { status: "sent_live" });
  assert.deepEqual(calls.live, [KING]);
  assert.equal(calls.recorded, 1);
  assert.deepEqual(calls.gated, []);
  // A failed live attempt still counts, so a retry loop cannot go past the cap.
  const bad = deps({ liveResult: { ok: false, permanent: false, code: "http_500" } });
  assert.deepEqual(await sendTestMail(KING, [KING], MAIL, bad.d), { status: "failed", code: "http_500" });
  assert.equal(bad.calls.recorded, 1);
});

test("the sixth live test in 24 hours is refused, and nothing is sent", async () => {
  const { d, calls } = deps({ used: TEST_EMAIL_CAP });
  assert.deepEqual(await sendTestMail(KING, [KING], MAIL, d), { status: "refused", reason: "cap" });
  assert.deepEqual(calls, { live: [], gated: [], recorded: 0 });
  const five = deps();
  for (let i = 0; i < TEST_EMAIL_CAP; i++) assert.equal((await sendTestMail(KING, [KING], MAIL, five.d)).status, "sent_live");
  assert.equal((await sendTestMail(KING, [KING], MAIL, five.d)).status, "refused");
  assert.equal(five.calls.live.length, TEST_EMAIL_CAP);
});

test("any other address while sending is off is a dry run: the real transport is never called for it", async () => {
  for (const to of ["someone@example.com", "owner@kdsquares.com", "king@kdsquares.com.evil.io", "other@gmail.com"]) {
    const { d, calls } = deps();
    const out = await sendTestMail(to, [to], MAIL, d);
    assert.deepEqual(out, { status: "dry_run" }, to);
    assert.deepEqual(calls.live, [], `${to}: no live send`);
    assert.deepEqual(calls.gated, [to]);
    assert.equal(calls.recorded, 0);
  }
});

test("a live transport that is reached with a non-allowlisted address refuses it by itself (defence in depth)", async () => {
  const { d } = deps();
  await assert.rejects(() => d.liveSend("someone@example.com", MAIL), /Refused/);
});

test("an address that is not one of the saved recipients, or is not an address, is refused before anything happens", async () => {
  const { d, calls } = deps();
  assert.deepEqual(await sendTestMail("stranger@example.com", [KING], MAIL, d), { status: "refused", reason: "not_a_recipient" });
  assert.deepEqual(await sendTestMail(KING, ["a@b.test"], MAIL, d), { status: "refused", reason: "not_a_recipient" });
  assert.deepEqual(await sendTestMail("not an address", ["not an address"], MAIL, d), { status: "refused", reason: "invalid_address" });
  assert.deepEqual(calls, { live: [], gated: [], recorded: 0 });
});

test("with sending switched on there is no exception: the normal path is used for everyone", async () => {
  const { d, calls } = deps({ switchOn: true });
  assert.deepEqual(await sendTestMail("someone@example.com", ["someone@example.com"], MAIL, d), { status: "sent" });
  assert.deepEqual(await sendTestMail(KING, [KING], MAIL, d), { status: "sent" });
  assert.deepEqual(calls.live, []);
  assert.equal(calls.recorded, 0);
});

test("when no mail service is configured, even the allowlisted address is a dry run and uses none of the five", async () => {
  const { d, calls } = deps({ ready: false });
  assert.deepEqual(await sendTestMail(KING, [KING], MAIL, d), { status: "dry_run" });
  assert.deepEqual(calls.live, []);
  assert.equal(calls.recorded, 0);
});

test("what the screen says for each outcome", () => {
  assert.match(testOutcomeText({ status: "sent_live" }, KING).text, /was sent to king@kdsquares.com/);
  assert.match(testOutcomeText({ status: "dry_run" }, "a@b.test").text, /Test mode: .*nothing was sent/);
  assert.equal(testOutcomeText({ status: "dry_run" }, "a@b.test").ok, true);
  assert.match(testOutcomeText({ status: "failed", code: "http_500" }, "a@b.test").text, /code: http_500/);
  assert.match(testOutcomeText({ status: "refused", reason: "cap" }, "a@b.test").text, /Too many test emails today/);
  assert.match(testOutcomeText({ status: "refused", reason: "not_a_recipient" }, "a@b.test").text, /Add this address to the recipients and save first/);
});
