import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { BULK_CAP, DEFAULT_SETTINGS, contentChecks, fillMerge, finalText, guardSend, hasMarkup, idemKey, parseDnd, smsSegments, textHash, type GuardInput } from "../ghl/send-guard.ts";
import { resetLimits, runAction, type Target } from "../ghl/workbench.ts";

// The guardrail matrix for sending a text or an email. Pure rules plus the gateway with a STUBBED platform only. No real message is ever sent and no live switch is read from process.env.
const NOON = new Date("2026-11-04T17:00:00Z"); // 12:00 in New York
const NIGHT = new Date("2026-11-05T03:00:00Z"); // 22:00 in New York
const ok = (): GuardInput => ({
  enabled: true, killed: false, settings: DEFAULT_SETTINGS, who: { kind: "business", isOwnerOrAdmin: true }, scopeGranted: true, channel: "SMS", text: "Hi Dana, can we talk today?",
  dnd: { all: false, sms: false, email: false }, hasPhone: true, hasEmail: true, timeZone: "America/New_York", now: NOON, usage: { personHour: 0, personDay: 0, accountDay: 0, duplicateRecent: false },
});
const ids = (i: GuardInput) => guardSend(i).map((b) => b.id);

beforeEach(() => resetLimits());

test("a clean text goes", () => assert.deepEqual(ids(ok()), []));

test("do-not-contact is checked per channel", () => {
  assert.ok(ids({ ...ok(), dnd: { all: true, sms: false, email: false } }).includes("dnd"));
  assert.ok(ids({ ...ok(), dnd: { all: false, sms: true, email: false } }).includes("dnd"));
  assert.deepEqual(ids({ ...ok(), dnd: { all: false, sms: true, email: false }, channel: "Email", subject: "Hello" }), [], "a text stop does not block an email");
  assert.ok(ids({ ...ok(), dnd: { all: false, sms: false, email: true }, channel: "Email", subject: "Hello" }).includes("dnd"));
});

test("an unreadable do-not-contact mark fails closed", () => assert.ok(ids({ ...ok(), dnd: null }).includes("dnd_unknown")));

test("quiet hours stop a text in the lead's time zone, and an unknown zone stops it too", () => {
  assert.ok(ids({ ...ok(), now: NIGHT }).includes("quiet_hours"));
  assert.ok(ids({ ...ok(), timeZone: null }).includes("tz_unknown"));
  assert.ok(ids({ ...ok(), timeZone: "Not/AZone" }).includes("tz_unknown"));
  const msg = guardSend({ ...ok(), now: NIGHT }).find((b) => b.id === "quiet_hours")!.text;
  assert.match(msg, /cannot schedule a message for later/);
  assert.deepEqual(ids({ ...ok(), now: NIGHT, channel: "Email", subject: "Hi" }), [], "quiet hours are for texts");
});

test("caps: per person per hour and day, and per account per day", () => {
  assert.ok(ids({ ...ok(), usage: { personHour: 2, personDay: 2, accountDay: 0, duplicateRecent: false } }).includes("cap_person_hour"));
  assert.ok(ids({ ...ok(), usage: { personHour: 0, personDay: 5, accountDay: 0, duplicateRecent: false } }).includes("cap_person_day"));
  assert.ok(ids({ ...ok(), usage: { personHour: 0, personDay: 0, accountDay: 200, duplicateRecent: false } }).includes("cap_account_day"));
  assert.ok(ids({ ...ok(), usage: null }).includes("usage_unknown"));
});

test("a duplicate inside the window is stopped, and the key is the same only inside it", () => {
  assert.ok(ids({ ...ok(), usage: { personHour: 0, personDay: 0, accountDay: 0, duplicateRecent: true } }).includes("duplicate"));
  const a = idemKey("c1", "SMS", "hello", NOON, 10), b = idemKey("c1", "SMS", "hello", new Date(NOON.getTime() + 60_000), 10), c = idemKey("c1", "SMS", "hello", new Date(NOON.getTime() + 11 * 60_000), 10);
  assert.equal(a, b); assert.notEqual(a, c); assert.notEqual(a, idemKey("c1", "Email", "hello", NOON, 10));
});

