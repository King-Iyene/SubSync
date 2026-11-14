import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildAlert, buildDigest, digestOn, excerptOf, isPlatformOwner, parseOwnerSettings, raisesInstantAlert, rateDecision, type AlertEvent, type AlertState } from "../feedback-alert.ts";
import { alertOwner, sendDigest, type AlertDeps, type OwnerSettings } from "../notifications/feedback-alert-send.ts";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const INST = "11111111-2222-3333-4444-555555555555";
const ev = (o: Partial<AlertEvent> = {}): AlertEvent => ({ kind: "feedback", severity: "idea", installationId: INST, company: "Acme Roofing", page: "speed", ref: "R-AAAAAA", text: "Call me on +234 801 234 5678 or a@b.com about the list", ...o });

/** A whole fake world: nothing real can be reached. Records every send, audit line and saved state. */
function world(env: Record<string, string> = {}, settings: OwnerSettings = { digestOn: null, instantLevel: "stuck" }, start = new Date("2026-11-13T10:00:00Z")) {
  const sent: Array<{ via: string; to: string; text: string; subject?: string }> = [];
  const audits: Array<{ action: string; detail: Record<string, unknown> }> = [];
  const states = new Map<string, AlertState & { detail?: unknown }>();
  let now = start; let fail = false; let rows: Array<{ ref: string; kind: string; severity: string; title: string; at: string }> = [];
  const d: AlertDeps = {
    env: { FEEDBACK_NOTIFY_EMAIL: "king@example.com", FEEDBACK_SLACK_WEBHOOK: "https://hooks.slack.com/services/T/B/SECRET", ...env }, now: () => now, appUrl: "https://app.example.com",
    settings: async () => settings,
    getState: async (k) => states.get(k) ?? { lastAlertAt: null, suppressed: 0, lastRef: null },
    saveState: async (k, s) => { states.set(k, { ...s, detail: s.detail }); },
    audit: async (_i, action, detail) => { audits.push({ action, detail }); },
    email: async (to, m) => { if (fail) throw new Error("boom"); sent.push({ via: "email", to, text: m.text, subject: m.subject }); return { ok: true }; },
    slack: async (to, text) => { if (fail) return { ok: false }; sent.push({ via: "slack", to, text }); return { ok: true }; },
    digestRows: async () => rows, log: () => undefined,
  };
  return { d, sent, audits, states, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, setFail: (f: boolean) => { fail = f; }, setRows: (r: typeof rows) => { rows = r; } };
}
const LIVE = { SEND_EMAIL_LIVE: "true", SEND_SLACK_LIVE: "true" };

test("default policy: an idea, a note that is annoying and a suggestion send nothing; stuck and every problem report do", () => {
  assert.equal(raisesInstantAlert("stuck", { kind: "feedback", severity: "idea" }), false);
  assert.equal(raisesInstantAlert("stuck", { kind: "feedback", severity: "annoying" }), false);
  assert.equal(raisesInstantAlert("stuck", { kind: "suggestion", severity: "idea" }), false);
  assert.equal(raisesInstantAlert("stuck", { kind: "feedback", severity: "blocking" }), true);
  assert.equal(raisesInstantAlert("stuck", { kind: "problem", severity: "blocking" }), true);
  assert.equal(raisesInstantAlert("stuck_annoying", { kind: "feedback", severity: "annoying" }), true);
  assert.equal(raisesInstantAlert("stuck_annoying", { kind: "feedback", severity: "idea" }), false);
  assert.equal(raisesInstantAlert("everything", { kind: "suggestion", severity: "idea" }), true);
});

test("an idea at the default level sends nothing at all, even with the live switches on and both addresses set", async () => {
  const w = world(LIVE);
  const r = await alertOwner(ev(), w.d);
  assert.equal(r.status, "skipped");
  assert.equal(w.sent.length, 0);
  assert.equal(w.audits.length, 0);
});

