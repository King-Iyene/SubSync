import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AI_WHAT, aiLine, aiStatus, calendarLine, calendarStatus, emailLine, emailStatus, recordResults, slackChatLine, slackChatState, summaryChips, testResultText } from "../connections/tools-status.ts";

const base = { notSwitchedOn: false, failed: false, canManage: true, killed: false, connection: null };

test("AI row status: every state has its own plain word", () => {
  assert.equal(aiStatus({ ...base, notSwitchedOn: true }).text, "Not switched on yet");
  assert.equal(aiStatus({ ...base, failed: true }).tone, "warn");
  assert.equal(aiStatus({ ...base, canManage: false }).text, "Set by your administrator");
  assert.equal(aiStatus({ ...base, killed: true }).text, "Switched off for everyone");
  assert.deepEqual(aiStatus(base), { text: "Not connected", tone: "neutral" });
  assert.deepEqual(aiStatus({ ...base, connection: { provider: "anthropic", model: "claude-x", status: "connected", paused: false } }), { text: "Connected: Anthropic, claude-x", tone: "good" });
  assert.equal(aiStatus({ ...base, connection: { provider: "openai", model: "m", status: "connected", paused: true } }).text, "Paused");
  assert.equal(aiStatus({ ...base, connection: { provider: "openai", model: "m", status: "needs_attention", paused: false } }).tone, "bad");
  assert.match(aiLine(base), /not using any AI/);
  assert.match(AI_WHAT, /never messages a lead/);
});

test("Email row status follows the saved address, the last check and the sending switch", () => {
  assert.equal(emailStatus({ address: null, check: null, sendingLive: false }).text, "No address yet");
  assert.equal(emailStatus({ address: "a@b.com", check: null, sendingLive: false }).text, "Address saved, not checked");
  const at = "2026-11-14T00:00:00Z";
  assert.equal(emailStatus({ address: "a@b.com", check: { status: "ok", checkedAt: at }, sendingLive: false }).tone, "good");
  assert.equal(emailStatus({ address: "a@b.com", check: { status: "warning", checkedAt: at }, sendingLive: false }).tone, "warn");
  assert.equal(emailStatus({ address: "a@b.com", check: { status: "critical", checkedAt: at }, sendingLive: false }).tone, "bad");
  assert.match(emailLine({ address: "a@b.com", check: null, sendingLive: false }), /switched off for now/);
  assert.doesNotMatch(emailLine({ address: "a@b.com", check: null, sendingLive: true }), /switched off/);
});

test("SPF, DKIM and DMARC lines: the worst finding per record wins; a record with no finding is not claimed", () => {
  const r = recordResults([
    { severity: "good", area: "spf", message: "SPF is fine." },
    { severity: "warning", area: "dmarc", message: "DMARC is only monitoring." },
    { severity: "critical", area: "dmarc", message: "DMARC is missing." },
  ]);
  assert.deepEqual(r.map((x) => [x.label, x.tone]), [["SPF", "good"], ["DKIM", "neutral"], ["DMARC", "bad"]]);
  assert.equal(r[1].text, "Not reported");
  assert.equal(r[2].text, "DMARC is missing.");
});

test("the test email result says plainly that nothing was sent while sending is off", () => {
  assert.match(testResultText({ dryRun: true, to: "a@b.com" }), /^Sending is switched off for now, so nothing was sent\. This is what would be sent to a@b\.com\.$/);
  assert.match(testResultText({ dryRun: false, to: "a@b.com" }), /was sent to a@b\.com/);
});

test("Calendars: a missing permission is named, never blurred with an empty list", () => {
  assert.deepEqual(calendarStatus({ count: 3, mapped: 1, permissionMissing: true }), { text: "Needs permission: reconnect", tone: "warn" });
  assert.equal(calendarStatus({ count: 0, mapped: 0, permissionMissing: false }).text, "None read yet");
  assert.equal(calendarStatus({ count: 1, mapped: 0, permissionMissing: false }).text, "1 calendar");
  assert.equal(calendarStatus({ count: 4, mapped: 2, permissionMissing: false }).text, "4 calendars");
  assert.match(calendarLine({ count: 4, mapped: 2, permissionMissing: false }), /2 have a team member attached/);
  assert.match(calendarLine({ count: 4, mapped: 0, permissionMissing: false }), /None has a team member/);
});

test("Slack chat: not set up, set up and waiting, connected, all from recorded facts", () => {
  assert.equal(slackChatState({ on: false, links: 2, recentEvents: 5, lastEventAt: null }), "off");
  assert.equal(slackChatState({ on: true, links: 0, recentEvents: 0, lastEventAt: null }), "not_set_up");
  assert.equal(slackChatState({ on: true, links: 1, recentEvents: 0, lastEventAt: null }), "waiting");
  assert.equal(slackChatState({ on: true, links: 1, recentEvents: 3, lastEventAt: "2026-11-14T00:00:00Z" }), "connected");
  assert.match(slackChatLine({ on: true, links: 1, recentEvents: 0, lastEventAt: null }), /set up, waiting for the first message/);
  assert.match(slackChatLine({ on: true, links: 0, recentEvents: 0, lastEventAt: null }), /not set up/);
});

test("the summary has four chips", () => {
  const chips = summaryChips({ ai: aiStatus(base), slack: { connected: true }, email: emailStatus({ address: null, check: null, sendingLive: false }), fathom: { connected: false, needsReconnect: true } });
  assert.deepEqual(chips.map((c) => c.name), ["AI", "Slack", "Email", "Fathom"]);
  assert.equal(chips[3].text, "Reconnect");
});

test("no vendor words in the new wording or screens", () => {
  for (const f of ["src/lib/connections/tools-status.ts", "src/app/app/views/connections-tools.tsx", "src/app/app/views/email-tool.tsx", "src/app/app/views/ai-tool-row.tsx"]) {
    const text = readFileSync(join(process.cwd(), f), "utf8");
    assert.doesNotMatch(text.replace(/\/\/.*$/gm, ""), /GoHighLevel|HighLevel|\bGHL\b/, f);
  }
});