test("role: staff of the account may send; an agency needs an owner or administrator and the account's setting", () => {
  assert.deepEqual(ids({ ...ok(), who: { kind: "client", isOwnerOrAdmin: false } }), []);
  assert.ok(ids({ ...ok(), who: { kind: "agency", isOwnerOrAdmin: false } }).includes("role"));
  assert.deepEqual(ids({ ...ok(), who: { kind: "agency", isOwnerOrAdmin: true } }), []);
  assert.ok(ids({ ...ok(), who: { kind: "agency", isOwnerOrAdmin: true }, settings: { ...DEFAULT_SETTINGS, allowAgencySend: false } }).includes("role"));
});

test("missing permission, flag off, kill switch and pause each stop it", () => {
  assert.ok(guardSend({ ...ok(), scopeGranted: false }).some((b) => b.id === "needs_permission" && /Needs permission: reconnect/.test(b.text)));
  assert.ok(ids({ ...ok(), scopeGranted: null }).includes("needs_permission"));
  assert.ok(ids({ ...ok(), enabled: false }).includes("off"));
  assert.ok(ids({ ...ok(), killed: true }).includes("killed"));
  assert.ok(ids({ ...ok(), settings: { ...DEFAULT_SETTINGS, paused: true } }).includes("paused"));
});

test("no destination for the channel", () => {
  assert.ok(ids({ ...ok(), hasPhone: false }).includes("no_destination"));
  assert.ok(ids({ ...ok(), channel: "Email", subject: "Hi", hasEmail: false }).includes("no_destination"));
});

test("content checks: empty, subject, personal data, links", () => {
  assert.ok(contentChecks("SMS", "  ", undefined, []).some((b) => b.id === "empty"));
  assert.ok(contentChecks("Email", "Hello", " ", []).some((b) => b.id === "no_subject"));
  assert.ok(contentChecks("SMS", "my card is 4111 1111 1111 1111", undefined, []).some((b) => b.id === "personal_data"));
  assert.ok(contentChecks("SMS", "ssn 123-45-6789", undefined, []).some((b) => b.id === "personal_data"));
  assert.ok(contentChecks("SMS", "password: hunter2", undefined, []).some((b) => b.id === "personal_data"));
  assert.deepEqual(contentChecks("SMS", "Book at https://www.acme.com/book", undefined, ["acme.com"]), []);
  assert.ok(contentChecks("SMS", "Click http://evil.example/x", undefined, ["acme.com"]).some((b) => b.id === "link_not_allowed"));
  assert.deepEqual(contentChecks("SMS", "Click http://anything.example/x", undefined, []), [], "no allow-list means any link");
});

test("text segments and the opt-out line", () => {
  assert.equal(smsSegments("a".repeat(160)).parts, 1);
  assert.equal(smsSegments("a".repeat(161)).parts, 2);
  assert.equal(smsSegments("hi \u{1F600}").perPart, 70);
  assert.equal(finalText("SMS", "Hello", { footerEnabled: true, footerText: "Reply STOP to opt out." }), "Hello\nReply STOP to opt out.");
  assert.equal(finalText("SMS", "Hello Reply STOP to opt out.", { footerEnabled: true, footerText: "Reply STOP to opt out." }), "Hello Reply STOP to opt out.", "not added twice");
  assert.equal(finalText("Email", "Hello", { footerEnabled: true, footerText: "x" }), "Hello", "texts only");
});

test("templates: merge fields only, plain text only", () => {
  assert.equal(fillMerge("Hi {first_name} from {business}, {my_name} {other}", { first_name: "Dana", my_name: "Ann", business: "Acme" }), "Hi Dana from Acme, Ann {other}");
  assert.equal(hasMarkup("<b>hi</b>"), true); assert.equal(hasMarkup("hi there"), false); assert.equal(hasMarkup("javascript:alert(1)"), true);
});