test("a blocking report is an urgent alert: subject, kind, severity, company, page, link to the inbox, and no text by default", async () => {
  const w = world(LIVE);
  const r = await alertOwner(ev({ kind: "problem", severity: "blocking" }), w.d);
  assert.equal(r.status, "sent");
  assert.deepEqual(w.sent.map((s) => s.via).sort(), ["email", "slack"]);
  const email = w.sent.find((s) => s.via === "email")!;
  assert.match(email.subject!, /^\[URGENT\] New feedback: problem, blocking, from Acme Roofing \(11111111\), page speed$/);
  assert.match(email.text, /Open the Feedback inbox: https:\/\/app\.example\.com\/app#feedback-owner/);
  assert.doesNotMatch(email.text, /801|a@b\.com|Call me/, "the words people typed are not in the alert unless the owner asked");
  assert.equal(w.sent.find((s) => s.via === "slack")!.to, "https://hooks.slack.com/services/T/B/SECRET");
  assert.ok(w.audits.some((a) => a.action === "notify.king.sent"));
  assert.doesNotMatch(JSON.stringify(w.audits), /SECRET|king@example\.com/, "no address or webhook is ever logged");
});

test("dry run is the default: switches off means nothing leaves, and the record says exactly what would have gone", async () => {
  const w = world({ SEND_EMAIL_LIVE: "false" });
  const r = await alertOwner(ev({ severity: "blocking" }), w.d);
  assert.equal(r.status, "dry_run");
  assert.equal(w.sent.length, 0);
  const line = w.audits.find((a) => a.action === "notify.king.alert_dry_run")!;
  assert.deepEqual({ kind: line.detail.kind, severity: line.detail.severity, company: line.detail.company, page: line.detail.page, urgent: line.detail.urgent, excerpt: line.detail.excerpt }, { kind: "feedback", severity: "blocking", company: "11111111", page: "speed", urgent: true, excerpt: null });
  assert.doesNotMatch(JSON.stringify(line), /Call me|SECRET|king@example\.com/);
});

test("one channel live, one not: only the live one sends", async () => {
  const w = world({ SEND_EMAIL_LIVE: "true" });
  const r = await alertOwner(ev({ severity: "blocking" }), w.d);
  assert.equal(r.status, "sent");
  assert.deepEqual(w.sent.map((s) => s.via), ["email"]);
});

test("the excerpt appears only when FEEDBACK_NOTIFY_INCLUDE_TEXT=true, is at most 160 characters, and drops emails and phone numbers", async () => {
  const w = world({ ...LIVE, FEEDBACK_NOTIFY_INCLUDE_TEXT: "true" });
  await alertOwner(ev({ severity: "blocking", text: `${"x".repeat(300)} a@b.com +234 801 234 5678` }), w.d);
  const email = w.sent.find((s) => s.via === "email")!;
  const quoted = /"([^"]+)"/.exec(email.text)![1];
  assert.ok(quoted.length <= 160);
  const clean = excerptOf("Call +234 801 234 5678 or a@b.com now");
  assert.equal(clean, "Call [removed] or [removed] now");
  assert.equal(excerptOf(null), null);
  const html = buildAlert(ev({ severity: "blocking", text: "<img src=x onerror=alert(1)>" }), { env: { FEEDBACK_NOTIFY_INCLUDE_TEXT: "true" }, appUrl: "https://a.example" }).html;
  assert.doesNotMatch(html, /<img/);
});

test("nothing is sent when no address is set; it is recorded as skipped", async () => {
  const w = world({ ...LIVE, FEEDBACK_NOTIFY_EMAIL: "", FEEDBACK_SLACK_WEBHOOK: "" });
  const r = await alertOwner(ev({ severity: "blocking" }), w.d);
  assert.equal(r.status, "skipped");
  assert.equal(w.sent.length, 0);
  assert.ok(w.audits.some((a) => a.action === "notify.king.skipped"));
});

test("rate limit: one alert per severity per ten minutes, the rest counted into the next; the same item never twice", async () => {
  const w = world(LIVE);
  assert.equal((await alertOwner(ev({ severity: "blocking", ref: "R-1" }), w.d)).status, "sent");
  assert.equal((await alertOwner(ev({ severity: "blocking", ref: "R-2" }), w.d)).status, "held");
  assert.equal((await alertOwner(ev({ severity: "blocking", ref: "R-3" }), w.d)).status, "held");
  assert.equal((await alertOwner(ev({ severity: "blocking", ref: "R-1" }), w.d)).status, "duplicate");
  assert.equal(w.sent.length, 2, "one email and one Slack message, for the first only");
  w.advance(11 * 60 * 1000);
  assert.equal((await alertOwner(ev({ severity: "blocking", ref: "R-4" }), w.d)).status, "sent");
  assert.match(w.sent[w.sent.length - 1].text, /2 more of this kind/);
  assert.equal(w.states.get("severity:blocking")!.suppressed, 0);
  assert.equal(rateDecision({ lastAlertAt: null, suppressed: 0, lastRef: null }, "x", new Date()).send, true);
});

