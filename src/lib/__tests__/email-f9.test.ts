import assert from "node:assert/strict";
import { test } from "node:test";

process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const { matchesEmail, readUnsubscribe, signUnsubscribe, unsubscribeUrl } = await import("../unsubscribe.ts");
const { sendEmail, unsubscribeHeaders } = await import("../email.ts");
const { alertEmail, alertsToSendNow, isQuietHour, weeklyEmail } = await import("../analytics/weekly-email.ts");

const INST = "11111111-2222-3333-4444-555555555555";

test("an unsubscribe token names the installation and the address, and nothing else works", () => {
  const t = signUnsubscribe(INST, "Owner@Example.com");
  const u = readUnsubscribe(t);
  assert.equal(u?.installationId, INST);
  assert.equal(matchesEmail(u!, "owner@example.com"), true, "case does not matter");
  assert.equal(matchesEmail(u!, "someone.else@example.com"), false, "a link for an old address stops working when the address changes");
  assert.equal(matchesEmail(u!, null), false);
  assert.equal(readUnsubscribe(t.slice(0, -2) + "xx"), null, "a damaged signature is refused");
  const [body, sig] = t.split(".");
  const other = Buffer.from(JSON.stringify({ i: "99999999-2222-3333-4444-555555555555", e: u!.emailTag })).toString("base64url");
  assert.equal(readUnsubscribe(`${other}.${sig}`), null, "a token cannot be edited to name another company");
  assert.equal(readUnsubscribe(`${body}.`), null);
  for (const junk of [null, undefined, "", "abc", "a.b", 42, "x".repeat(500) + ".y", "..", `${body}.${sig}.extra`]) assert.equal(readUnsubscribe(junk), null, String(junk));
});

test("the stop link is in the text and the html of both emails, and is escaped", () => {
  const stop = unsubscribeUrl("https://app.example.test/", INST, "o@example.com");
  assert.match(stop, /^https:\/\/app\.example\.test\/api\/email\/unsubscribe\?t=/);
  const w = weeklyEmail({ who: "Acme", appUrl: "https://app.example.test", stopUrl: stop, fine: 1, headlines: [], attention: [] });
  const a = alertEmail("Acme", [{ severity: "warning", title: "x" }], "https://app.example.test", stop);
  for (const m of [w, a]) {
    assert.ok(m.text.includes(`Stop these emails: ${stop}`), "text");
    assert.ok(m.html.includes("Stop these emails") && m.html.includes(stop.replace(/&/g, "&amp;")), "html");
  }
  assert.ok(!weeklyEmail({ who: "Acme", appUrl: "https://x.test", fine: 0, headlines: [], attention: [] }).text.includes("Stop these emails"), "no link when none is given");
  assert.ok(alertEmail("A", [{ severity: "warning", title: "<b>x</b>" }], "https://x.test", "https://x.test/?a=1&b=2").html.includes("&amp;b=2"), "the address is escaped in the html");
});

test("the emails use no platform name and none of our internal words", () => {
  const stop = unsubscribeUrl("https://x.test", INST, "o@example.com");
  const all = [weeklyEmail({ who: "Acme Marketing", appUrl: "https://x.test", stopUrl: stop, fine: 2, headlines: [{ label: "Open pipeline", money: true, today: 5, vsAvg: 1 }], attention: [{ name: "A", title: "t" }], facts: ["a fact"] }), alertEmail("Acme Marketing", [{ severity: "critical", title: "t" }], "https://x.test", stop)];
  for (const m of all) assert.ok(!/gohighlevel|highlevel|leadconnector|\bghl\b|agenc(y|ies)|sub-?account|\blocations?\b/i.test(m.subject + m.text + m.html));
});

test("quiet hours: 21:00 to 07:00 holds warnings, never criticals; off or unknown time sends everything", () => {
  assert.deepEqual([6, 7, 20, 21, 23, 0].map(isQuietHour), [true, false, false, true, true, true]);
  const list = [{ severity: "critical" }, { severity: "warning" }];
  assert.deepEqual(alertsToSendNow(list, 23, true), [{ severity: "critical" }]);
  assert.deepEqual(alertsToSendNow(list, 3, true), [{ severity: "critical" }]);
  assert.equal(alertsToSendNow(list, 12, true).length, 2);
  assert.equal(alertsToSendNow(list, 23, false).length, 2, "quiet hours switched off");
  assert.equal(alertsToSendNow(list, null, true).length, 2, "an unreadable time zone does not hold alerts back");
});

test("sending: one retry after a pause for a network failure, a rate limit or a server error; none for a refusal", async () => {
  process.env.RESEND_API_KEY = "test-key";
  process.env.EMAIL_FROM = "SubSync <hello@example.test>";
  const mail = { subject: "s", text: "t", html: "<p>t</p>", headers: unsubscribeHeaders("https://x.test/u") };
  const run = async (script: Array<number | "throw">) => {
    const calls: Array<{ body: string }> = [];
    let waited = 0;
    const result = await sendEmail("a@example.test", mail, {
      fetch: async (_u, init) => { calls.push({ body: String(init.body) }); const next = script.shift(); if (next === "throw") throw new Error("network"); return { ok: next === 200, status: next as number }; },
      wait: async (ms) => { waited += ms; },
    });
    return { result, calls: calls.length, waited, body: calls[0]?.body ?? "" };
  };
  assert.deepEqual(await run([200]), { ...(await run([200])), result: true, calls: 1, waited: 0 });
  const retried = await run([500, 200]); assert.equal(retried.result, true); assert.equal(retried.calls, 2); assert.ok(retried.waited > 0);
  const net = await run(["throw", 200]); assert.equal(net.result, true); assert.equal(net.calls, 2);
  const limited = await run([429, 429]); assert.equal(limited.result, false); assert.equal(limited.calls, 2, "gives up after one retry");
  const refused = await run([422, 200]); assert.equal(refused.result, false); assert.equal(refused.calls, 1, "a bad address is not retried");
  const sent = JSON.parse((await run([200])).body);
  assert.equal(sent.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click", "the one-click unsubscribe header goes with the message");
  assert.deepEqual(sent.to, ["a@example.test"]);
  delete process.env.RESEND_API_KEY;
  assert.equal(await sendEmail("a@example.test", mail, { fetch: async () => { throw new Error("must not be called"); } }), false, "nothing is sent when the service is not configured");
});