test("the CRM's do-not-contact answer is read per channel, and no sign of it is unknown", () => {
  assert.deepEqual(parseDnd({ contact: { dnd: false, dndSettings: { SMS: { status: "active" }, Email: { status: "inactive" } } } }), { all: false, sms: true, email: false });
  assert.deepEqual(parseDnd({ dnd: true }), { all: true, sms: false, email: false });
  assert.equal(parseDnd({ contact: { firstName: "x" } }), null);
  assert.equal(parseDnd(null), null);
  assert.equal(BULK_CAP, 20);
  assert.notEqual(textHash("a"), textHash("b"));
});

// ---------------- the gateway ----------------
const T: Target = { locationId: "L1", contactId: "c1", name: "Dana Cole", dnd: false, phone: "+15550102030", email: "dana@x.com", timeZone: "America/New_York" };
const stub = () => {
  const calls: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ method: init.method ?? "GET", path: new URL(url).pathname, body: init.body ? JSON.parse(init.body as string) : null }); return Response.json({ messageId: "m-1" }); }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};
const quiet = { audit: async () => undefined, log: () => undefined, sleep: async () => undefined };
const send = (text: string, env: Record<string, string>, f = stub(), extra: Record<string, unknown> = {}) =>
  runAction({ installationId: "i1", actor: "Ann", target: T, action: { kind: "message", channel: "SMS", text }, optedIn: true, confirmed: true, ack: [], token: async () => "tok", now: NOON, ...extra }, { env, fetchImpl: f.fetchImpl, ...quiet });

test("dry run: with the live switch off nothing is sent", async () => {
  const f = stub();
  const r = await send("Hello", {}, f);
  assert.equal(r.outcome, "dry_run"); assert.equal(f.calls.length, 0);
});

test("the account's own opt-in is also required", async () => {
  const f = stub();
  const r = await send("Hello", { WRITE_GHL_LIVE: "true" }, f, { optedIn: false });
  assert.equal(r.outcome, "dry_run"); assert.equal(f.calls.length, 0);
});

test("preview equals what is sent: the request body carries exactly the previewed words", async () => {
  const f = stub();
  const words = finalText("SMS", "Hello Dana", { footerEnabled: true, footerText: "Reply STOP to opt out." });
  const r = await send(words, { WRITE_GHL_LIVE: "true" }, f);
  assert.equal(r.outcome, "done");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, "/conversations/messages");
  assert.equal(f.calls[0].body?.message, words);
  assert.equal(f.calls[0].body?.type, "SMS");
});

test("nothing is sent without the person's confirm", async () => {
  const f = stub();
  const r = await send("Hello", { WRITE_GHL_LIVE: "true" }, f, { confirmed: false });
  assert.equal(r.outcome, "needs_confirm"); assert.equal(f.calls.length, 0);
});

test("the last check just before the request can stop a send, and a failed check stops it too (fail closed)", async () => {
  const f1 = stub();
  const r1 = await send("Hello", { WRITE_GHL_LIVE: "true" }, f1, { preSend: async () => [{ id: "dnd", text: "asked not to be contacted" }] });
  assert.equal(r1.outcome, "blocked"); assert.equal(f1.calls.length, 0);
  const f2 = stub();
  const r2 = await send("Hello 2", { WRITE_GHL_LIVE: "true" }, f2, { preSend: async () => { throw new Error("CRM down"); } });
  assert.equal(r2.outcome, "blocked"); assert.equal(f2.calls.length, 0);
});

test("a failed send says so and is not recorded as sent", async () => {
  const f = { calls: [] as never[], fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch };
  const r = await send("Hello", { WRITE_GHL_LIVE: "true" }, f as never, {});
  assert.equal(r.outcome, "failed");
});