test("a delivery failure never throws and is logged; the sender's submission is not affected", async () => {
  const w = world(LIVE);
  w.setFail(true);
  const r = await alertOwner(ev({ severity: "blocking" }), w.d);
  assert.equal(r.status, "failed");
  assert.ok(w.audits.some((a) => a.action === "notify.king.failed"));
  const boom = world(LIVE);
  boom.d.settings = async () => { throw new Error("database down"); };
  assert.equal((await alertOwner(ev({ severity: "blocking" }), boom.d)).status, "failed");
});

test("the owner's setting changes behaviour: stuck and annoying, or everything", async () => {
  const a = world(LIVE, { digestOn: null, instantLevel: "stuck_annoying" });
  assert.equal((await alertOwner(ev({ severity: "annoying" }), a.d)).status, "sent");
  assert.equal((await alertOwner(ev({ severity: "idea", ref: "R-9" }), a.d)).status, "skipped");
  const b = world(LIVE, { digestOn: null, instantLevel: "everything" });
  assert.equal((await alertOwner(ev({ kind: "suggestion", severity: "idea" }), b.d)).status, "sent");
});

test("the daily summary is off by default; FEEDBACK_DIGEST=daily or the owner's switch turns it on, and the owner's switch wins", async () => {
  assert.equal(digestOn({}, null), false);
  assert.equal(digestOn({ FEEDBACK_DIGEST: "daily" }, null), true);
  assert.equal(digestOn({ FEEDBACK_DIGEST: "daily" }, false), false);
  assert.equal(digestOn({}, true), true);
  const rows = [
    { ref: "R-1", kind: "feedback", severity: "idea", title: "Add a team view", at: "2026-11-13T09:00:00Z" },
    { ref: "R-2", kind: "problem", severity: "blocking", title: "Stuck on login a@b.com", at: "2026-11-13T09:30:00Z" },
  ];
  const off = world(LIVE); off.setRows(rows);
  assert.equal((await sendDigest(off.d)).status, "skipped");
  assert.equal(off.sent.length, 0, "off by default: no message");
  const viaEnv = world({ ...LIVE, FEEDBACK_DIGEST: "daily" }); viaEnv.setRows(rows);
  assert.equal((await sendDigest(viaEnv.d)).status, "sent");
  assert.match(viaEnv.sent[0].text, /feedback\/idea: 1; problem\/blocking: 1/);
  assert.match(viaEnv.sent[0].text, /R-2 \(problem, blocking\)/);
  assert.doesNotMatch(viaEnv.sent[0].text, /Add a team view|a@b\.com/, "ids only by default");
  assert.equal((await sendDigest(viaEnv.d)).status, "held", "never twice in one day");
  const viaSetting = world(LIVE, { digestOn: true, instantLevel: "stuck" }); viaSetting.setRows(rows);
  assert.equal((await sendDigest(viaSetting.d)).status, "sent");
  const dry = world({ FEEDBACK_DIGEST: "daily" }); dry.setRows(rows);
  assert.equal((await sendDigest(dry.d)).status, "dry_run");
  assert.equal(dry.sent.length, 0);
  const withText = world({ ...LIVE, FEEDBACK_DIGEST: "daily", FEEDBACK_NOTIFY_INCLUDE_TEXT: "true" }); withText.setRows(rows);
  await sendDigest(withText.d);
  assert.match(withText.sent[0].text, /Add a team view/);
  assert.equal(buildDigest([], { env: {}, appUrl: "https://a" }).empty, true);
  const top5 = buildDigest(Array.from({ length: 9 }, (_, i) => ({ ref: `R-${i}`, kind: "feedback", severity: "idea", title: "t", at: `2026-11-13T0${i}:00:00Z` })), { env: {}, appUrl: "https://a" });
  assert.equal((top5.text.match(/^R-\d/gm) ?? []).length, 5);
});

test("owner settings are validated: only the two known choices are accepted", () => {
  assert.deepEqual(parseOwnerSettings({ digestOn: true }), { ok: true, value: { digestOn: true } });
  assert.deepEqual(parseOwnerSettings({ instantLevel: "everything" }), { ok: true, value: { instantLevel: "everything" } });
  assert.equal(parseOwnerSettings({ instantLevel: "nothing" }).ok, false);
  assert.equal(parseOwnerSettings({ digestOn: "yes" }).ok, false);
  assert.equal(parseOwnerSettings({}).ok, false);
  assert.equal(parseOwnerSettings(null).ok, false);
});

