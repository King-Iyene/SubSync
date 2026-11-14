import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import {
  DEFAULT_SETTINGS, MASTER_OFF_LINE, NEEDS_PERMISSION_SEND, NOT_AVAILABLE, PREVIEW_ONLY_LINE, TURN_ON_MEANS, channelOffReason, composerState, dryRunMessage, guardSend, smsSegments, type ComposerFacts, type GuardInput,
} from "../ghl/send-guard.ts";
import { resultText } from "../design/send-result.ts";
import { resetLimits, runAction, type Target } from "../ghl/workbench.ts";

// The message box on a lead with no conversation yet, and the plain state it shows (King, 13 Nov 2026). No real message is ever sent: the platform is a stub and no live switch is read from process.env.
const facts = (o: Partial<ComposerFacts> = {}): ComposerFacts => ({ enabled: true, killed: false, paused: false, needsPermission: false, roleOk: true, agencyOff: false, optedIn: true, masterOn: true, ...o });
const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const walk = (d: string): string[] => readdirSync(join(ROOT, d)).flatMap((n) => { const p = `${d}/${n}`; return statSync(join(ROOT, p)).isDirectory() ? (n === "__tests__" || n === "node_modules" ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) ? [p] : []; });

beforeEach(() => resetLimits());

// ---------------- each state says one precise thing ----------------
test("everything on: the box simply works", () => {
  assert.deepEqual(composerState(facts()), { lock: null, previewOnly: null });
});

test("live sending not turned on for the account: the box works up to the preview, and says so", () => {
  const s = composerState(facts({ optedIn: false }));
  assert.equal(s.lock, null);
  assert.equal(s.previewOnly?.id, "account");
  assert.equal(s.previewOnly?.text, PREVIEW_ONLY_LINE);
  assert.match(PREVIEW_ONLY_LINE, /^Preview only: nothing was sent, because sending is not turned on for this account yet\. Turn it on in Settings > Sending rules \(account owners and admins\)\.$/);
});

test("SubSync's own live switch off (account ready): a different, honest line", () => {
  const s = composerState(facts({ masterOn: false }));
  assert.equal(s.lock, null);
  assert.equal(s.previewOnly?.id, "switch");
  assert.equal(s.previewOnly?.text, MASTER_OFF_LINE);
  assert.notEqual(MASTER_OFF_LINE, PREVIEW_ONLY_LINE);
});

test("a missing permission locks the box with the reconnect sentence", () => {
  const s = composerState(facts({ needsPermission: true, optedIn: false }));
  assert.equal(s.lock?.id, "permission");
  assert.equal(s.lock?.text, NEEDS_PERMISSION_SEND);
  assert.equal(NEEDS_PERMISSION_SEND, "Needs permission: reconnect to allow sending");
});

test("role not allowed, paused and the kill switch each have their own sentence", () => {
  assert.match(composerState(facts({ roleOk: false })).lock?.text ?? "", /Only an account owner or administrator/);
  assert.match(composerState(facts({ roleOk: false, agencyOff: true })).lock?.text ?? "", /turned off sending by the company that manages it/);
  assert.match(composerState(facts({ paused: true })).lock?.text ?? "", /^Sending is paused for this account/);
  assert.match(composerState(facts({ killed: true })).lock?.text ?? "", /paused for everyone by SubSync/);
  assert.equal(composerState(facts({ roleOk: false })).lock?.id, "role");
  assert.equal(composerState(facts({ paused: true })).lock?.id, "paused");
  assert.equal(composerState(facts({ killed: true })).lock?.id, "killed");
});

test("the feature being unavailable has its own sentence, and it is never the vague old one", () => {
  const s = composerState(facts({ enabled: false }));
  assert.equal(s.lock?.id, "feature_off");
  assert.equal(s.lock?.text, NOT_AVAILABLE);
  assert.doesNotMatch(NOT_AVAILABLE, /not switched on for your account yet/);
});

test("order of check: feature, permission, role, paused, kill switch, then the preview-only notes", () => {
  const all = facts({ enabled: false, needsPermission: true, roleOk: false, paused: true, killed: true, optedIn: false, masterOn: false });
  assert.equal(composerState(all).lock?.id, "feature_off");
  assert.equal(composerState({ ...all, enabled: true }).lock?.id, "permission");
  assert.equal(composerState({ ...all, enabled: true, needsPermission: false }).lock?.id, "role");
  assert.equal(composerState({ ...all, enabled: true, needsPermission: false, roleOk: true }).lock?.id, "paused");
  assert.equal(composerState({ ...all, enabled: true, needsPermission: false, roleOk: true, paused: false }).lock?.id, "killed");
  assert.equal(composerState({ ...all, enabled: true, needsPermission: false, roleOk: true, paused: false, killed: false }).previewOnly?.id, "account");
});