// ---------------- source checks ----------------
const ROOT = process.cwd();
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const walk = (d: string): string[] => readdirSync(join(ROOT, d)).flatMap((n) => { const p = `${d}/${n}`; return statSync(join(ROOT, p)).isDirectory() ? (n === "__tests__" || n === "node_modules" ? [] : walk(p)) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : []; });

test("our own sends never change our own numbers: they are written to the shared write log and the sync skips them", () => {
  assert.match(read("src/lib/ghl/workbench.ts"), /kind: a\.action\.kind === "message" \? "message"/);
  assert.match(read("src/lib/sync/engine.ts"), /kind = 'message' and ghl_id is not null/);
  assert.match(read("src/lib/api/send-routes.ts"), /recordSend/);
});

test("nowhere does SubSync turn a live switch on, and every send goes through the one gateway", () => {
  const src = read("src/lib/api/send-routes.ts");
  assert.doesNotMatch(src, /process\.env\.\w+LIVE\s*=|SEND_EMAIL_LIVE|SEND_SLACK_LIVE/);
  assert.match(src, /runAction\(/);
  assert.doesNotMatch(src, /ghlFetch\([^)]*conversations\/messages/, "no message is posted outside the gateway");
});

// The copy test: no screen, guide, email, doc or comment may say SubSync never messages, replies or sends (King, 13 Nov 2026).
const NEVER = /\bnever (messages|replies|sends (a |any )?(message|messages|reply|replies))\b|\b(does not|cannot) (message|send repl|send messages)|\bnever replies for the agency\b|SubSync never sends anything to the lead|It reads only\. It never messages/i;
test("copy: nothing in the app says SubSync never messages, replies or sends", () => {
  const bad: string[] = [];
  for (const f of walk("src")) { if (f === "src/lib/ghl/send-guard.ts") continue; read(f).split(/\r?\n/).forEach((line, i) => { if (NEVER.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); }); }
  assert.deepEqual(bad, []);
});

test("copy: the one accurate statement is what the app says about sending", () => {
  assert.match(read("src/lib/ghl/send-guard.ts"), /SubSync sends a message only when a person presses Send \(or a schedule they set\), never on its own\. It never sends to a contact who asked not to be contacted\./);
  assert.match(read("src/lib/trust.ts"), /only when a person presses Send/);
  assert.match(read("CLAUDE.md"), /SUPERSEDED BY KING, 13 NOV 2026/);
});

test("copy: no claim that SubSync is read-only as a whole", () => {
  const bad: string[] = [];
  for (const f of ["src/app/page.tsx", "src/app/support/page.tsx", "src/lib/slack-chat/format.ts", "src/lib/guides.ts", "src/lib/getting-started.ts", "src/app/app/views/ai-card.tsx", "src/app/app/views/settings-hub-parts.tsx", "src/app/app/views/write-access.tsx"]) {
    read(f).split(/\r?\n/).forEach((line, i) => { if (/Read-only by default|SubSync only reads|SubSync reads your CRM\.\s*It never|Read only: SubSync never messages|never changes your CRM/i.test(line)) bad.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
});

// The copy test, part 3 (13 Nov 2026): the Calendars card and every card wording that claimed SubSync only reads, or that there is nothing to connect.
const ONLY_READS = /SubSync only reads|SubSync only READS|Nothing to connect here|whatever tool feeds|never changes anything|never writes anything|SubSync is read-only|It does not change anything in your account/i;
test("copy: no card, guide, listing doc or scope reason says SubSync only reads", () => {
  const bad: string[] = [];
  for (const f of [...walk("src"), "docs/COMPETITORS.md", "docs/features/Z2.md"]) {
    if (f.includes("__tests__")) continue;
    read(f).split(/\r?\n/).forEach((line, i) => { if (!/^\s*(\/\/|\/\*|\*)/.test(line) && ONLY_READS.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(bad, []);
});