test("who is the platform owner: only an agency session on the allowlist (company id or email); nobody else", () => {
  const env = { PLATFORM_OWNER_COMPANY_IDS: "co_king, co_other", PLATFORM_OWNER_EMAILS: "King@Example.com" };
  assert.equal(isPlatformOwner({ kind: "agency", companyId: "co_king" }, env), true);
  assert.equal(isPlatformOwner({ kind: "agency", companyId: "x", email: "king@example.com" }, env), true);
  assert.equal(isPlatformOwner({ kind: "agency", companyId: "co_customer", email: "a@b.com" }, env), false);
  assert.equal(isPlatformOwner({ kind: "business", companyId: "co_king" }, env), false, "a business or client session is never the owner");
  assert.equal(isPlatformOwner({ kind: "client", companyId: "co_king" }, env), false);
  assert.equal(isPlatformOwner({ kind: "agency", companyId: "co_king" }, {}), false, "nothing is an owner until the variables are set");
  assert.equal(isPlatformOwner({ kind: "agency", companyId: null, email: null }, env), false);
});

test("the owner routes answer 404 to anyone who is not the owner, before any rule runs, and every handler checks again", () => {
  const auth = read("src/lib/api/auth.ts");
  assert.match(auth, /segments\[0\] === "owner" && !ownerSession\(session\)\) return json\(\{ error: "Not found" \}, 404\)/);
  assert.match(auth, /s\.platformOwner === true && !s\.demo/);
  assert.ok(auth.indexOf('segments[0] === "owner"') < auth.indexOf("routeAllowed(kind"), "the 404 comes before the role rules");
  const owner = read("src/lib/api/owner-feedback.ts");
  assert.match(owner, /if \(!ownerSession\(ctx\.session\)\) return notFound\(\)/);
  assert.equal((owner.match(/saveOwnerSettings|setStatus\(/g) ?? []).length >= 2, true);
  const router = read("src/lib/api/router.ts");
  assert.match(router, /a === "owner"\) return await handleOwnerFeedback/);
  const access = read("src/lib/access.ts");
  assert.doesNotMatch(access, /"owner"/, "no customer role rule opens the owner routes");
  const sso = read("src/app/api/sso/route.ts");
  assert.match(sso, /platformOwner: owner/);
  assert.match(read("src/app/app/dashboard.tsx"), /isOwner = auth\.status === "ready" && auth\.owner && !auth\.demo/);
});

test("the status change is audited and the inbox never reads contacts", () => {
  const q = read("src/lib/feedback-owner-queries.ts");
  assert.match(q, /'feedback\.status_changed'/);
  assert.doesNotMatch(q, /cached_contacts|from contacts/);
  assert.doesNotMatch(q, /access_token|refresh_token/);
});

test("the senders live only in the gated transport; the alert flow files name no sender and read no address", () => {
  for (const f of ["src/lib/feedback-alert.ts", "src/lib/notifications/feedback-alert-send.ts", "src/lib/feedback-owner-queries.ts", "src/lib/api/owner-feedback.ts"]) {
    const src = read(f).replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(src, /\b(sendEmail|sendEmailResult|postSlackWebhook)\b|\bfetch\(|hooks\.slack\.com/, f);
  }
  const t = read("src/lib/notifications/transports.ts");
  assert.match(t, /feedbackSenders[\s\S]*?outward\(\{ flag: "SEND_EMAIL_LIVE"[\s\S]*?sendEmailResult\(to/);
  assert.match(t, /feedbackSenders[\s\S]*?outward\(\{ flag: "SEND_SLACK_LIVE"[\s\S]*?postSlackWebhook\(url, text\)/);
  const all = read("src/lib/notifications/feedback-alert-run.ts") + read("src/lib/api/owner-feedback.ts");
  assert.doesNotMatch(all, /console\.(log|error)\([^)]*(FEEDBACK_NOTIFY_EMAIL|FEEDBACK_SLACK_WEBHOOK)/);
});

test("a person is told what happens: thanks, we read every one, and no promise of a reply time", () => {
  const box = read("src/app/app/feedback-box.tsx");
  assert.match(box, /Thanks, we read every one\./);
  assert.doesNotMatch(box, /within \d+|hours|24 ?h/i);
});