test("every state is plain: no internal switch names, no vague notice", () => {
  const texts = [NOT_AVAILABLE, NEEDS_PERMISSION_SEND, PREVIEW_ONLY_LINE, MASTER_OFF_LINE, ...TURN_ON_MEANS];
  for (const f of [facts({ roleOk: false }), facts({ roleOk: false, agencyOff: true }), facts({ paused: true }), facts({ killed: true })]) texts.push(composerState(f).lock?.text ?? "");
  for (const t of texts) { assert.ok(t.length > 10); assert.doesNotMatch(t, /WRITE_GHL_LIVE|send_messages|SEND_MESSAGES_KILL|GoHighLevel|HighLevel|\bGHL\b/); }
});

// ---------------- a lead with no conversation: each way of sending ----------------
test("no phone number or no email: that way is off, with one plain line why", () => {
  assert.equal(channelOffReason("SMS", { phone: null, email: "a@b.co" }), "No phone number on this contact");
  assert.equal(channelOffReason("Email", { phone: "+15551230000", email: null }), "No email address on this contact");
  assert.equal(channelOffReason("SMS", { phone: "+15551230000", email: null }), null);
  assert.equal(channelOffReason("Email", { phone: null, email: "a@b.co" }), null);
  assert.equal(channelOffReason("WhatsApp", { phone: "+1", email: "a@b.co" }), "WhatsApp is not available from SubSync");
});

test("the text counter works from the first character (parts, and emoji make parts shorter)", () => {
  assert.equal(smsSegments("").parts, 0);
  assert.equal(smsSegments("Hi Dana").parts, 1);
  assert.equal(smsSegments("a".repeat(161)).parts, 2);
  assert.equal(smsSegments("Hi \u{1F600}").unicode, true);
});

// ---------------- the send for a contact with no conversation: the gateway, stubbed ----------------
const T: Target = { locationId: "L1", contactId: "C1", name: "Dana Reed", dnd: false, phone: "+15551230000", email: "dana@example.com", timeZone: "America/New_York" } as Target;
const NOON = new Date("2026-11-04T17:00:00Z");
const quiet = { audit: async () => undefined, log: () => undefined, sleep: async () => undefined };
const stub = () => { const calls: Array<{ url: string; body: unknown }> = []; return { calls, fetchImpl: (async (url: string, init?: RequestInit) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null }); return new Response(JSON.stringify({ messageId: "m1" }), { status: 200 }); }) as typeof fetch }; };
let n = 0;
const run = (channel: "SMS" | "Email", env: Record<string, string>, optedIn: boolean, f = stub()) =>
  runAction({ installationId: "i1", actor: "Ann", target: T, action: { kind: "message", channel, text: `Hello Dana ${++n}`, ...(channel === "Email" ? { subject: "Hi" } : {}) }, optedIn, confirmed: true, ack: [], token: async () => "tok", now: NOON }, { env, fetchImpl: f.fetchImpl, ...quiet }).then((r) => ({ r, f }));

test("account not opted in: Send records a dry run, says why, and nothing leaves", async () => {
  for (const channel of ["SMS", "Email"] as const) {
    const { r, f } = await run(channel, { WRITE_GHL_LIVE: "true" }, false);
    assert.equal(r.outcome, "dry_run"); assert.equal(f.calls.length, 0);
    if (r.outcome === "dry_run") { assert.equal(r.reason, "account"); assert.equal(dryRunMessage(r.reason), PREVIEW_ONLY_LINE); }
  }
});

test("opted in but the server switch off: a dry run with the other line", async () => {
  const { r, f } = await run("SMS", {}, true);
  assert.equal(r.outcome, "dry_run"); assert.equal(f.calls.length, 0);
  if (r.outcome === "dry_run") { assert.equal(r.reason, "switch"); assert.equal(dryRunMessage(r.reason), MASTER_OFF_LINE); }
});

test("the first message to a contact with no conversation is the one contact-id call, and it only goes out when both switches are on", async () => {
  const { r, f } = await run("SMS", { WRITE_GHL_LIVE: "true" }, true);
  assert.equal(r.outcome, "done");
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /\/conversations\/messages$/);
  const b = f.calls[0].body as { type: string; contactId: string; message: string };
  assert.deepEqual({ ...b, message: b.message.replace(/\d+$/, "N") }, { type: "SMS", contactId: "C1", message: "Hello Dana N" }, "no conversation id is needed: the CRM opens the conversation (CHECK on the first live send)");
  const mail = await run("Email", { WRITE_GHL_LIVE: "true" }, true);
  assert.equal((mail.f.calls[0].body as { type: string }).type, "Email");
});

test("the person sees the preview-only sentence as it is, not rewritten", () => {
  assert.equal(resultText("message", true, PREVIEW_ONLY_LINE, "Send this text to Dana"), PREVIEW_ONLY_LINE);
  assert.equal(resultText("message", true, MASTER_OFF_LINE), MASTER_OFF_LINE);
  assert.match(resultText("message", true, "Nothing was sent."), /^Not sent:/);
});

// ---------------- guardrails still fail closed ----------------
const base = (): GuardInput => ({
  enabled: true, killed: false, settings: DEFAULT_SETTINGS, who: { kind: "business", isOwnerOrAdmin: true }, scopeGranted: true, channel: "SMS", text: "Hi Dana, can we talk today?",
  dnd: { all: false, sms: false, email: false }, hasPhone: true, hasEmail: true, timeZone: "America/New_York", now: NOON, usage: { personHour: 0, personDay: 0, accountDay: 0, duplicateRecent: false },
});
const ids = (i: GuardInput) => guardSend(i).map((b) => b.id);

test("the guardrails are unchanged: DND unknown, per-channel DND, quiet hours, caps, duplicate, no destination, kill switch, permission", () => {
  assert.deepEqual(ids(base()), []);
  assert.ok(ids({ ...base(), dnd: null }).includes("dnd_unknown"));
  assert.ok(ids({ ...base(), dnd: { all: false, sms: true, email: false } }).includes("dnd"));
  assert.ok(ids({ ...base(), now: new Date("2026-11-05T03:00:00Z") }).includes("quiet_hours"));
  assert.ok(ids({ ...base(), timeZone: null }).includes("tz_unknown"));
  assert.ok(ids({ ...base(), usage: null }).includes("usage_unknown"));
  assert.ok(ids({ ...base(), usage: { personHour: 2, personDay: 0, accountDay: 0, duplicateRecent: true } }).includes("duplicate"));
  assert.ok(ids({ ...base(), usage: { personHour: 2, personDay: 0, accountDay: 0, duplicateRecent: false } }).includes("cap_person_hour"));
  assert.ok(ids({ ...base(), hasPhone: false }).includes("no_destination"));
  assert.ok(ids({ ...base(), killed: true }).includes("killed"));
  assert.ok(ids({ ...base(), scopeGranted: null }).includes("needs_permission"));
  assert.ok(ids({ ...base(), who: { kind: "agency", isOwnerOrAdmin: false } }).includes("role"));
  assert.ok(ids({ ...base(), text: "see http://evil.test/x", settings: { ...DEFAULT_SETTINGS, linkAllowlist: ["good.test"] } }).includes("link_not_allowed"));
});

// ---------------- source guards ----------------
test("the old vague notice is gone everywhere", () => {
  const bad: string[] = [];
  for (const f of walk("src")) read(f).split(/\r?\n/).forEach((line, i) => { if (/Sending from SubSync is not switched on/.test(line)) bad.push(`${f}:${i + 1}`); });
  assert.deepEqual(bad, []);
  assert.doesNotMatch(read("src/app/app/ds/wb/conversation.tsx"), /not switched on for your account yet/);
});

test("the message box is drawn whether or not a conversation exists, and WhatsApp stays hidden", () => {
  const c = read("src/app/app/ds/wb/conversation.tsx");
  assert.doesNotMatch(c, /hasConversation/, "the box never depends on an existing conversation");
  assert.match(c, /channelOffReason\(/);
  assert.match(c, /data-testid="wb-preview-only"/);
  assert.match(c, /RECONNECT_HREF/);
  assert.match(c, /k !== "WhatsApp"/);
  const d = read("src/app/app/ds/lead-drawer.tsx");
  assert.match(d, /!wb\.hasConversation/);
  assert.match(d, /onChannel=\{setChannelPref\}/, "the Text and Email tabs set the way the box starts");
});

test("the AI draft only fills the box and still never sends", () => {
  const c = read("src/app/app/ds/wb/conversation.tsx");
  assert.match(c, /onDraft=\{\(t\) => \{ setText\(t\); setAiDraft\(true\)/);
  assert.match(c, /data-testid="ai-draft-note"/);
  assert.doesNotMatch(read("src/app/app/ds/ai-lead.tsx"), /workbench\/do|runner\.(send|now|confirm)/);
});

test("the account switch: owners and admins only, the account name typed, an audit line, the one existing opt-in", () => {
  const r = read("src/lib/api/send-routes.ts");
  assert.match(r, /export async function sendOptinRoute/);
  assert.match(r, /mayConfigure\(ctx\)\) return json\(\{ error: "Only an account owner or administrator/);
  assert.match(r, /Type the account name/);
  assert.match(r, /setWriteEnabled\(/);
  assert.match(r, /message\.sending_on/);
  assert.doesNotMatch(r, /process\.env\.\w+LIVE\s*=/);
  assert.match(read("src/lib/api/workbench-routes.ts"), /send-optin/);
  assert.match(read("src/app/app/views/settings-hub-parts.tsx"), /SendingRulesCard/);
});
